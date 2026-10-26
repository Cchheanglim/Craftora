import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExportSettings, Job, MediaSource } from "./types";
import { DEMO_JOBS, DEMO_SOURCES } from "./data/demo";
import {
  engineStatus,
  exportEncoder,
  fetchMedia,
  keptThumbnail,
  siteCheckAvailable,
  inDesktopApp,
  makePreview,
  onPreviewCache,
  prefetchPreview,
  onFileDrop,
  localThumbnail,
  audioPeaks,
  detectSilences,
  openLocal,
  probeLocal,
  recordLive,
  recordingUrl,
  allowLocal,
  pickFolder,
  saveSnapshot,
  pickMediaFiles,
  openSignIn,
  onFetchPage,
  type FoundPage,
  signOutEverywhere,
  tellSignIn,
  updateYtDlp,
  type EngineStatus,
} from "./lib/engine";
import {
  DEFAULT_OUTPUT_DIR,
  deleteProject,
  getOutputDir,
  listProjects,
  loadFetchHistory,
  loadHistory,
  loadProject,
  saveFetchHistory,
  saveHistory,
  saveProject,
  setOutputDir,
  type FetchEntry,
  type ProjectEntry,
} from "./lib/storage";
import { captureThumbnail } from "./lib/thumbnail";
import { useQueue } from "./state/useQueue";
import { storeEdition, useUpdates } from "./lib/updates";
import { formatClock } from "./lib/timecode";
import { useProject } from "./project/useProject";
import { applyEdit } from "./project/actions";
import { usePlayback } from "./project/usePlayback";
import { cutModeApplies, frameOf, planExport } from "./project/exportPlan";
import {
  NO_CROP,
  baseVideoTrack,
  clipEnd,
  emptyProject,
  mediaFromSource,
  previousOnTrack,
  projectDuration,
  projectName,
  silencesFromPeaks,
  upgradeProject,
  type MediaItem,
  type Project,
} from "./project/model";
import { Toolbar } from "./components/Toolbar";
import { Sidebar, type View } from "./components/Sidebar";
import { Home } from "./components/Home";
import { Preview } from "./components/Preview";
import { TimelineEditor } from "./components/TimelineEditor";
import { Inspector } from "./components/Inspector";
import { ExportPanel } from "./components/ExportPanel";
import { QueueDock } from "./components/QueueDock";
import { Library } from "./components/Library";
import { AssistantPanel } from "./components/AssistantPanel";
import { TextMenu } from "./components/TextMenu";
import { WelcomeDialog, alreadyWelcomed } from "./components/WelcomeDialog";
import "./App.css";

const DEMO = DEMO_SOURCES[0];
/** Quiet time after the last edit before the project is saved. */
const AUTOSAVE_MS = 600;

/** Browser preview: the sample film already on the timeline, trimmed. */
function demoProject(): Project {
  const project = emptyProject();
  const item = mediaFromSource(DEMO);
  return {
    ...project,
    media: [item],
    clips: [
      {
        id: "demo-clip",
        trackId: baseVideoTrack(project)!.id,
        mediaId: item.id,
        start: 0,
        in: 84,
        out: 225.5,
        speed: 1,
        volume: 1,
        mirror: false,
        reverse: false,
        fadeIn: 0,
        fadeOut: 0,
        crop: NO_CROP,
        size: 1,
        x: 0.5,
        y: 0.5,
      },
    ],
  };
}

const DEFAULT_SETTINGS: ExportSettings = {
  output: "video",
  videoContainer: "mp4",
  audioContainer: "mp3",
  cutMode: "fast",
  frameId: "1080p",
  quality: "fast",
};

/** Panel open/closed is remembered per machine; storage may be unavailable. */
function remembered(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function remember(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* not essential */
  }
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName));

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The project's picture for lists: the first media that has one. */
const coverOf = (project: Project) => project.media.find((m) => m.source.thumbnail)?.source.thumbnail;

/** Why "Fetch this video" found nothing, from how the page was seen playing. */
function notFoundMessage(found: FoundPage): string {
  const playing = found.playing ?? [];
  const seen = playing.length ? ` (Craftora saw: ${playing.join("; ")})` : "";
  if (playing.some((p) => p.startsWith("webrtc")))
    return `This page plays its video over a direct live connection (WebRTC), which has no link Craftora can fetch.${seen}`;
  if (playing.length)
    return `A video is playing, but Craftora couldn't see where it comes from.${seen}`;
  return "No video was playing when you clicked Fetch this video. Press play in the window, wait until the video moves, then click Fetch this video again.";
}

