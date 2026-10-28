/**
 * Bridge to the Rust backend (src-tauri/src). Only meaningful inside the desktop app;
 * in a plain browser tab `inDesktopApp` is false and the UI runs its demo mode.
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { Caption, JobSpec, MediaSource, RenderSpec } from "../types";
import { captureThumbnail } from "./thumbnail";

export const inDesktopApp = "__TAURI_INTERNALS__" in window;

export interface EngineStatus {
  ytDlp: string | null;
  ffmpeg: string | null;
}

export type JobEvent =
  | {
      kind: "progress";
      id: string;
      phase: "downloading" | "processing" | "cutting" | "encoding" | "recording";
      percent: number | null;
      downloadedBytes: number | null;
      totalBytes: number | null;
      speedBps: number | null;
      etaSeconds: number | null;
    }
  | { kind: "done"; id: string; path: string; sizeBytes: number }
  | { kind: "failed"; id: string; message: string }
  | { kind: "cancelled"; id: string }
  | { kind: "paused"; id: string };

/** Rust commands reject with a plain message string. */
const message = (err: unknown) => (typeof err === "string" ? err : err instanceof Error ? err.message : String(err));

export const engineStatus = () => invoke<EngineStatus>("engine_status");

/** Updates the bundled yt-dlp; resolves with its answer ("Updated yt-dlp to …" or "up to date"). */
export const updateYtDlp = () => invoke<string>("update_yt_dlp");


/** Opens a website or a video's page in a Craftora window, to log in and pick a video there. */
export const openSignIn = (site: string) => invoke<void>("open_sign_in", { site });
export const signOutEverywhere = () => invoke<void>("sign_out_everywhere");
/** Websites Craftora keeps a login for, such as "youtube.com". */
export const signedInSites = () => invoke<string[]>("signed_in_sites");
export const signOutOf = (site: string) => invoke<void>("sign_out_of", { site });
/** A short message shown on top of the page in the sign-in window. */
export const tellSignIn = (message: string) => invoke<void>("tell_sign_in", { message });
/** What "Fetch this video" saw in the sign-in window (`FoundPage` in src-tauri/src/signin.rs). */
export interface FoundPage {
  page: string;
  title: string;
  /** The page's own preview picture, or "". */
  image: string;
  /** Video files and embedded players the page plays, best guesses first, each carrying the page. */
  media: string[];
  /**
   * How videos were seen playing: "file", "player" (the site's own stream player) or "webrtc" (a
   * direct live connection, with nothing to fetch), each maybe followed by " in a frame from <host>".
   */
  playing?: string[];
}

export const onFetchPage = (handler: (found: FoundPage) => void): Promise<UnlistenFn> =>
  listen<FoundPage>("fetch-page", (e) => handler(e.payload));

/**
 * A video's picture as a small copy kept with the media: fetched once by Rust with the page it
 * belongs to (some sites refuse their pictures to other pages), so the site isn't asked again
 * each time it shows. Falls back to the picture's address.
 */
export async function keptThumbnail(url: string, link: string): Promise<string> {
  try {
    const bytes = await invoke<ArrayBuffer>("fetch_thumbnail", { url, link });
    const local = URL.createObjectURL(new Blob([bytes]));
    try {
      return (await captureThumbnail(local, true)) ?? url;
    } finally {
      URL.revokeObjectURL(local);
    }
  } catch {
    return url;
  }
}

/** What VirusTotal's security vendors say about a website (`SiteReport` in virustotal.rs). */
export interface SiteReport {
  site: string;
  malicious: number;
  suspicious: number;
  /** 0 when VirusTotal has no report on the site yet. */
  total: number;
  /** The vendors that flag the site, and what they call it ("phishing", "malware"…). */
  flaggedBy: { vendor: string; verdict: string }[];
  /** What kind of site it is ("video sharing"…). */
  categories: string[];
  /** VirusTotal's community score: below 0 means people found it harmful. */
  reputation: number;
  votesSafe: number;
  votesDangerous: number;
  /** Seconds since 1970, or null if never scanned. */
  scannedAt: number | null;
  /** The full report on VirusTotal's website. */
  reportUrl: string;
}
/** Whether this copy of Craftora was built with a VirusTotal key ("Is this link safe?"). */
export const siteCheckAvailable = () => invoke<boolean>("site_check_available");
export const checkSite = (link: string) => invoke<SiteReport>("check_site", { link });

