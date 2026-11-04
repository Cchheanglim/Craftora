import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ExportSettings, Job, MediaSource } from "./types";
import { DEMO_JOBS, DEMO_SOURCES } from "./data/demo";
import {
  engineStatus,
  exportEncoder,
  fetchMedia,
  keptThumbnail,
  siteCheckAvailable,
  setSiteCheckKey,
  inDesktopApp,
  makePreview,
  onPreviewCache,
  prefetchPreview,
  onFileDrop,
  localThumbnail,
  audioPeaks,
  errorText,
  linkPeaks,
  loadCaptions,
  makeCaptions,
  onSpeechProgress,
  onSpeechLine,
  detectSilences,
  openLocal,
  renameDownload,
  deleteFile,
  deletedFiles,
  probeLocal,
  recordLive,
  recordingUrl,
  allowLocal,
  pickFolder,
  saveSnapshot,
  saveSrt,
  pickMediaFiles,
  pickMediaFile,
  revealFile,
  pickPicture,
  fileThumbnail,
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
  getDownloadsDir,
  getOutputDir,
  listProjects,
  loadFetchHistory,
  loadHistory,
  loadProject,
  saveFetchHistory,
  saveHistory,
  saveProject,
  setDownloadsDir,
  setOutputDir,
  type FetchEntry,
  type ProjectEntry,
  loadMediaLibrary,
  saveMediaLibrary,
  LIBRARY_LIMIT,
  type LibraryEntry,
} from "./lib/storage";
import { captureFrame, captureThumbnail, coverFrame } from "./lib/thumbnail";
import { MAX_RUNNING, useQueue } from "./state/useQueue";
import { storeEdition, useUpdates } from "./lib/updates";
import { formatClock } from "./lib/timecode";
import { applyTheme, saveTheme, savedTheme, type Theme } from "./lib/theme";
import { useGlideScroll } from "./lib/glide";
import { useProject } from "./project/useProject";
import { applyEdit, SHOWN_CAPTIONS, timelineCaptions, withShownCaptions } from "./project/actions";
import { usePlayback } from "./project/usePlayback";
import { cutModeApplies, formatSize, frameOf, planExport, type ExportPlan } from "./project/exportPlan";
import {
  CAPTIONS,
  NO_CROP,
  mainTrack,
  showsPicture,
  clipEnd,
  emptyProject,
  mediaTimeAt,
  MIN_CLIP,
  trackLabel,
  type Clip,
  mediaFromSource,
  sameFormat,
  previousOnTrack,
  projectDuration,
  projectName,
  silencesFromPeaks,
  upgradeProject,
  type MediaItem,
  type Project,
  withImported,
} from "./project/model";
import { Toolbar } from "./components/Toolbar";
import { Sidebar, type View } from "./components/Sidebar";
import { Home, type LinkSettings } from "./components/Home";
import { TimelineDivider } from "./components/TimelineDivider";
import { EdgeResizer, PANEL_WIDTH, SIDE_WIDTH, roomFor } from "./components/EdgeResizer";
import { dropEdits, type FxItem } from "./project/effects";
import { FxPanel, type FxTab } from "./components/FxPanel";
import { useFetchReview } from "./components/FetchDetails";
import { Preview } from "./components/Preview";
import { TimelineEditor, type ClipCommand } from "./components/TimelineEditor";
import { CaptionStyle, Inspector } from "./components/Inspector";
import { ExportPanel } from "./components/ExportPanel";
import { QueueDock } from "./components/QueueDock";
import { Library } from "./components/Library";
import { Projects } from "./components/Projects";
import { MediaLibrary } from "./components/MediaLibrary";
import { Downloads } from "./components/Downloads";
import { History } from "./components/History";
import { Transcript } from "./components/Transcript";
import { Settings } from "./components/Settings";
import { AssistantPanel } from "./components/AssistantPanel";
import { TextMenu } from "./components/TextMenu";
import { WelcomeDialog, welcomeHidden } from "./components/WelcomeDialog";
import { useConfirm } from "./components/ConfirmDialog";
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Ambient } from "./components/Ambient";
import "./App.css";

const DEMO = DEMO_SOURCES[0];
/** Quiet time after the last edit before the project is saved. */
const AUTOSAVE_MS = 600;
/** The label of captions Craftora made from the sound (whisper). */
const SPOKEN = "Made from the sound";

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
        trackId: mainTrack(project)!.id,
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

/** A Settings page number (1–4), remembered per machine; storage may be unavailable. */
function rememberedCount(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isInteger(v) && v >= 1 && v <= 4 ? v : fallback;
  } catch {
    return fallback;
  }
}
function rememberText(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not essential */
  }
}

