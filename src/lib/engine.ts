/**
 * Bridge to the Rust backend (src-tauri/src). Only meaningful inside the desktop app;
 * in a plain browser tab `inDesktopApp` is false and the UI runs its demo mode.
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { JobSpec, MediaSource, RenderSpec } from "../types";

export const inDesktopApp = "__TAURI_INTERNALS__" in window;

export interface EngineStatus {
  ytDlp: string | null;
  ffmpeg: string | null;
}

export type JobEvent =
  | {
      kind: "progress";
      id: string;
      phase: "downloading" | "processing" | "cutting" | "encoding";
      percent: number | null;
      downloadedBytes: number | null;
      totalBytes: number | null;
      speedBps: number | null;
      etaSeconds: number | null;
    }
  | { kind: "done"; id: string; path: string; sizeBytes: number }
  | { kind: "failed"; id: string; message: string }
  | { kind: "cancelled"; id: string };

/** Rust commands reject with a plain message string. */
const message = (err: unknown) => (typeof err === "string" ? err : err instanceof Error ? err.message : String(err));

export const engineStatus = () => invoke<EngineStatus>("engine_status");

/** Updates the bundled yt-dlp; resolves with its answer ("Updated yt-dlp to …" or "up to date"). */
export const updateYtDlp = () => invoke<string>("update_yt_dlp");

/** A cookies.txt file yt-dlp uses for logins instead of Craftora's sign-in window, or null. */
export const getCookieFile = () => invoke<string | null>("get_cookie_file");
export const setCookieFile = (file: string | null) => invoke<void>("set_cookie_file", { file });

/** Opens a website or a video's page in a Craftora window, to log in and pick a video there. */
export const openSignIn = (site: string) => invoke<void>("open_sign_in", { site });
export const signOutEverywhere = () => invoke<void>("sign_out_everywhere");
/** What "Fetch this video" saw in the sign-in window (`FoundPage` in src-tauri/src/signin.rs). */
export interface FoundPage {
  page: string;
  title: string;
  /** Video files and embedded players the page plays, best guesses first, each carrying the page. */
  media: string[];
}

export const onFetchPage = (handler: (found: FoundPage) => void): Promise<UnlistenFn> =>
  listen<FoundPage>("fetch-page", (e) => handler(e.payload));

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
    const previewUrl = await cached(source.previewUrl);
    const previewAudioUrl = await cached(source.previewAudioUrl);
    return { ...source, previewUrl, previewAudioUrl, previewCacheIds: ids };
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
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp"];

/** The preview plays files straight from disk through Tauri's asset protocol. */
const assetUrl = (path: string) => (path ? convertFileSrc(path) : "");

/** Reads a file on this PC with ffprobe. Works offline. */
export async function openLocal(path: string): Promise<MediaSource> {
  try {
    const source = await invoke<MediaSource>("open_local", { path });
    return { ...source, previewUrl: assetUrl(source.previewUrl), previewAudioUrl: assetUrl(source.previewAudioUrl ?? "") };
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

export async function pickCookieFile(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    title: "Choose a cookie file (cookies.txt)",
    filters: [{ name: "Cookie file", extensions: ["txt"] }],
  });
  return typeof picked === "string" ? picked : null;
}

export async function pickMediaFile(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    title: "Open a video or audio file",
    filters: [{ name: "Video and audio", extensions: MEDIA_EXTENSIONS }],
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

export const onJobEvent = (handler: (event: JobEvent) => void): Promise<UnlistenFn> =>
  listen<JobEvent>("job-event", (e) => handler(e.payload));

export const revealFile = (path: string) => revealItemInDir(path);

/** Makes the app window fill the screen (desktop app only). */
export async function setWindowFullscreen(on: boolean): Promise<void> {
  if (!inDesktopApp) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setFullscreen(on);
}