/** Carries the page a link's servers want (`REFERER_MARK` in src-tauri/src/signin.rs). */
const PAGE_MARK = "#craftora-referer=";
/** The HLS relay in src-tauri/src/media_cache.rs (Windows' address for the `cmedia` scheme). */
export const HLS_RELAY = "http://cmedia.localhost/hls";
/** Where the preview plays live recordings in progress (src-tauri/src/live.rs). */
export const RECORDINGS = "http://cmedia.localhost/rec/";
export const recordingUrl = (jobId: string) => `${RECORDINGS}${jobId}/index.m3u8`;

/** Starts recording a live link as job `id`; resolves with the growing playlist's path. */
export const recordLive = (spec: { id: string; url: string; title: string }) =>
  invoke<string>("record_live", { spec }).catch((err) => Promise.reject(new Error(message(err))));
/** Ends a recording and keeps it: the job finishes with the whole video as an MP4. */
export const stopRecording = (id: string) => invoke<boolean>("stop_recording", { id });
/** Lets the preview and exports read a file on this PC without probing it. */
export const allowLocal = (path: string) => invoke("allow_local", { path });

export async function fetchMedia(url: string): Promise<MediaSource> {
  try {
    const source = await invoke<MediaSource>("fetch_media", { url });
    // The preview plays through the disk cache, so parts already fetched scrub instantly.
    const ids: string[] = [];
    const cached = async (remote?: string) => {
      if (!remote) return remote ?? "";
      const id = await invoke<string>("cache_media", { url: remote });
      ids.push(id);
      return convertFileSrc(id, "cmedia");
    };
    // Stream playlists can't go through the byte cache. The WebView plays them itself, except
    // when their server wants the page they came from: then hls.js plays them through the relay.
    const previewUrl = !source.previewHls
      ? await cached(source.previewUrl)
      : source.previewUrl.includes(PAGE_MARK)
        ? `${HLS_RELAY}?u=${encodeURIComponent(source.previewUrl)}`
        : source.previewUrl;
    const previewAudioUrl = await cached(source.previewAudioUrl);
    // The site's picture is kept (keptThumbnail) by the editor after the video shows up: not waited for here.
    return { ...source, thumbnail: source.thumbnail || undefined, previewUrl, previewAudioUrl, previewCacheIds: ids };
  } catch (err) {
    throw new Error(message(err));
  }
}

/** Fills a link's preview cache from start to end in the background ("Download first"). */
export const prefetchPreview = (id: string) => invoke("prefetch_media", { id });

/** How much of each cached preview stream is on disk, 0–100. */
export const onPreviewCache = (handler: (id: string, percent: number) => void): Promise<UnlistenFn> =>
  listen<{ id: string; percent: number }>("media-cache", (e) => handler(e.payload.id, e.payload.percent));

/** File types offered in the Open dialog; FFmpeg reads many more if dropped. */
const MEDIA_EXTENSIONS = ["mp4", "mkv", "webm", "mov", "avi", "m4v", "wmv", "flv", "ts", "mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma"];
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "jfif", "webp", "bmp", "gif", "avif", "tif", "tiff", "ico"];

/**
 * The preview plays files from disk through Craftora's own `cmedia` server, piece by piece (Tauri's
 * asset protocol read a whole file into memory for some requests, which crashed on a 4 GB video).
 */
const assetUrl = (path: string) => (path ? `${convertFileSrc("file", "cmedia")}?p=${encodeURIComponent(path)}` : "");

interface QuickLocal {
  path: string;
  title: string;
  sizeMb: number;
  kind: "video" | "audio" | "image";
  ext: string;
}

function browserProbe(url: string, kind: "video" | "audio"): Promise<{ duration: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    const done = (val: { duration: number; width: number; height: number } | null) => {
      window.clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      resolve(val);
    };
    const timer = window.setTimeout(() => done(null), 1500);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const duration = el.duration;
      if (!Number.isFinite(duration) || duration <= 0) return done(null);
      const width = kind === "video" ? (el as HTMLVideoElement).videoWidth : 0;
      const height = kind === "video" ? (el as HTMLVideoElement).videoHeight : 0;
      done({ duration, width, height });
    };
    el.onerror = () => done(null);
    el.src = url;
  });
}

/** Reads a file on this PC with ffprobe (used when the WebView can't open the container directly). */
export async function probeLocal(path: string): Promise<MediaSource> {
  try {
    const source = await invoke<MediaSource>("open_local", { path });
    const previewUrl = assetUrl(source.previewUrl);
    return {
      ...source,
      previewUrl,
      previewAudioUrl: assetUrl(source.previewAudioUrl ?? ""),
      thumbnail: source.thumbnail || (source.image ? previewUrl : previewUrl ? `${previewUrl}#t=0.5` : ""),
    };
  } catch (err) {
    throw new Error(message(err));
  }
}