/** Panel open/closed is remembered per machine; storage may be unavailable. */
function remembered(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
/** A size (px) the user dragged something to, if they did; storage may be unavailable. */
function rememberedSize(key: string): number | null {
  try {
    return Number(localStorage.getItem(key)) || null;
  } catch {
    return null;
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


/** The project's picture for lists: the first media that has one. */
/**
 * The project's picture for lists (Projects, Home, Exports): one kept in the app (a data URL) or a
 * website's picture. Not a file's preview address: it stops working once Craftora restarts.
 */
const coverOf = (project: Project) =>
  project.cover ??
  project.media.map((m) => m.source.thumbnail).find((t) => t?.startsWith("data:") || (t?.startsWith("http") && !t.includes("asset.localhost")));

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
        const thumbnail = source.thumbnail || (found.image ? await keptThumbnail([found.image], found.page) : undefined);
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

/** How long Freeze frame holds the picture, in seconds. */
const FREEZE_LENGTH = 3;

/** Finished exports as kept in the history: without what only a running job needs. */
const forHistory = (j: Job): Job => ({ ...j, spec: undefined, render: undefined, after: undefined });

export default function App() {
  const [view, setView] = useState<View>(inDesktopApp ? "home" : "editor");
  const [leftOpen, setLeftOpen] = useState(() => remembered("craftora.left", true));
  const [rightOpen, setRightOpen] = useState(() => remembered("craftora.right", true));
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Settings page: how many jobs run at once.
  const [maxRunning, setMaxRunning] = useState(() => rememberedCount("craftora.maxRunning", MAX_RUNNING));
  const [timelineHeight, setTimelineHeight] = useState(() => rememberedSize("craftora.timelineHeight"));
  const resizeTimeline = (height: number) => {
    setTimelineHeight(height);
    rememberText("craftora.timelineHeight", String(height));
  };
  // The left sidebar's and the right panel's widths, dragged by their inner edges.
  const [sideWidth, setSideWidth] = useState(() => Math.min(SIDE_WIDTH.max, Math.max(SIDE_WIDTH.min, rememberedSize("craftora.sideWidth") ?? SIDE_WIDTH.usual)));
  const [panelWidth, setPanelWidth] = useState(() => Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, rememberedSize("craftora.panelWidth") ?? PANEL_WIDTH.usual)));
  const resizeSide = (dragged: number) => {
    const width = roomFor(dragged, rightOpen && view === "editor" ? panelWidth : 0, SIDE_WIDTH);
    setSideWidth(width);
    rememberText("craftora.sideWidth", String(width));
  };
  const resizePanel = (dragged: number) => {
    const width = roomFor(dragged, leftOpen ? sideWidth : 56, PANEL_WIDTH);
    setPanelWidth(width);
    rememberText("craftora.panelWidth", String(width));
  };
  // Settings → Theme; main.tsx already put the saved one on the page.
  const [theme, setTheme] = useState(savedTheme);
  const chooseTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next, true);
    saveTheme(next);
  };
  useGlideScroll();
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_SETTINGS);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [engines, setEngines] = useState<EngineStatus | "checking" | "browser">(inDesktopApp ? "checking" : "browser");
  const [projectId, setProjectId] = useState<string>(() => crypto.randomUUID());
  // A typed file name belongs to the project it was typed in.
  useEffect(() => setSettings((s) => (s.name === undefined ? s : { ...s, name: undefined })), [projectId]);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [history, setHistory] = useState<Job[] | null>(null);
  /** Links fetched before, newest first. */
  const [fetchHistory, setFetchHistory] = useState<FetchEntry[]>(loadFetchHistory);
  const changeFetchHistory = (next: FetchEntry[]) => {
    setFetchHistory(next);
    saveFetchHistory(next);
  };
  const [outputDir, setOutputDirState] = useState(DEFAULT_OUTPUT_DIR);
  const [downloadsDir, setDownloadsDirState] = useState(`${DEFAULT_OUTPUT_DIR}\\Downloads`);
  /** Media whose preview copy is being made. */
  const [preparing, setPreparing] = useState<Set<string>>(() => new Set());
  const [cuttingSilences, setCuttingSilences] = useState(false);
  const [rightTab, setRightTab] = useState<"edit" | "export" | "transcript" | "assistant" | FxTab>("edit");
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
  const [siteChecks, setSiteChecks] = useState({ available: false, ownKey: false });
  /** A link that failed in a way the sign-in window can fix: a login, or a page yt-dlp doesn't know. */
  const [pageAction, setPageAction] = useState<{ label: string; link: string } | null>(null);
  const [ytDlpUpdate, setYtDlpUpdate] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const urlRef = useRef<HTMLInputElement>(null);
  /** The first-launch guide is open (it shows until it's closed once). */
  const [welcoming, setWelcoming] = useState(() => !welcomeHidden());

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
  const queue = useQueue(inDesktopApp ? [] : DEMO_JOBS, inDesktopApp, maxRunning);
  /** Media being downloaded for editing. */
  const downloadingIds = new Set(queue.jobs.filter((j) => j.prefetch && j.status !== "finished" && j.status !== "failed").map((j) => j.prefetch!.mediaId));
  const downloadsCount = queue.jobs.filter((j) => (j.prefetch || j.record) && j.status !== "finished" && j.status !== "failed").length;

  // Every file on this PC used in a project is remembered in the Media library, across projects.
  const [library, setLibrary] = useState<LibraryEntry[]>(loadMediaLibrary);
  const changeLibrary = useCallback((update: (entries: LibraryEntry[]) => LibraryEntry[]) => {
    setLibrary((entries) => {
      const next = update(entries);
      if (next !== entries) saveMediaLibrary(next);
      return next;
    });
  }, []);
  useEffect(() => changeLibrary((entries) => withImported(entries, project.media, LIBRARY_LIMIT)), [project.media, changeLibrary]);
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
    void getDownloadsDir().then(setDownloadsDirState).catch(() => {});
  }, []);

  // No "Saved info" list under Craftora's own fields: WebView2's autofill switch (lib.rs) doesn't
  // reach every field, so each one is marked as it gets focus (ones that set their own are left).
  useEffect(() => {
    const noAutofill = (e: FocusEvent) => {
      const field = e.target;
      if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && !field.hasAttribute("autocomplete")) field.setAttribute("autocomplete", "off");
    };
    document.addEventListener("focusin", noAutofill);
    return () => document.removeEventListener("focusin", noAutofill);
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

  // Exports deleted outside Craftora (in File Explorer) leave Exports and Home when Craftora starts
  // or comes back into view.
  const historyRef = useRef(history);
  historyRef.current = history;
  const historyLoaded = history !== null;
  useEffect(() => {
    if (!inDesktopApp || !historyLoaded) return;
    const forgetDeleted = () =>
      void deletedFiles((historyRef.current ?? []).flatMap((j) => (j.outputPath ? [j.outputPath] : [])))
        .then((gone) => {
          if (gone.length === 0) return;
          setHistory((list) => {
            if (!list) return list;
            const next = list.filter((j) => !j.outputPath || !gone.includes(j.outputPath));
            void saveHistory(next).catch(() => {});
            return next;
          });
        })
        .catch(() => {});
    forgetDeleted();
    window.addEventListener("focus", forgetDeleted);
    return () => window.removeEventListener("focus", forgetDeleted);
  }, [historyLoaded]);

  /** Hides a finished export from Exports and Home, or shows it again; the file isn't touched. */
  const setExportHidden = (id: string, hidden: boolean) => {
    if (!history) return;
    const next = history.map((j) => (j.id === id ? { ...j, hidden: hidden || undefined } : j));
    setHistory(next);
    void saveHistory(next).catch(() => {});
  };

  /** Moves an export's file to the Recycle Bin and takes it off the history. */
  const deleteExport = async (job: Job) => {
    try {
      if (job.outputPath) await deleteFile(job.outputPath);
    } catch (err) {
      setError(errorText(err));
      return;
    }
    setHistory((list) => {
      if (!list) return list;
      const next = list.filter((j) => j.id !== job.id);
      void saveHistory(next).catch(() => {});
      return next;
    });
  };

  const toggleLeft = useCallback(() => setLeftOpen((o) => (remember("craftora.left", !o), !o)), []);
  const toggleRight = useCallback(() => setRightOpen((o) => (remember("craftora.right", !o), !o)), []);

  // A timeline with nothing visual can only be saved as sound.
  const hasPicture = project.clips.some((c) => !c.mediaId || showsPicture(project, c));
  const effective: ExportSettings = useMemo(() => (hasPicture ? settings : { ...settings, output: "audio" }), [hasPicture, settings]);
  // Captions on (CC in the preview): shown there and burned into the export alike.
  const [showCaptions, setShowCaptions] = useState(() => {
    try {
      return localStorage.getItem("craftora.captions") !== "off";
    } catch {
      return true;
    }
  });
  const toggleCaptions = () => {
    try {
      localStorage.setItem("craftora.captions", showCaptions ? "off" : "on");
    } catch {
      /* not remembered */
    }
    setShowCaptions(!showCaptions);
  };
  // What gets exported: the timeline plus the captions shown on the preview.
  const toExport = useMemo(() => (showCaptions ? withShownCaptions(project) : project), [project, showCaptions]);
  const plan = useMemo(() => planExport(toExport, effective), [toExport, effective]);
  const selected = project.clips.find((c) => c.id === selectedId) ?? null;

  /** Makes the preview copy for a file the player can't open, then swaps it in. */
  const prepare = useCallback(
    (mediaId: string, source: MediaSource) => {
      if (!source.previewProxy) return;
      setPreparing((s) => new Set(s).add(mediaId));
      makePreview(source)
        .then(({ previewUrl, previewAudioUrl, previewProxy }) => {
          // Onto the media as it is now: its picture and sound wave may have arrived while the copy was made.
          const current = projectRef.current.media.find((m) => m.id === mediaId);
          if (current?.source.url === source.url) api.refreshMedia(mediaId, { source: { ...current.source, previewUrl, previewAudioUrl, previewProxy } });
        })
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
  // A fetched link's wave, from a light stream of its sound, before it's downloaded.
  useEffect(() => {
    if (!inDesktopApp) return;
    for (const m of project.media) {
      const s = m.source;
      if (s.local || !s.peaksUrl || !m.hasAudio || s.peaksRate === 10 || peaksTried.current.has(m.id)) continue;
      peaksTried.current.add(m.id);
      // A moment later, so the preview's first pieces load first.
      window.setTimeout(() => {
        void linkPeaks(s.peaksUrl!)
          .then((peaks) => {
            const current = projectRef.current.media.find((x) => x.id === m.id);
            if (peaks.length && current && !current.source.local) api.refreshMedia(m.id, { source: { ...current.source, peaks, peaksRate: 10 } });
          })
          .catch(() => {});
      }, 3000);
    }
  }, [project.media, api]);
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
        // Waves saved before peaksRate came from an older, wrong reading (see audio_peaks).
        if (m.hasAudio && s.peaksRate !== 10) {
          void audioPeaks(s.url)
            .then((peaks) => {
              const current = projectRef.current.media.find((x) => x.id === m.id);
              if (peaks.length && current) api.refreshMedia(m.id, { source: { ...current.source, peaks, peaksRate: 10 } });
            })
            .catch(() => {});
        }
      }, 1500);
    }
  }, [project.media, api, prepare]);
  useEffect(() => {
    for (const m of project.media) {
      const s = m.source;
      if (s.thumbnail?.startsWith("data:") || thumbTried.current.has(m.id)) continue;
      // A link with the site's picture: a small copy of it is kept (fetched once, with the page as Referer).
      const sitePicture = inDesktopApp && !s.local && s.thumbnail?.startsWith("http") ? s.thumbnail : undefined;
      // Otherwise (or if that fails) a frame of the video. Stream playlists (HLS) can't be drawn by a plain video element.
      const canDraw = (m.hasVideo || s.image) && (s.local || !(s.previewHls || s.live || !s.previewUrl)) && (inDesktopApp || !(s.previewProxy || !s.previewUrl));
      if (!sitePicture && !canDraw) continue;
      thumbTried.current.add(m.id);
      const kept = sitePicture ? keptThumbnail([sitePicture, ...(s.thumbnails ?? [])], s.url).then((t) => (t.startsWith("data:") ? t : undefined)) : Promise.resolve(undefined);
      const task = kept
        .then((thumb) => thumb ?? (canDraw && s.previewUrl ? captureThumbnail(s.previewUrl, s.image) : undefined))
        .then((thumb) => thumb ?? (inDesktopApp && s.local ? localThumbnail(s.url, Boolean(s.image)).catch(() => undefined) : undefined));
      void task.then((thumbnail) => {
        const current = projectRef.current.media.find((x) => x.id === m.id);
        // Only the list picture: an image keeps its full-size previewUrl (Preview falls back to this if it can't load).
        if (thumbnail && current) api.refreshMedia(m.id, { source: { ...current.source, thumbnail, thumbnails: undefined } });
        // History saved the link before this picture existed.
        if (thumbnail && !s.local)
          setFetchHistory((list) => {
            const next = list.map((e) => (e.url === s.url && !e.thumbnail?.startsWith("data:") ? { ...e, thumbnail } : e));
            saveFetchHistory(next);
            return next;
          });
      });
    }
  }, [project.media, api]);

  // A fetched video's captions, read once and kept with the media, so they stay after it's downloaded.
  const captionsTried = useRef(new Set<string>());
  useEffect(() => {
    if (!inDesktopApp) return;
    for (const m of project.media) {
      const track = m.source.captions;
      if (!track || m.captions || captionsTried.current.has(m.id)) continue;
      captionsTried.current.add(m.id);
      loadCaptions(track.url, m.source.url)
        .then((lines) => {
          if (lines.length) api.refreshMedia(m.id, { captions: { label: track.label, lines } });
        })
        .catch(() => {});
    }
  }, [project.media, api]);

  /** Media id → how making its captions is going, for the Media list. */
  const [captioning, setCaptioning] = useState<Record<string, string>>({});

  // Closing stops everything still running (engine.rs `tie`), so ask first. Paused downloads are kept.
  const running =
    queue.jobs.filter((j) => j.status === "waiting" || j.status === "downloading" || j.status === "encoding" || (j.status === "paused" && !j.prefetch)).length +
    Object.values(captioning).filter((text) => text !== "couldn't make captions").length;
  const runningRef = useRef(running);
  runningRef.current = running;
  const { ask: askClose, dialog: closeDialog } = useConfirm();
  useEffect(() => {
    if (!inDesktopApp) return;
    const win = getCurrentWindow();
    const stop = win.onCloseRequested(async (event) => {
      const count = runningRef.current;
      if (count === 0) return;
      event.preventDefault();
      const ok = await askClose({
        title: "Close Craftora?",
        message: `${count === 1 ? "1 download, export or caption is" : `${count} downloads, exports or captions are`} not finished. Closing stops ${count === 1 ? "it" : "them"} and what ${count === 1 ? "it has" : "they have"} done so far is lost.`,
        note: "Paused downloads are kept and wait in the queue next time.",
        confirmLabel: "Stop and close",
        danger: true,
      });
      if (ok) void win.destroy();
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [askClose]);

  // The taskbar button fills with what's running (recordings have no end, so they don't count).
  const filling = queue.jobs.filter((j) => (j.status === "downloading" || j.status === "encoding") && !j.record);
  const taskbar = filling.length ? Math.round(filling.reduce((sum, j) => sum + (j.progress ?? 0), 0) / filling.length) : null;
  useEffect(() => {
    if (!inDesktopApp) return;
    const bar = taskbar === null ? { status: ProgressBarStatus.None } : { status: ProgressBarStatus.Normal, progress: taskbar };
    void getCurrentWindow().setProgressBar(bar).catch(() => {});
  }, [taskbar]);

  // While Craftora is in the background, Windows says when a download, export or recording ends.
  const lastStatus = useRef(new Map<string, Job["status"]>());
  useEffect(() => {
    const before = lastStatus.current;
    lastStatus.current = new Map(queue.jobs.map((j) => [j.id, j.status]));
    if (!inDesktopApp || document.hasFocus()) return;
    for (const j of queue.jobs) {
      const was = before.get(j.id);
      if ((was !== "downloading" && was !== "encoding") || (j.status !== "finished" && j.status !== "failed")) continue;
      const what = j.record ? "Recording" : j.prefetch ? "Download" : "Export";
      const page: View = j.prefetch || j.record ? "downloads" : "library";
      const open = `Click to open ${page === "downloads" ? "Downloads" : "Exports"}.`;
      const saved = j.prefetch ? "Ready to edit" : `Saved as ${j.outputPath?.split(/[\\/]/).pop() ?? j.fileName}`;
      const notice =
        j.status === "finished"
          ? { title: `${what} finished`, detail: `${saved} · ${formatSize(j.sizeMb)}. ${open}` }
          : { title: `${what} failed`, detail: `${(j.error ?? "It stopped").replace(/\.?$/, ".")} ${open}` };
      void invoke("notify", { ...notice, line: j.rename ?? j.title, page }).catch(() => {});
    }
  }, [queue.jobs]);
  // A click on one of those notifications brings Craftora forward on that page (notify.rs).
  useEffect(() => {
    if (!inDesktopApp) return;
    const stop = listen<View>("notification-clicked", (e) => setView(e.payload));
    return () => void stop.then((unlisten) => unlisten());
  }, []);
  const speechTurn = useRef<Promise<unknown>>(Promise.resolve());
  // Captions wait their turn: on a slow connection, getting the model or a link's sound would slow
  // the fetch, preview, downloads and exports going on (and whisper would slow exports).
  const idle = useRef(true);
  // A live recording "downloads" for hours: it doesn't hold captions back.
  idle.current = !busy && !queue.jobs.some((j) => (j.status === "downloading" && !j.record) || j.status === "encoding");
  useEffect(() => {
    if (!inDesktopApp) return;
    const unlisten = onSpeechProgress(({ id, stage, percent }) =>
      setCaptioning((all) => ({
        ...all,
        [id]: stage === "model" ? `getting the speech model, ${Math.floor(percent)}%` : stage === "sound" ? "getting the sound for captions…" : `making captions, ${Math.floor(percent)}%`,
      })),
    );
    // Lines show up while the rest is still being made.
    const unlines = onSpeechLine((id, line) => {
      const current = projectRef.current.media.find((m) => m.id === id);
      if (!current) return;
      const lines = current.captions?.partial ? [...current.captions.lines, line] : [line];
      api.refreshMedia(id, { captions: { label: SPOKEN, lines, partial: true, fitted: true } });
    });
    return () => {
      void unlisten.then((stop) => stop());
      void unlines.then((stop) => stop());
    };
  }, [api]);
  // Media that captions can be made for from its sound: none yet, unfinished, or made before lines
  // were fitted to their words. Not while it's being done (a failed try can be tried again).
  const uncaptioned = inDesktopApp
    ? project.media.filter((m) => {
        const s = m.source;
        const made = m.captions && !m.captions.partial && (m.captions.fitted || m.captions.label !== SPOKEN);
        const going = captioning[m.id] && captioning[m.id] !== "couldn't make captions";
        return !made && !going && !s.captions && m.hasAudio && !s.image && !s.live && !m.missing;
      })
    : [];
  // Only when asked (Transcript → Make captions): it keeps the processor busy for minutes.
  const makeSpokenCaptions = () => {
    for (const m of uncaptioned) {
      const s = m.source;
      setCaptioning((all) => ({ ...all, [m.id]: "captions waiting…" }));
      const done = (label?: string) =>
        setCaptioning((all) => {
          const { [m.id]: _, ...rest } = all;
          return label ? { ...rest, [m.id]: label } : rest;
        });
      speechTurn.current = speechTurn.current.then(async () => {
        while (!idle.current) await new Promise((r) => window.setTimeout(r, 3_000));
        return makeCaptions(m.id, s.url, Boolean(s.local))
          .then((lines) => {
            done();
            // The finished file replaces the lines shown along the way.
            if (lines.length) api.refreshMedia(m.id, { captions: { label: SPOKEN, lines, fitted: true } });
          })
          .catch(() => done("couldn't make captions"));
      });
    }
  };

  /** A picture picked on this PC becomes a media item's list picture (and its History row's). */
  const changePicture = async (mediaId: string) => {
    const path = await pickPicture().catch(() => null);
    if (!path) return;
    const thumbnail = await fileThumbnail(path, true);
    if (!thumbnail) return setError("Couldn't read that picture. Try a PNG or JPEG file.");
    const item = projectRef.current.media.find((m) => m.id === mediaId);
    if (!item) return;
    api.refreshMedia(mediaId, { source: { ...item.source, thumbnail, thumbnails: undefined } });
    if (!item.source.local)
      setFetchHistory((list) => {
        const next = list.map((e) => (e.url === item.source.url ? { ...e, thumbnail } : e));
        saveFetchHistory(next);
        return next;
      });
  };

  /** Queues a whole link to download, so it edits like a file on this PC. Returns the queue job's id. */
  const downloadForEditing = (item: MediaItem) => {
    if (!inDesktopApp || item.source.local) return;
    // Meanwhile, fill the preview's cache from the start, so scrubbing what's done is instant. Not
    // through the page window (bot-checked sites): that would fetch the whole video twice.
    if (!item.source.downloadFirst) for (const id of item.source.previewCacheIds ?? []) void prefetchPreview(id).catch(() => {});
    const format = item.hasVideo ? item.videoFormat : item.audioFormat;
    const stream = item.source.streams.find((s) => s.id === format);
    const id = crypto.randomUUID();
    queue.add({
      id,
      title: item.name,
      summary: `Download for editing · ${formatClock(item.source.duration)} · ${stream?.label ?? "best quality"}`,
      kind: item.hasVideo ? "video" : "audio",
      status: "waiting",
      progress: 0,
      needsEncode: false,
      sizeMb: stream?.sizeMb ?? 0,
      fileName: item.name,
      command: `yt-dlp -f "${format}" ${item.hasVideo ? "--merge-output-format mp4" : "-x --audio-format m4a"} "${item.source.url}"`,
      thumbnail: item.source.thumbnail,
      prefetch: { mediaId: item.id, url: item.source.url, format, title: item.name, audioOnly: !item.hasVideo },
    });
    return id;
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
      thumbnail: item.source.thumbnail,
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
      const { rename } = job;
      // A name typed while it downloaded: the file takes it now (kept as it is if that fails).
      const named = rename && job.prefetch ? renameDownload(job.outputPath, rename).catch(() => job.outputPath!) : Promise.resolve(job.outputPath);
      named
        .then(async (path) => {
          if (path !== job.outputPath) queue.edit(job.id, { outputPath: path });
          const local = await openLocal(path);
          if (job.prefetch) queue.downloaded(job.id, mediaId, path);
          const item = projectRef.current.media.find((m) => m.id === mediaId);
          if (!item) return;
          // Keep the link's length so clip times stay exactly where they were (a recording, or a
          // link whose length wasn't known, takes the file's).
          const duration = item.source.live || !item.source.duration ? local.duration : item.source.duration;
          // The picture kept for the link (or picked by the user) stays.
          const thumbnail = item.source.thumbnail?.startsWith("data:") ? item.source.thumbnail : local.thumbnail;
          api.refreshMedia(mediaId, { source: { ...local, duration, thumbnail }, missing: false, ...(rename ? { name: rename } : {}) });
          prepare(mediaId, local);
        })
        .catch((err) => setError(`The download finished but couldn't be opened: ${errorText(err)}`));
    }
  }, [queue.jobs, queue.edit, queue.downloaded, api, prepare]);

  /** `found`: what "Fetch this video" saw the page play, tried when yt-dlp doesn't know the page. */
  const fetchReview = useFetchReview(inDesktopApp && siteChecks.available);
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
      // The user sees what the link holds before anything from it is added or downloaded.
      if (!(await fetchReview.review(source, link))) {
        if (found) void tellSignIn("Not added to Craftora.").catch(() => {});
        return;
      }
      // Straight onto the timeline, after the last clip, ready to edit. With nothing the preview
      // can play (some stream sites), it downloads too, so it can still be edited.
      // A live stream goes to Media only: drag in the parts you want as they're recorded. So does a
      // video with no known length yet (behind a site's bot check): it downloads first.
      const item = importSource(source, !source.live && source.duration > 0);
      if (source.live && inDesktopApp) recordForEditing(item);
      else if ((!source.previewUrl || source.downloadFirst) && inDesktopApp) downloadForEditing(item);
      // A bot-checked site's video plays and downloads through this window: keep it (minimized is fine).
      if (found)
        void tellSignIn(
          source.downloadFirst ? "Sent to Craftora ✓  Keep this window open (minimize it): Craftora plays this video through it." : "Sent to Craftora ✓  You can close this window.",
        ).catch(() => {});
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
      const refreshed = source.local ? openLocal(source.url) : fetchMedia(source.url, item.previewHeight);
      refreshed
        .then((fresh) => {
          // The picture kept last time stays (no need to fetch it from the site again).
          const thumbnail = source.thumbnail?.startsWith("data:") ? source.thumbnail : fresh.thumbnail;
          // The wave drawn last time stays too (it's the same sound).
          const wave = source.peaksRate === 10 ? { peaks: source.peaks, peaksRate: 10 } : {};
          // As it is now: the export quality may have been changed while the link was read.
          const current = projectRef.current.media.find((m) => m.id === item.id) ?? item;
          const videoFormat = sameFormat(current.videoFormat, current.source, fresh);
          api.refreshMedia(item.id, { source: { ...fresh, duration: source.duration, thumbnail, ...wave }, missing: false, videoFormat });
          prepare(item.id, fresh);
        })
        .catch(() => {
          // A link that can't be fetched now (offline) keeps its old details and can still export later.
          if (source.local) api.refreshMedia(item.id, { missing: true });
        });
    }
  };

  // Preview quality of the project's links (the picker by the speed): the best each video has unless
  // a height is picked. Separate from the quality exports use.
  const links = project.media.filter((m) => !m.source.local && m.hasVideo && !m.source.live);
  const previewHeights = [...new Set(links.flatMap((m) => m.source.streams.filter((s) => s.kind === "video").map((s) => parseInt(s.label, 10))))]
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  /** Reads the links again for previews at `height` (the old ones play meanwhile); reopening keeps it. */
  const choosePreviewHeight = (height?: number) => {
    for (const item of links) api.refreshMedia(item.id, { previewHeight: height });
    reconnect(links.map((item) => ({ ...item, previewHeight: height })));
  };

  /** A file that was moved or renamed: the user points to it, and its clips play again. */
  const relink = async (item: MediaItem) => {
    const path = await pickMediaFile();
    if (!path) return;
    try {
      const fresh = await openLocal(path);
      api.refreshMedia(item.id, { source: { ...fresh, duration: item.source.duration }, missing: false });
      prepare(item.id, fresh);
    } catch (err) {
      setError(`Couldn't open that file: ${errorText(err)}`);
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
      // Downloads sit inside the export folder unless they have their own.
      setDownloadsDirState(await getDownloadsDir());
    } catch (err) {
      setError(errorText(err));
    }
  };

  const chooseDownloadsDir = async () => {
    const picked = await pickFolder("Choose where downloads are saved");
    if (!picked) return;
    try {
      setDownloadsDirState(await setDownloadsDir(picked));
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

  /** The selected clip, or else the clip under the playhead on the lowest track that has one. */
  const splitTarget = () => {
    const t = playback.time;
    const under = (c: (typeof project.clips)[number]) => t > c.start && t < clipEnd(c);
    const selectedClip = project.clips.find((c) => c.id === selectedId && under(c));
    if (selectedClip) return selectedClip;
    for (const track of [...project.tracks].reverse()) {
      const clip = project.clips.find((c) => c.trackId === track.id && under(c));
      if (clip) return clip;
    }
    return undefined;
  };
  const split = () => {
    const clip = splitTarget();
    if (clip) api.edit({ type: "splitClip", clipId: clip.id, newClipId: crypto.randomUUID(), at: playback.time });
  };
  /**
   * A filter, effect or transition from the right panel, dropped on track `trackId` at `time` (or
   * clicked: at the playhead, on the selected clip's track). One undo step.
   */
  const applyFx = (item: FxItem, trackId: string | undefined, time: number) => {
    const done = dropEdits(project, item, trackId, time, [crypto.randomUUID(), crypto.randomUUID()]);
    if (!done) {
      setError(item.kind === "transition" ? "Drop a transition on the join between two clips, or click the + there." : "Drop it on the video clip it should change.");
      return;
    }
    setError(null);
    api.checkpoint();
    for (const edit of done.edits) api.editLive(edit);
    if (done.select) setSelectedId(done.select);
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
        setError(media.source.local || !inDesktopApp ? "No silent pauses were found in this clip." : "Download this link first (⬇ under In this project) so Craftora can scan its sound for silences.");
        return;
      }
      api.edit({ type: "cutSilences", clipId: clip.id, ranges });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCuttingSilences(false);
    }
  };
  /** Every caption as exported, as an .srt file the user saves (for YouTube and video players). */
  const saveCaptionsFile = async () => {
    const lines = timelineCaptions(project);
    if (lines.length === 0) {
      setError("There are no captions on the timeline to save.");
      return;
    }
    try {
      await saveSrt(lines, projectName(project));
    } catch (err) {
      setError(errorText(err));
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

  /** Queues `plan`, an export of `source` (the timeline, or one clip of it: Export this clip). */
  const queueExport = (plan: ExportPlan, source: Project) => {
    if (plan.kind === "empty") return;
    const id = crypto.randomUUID();
    // An edited video renders links from whole downloads, which go on where they were after a pause,
    // and then the editor plays the files instead of streaming the links.
    const links = plan.kind === "render" ? source.media.filter((m) => !m.source.local && !m.source.live && plan.spec.media.some((s) => s.id === m.id)) : [];
    const after = links.flatMap((m) => queue.jobs.find((j) => j.prefetch?.mediaId === m.id && j.status !== "failed")?.id ?? downloadForEditing(m) ?? []);
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
      after: after.length ? after : undefined,
      thumbnail: coverOf(source),
    };
    queue.add(job);
    setFreshId(id);
    setQueuedCount((n) => n + 1);
  };
  const addToQueue = () => queueExport(plan, project);

  // A clip's right-click menu (and Ctrl+C, Ctrl+X, Ctrl+V).
  const clipboard = useRef<Clip | null>(null);
  const [canPaste, setCanPaste] = useState(false);
  const copyClip = (clip: Clip) => {
    clipboard.current = clip;
    setCanPaste(true);
  };
  /** The copied clip at the playhead, on its own track if it's free there. */
  const pasteClip = () => {
    const clip = clipboard.current;
    if (!clip) return;
    const newClipId = crypto.randomUUID();
    api.edit({ type: "pasteClip", clip, newClipId, at: playback.time });
    setSelectedId(newClipId);
  };
  /** One clip as its own file, from its start. */
  const exportClip = (clip: Clip) => {
    const media = project.media.find((m) => m.id === clip.mediaId);
    const single: Project = { ...project, clips: [{ ...clip, start: 0, transition: undefined }] };
    const name = `${(media?.name ?? "clip").replace(/\.[a-z0-9]{2,4}$/i, "")}_clip`;
    queueExport(planExport(single, { ...effective, name }), single);
  };
  /** Another file from this PC in the clip's place, from that file's start. */
  const replaceClip = async (clip: Clip) => {
    const path = await pickMediaFile().catch(() => null);
    if (!path) return;
    try {
      const source = await openLocal(path);
      const item = importSource(source, false);
      api.edit({ type: "replaceClipMedia", clipId: clip.id, mediaId: item.id });
    } catch (err) {
      setError(errorText(err));
    }
  };
  /**
   * The frame at `time` held still for a moment: the clip is cut there and the still goes in
   * between, pushing what comes after along. One undo step.
   */
  const freezeFrame = async (clip: Clip, time: number) => {
    const media = project.media.find((m) => m.id === clip.mediaId);
    if (!media || media.source.image || !inDesktopApp) return;
    const at = Math.min(Math.max(time, clip.start + MIN_CLIP), clipEnd(clip) - MIN_CLIP);
    setError(null);
    try {
      const bytes = await captureFrame(media.source.previewUrl, mediaTimeAt(clip, at));
      if (!bytes) throw new Error("Couldn't read that frame of the video. Download it for editing, then try again.");
      const path = await saveSnapshot(Array.from(bytes), `${media.name.replace(/\.[a-z0-9]{2,4}$/i, "")}_freeze`);
      const still = importSource(await openLocal(path), false);
      const track = project.tracks.find((t) => t.id === clip.trackId);
      const rest = crypto.randomUUID();
      const stillId = crypto.randomUUID();
      api.checkpoint();
      api.editLive({ type: "splitClip", clipId: clip.id, newClipId: rest, at });
      if (!track?.magnetic) {
        // Make room: everything after the cut on this track moves along, last first.
        const after = project.clips.filter((c) => c.trackId === clip.trackId && c.id !== clip.id && c.start >= at - 0.001);
        for (const c of [...after].sort((a, b) => b.start - a.start)) api.editLive({ type: "moveClip", clipId: c.id, start: c.start + FREEZE_LENGTH, trackId: c.trackId });
        api.editLive({ type: "moveClip", clipId: rest, start: at + FREEZE_LENGTH, trackId: clip.trackId });
      }
      api.editLive({ type: "addClip", clipId: stillId, mediaId: still.id, trackId: clip.trackId, at });
      api.editLive({ type: "trimClip", clipId: stillId, edge: "end", time: at + FREEZE_LENGTH });
      api.editLive({ type: "settle" });
      setSelectedId(stillId);
    } catch (err) {
      setError(errorText(err));
    }
  };
  /** Cover (the main track): from the picture showing at the playhead, a picture from this PC, or none. */
  const chooseCover = async (choice: "frame" | "picture" | "remove") => {
    setError(null);
    if (choice === "remove") return api.edit({ type: "setCover", cover: null });
    let cover: string | undefined;
    if (choice === "picture") {
      const path = await pickPicture().catch(() => null);
      if (!path) return;
      cover = await fileThumbnail(path, true);
    } else {
      // The top picture showing at the playhead.
      const t = playback.time;
      const order = [...project.tracks].filter((tr) => !tr.hidden).map((tr) => tr.id);
      const showing = project.clips
        .filter((c) => order.includes(c.trackId) && showsPicture(project, c) && t >= c.start && t < clipEnd(c))
        .sort((a, b) => order.indexOf(a.trackId) - order.indexOf(b.trackId))[0];
      const media = project.media.find((m) => m.id === showing?.mediaId);
      if (!showing || !media) return setError("Move the playhead to a picture first, then use its frame as the cover.");
      cover = media.source.image ? await fileThumbnail(media.source.url, true) : await coverFrame(media.source.previewUrl, mediaTimeAt(showing, t));
    }
    if (!cover) return setError("Couldn't read that picture for the cover.");
    api.edit({ type: "setCover", cover });
  };
  const clipCommand = (command: ClipCommand, clip: Clip, time: number) => {
    const media = project.media.find((m) => m.id === clip.mediaId);
    const patch = (p: Partial<Clip>) => api.edit({ type: "updateClip", clipId: clip.id, patch: p });
    const actions: Record<ClipCommand, () => void> = {
      copy: () => copyClip(clip),
      cut: () => {
        copyClip(clip);
        api.edit({ type: "deleteClip", clipId: clip.id });
        setSelectedId(null);
      },
      paste: pasteClip,
      delete: () => {
        api.edit({ type: "deleteClip", clipId: clip.id });
        setSelectedId(null);
      },
      freeze: () => void freezeFrame(clip, time),
      reverse: () => patch({ reverse: !clip.reverse }),
      mirror: () => patch({ mirror: !clip.mirror }),
      rotate: () => patch({ rotate: ((clip.rotate ?? 0) + 90) % 360 || undefined }),
      crop: () => {
        // The crop sliders in Edit.
        setSelectedId(clip.id);
        setRightTab("edit");
        if (!rightOpen) toggleRight();
        window.setTimeout(() => document.getElementById("insp-crop-left")?.focus(), 80);
      },
      export: () => exportClip(clip),
      replace: () => void replaceClip(clip),
      reveal: () => media?.source.local && void revealFile(media.source.url),
    };
    actions[command]();
  };

  // Keyboard shortcuts.
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
    if (ctrl && key === "c" && selected) return (e.preventDefault(), copyClip(selected));
    if (ctrl && key === "x" && selected) return (e.preventDefault(), clipCommand("cut", selected, playback.time));
    if (ctrl && key === "v" && clipboard.current) return (e.preventDefault(), pasteClip());
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
  const selectedTrack = selected ? project.tracks.find((t) => t.id === selected.trackId) : undefined;

  /** Signing out of websites, checking links and updating yt-dlp (Settings); absent in the browser preview. */
  const linkSettings: LinkSettings | undefined = inDesktopApp
    ? {
        onSignOut: () =>
          void signOutEverywhere()
            .then(() => setSignInMessage("Signed out of all websites."))
            .catch((err) => setSignInMessage(errorText(err))),
        signInMessage,
        siteChecks,
        onSiteCheckKey: async (key) => {
          await setSiteCheckKey(key);
          setSiteChecks(await siteCheckAvailable());
        },
        onUpdateYtDlp: storeEdition ? undefined : refreshYtDlp,
        updating: ytDlpUpdate.busy,
        ytDlpMessage: ytDlpUpdate.message,
      }
    : undefined;
  const chooseMaxRunning = (count: number) => {
    setMaxRunning(count);
    rememberText("craftora.maxRunning", String(count));
  };

  return (
    <div className="app" data-left={leftOpen ? "open" : "closed"} style={{ "--side-w": `${sideWidth}px`, "--panel-w": `${roomFor(panelWidth, leftOpen ? sideWidth : 56, PANEL_WIDTH)}px` } as CSSProperties}>
      <Ambient active={theme !== "classic"} />
      {fetchReview.dialog}
      <Toolbar
        queue={<QueueDock queue={queue} freshId={freshId} />}
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
        canCheckSite={inDesktopApp && siteChecks.available}
        onSetUpSiteCheck={
          inDesktopApp
            ? () => {
                setView("settings");
                // The key field is at the foot of Settings: bring it into view once the page is drawn.
                window.setTimeout(() => document.getElementById("vt-key")?.focus(), 100);
              }
            : undefined
        }
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
        downloadsCount={downloadsCount}
        engines={engines}
        media={project.media}
        preparing={preparing}
        captioning={captioning}
        previewReady={Object.fromEntries(
          project.media
            .filter((m) => m.source.previewCacheIds?.some((id) => cached[id] !== undefined))
            .map((m) => [m.id, Math.min(...(m.source.previewCacheIds ?? []).map((id) => cached[id] ?? 0))]),
        )}
        downloading={downloadingIds}
        onDownload={inDesktopApp ? (mediaId) => {
          const item = project.media.find((m) => m.id === mediaId);
          if (item) downloadForEditing(item);
        } : undefined}
        onImport={inDesktopApp ? () => void importFiles() : undefined}
        onAddMedia={addMedia}
        onRemoveMedia={(mediaId) => api.edit({ type: "removeMedia", mediaId })}
        onChangePicture={inDesktopApp ? (mediaId) => void changePicture(mediaId) : undefined}
        usedMedia={usedMedia}
        activity={[
          // Downloads, exports and recordings running now, then captions being made.
          ...queue.jobs
            .filter((j) => j.status === "downloading" || j.status === "encoding")
            .map((j) => ({
              id: j.id,
              label: j.record ? "Recording live" : j.prefetch ? "Downloading" : j.status === "downloading" ? "Getting video to export" : "Exporting",
              detail: j.rename ?? j.title,
              percent: j.record ? null : j.progress,
            })),
          ...project.media
            .filter((m) => captioning[m.id] && captioning[m.id] !== "couldn't make captions")
            .map((m) => {
              const text = captioning[m.id];
              const percent = /(\d+)%/.exec(text)?.[1];
              const label = text.replace(/,?\s*\d+%$/, "");
              return { id: `captions-${m.id}`, label: label[0].toUpperCase() + label.slice(1), detail: m.name, percent: percent ? Number(percent) : null };
            }),
        ]}
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
            onSeeProjects={() => setView("projects")}
          />
        )}
        {view === "projects" && (
          <Projects
            projects={projects}
            currentId={project.clips.length || project.media.length ? projectId : null}
            onOpenProject={(id) => (id === projectId ? setView("editor") : void openProject(id))}
            onNewProject={newProject}
            onDeleteProject={(id) => void removeProject(id)}
          />
        )}
        {view === "media" && (
          <MediaLibrary
            entries={library}
            onAdd={(path) => void importFiles([path])}
            onSave={(path, saved) => changeLibrary((entries) => entries.map((e) => (e.path === path ? { ...e, saved } : e)))}
            onThumbnail={(path, thumbnail) => changeLibrary((entries) => entries.map((e) => (e.path === path ? { ...e, thumbnail } : e)))}
            onForget={(path) => changeLibrary((entries) => entries.filter((e) => e.path !== path))}
          />
        )}
        {view === "downloads" && <Downloads queue={queue} folderPath={downloadsDir} onChooseFolder={inDesktopApp ? () => void chooseDownloadsDir() : undefined} onAdd={(path) => void importFiles([path])} />}
        {view === "history" && (
          <History
            history={fetchHistory}
            onFetchAgain={(link) => {
              setView("editor");
              void fetchSource(link);
            }}
            onRemove={(links) => changeFetchHistory(fetchHistory.filter((e) => !links.includes(e.url)))}
          />
        )}
        {view === "settings" && (
          <Settings
            outputDir={outputDir}
            onChooseOutputDir={inDesktopApp ? () => void chooseOutputDir() : undefined}
            downloadsDir={downloadsDir}
            onChooseDownloadsDir={inDesktopApp ? () => void chooseDownloadsDir() : undefined}
            theme={theme}
            onTheme={chooseTheme}
            maxRunning={maxRunning}
            onMaxRunning={chooseMaxRunning}
            links={linkSettings}
            updates={updates}
          />
        )}
        {view === "library" && (
          <Library
            jobs={exported}
            queue={queue}
            onHide={setExportHidden}
            onDelete={inDesktopApp ? (job) => void deleteExport(job) : undefined}
            outputDir={outputDir}
            onChooseOutputDir={inDesktopApp ? () => void chooseOutputDir() : undefined}
            onOpenWorkspace={() => setView("editor")}
          />
        )}
        {view === "editor" && (
          <div
            className="app__editor"
            data-sized={timelineHeight ? "" : undefined}
            style={timelineHeight ? ({ "--tl-h": `${timelineHeight}px` } as CSSProperties) : undefined}
          >
            <Preview
              project={project}
              api={api}
              playback={playback}
              frame={frameOf(effective)}
              duration={duration}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onSnapshot={takeSnapshot}
              captionStatus={project.media.map((m) => captioning[m.id]).find(Boolean)}
              showCaptions={showCaptions}
              onToggleCaptions={toggleCaptions}
              onMakeCaptions={uncaptioned.length ? makeSpokenCaptions : undefined}
              onDownload={
                inDesktopApp
                  ? (mediaId) => {
                      const item = project.media.find((m) => m.id === mediaId);
                      if (item && !downloadingIds.has(mediaId)) downloadForEditing(item);
                    }
                  : undefined
              }
              quality={
                inDesktopApp && previewHeights.length
                  ? { height: links[0]?.previewHeight, heights: previewHeights, onChange: choosePreviewHeight }
                  : undefined
              }
            />
            <TimelineDivider height={timelineHeight} onResize={resizeTimeline} />
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
              onDropFx={applyFx}
              onClipCommand={clipCommand}
              canPaste={canPaste}
              onCover={(choice) => void chooseCover(choice)}
              onJoin={(clip) => {
                // The clip after the join: a transition clicked now goes on this join, a filter or effect on it.
                setSelectedId(clip.id);
                playback.seek(clip.start);
                setRightTab("transitions");
                if (!rightOpen) toggleRight();
              }}
            />
          </div>
        )}
      </main>

      {leftOpen && <EdgeResizer edge="right" width={sideWidth} limits={SIDE_WIDTH} label="Sidebar width" onResize={resizeSide} />}
      {view === "editor" && rightOpen && <EdgeResizer edge="left" width={panelWidth} limits={PANEL_WIDTH} label="Right panel width" onResize={resizePanel} />}
      {view === "editor" && (
        // Stays mounted when closed so it can slide away; inert keeps it out of Tab and clicks.
        <div className={`app__panel${rightOpen ? "" : " is-closed"}`} inert={!rightOpen}>
          <div className="segmented app__tabs" role="group" aria-label="Right panel">
            <button type="button" aria-pressed={rightTab === "edit"} onClick={() => setRightTab("edit")}>
              Edit
            </button>
            <button type="button" aria-pressed={rightTab === "export"} onClick={() => setRightTab("export")}>
              Export
            </button>
            <button type="button" aria-pressed={rightTab === "transcript"} onClick={() => setRightTab("transcript")}>
              Transcript
            </button>
            <button type="button" aria-pressed={rightTab === "assistant"} onClick={() => setRightTab("assistant")}>
              Assistant
            </button>
          </div>
          <div className="segmented app__tabs is-second" role="group" aria-label="Filters, effects and transitions">
            {(["filters", "effects", "transitions"] as const).map((tab) => (
              <button key={tab} type="button" aria-pressed={rightTab === tab} onClick={() => setRightTab(tab)}>
                {tab === "filters" ? "Filters" : tab === "effects" ? "Effects" : "Transitions"}
              </button>
            ))}
          </div>
          {rightTab === "filters" || rightTab === "effects" || rightTab === "transitions" ? (
            <FxPanel
              tab={rightTab}
              onPick={(item) => {
                // On the selected clip (a transition on the join before it), else at the playhead.
                if (!selected) return applyFx(item, undefined, playback.time);
                const inside = playback.time >= selected.start && playback.time < clipEnd(selected);
                applyFx(item, selected.trackId, item.kind !== "transition" && inside ? playback.time : selected.start);
              }}
            />
          ) : rightTab === "transcript" ? (
            <Transcript
              project={project}
              api={api}
              time={playback.time}
              seek={playback.seek}
              captionStatus={project.media.map((m) => captioning[m.id]).find(Boolean)}
              onMakeCaptions={uncaptioned.length ? makeSpokenCaptions : undefined}
              onSaveSrt={inDesktopApp ? () => void saveCaptionsFile() : undefined}
            />
          ) : rightTab === "assistant" ? (
            <AssistantPanel api={api} current={currentProject} playhead={currentTime} seek={playback.seek} />
          ) : rightTab === "export" ? (
            <ExportPanel
              settings={effective}
              onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
              plan={plan}
              cutModeApplies={cutModeApplies(toExport, effective)}
              hasPicture={hasPicture}
              onAddToQueue={addToQueue}
              captionsDrawn={showCaptions && project.media.some((m) => m.captions)}
              onPreset={(frameId, fill) => {
                setSettings((prev) => ({ ...prev, frameId }));
                // Every video and picture fits or fills the new frame, as one undo step.
                const pictures = project.clips.filter((c) => showsPicture(project, c));
                const next = pictures.reduce((p, c) => applyEdit(p, { type: "updateClip", clipId: c.id, patch: { fill } }), project);
                if (next !== project) api.commit(next, false);
              }}
              queuedCount={queuedCount}
              outputDir={outputDir}
              onChooseOutputDir={inDesktopApp ? () => void chooseOutputDir() : undefined}
              fastEncoder={fastEncoder}
            />
          ) : (
            // Edit: the selected clip's settings (and the captions' style).
            <aside className="export" aria-label="Clip settings">
              <div className="export__body is-edit">
              {!selected && selectedId !== SHOWN_CAPTIONS && <p className="export__hint">Click a clip on the timeline to change it here.</p>}
              {(selectedId === SHOWN_CAPTIONS || selectedTrack?.name === "Captions") && (
                <CaptionStyle
                  layout={project.captionLayout ?? CAPTIONS}
                  onChange={(patch, live) => (live ? api.editLive : api.edit)({ type: "layoutCaptions", patch })}
                  onCheckpoint={api.checkpoint}
                  onSaveSrt={inDesktopApp ? () => void saveCaptionsFile() : undefined}
                />
              )}
              {selected && selectedTrack && (
                <Inspector
                  key={selected.id}
                  clip={selected}
                  track={selectedTrack}
                  media={project.media.find((m) => m.id === selected.mediaId)}
                  onRelink={(item) => void relink(item)}
                  trackName={trackLabel(project, selectedTrack)}
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
                  onAddCaptions={
                    selected.mediaId && project.media.find((m) => m.id === selected.mediaId)?.captions
                      ? () => api.edit({ type: "addCaptions", mediaId: selected.mediaId!, trackId: `text-${crypto.randomUUID().slice(0, 8)}` })
                      : undefined
                  }
                  onDelete={remove}
                  canSplit={playback.time > selected.start && playback.time < clipEnd(selected)}
                />
              )}
              </div>
            </aside>
          )}
        </div>
      )}

      <TextMenu />
      {closeDialog}
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