/** "youtube.com" for a link, or null when it doesn't parse. */
function siteOf(link: string): string | null {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Fetches a link; when yt-dlp doesn't know the page ("Unsupported URL"), tries what the page was
 * seen playing instead, titled like the page (a stream's own title is just its file name).
 */
async function fetchFirst(link: string, found?: FoundPage): Promise<MediaSource> {
  try {
    return await fetchMedia(link);
  } catch (err) {
    if (!found?.media.length || !/unsupported url/i.test(errorText(err))) throw err;
    let firstProblem: unknown;
    for (const media of found.media) {
      try {
        const source = await fetchMedia(media);
        const thumbnail = source.thumbnail || (found.image ? await keptThumbnail(found.image, found.page) : undefined);
        return { ...source, title: found.title || source.title, thumbnail };
      } catch (problem) {
        // An ad or a player that isn't the video: try the next guess.
        firstProblem ??= problem;
      }
    }
    // Something was found but wouldn't open: say why, rather than "nothing found".
    throw new Error(`A video was found on this page, but it couldn't be opened: ${errorText(firstProblem)}`);
  }
}

/** Finished exports as kept in the history: without what only a running job needs. */
const forHistory = (j: Job): Job => ({ ...j, spec: undefined, render: undefined });

export default function App() {
  const [view, setView] = useState<View>(inDesktopApp ? "home" : "editor");
  const [leftOpen, setLeftOpen] = useState(() => remembered("craftora.left", true));
  const [rightOpen, setRightOpen] = useState(() => remembered("craftora.right", true));
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_SETTINGS);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [engines, setEngines] = useState<EngineStatus | "checking" | "browser">(inDesktopApp ? "checking" : "browser");
  const [projectId, setProjectId] = useState<string>(() => crypto.randomUUID());
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [history, setHistory] = useState<Job[] | null>(null);
  /** Links fetched before, newest first. */
  const [fetchHistory, setFetchHistory] = useState<FetchEntry[]>(loadFetchHistory);
  const changeFetchHistory = (next: FetchEntry[]) => {
    setFetchHistory(next);
    saveFetchHistory(next);
  };
  const [outputDir, setOutputDirState] = useState(DEFAULT_OUTPUT_DIR);
  /** Media whose preview copy is being made. */
  const [preparing, setPreparing] = useState<Set<string>>(() => new Set());
  const [cuttingSilences, setCuttingSilences] = useState(false);
  const [rightTab, setRightTab] = useState<"edit" | "assistant">("edit");
  /** How much of each link preview is cached on disk (by cache id), 0–100. */
  const [cached, setCached] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!inDesktopApp) return;
    const stop = onPreviewCache((id, percent) => setCached((all) => ({ ...all, [id]: percent })));
    return () => void stop.then((unlisten) => unlisten());
  }, []);
  const [fastEncoder, setFastEncoder] = useState<string | null>(null);
  const [signInMessage, setSignInMessage] = useState<string | null>(null);
  /** This copy was built with a VirusTotal key, so Home → Links can check links. */
  const [siteChecks, setSiteChecks] = useState(false);
  /** A link that failed in a way the sign-in window can fix: a login, or a page yt-dlp doesn't know. */
  const [pageAction, setPageAction] = useState<{ label: string; link: string } | null>(null);
  const [ytDlpUpdate, setYtDlpUpdate] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const urlRef = useRef<HTMLInputElement>(null);
  /** The first-launch guide is open (it shows until it's closed once). */
  const [welcoming, setWelcoming] = useState(() => !alreadyWelcomed());

  const api = useProject(() => (inDesktopApp ? emptyProject() : demoProject()));
  const { project } = api;
  const duration = projectDuration(project);
  const playback = usePlayback(duration);
  // The assistant reads these at the moment it needs them, between network calls.
  const projectRef = useRef(project);
  projectRef.current = project;
  const timeRef = useRef(playback.time);
  timeRef.current = playback.time;
  const currentProject = useCallback(() => projectRef.current, []);
  const currentTime = useCallback(() => timeRef.current, []);
  const queue = useQueue(inDesktopApp ? [] : DEMO_JOBS, inDesktopApp);
  const updates = useUpdates();

  useEffect(() => {
    if (inDesktopApp) {
      void engineStatus().then(setEngines);
      void exportEncoder().then(setFastEncoder).catch(() => setFastEncoder("the processor"));
      void siteCheckAvailable().then(setSiteChecks).catch(() => {});
    }
    void listProjects().then(setProjects).catch(() => setProjects([]));
    void loadHistory().then(setHistory);
    void getOutputDir().then(setOutputDirState).catch(() => {});
  }, []);

  // Save the project a moment after each change. Empty projects aren't worth keeping.
  useEffect(() => {
    if (project.media.length === 0 && project.clips.length === 0) return;
    const timer = window.setTimeout(() => {
      const entry: ProjectEntry = {
        id: projectId,
        name: projectName(project),
        savedAt: Date.now(),
        duration: projectDuration(project),
        clips: project.clips.length,
        thumbnail: coverOf(project),
      };
      saveProject({ ...entry, version: 1, project })
        .then(() => setProjects((list) => [entry, ...list.filter((p) => p.id !== entry.id)]))
        .catch((err) => setError(`Couldn't save the project: ${errorText(err)}`));
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [project, projectId]);

  // Keep every finished export in the history, saved across restarts.
  useEffect(() => {
    if (!history) return;
    const known = new Set(history.map((j) => j.id));
    // Exports only: downloads for editing aren't exports.
    const added = queue.jobs.filter((j) => j.status === "finished" && !j.prefetch && !j.record && !known.has(j.id)).map(forHistory);
    if (added.length === 0) return;
    const next = [...added, ...history].slice(0, 500);
    setHistory(next);
    void saveHistory(next).catch(() => {});
  }, [queue.jobs, history]);

  /** Hides a finished export from Exports and Home, or shows it again; the file isn't touched. */
  const setExportHidden = (id: string, hidden: boolean) => {
    if (!history) return;
    const next = history.map((j) => (j.id === id ? { ...j, hidden: hidden || undefined } : j));
    setHistory(next);
    void saveHistory(next).catch(() => {});
  };

  const toggleLeft = useCallback(() => setLeftOpen((o) => (remember("craftora.left", !o), !o)), []);
  const toggleRight = useCallback(() => setRightOpen((o) => (remember("craftora.right", !o), !o)), []);

  // A timeline with nothing visual can only be saved as sound.
  const hasPicture = project.clips.some((c) => !c.mediaId || project.tracks.find((t) => t.id === c.trackId)?.kind === "video");
  const effective: ExportSettings = useMemo(() => (hasPicture ? settings : { ...settings, output: "audio" }), [hasPicture, settings]);
  const plan = useMemo(() => planExport(project, effective), [project, effective]);
  const selected = project.clips.find((c) => c.id === selectedId) ?? null;

  /** Makes the preview copy for a file the player can't open, then swaps it in. */
  const prepare = useCallback(
    (mediaId: string, source: MediaSource) => {
      if (!source.previewProxy) return;
      setPreparing((s) => new Set(s).add(mediaId));
      makePreview(source)
        .then((ready) => api.refreshMedia(mediaId, { source: ready }))
        .catch((err) => setError(errorText(err)))
        .finally(() =>
          setPreparing((s) => {
            const next = new Set(s);
            next.delete(mediaId);
            return next;
          }),
        );
    },
    [api],
  );

  /** Puts fetched or opened media in the library; with `place`, also on the timeline. */
  const importSource = useCallback(
    (source: MediaSource, place: boolean, format?: string) => {
      const item = mediaFromSource(source);
      // The quality picked when fetching.
      if (format && item.hasVideo) item.videoFormat = format;
      else if (format) item.audioFormat = format;
      api.edit({ type: "importMedia", item });
      if (place) api.edit({ type: "addClip", clipId: crypto.randomUUID(), mediaId: item.id });
      prepare(item.id, source);
      setView("editor");
      return item;
    },
    [api, prepare],
  );

  // Files on this PC get a picture of their first frame and their real FFmpeg audio wave.
  const thumbTried = useRef(new Set<string>());
  const peaksTried = useRef(new Set<string>());
  useEffect(() => {
    if (!inDesktopApp) return;
    for (const m of project.media) {
      const s = m.source;
      // A recording in progress isn't probed: it keeps growing, and its playlist plays as it is.
      if (!s.local || s.image || s.live || peaksTried.current.has(m.id)) continue;
      peaksTried.current.add(m.id);
      // Wait until the video is already open in the editor before running background ffprobe/ffmpeg tasks.
      window.setTimeout(() => {
        void probeLocal(s.url)
          .then((fresh) => {
            const current = projectRef.current.media.find((x) => x.id === m.id);
            if (!current) return;
            const next = {
              ...fresh,
              duration: current.source.duration,
              thumbnail: current.source.thumbnail || fresh.thumbnail,
              peaks: current.source.peaks,
            };
            api.refreshMedia(m.id, { source: next, hasAudio: fresh.previewHasAudio !== false });
            prepare(m.id, next);
          })
          .catch(() => {});
        if (m.hasAudio && !s.peaks?.length) {
          void audioPeaks(s.url)
            .then((peaks) => {
              const current = projectRef.current.media.find((x) => x.id === m.id);
              if (peaks.length && current) api.refreshMedia(m.id, { source: { ...current.source, peaks } });
            })
            .catch(() => {});
        }
      }, 1500);
    }
  }, [project.media, api, prepare]);
  useEffect(() => {
    for (const m of project.media) {
      const s = m.source;
      if (!s.local || s.thumbnail?.startsWith("data:") || !(m.hasVideo || s.image) || thumbTried.current.has(m.id)) continue;
      if (!inDesktopApp && (s.previewProxy || !s.previewUrl)) continue;
      thumbTried.current.add(m.id);
      const task = (s.previewUrl ? captureThumbnail(s.previewUrl, s.image) : Promise.resolve(undefined)).then(
        (thumb) => thumb ?? (inDesktopApp ? localThumbnail(s.url, Boolean(s.image)).catch(() => undefined) : undefined),
      );
      void task.then((thumbnail) => {
        const current = projectRef.current.media.find((x) => x.id === m.id);
        // Only the list picture: an image keeps its full-size previewUrl (Preview falls back to this if it can't load).
        if (thumbnail && current) api.refreshMedia(m.id, { source: { ...current.source, thumbnail } });
      });
    }
  }, [project.media, api]);

  /** Queues a whole link to download, so it edits like a file on this PC. */
  const downloadForEditing = (item: MediaItem) => {
    if (!inDesktopApp || item.source.local) return;
    // Meanwhile, fill the preview's cache from the start, so scrubbing what's done is instant.
    for (const id of item.source.previewCacheIds ?? []) void prefetchPreview(id).catch(() => {});
    const format = item.hasVideo ? item.videoFormat : item.audioFormat;
    const stream = item.source.streams.find((s) => s.id === format);
    queue.add({
      id: crypto.randomUUID(),
      title: item.name,
      summary: `Download for editing · ${formatClock(item.source.duration)} · ${stream?.label ?? "best quality"}`,
      kind: item.hasVideo ? "video" : "audio",
      status: "waiting",
      progress: 0,
      needsEncode: false,
      sizeMb: stream?.sizeMb ?? 0,
      fileName: item.name,
      command: `yt-dlp -f "${format}" ${item.hasVideo ? "--merge-output-format mp4" : "-x --audio-format m4a"} "${item.source.url}"`,
      prefetch: { mediaId: item.id, url: item.source.url, format, title: item.name, audioOnly: !item.hasVideo },
    });
  };

  /** A live link is recorded while it plays, so it can be edited before the stream ends. */
  const recordForEditing = (item: MediaItem) => {
    const id = crypto.randomUUID();
    queue.add({
      id,
      title: item.name,
      summary: "Live stream · edit what's recorded while it plays",
      kind: "video",
      status: "downloading",
      phase: "recording",
      progress: null,
      needsEncode: false,
      sizeMb: 0,
      fileName: item.name,
      command: `ffmpeg -i <live stream of "${item.source.url}"> -c copy -f hls index.m3u8`,
      record: { mediaId: item.id },
    });
    recordLive({ id, url: item.source.url, title: item.name })
      .then((path) => recordings.current.set(id, { mediaId: item.id, path }))
      .catch((err) => {
        queue.remove(id);
        setError(`Couldn't record the live stream: ${errorText(err)}`);
      });
  };

  // Live recordings: every few seconds the media's length catches up with the parts saved so far.
  // From the first part on, the preview plays the recording and exports read it like a local file.
  const recordings = useRef(new Map<string, { mediaId: string; path: string }>());
  const recordingIds = queue.jobs.filter((j) => j.record && j.status === "downloading").map((j) => j.id).join();
  useEffect(() => {
    if (!recordingIds) return;
    const catchUp = async () => {
      for (const id of recordingIds.split(",")) {
        const rec = recordings.current.get(id);
        const item = rec && projectRef.current.media.find((m) => m.id === rec.mediaId);
        if (!rec || !item?.source.live) continue;
        const playlist = await fetch(recordingUrl(id)).then((r) => (r.ok ? r.text() : "")).catch(() => "");
        const seconds = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
        if (seconds <= item.source.duration) continue;
        if (!item.source.local) await allowLocal(rec.path).catch(() => {});
        const current = projectRef.current.media.find((m) => m.id === rec.mediaId);
        if (!current) continue;
        api.refreshMedia(current.id, {
          source: { ...current.source, url: rec.path, local: true, previewUrl: recordingUrl(id), previewHls: true, duration: seconds },
        });
      }
    };
    const timer = window.setInterval(() => void catchUp(), 3000);
    return () => window.clearInterval(timer);
  }, [recordingIds, api]);

  // A finished "download for editing" takes over its link: the media becomes the local file.
  // A finished live recording does the same with the whole recorded MP4.
  const swapped = useRef(new Set<string>());
  useEffect(() => {
    for (const job of queue.jobs) {
      const target = job.prefetch ?? job.record;
      if (!target || job.status !== "finished" || !job.outputPath || swapped.current.has(job.id)) continue;
      swapped.current.add(job.id);
      const { mediaId } = target;
      openLocal(job.outputPath)
        .then((local) => {
          const item = projectRef.current.media.find((m) => m.id === mediaId);
          if (!item) return;
          // Keep the link's length so clip times stay exactly where they were (a recording, or a
          // link whose length wasn't known, takes the file's).
          const duration = item.source.live || !item.source.duration ? local.duration : item.source.duration;
          api.refreshMedia(mediaId, { source: { ...local, duration }, missing: false });
          prepare(mediaId, local);
        })
        .catch((err) => setError(`The download finished but couldn't be opened: ${errorText(err)}`));
    }
  }, [queue.jobs, api, prepare]);

  /** `found`: what "Fetch this video" saw the page play, tried when yt-dlp doesn't know the page. */
  const fetchSource = async (link: string, found?: FoundPage) => {
    setUrl(link);
    setBusy(true);
    setError(null);
    setPageAction(null);
    try {
      let source: MediaSource;
      if (inDesktopApp) {
        source = await fetchFirst(link, found);
      } else {
        // Browser preview: only the demo links resolve.
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        const found = DEMO_SOURCES.find((s) => s.url.toLowerCase() === link.toLowerCase());
        if (!found) throw new Error("Real links need the desktop app.");
        source = found;
      }
      // Straight onto the timeline, after the last clip, ready to edit. With nothing the preview
      // can play (some stream sites), it downloads too, so it can still be edited.
      // A live stream goes to Media only: drag in the parts you want as they're recorded. So does a
      // video with no known length yet (behind a site's bot check): it downloads first.
      const item = importSource(source, !source.live && source.duration > 0);
      if (source.live && inDesktopApp) recordForEditing(item);
      else if (!source.previewUrl && inDesktopApp) downloadForEditing(item);
      if (found) void tellSignIn("Sent to Craftora ✓  You can close this window.").catch(() => {});
      const entry: FetchEntry = { url: link, title: source.title, thumbnail: source.thumbnail, fetchedAt: Date.now() };
      changeFetchHistory([entry, ...fetchHistory.filter((e) => e.url !== link)].slice(0, 50));
      setUrl("");
    } catch (err) {
      const text = errorText(err);
      // yt-dlp asks for a login as "Sign in to confirm…", "log in", "Use --cookies…".
      const needsLogin = /sign in|log ?in|cookies|private|members/i.test(text);
      const unsupported = /unsupported url/i.test(text);
      if (found) void tellSignIn("No video found yet. Play the video, then click Fetch this video again.").catch(() => {});
      setError(
        unsupported
          ? found
            ? notFoundMessage(found)
            : "Craftora doesn't know this website yet, but it can find the video while the page plays."
          : text,
      );
      const site = siteOf(link);
      if (inDesktopApp && site && (needsLogin || unsupported)) {
        setPageAction({ label: needsLogin ? `Sign in to ${site}` : "Find the video on the page", link });
      }
    } finally {
      setBusy(false);
    }
  };

  // "Fetch this video" in the sign-in window fetches the page it shows, with the login.
  const fetchRef = useRef(fetchSource);
  fetchRef.current = fetchSource;
  useEffect(() => {
    if (!inDesktopApp) return;
    const stop = onFetchPage((found) => void fetchRef.current(found.page, found));
    return () => void stop.then((unlisten) => unlisten());
  }, []);

  const refreshYtDlp = () => {
    setYtDlpUpdate({ busy: true, message: null });
    updateYtDlp()
      .then((message) => setYtDlpUpdate({ busy: false, message }))
      .catch((err) => setYtDlpUpdate({ busy: false, message: `Couldn't update: ${errorText(err)}` }))
      .finally(() => void engineStatus().then(setEngines));
  };

  /** Files from this PC: picked in the dialog, or dropped on the window. */
  const importFiles = async (dropped?: string[]) => {
    const paths = dropped ?? (await pickMediaFiles());
    if (paths.length === 0) return;
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    // Only the first file goes straight onto an empty timeline; the rest wait in Media.
    let place = project.clips.length === 0;
    const results = await Promise.allSettled(paths.map((path) => openLocal(path)));
    results.forEach((res, i) => {
      if (res.status === "fulfilled") {
        importSource(res.value, place);
        place = false;
      } else {
        failed.push(`${paths[i].split(/[\\/]/).pop()}: ${errorText(res.reason)}`);
      }
    });
    if (failed.length) setError(failed.join("  "));
    setBusy(false);
  };

  const importRef = useRef(importFiles);
  importRef.current = importFiles;
  useEffect(() => {
    if (!inDesktopApp) return;
    const unlisten = onFileDrop((state) => {
      if (state === "over") setDragging(true);
      else if (state === "left") setDragging(false);
      else {
        setDragging(false);
        if (state.dropped.length) void importRef.current(state.dropped);
      }
    });
    return () => void unlisten.then((stop) => stop());
  }, []);

  /**
   * After opening a saved project: files on this PC are opened again (the app only reads
   * files the user opened), and links are fetched again because their preview links expire.
   */
  const reconnect = (media: MediaItem[]) => {
    if (!inDesktopApp) return;
    for (const item of media) {
      const source = item.source;
      const refreshed = source.local ? openLocal(source.url) : fetchMedia(source.url);
      refreshed
        .then((fresh) => {
          api.refreshMedia(item.id, { source: { ...fresh, duration: source.duration }, missing: false });
          prepare(item.id, fresh);
        })
        .catch(() => {
          // A link that can't be fetched now (offline) keeps its old details and can still export later.
          if (source.local) api.refreshMedia(item.id, { missing: true });
        });
    }
  };

  const openProject = async (id: string) => {
    try {
      const saved = await loadProject(id);
      const opened = upgradeProject(saved.project);
      api.reset(opened);
      setProjectId(id);
      setSelectedId(null);
      playback.pause();
      playback.seek(0);
      setView("editor");
      reconnect(opened.media);
    } catch (err) {
      setError(`Couldn't open the project: ${errorText(err)}`);
    }
  };

  const newProject = () => {
    api.reset(emptyProject());
    setProjectId(crypto.randomUUID());
    setSelectedId(null);
    playback.pause();
    playback.seek(0);
    setView("editor");
  };

  const removeProject = async (id: string) => {
    try {
      await deleteProject(id);
      setProjects((list) => list.filter((p) => p.id !== id));
      if (id === projectId) {
        api.reset(emptyProject());
        setProjectId(crypto.randomUUID());
        setSelectedId(null);
      }
    } catch (err) {
      setError(errorText(err));
    }
  };

  const chooseOutputDir = async () => {
    const picked = await pickFolder("Choose where exports are saved");
    if (!picked) return;
    try {
      setOutputDirState(await setOutputDir(picked));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const addMedia = (mediaId: string) => {
    const clipId = crypto.randomUUID();
    api.edit({ type: "addClip", clipId, mediaId, at: playback.time });
    setSelectedId(clipId);
    setView("editor");
  };

  /** The selected clip, or else the clip under the playhead on the lowest video track that has one. */
  const splitTarget = () => {
    const t = playback.time;
    const under = (c: (typeof project.clips)[number]) => t > c.start && t < clipEnd(c);
    const selectedClip = project.clips.find((c) => c.id === selectedId && under(c));
    if (selectedClip) return selectedClip;
    const videoTracks = project.tracks.filter((tr) => tr.kind === "video").reverse();
    for (const track of videoTracks) {
      const clip = project.clips.find((c) => c.trackId === track.id && under(c));
      if (clip) return clip;
    }
    return undefined;
  };
  const split = () => {
    const clip = splitTarget();
    if (clip) api.edit({ type: "splitClip", clipId: clip.id, newClipId: crypto.randomUUID(), at: playback.time });
  };
  const duplicate = () => {
    if (!selectedId) return;
    const newClipId = crypto.randomUUID();
    api.edit({ type: "duplicateClip", clipId: selectedId, newClipId });
    setSelectedId(newClipId);
  };
  const cutSilences = async () => {
    const clip = project.clips.find((c) => c.id === selectedId);
    const media = clip?.mediaId ? project.media.find((m) => m.id === clip.mediaId) : undefined;
    if (!clip || !media || !media.hasAudio || media.source.image || cuttingSilences) return;
    setCuttingSilences(true);
    setError(null);
    try {
      const ranges =
        inDesktopApp && media.source.local
          ? await detectSilences(media.source.url, clip.in, clip.out)
          : silencesFromPeaks(media, clip.in, clip.out);
      if (ranges.length === 0) {
        setError(media.source.local || !inDesktopApp ? "No silent pauses were found in this clip." : "Download this link first (⬇ in Media) so Craftora can scan its sound for silences.");
        return;
      }
      api.edit({ type: "cutSilences", clipId: clip.id, ranges });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCuttingSilences(false);
    }
  };
  const takeSnapshot = async (bytes: Uint8Array) => {
    setError(null);
    try {
      if (inDesktopApp) {
        const path = await saveSnapshot(Array.from(bytes), projectName(project));
        importSource(await openLocal(path), false);
      } else {
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
        importSource(
          {
            url,
            title: `${projectName(project)}_snapshot`,
            uploader: "Snapshot",
            duration: 86400,
            local: true,
            previewUrl: url,
            previewHasAudio: false,
            image: true,
            thumbnail: url,
            streams: [{ id: "local:image", kind: "video", label: "Image", detail: "PNG", sizeMb: bytes.byteLength / 1_000_000 }],
          },
          false,
        );
      }
    } catch (err) {
      setError(errorText(err));
    }
  };
  const remove = () => {
    if (!selectedId) return;
    api.edit({ type: "deleteClip", clipId: selectedId });
    setSelectedId(null);
  };
  const addText = () => {
    const clipId = crypto.randomUUID();
    api.edit({ type: "addText", clipId, at: playback.time });
    setSelectedId(clipId);
    setView("editor");
  };

  const addToQueue = useCallback(() => {
    if (plan.kind === "empty") return;
    const id = crypto.randomUUID();
    const job: Job = {
      id,
      title: plan.title,
      summary: plan.summary,
      kind: effective.output,
      status: "waiting",
      progress: 0,
      needsEncode: plan.kind === "render",
      sizeMb: plan.sizeMb,
      fileName: plan.fileName,
      command: plan.command,
      spec: inDesktopApp && plan.kind === "simple" ? { ...plan.spec, id } : undefined,
      render: inDesktopApp && plan.kind === "render" ? { ...plan.spec, id } : undefined,
      thumbnail: coverOf(project),
    };
    queue.add(job);
    setFreshId(id);
    setQueuedCount((n) => n + 1);
  }, [plan, effective.output, queue, project]);

  // Keyboard shortcuts, CapCut-style.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    // Picking a suggestion from the link field's list sends a keydown without a key.
    const key = e.key?.toLowerCase();
    if (!key) return;
    if (ctrl && key === "enter" && view === "editor") return (e.preventDefault(), addToQueue());
    if (ctrl && key === "o" && inDesktopApp) return (e.preventDefault(), void importFiles());
    if (ctrl && key === "b") return (e.preventDefault(), e.altKey ? toggleRight() : toggleLeft());
    if (isTyping(e.target) || view !== "editor") return;
    if (ctrl && key === "z" && !e.shiftKey) return (e.preventDefault(), api.undo());
    if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) return (e.preventDefault(), api.redo());
    if (ctrl && key === "d") return (e.preventDefault(), duplicate());
    if (ctrl || e.altKey) return;
    const target = e.target as HTMLElement;
    const onButton = target.tagName === "BUTTON" || target.getAttribute("role") === "button";
    const t = playback.time;
    const actions: Record<string, () => void> = {
      " ": playback.toggle,
      s: split,
      delete: remove,
      backspace: remove,
      t: addText,
      f: () => window.dispatchEvent(new Event("craftora:toggle-fullscreen")),
      arrowleft: () => playback.seek(t - (e.shiftKey ? 1 : 1 / 30)),
      arrowright: () => playback.seek(t + (e.shiftKey ? 1 : 1 / 30)),
      home: () => playback.seek(0),
      end: () => playback.seek(duration),
      i: () => selectedId && api.edit({ type: "trimClip", clipId: selectedId, edge: "start", time: t }),
      o: () => selectedId && api.edit({ type: "trimClip", clipId: selectedId, edge: "end", time: t }),
      escape: () => setSelectedId(null),
    };
    const action = actions[key];
    if (!action || (key === " " && onButton)) return;
    e.preventDefault();
    action();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const exported = history ?? [];
  const shownExports = exported.filter((j) => !j.hidden);
  const usedMedia = new Set(project.clips.map((c) => c.mediaId).filter((id): id is string => Boolean(id)));
  const showPanel = view === "editor" && rightOpen;
  const selectedTrack = selected ? project.tracks.find((t) => t.id === selected.trackId) : undefined;

  return (
    <div className="app" data-left={leftOpen ? "open" : "closed"}>
      <Toolbar
        url={url}
        onUrlChange={(next) => {
          setUrl(next);
          setError(null);
        }}
        onFetch={(link) => void fetchSource(link)}
        fetching={busy}
        error={error}
        errorAction={
          pageAction
            ? {
                label: pageAction.label,
                // Opens the video's own page: log in or play it there, then "Fetch this video".
                onClick: () => void openSignIn(pageAction.link).catch((err) => setError(errorText(err))),
              }
            : undefined
        }
        canCheckSite={inDesktopApp && siteChecks}
        onImport={inDesktopApp ? () => void importFiles() : undefined}
        inputRef={urlRef}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={toggleLeft}
        onToggleRight={view === "editor" ? toggleRight : undefined}
        update={
          updates.status.kind === "available"
            ? { label: `Update to v${updates.status.version}`, onClick: () => void updates.install() }
            : updates.status.kind === "installing"
              ? { label: `Updating${updates.status.percent === null ? "…" : ` ${updates.status.percent}%`}` }
              : undefined
        }
      />
      <Sidebar
        view={view}
        onViewChange={setView}
        collapsed={!leftOpen}
        libraryCount={shownExports.length}
        engines={engines}
        media={project.media}
        preparing={preparing}
        previewReady={Object.fromEntries(
          project.media
            .filter((m) => m.source.previewCacheIds?.some((id) => cached[id] !== undefined))
            .map((m) => [m.id, Math.min(...(m.source.previewCacheIds ?? []).map((id) => cached[id] ?? 0))]),
        )}
        downloading={
          new Set(queue.jobs.filter((j) => j.prefetch && j.status !== "finished" && j.status !== "failed").map((j) => j.prefetch!.mediaId))
        }
        onDownload={inDesktopApp ? (mediaId) => {
          const item = project.media.find((m) => m.id === mediaId);
          if (item) downloadForEditing(item);
        } : undefined}
        onImport={inDesktopApp ? () => void importFiles() : undefined}
        onAddMedia={addMedia}
        onRemoveMedia={(mediaId) => api.edit({ type: "removeMedia", mediaId })}
        usedMedia={usedMedia}
        history={fetchHistory}
        onFetchAgain={(link) => void fetchSource(link)}
        onRemoveHistory={(link) => changeFetchHistory(fetchHistory.filter((e) => e.url !== link))}
        onClearHistory={() => changeFetchHistory([])}
      />

      <main className="app__work">
        {view === "home" && (
          <Home
            onImport={inDesktopApp ? () => void importFiles() : undefined}
            onPasteLink={() => urlRef.current?.focus()}
            busy={busy}
            projects={projects}
            currentId={project.clips.length || project.media.length ? projectId : null}
            onOpenProject={(id) => (id === projectId ? setView("editor") : void openProject(id))}
            onNewProject={newProject}
            onDeleteProject={(id) => void removeProject(id)}
            recent={shownExports}
            outputDir={outputDir}
            updates={updates}
            onOpenWelcome={() => setWelcoming(true)}
            links={
              inDesktopApp
                ? {
                    onSignIn: (site) => {
                      setSignInMessage(null);
                      openSignIn(site).catch((err) => setSignInMessage(errorText(err)));
                    },
                    onSignOut: () =>
                      void signOutEverywhere()
                        .then(() => setSignInMessage("Signed out of all websites."))
                        .catch((err) => setSignInMessage(errorText(err))),
                    signInMessage,
                    siteChecks,
                    onUpdateYtDlp: storeEdition ? undefined : refreshYtDlp,
                    updating: ytDlpUpdate.busy,
                    ytDlpMessage: ytDlpUpdate.message,
                  }
                : undefined
            }
          />
        )}
        {view === "library" && (
          <Library
            jobs={exported}
            onHide={setExportHidden}
            outputDir={outputDir}
            onChooseOutputDir={inDesktopApp ? () => void chooseOutputDir() : undefined}
            onOpenWorkspace={() => setView("editor")}
          />
        )}
        {view === "editor" && (
          <div className="app__editor">
            <Preview
              project={project}
              api={api}
              playback={playback}
              frame={frameOf(effective)}
              duration={duration}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onSnapshot={takeSnapshot}
            />
            <TimelineEditor
              project={project}
              api={api}
              playback={playback}
              duration={duration}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onSplit={split}
              onDuplicate={duplicate}
              onCutSilences={() => void cutSilences()}
              cuttingSilences={cuttingSilences}
              onDelete={remove}
              onAddText={addText}
            />
          </div>
        )}
      </main>

      {showPanel && (
        <div className="app__panel">
          <div className="segmented app__tabs" role="group" aria-label="Right panel">
            <button type="button" aria-pressed={rightTab === "edit"} onClick={() => setRightTab("edit")}>
              Edit & export
            </button>
            <button type="button" aria-pressed={rightTab === "assistant"} onClick={() => setRightTab("assistant")}>
              Assistant
            </button>
          </div>
          {rightTab === "assistant" ? (
            <AssistantPanel api={api} current={currentProject} playhead={currentTime} seek={playback.seek} />
          ) : (
            <ExportPanel
              settings={effective}
              onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
              plan={plan}
              cutModeApplies={cutModeApplies(project, effective)}
              hasPicture={hasPicture}
              onAddToQueue={addToQueue}
              onPreset={(frameId, fill) => {
                setSettings((prev) => ({ ...prev, frameId }));
                // Every picture on a video track fits or fills the new frame, as one undo step.
                const pictures = project.clips.filter((c) => c.mediaId && project.tracks.find((t) => t.id === c.trackId)?.kind === "video");
                const next = pictures.reduce((p, c) => applyEdit(p, { type: "updateClip", clipId: c.id, patch: { fill } }), project);
                if (next !== project) api.commit(next, false);
              }}
              queuedCount={queuedCount}
              outputDir={outputDir}
              onChooseOutputDir={inDesktopApp ? () => void chooseOutputDir() : undefined}
              fastEncoder={fastEncoder}
            >
              {selected && selectedTrack && (
                <Inspector
                  key={selected.id}
                  clip={selected}
                  track={selectedTrack}
                  media={project.media.find((m) => m.id === selected.mediaId)}
                  onChange={(patch, live) => (live ? api.editLive : api.edit)({ type: "updateClip", clipId: selected.id, patch })}
                  onDuration={
                    !selected.mediaId || project.media.find((m) => m.id === selected.mediaId)?.source.image
                      ? (seconds, live) =>
                          (live ? api.editLive : api.edit)({
                            type: "trimClip",
                            clipId: selected.id,
                            edge: "end",
                            time: selected.start + Math.max(0.2, seconds),
                          })
                      : undefined
                  }
                  onSpeed={(speed) => api.edit({ type: "setSpeed", clipId: selected.id, speed })}
                  onTransition={
                    selectedTrack.magnetic && previousOnTrack(project, selected)
                      ? (transition, live) => (live ? api.editLive : api.edit)({ type: "setTransition", clipId: selected.id, transition })
                      : undefined
                  }
                  onCheckpoint={api.checkpoint}
                  onFormat={(format) => selected.mediaId && api.edit({ type: "setMediaFormat", mediaId: selected.mediaId, ...format })}
                  onSplit={split}
                  onDuplicate={duplicate}
                  onCutSilences={
                    selected.mediaId && project.media.find((m) => m.id === selected.mediaId)?.hasAudio && !project.media.find((m) => m.id === selected.mediaId)?.source.image
                      ? () => void cutSilences()
                      : undefined
                  }
                  cuttingSilences={cuttingSilences}
                  onSplitChapters={
                    selected.mediaId &&
                    project.media
                      .find((m) => m.id === selected.mediaId)
                      ?.source.chapters?.some((ch) => ch.start > selected.in + 0.2 && ch.start < selected.out - 0.2)
                      ? () => api.edit({ type: "splitByChapters", clipId: selected.id })
                      : undefined
                  }
                  onDelete={remove}
                  canSplit={playback.time > selected.start && playback.time < clipEnd(selected)}
                />
              )}
            </ExportPanel>
          )}
        </div>
      )}

      <QueueDock queue={queue} freshId={freshId} />
      <TextMenu />
      {welcoming && (
        <WelcomeDialog
          onImport={inDesktopApp ? () => void importFiles() : undefined}
          onPasteLink={() => urlRef.current?.focus()}
          busy={busy}
          onClose={() => setWelcoming(false)}
        />
      )}
      {dragging && (
        <div className="app__drop" role="status">
          <span>Drop to import into Media</span>
        </div>
      )}
    </div>
  );
}