/** Opens a file on this PC immediately using the WebView's own media reader, falling back to ffprobe when needed. */
export async function openLocal(path: string): Promise<MediaSource> {
  try {
    const quick = await invoke<QuickLocal>("allow_local", { path });
    const previewUrl = assetUrl(quick.path);
    const detail = quick.ext.toUpperCase() || "Local";
    if (quick.kind === "image") {
      return {
        url: quick.path,
        title: quick.title,
        uploader: "On this PC",
        duration: 86400,
        local: true,
        previewUrl,
        previewHasAudio: false,
        previewAudioUrl: "",
        previewHls: false,
        previewProxy: "",
        image: true,
        thumbnail: previewUrl,
        chapters: [],
        streams: [{ id: "local:image", kind: "video", label: "Image", detail, sizeMb: quick.sizeMb }],
      };
    }
    const fast = await browserProbe(previewUrl, quick.kind);
    if (fast && (quick.kind === "audio" || fast.height > 0)) {
      const streams: MediaSource["streams"] = [];
      if (fast.height > 0) {
        streams.push({ id: "local:video", kind: "video", label: `${fast.height}p`, detail, sizeMb: quick.sizeMb });
      }
      streams.push({ id: "local:audio", kind: "audio", label: "Original audio", detail, sizeMb: quick.sizeMb });
      return {
        url: quick.path,
        title: quick.title,
        uploader: "On this PC",
        duration: fast.duration,
        local: true,
        previewUrl,
        previewHasAudio: true,
        previewAudioUrl: "",
        previewHls: false,
        previewProxy: "",
        image: false,
        thumbnail: fast.height > 0 ? `${previewUrl}#t=0.5` : "",
        chapters: [],
        streams,
      };
    }
    return await probeLocal(quick.path);
  } catch (err) {
    throw new Error(message(err));
  }
}

/**
 * Makes the preview copy a file needs (its `previewProxy`) and returns the source with
 * playable preview links. Can take a while for long videos; the copy is kept for next time.
 */
export async function makePreview(source: MediaSource): Promise<MediaSource> {
  try {
    const files = await invoke<{ video: string; audio: string }>("make_preview", { path: source.url });
    return { ...source, previewUrl: assetUrl(files.video), previewAudioUrl: assetUrl(files.audio), previewProxy: "" };
  } catch (err) {
    throw new Error(message(err));
  }
}

/** Shows the Windows Open dialog; empty when the user cancels. */
export async function pickMediaFiles(): Promise<string[]> {
  const picked = await open({
    multiple: true,
    directory: false,
    title: "Import video, audio or image files",
    filters: [
      { name: "Video, audio and images", extensions: [...MEDIA_EXTENSIONS, ...IMAGE_EXTENSIONS] },
      { name: "Images", extensions: IMAGE_EXTENSIONS },
    ],
  });
  return Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
}

export async function pickMediaFile(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    title: "Find the file",
    filters: [{ name: "Video, audio and images", extensions: [...MEDIA_EXTENSIONS, ...IMAGE_EXTENSIONS] }],
  });
  return typeof picked === "string" ? picked : null;
}

export type DropState = "over" | "left" | { dropped: string[] };

/** Shows the folder picker; null when the user cancels. */
export async function pickFolder(title: string): Promise<string | null> {
  const picked = await open({ multiple: false, directory: true, title });
  return typeof picked === "string" ? picked : null;
}

/** Files dragged onto the window. */
export const onFileDrop = (handler: (state: DropState) => void): Promise<UnlistenFn> =>
  getCurrentWebview().onDragDropEvent((event) => {
    const { type } = event.payload;
    if (type === "enter" || type === "over") handler("over");
    else if (type === "leave") handler("left");
    else if (type === "drop") handler({ dropped: event.payload.paths });
  });

export async function startJob(spec: JobSpec): Promise<void> {
  try {
    await invoke("start_job", { spec });
  } catch (err) {
    throw new Error(message(err));
  }
}

/** Renders a whole timeline in one FFmpeg pass. */
export async function startRender(spec: RenderSpec): Promise<void> {
  try {
    await invoke("start_render", { spec });
  } catch (err) {
    throw new Error(message(err));
  }
}

export const cancelJob = (id: string) => invoke<boolean>("cancel_job", { id });

/** Downloads a whole link into Videos\Craftora\Downloads; progress arrives as job events. */
export async function downloadMedia(spec: { id: string; url: string; format: string; title: string; audioOnly: boolean }): Promise<void> {
  try {
    await invoke("download_media", { spec });
  } catch (err) {
    throw new Error(message(err));
  }
}

/** What encodes "Fast" exports on this PC, e.g. "your NVIDIA graphics card". */
export const exportEncoder = () => invoke<string>("export_encoder");

/** Pauses a "download for editing", keeping what it saved; starting it again continues it. */
export const pauseJob = (id: string) => invoke<boolean>("pause_job", { id });
/** Throws away what a paused download saved. */
export const discardDownload = (id: string) => invoke<void>("discard_download", { id });

export interface DownloadedFile {
  name: string;
  path: string;
  sizeBytes: number;
  /** Milliseconds since 1970. */
  modifiedMs: number;
}
/** The Downloads folder and the finished downloads in it, newest first. */
export const listDownloads = () => invoke<{ folder: string; files: DownloadedFile[] }>("list_downloads");

/** What fetching and previewing did, web addresses hidden (src-tauri/src/diag.rs). */
export const copyReport = async () => navigator.clipboard.writeText(await invoke<string>("diagnostics"));
/** Adds a step the editor saw to that report. */
export const noteDiagnostic = (text: string) => void invoke("note_diagnostic", { text }).catch(() => {});

export const onJobEvent = (handler: (event: JobEvent) => void): Promise<UnlistenFn> =>
  listen<JobEvent>("job-event", (e) => handler(e.payload));

export const revealFile = (path: string) => revealItemInDir(path);
export const openFile = (path: string) => invoke<void>("open_file", { path });
/** Renames a finished download in the Downloads folder; resolves its new path. */
export const renameDownload = (path: string, name: string) => invoke<string>("rename_download", { path, name });
/** The proxy Craftora's connections use now, and the one its window started with (null: direct). */
export interface ProxyState {
  proxy: string | null;
  window: string | null;
}
export const getProxy = () => invoke<ProxyState>("get_proxy");
/** Saves and uses a proxy ("http://host:port"), or none with null; rejects addresses that won't work. */
export const setProxy = (proxy: string | null) => invoke<ProxyState>("set_proxy", { proxy });
/** The internet address websites see now (asks Cloudflare). */
export const checkAddress = () => invoke<string>("check_address");
/** Moves an exported file to the Recycle Bin. */
export const deleteFile = (path: string) => invoke<void>("delete_file", { path });
export const localThumbnail = (path: string, image = false) => invoke<string>("local_thumbnail", { path, image });

const fileThumbnails = new Map<string, Promise<string | undefined>>();
let thumbnailTurn: Promise<unknown> = Promise.resolve();
/**
 * A small picture (JPEG data URL) of a file on this PC that isn't open in the editor (Downloads,
 * Media library): made once per file, one file at a time, undefined when it can't be.
 */
export function fileThumbnail(path: string, image = false): Promise<string | undefined> {
  let made = fileThumbnails.get(path);
  if (!made) {
    made = thumbnailTurn.then(() => allowLocal(path).then(() => localThumbnail(path, image))).catch(() => undefined);
    thumbnailTurn = made;
    fileThumbnails.set(path, made);
  }
  return made;
}
export const audioPeaks = (path: string) => invoke<number[]>("audio_peaks", { path });
/** A fetched video's captions (`MediaSource.captions.url`) as timed lines. */
export const loadCaptions = (url: string, link: string) => invoke<Caption[]>("load_captions", { url, link });
/** Captions made from what's said (whisper.cpp, on this PC); `source` is a file path or a link. */
export const makeCaptions = (id: string, source: string, local: boolean) => invoke<Caption[]>("make_captions", { id, source, local });
export interface SpeechProgress {
  id: string;
  /** "model": downloading the speech model (first time only); "sound": getting a link's sound. */
  stage: "model" | "sound" | "listening";
  percent: number;
}
export const onSpeechProgress = (handler: (progress: SpeechProgress) => void): Promise<UnlistenFn> =>
  listen<SpeechProgress>("speech-progress", (e) => handler(e.payload));
/** Each caption line as soon as whisper has it, before the whole video is done. */
export const onSpeechLine = (handler: (id: string, line: Caption) => void): Promise<UnlistenFn> =>
  listen<{ id: string; line: Caption }>("speech-line", (e) => handler(e.payload.id, e.payload.line));
export const detectSilences = (path: string, start: number, end: number) => invoke<[number, number][]>("detect_silences", { path, start, end });
export const saveSnapshot = (bytes: number[], title: string) => invoke<string>("save_snapshot", { bytes, title });

/** Makes the app window fill the screen (desktop app only). */
export async function setWindowFullscreen(on: boolean): Promise<void> {
  if (!inDesktopApp) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setFullscreen(on);
}
