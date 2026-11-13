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
  cancelCaptions,
  onSpeechProgress,
  onSpeechLines,
  detectSilences,
  openLocal,
  renameDownload,
  deleteFile,
  deletedFiles,
  probeLocal,
  recordLive,
  recordingUrl,
  RECORDINGS,
  allowLocal,
  pickFolder,
  saveSnapshot,
  saveVoice,
  saveSrt,
  openCaptionsFile,
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
import { MAX_RUNNING, folded, resumable, useQueue } from "./state/useQueue";
import { storeEdition, useUpdates } from "./lib/updates";
import { formatClock } from "./lib/timecode";
import { applyTheme, saveTheme, savedTheme, type Theme } from "./lib/theme";
import { preference } from "./lib/preferences";
import { useGlideScroll } from "./lib/glide";
import { useProject } from "./project/useProject";
import { applyEdit, SHOWN_CAPTIONS, timelineCaptions, voiceTrack, withShownCaptions, type ClipPatch } from "./project/actions";
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
  clipLength,
  isBlock,
  meets,
  trackOrder,
  projectDuration,
  projectName,
  newImageProject,
  MAX_IMAGE_SIDE,
  silencesFromPeaks,
  upgradeProject,
  layersOf,
  type MediaItem,
  type Project,
  withImported,
} from "./project/model";
import { Toolbar } from "./components/Toolbar";
import { Sidebar, type View } from "./components/Sidebar";
import { MediaPanel, type Tab as MediaTab } from "./components/MediaPanel";
import { LayersPanel } from "./components/LayersPanel";
import { removeBackground } from "./lib/cutout";
import { ImageSizePanel } from "./components/ImageSizePanel";
import { NewImageDialog } from "./components/NewImageDialog";
import { ImageWorkspace, type ImageTool } from "./components/ImageWorkspace";
import { Home, type LinkSettings } from "./components/Home";
import { TimelineDivider } from "./components/TimelineDivider";
import { EdgeResizer, PANEL_WIDTH, SIDE_WIDTH, roomFor } from "./components/EdgeResizer";
import { dropEdits, type FxItem } from "./project/effects";
import { FxPanel, type FxTab } from "./components/FxPanel";
import { CropDialog } from "./components/CropDialog";
import { IconTabs } from "./components/IconTabs";
import { loadFont } from "./lib/fonts";
import { Icon, type IconName } from "./components/Icon";
import { SoundPanel } from "./components/SoundPanel";
import { LEVEL_STEP, VoicePanel } from "./components/VoicePanel";
import { Tooltip } from "./components/Tooltip";
import { useFetchReview } from "./components/FetchDetails";
import { Preview } from "./components/Preview";
import { TimelineEditor, type ClipCommand } from "./components/TimelineEditor";
import { AddText, CaptionStyle, Inspector, KEY_START, type ClipSection } from "./components/Inspector";
import { ExportPanel } from "./components/ExportPanel";
import { ExportDialog } from "./components/ExportDialog";
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
/** The right panel's tiles to add to the timeline (Filters … Shapes). */
const FX_TABS = ["filters", "effects", "transitions", "shapes"] as const;
/** The right panel's tabs, in the owner's order (2026-11-12); those that don't fit go under More. */
/** A selected clip's own tabs beside Edit (Inspector `section`). */
const CLIP_TABS = ["text", "adjust", "enhance", "background", "speed"] as const;
/** The right panel's row: the selected clip's settings (Filters, Effects, Transitions and Shapes are in the left panel, MediaPanel). */
const PANEL_TABS: { id: "edit" | "transcript" | "assistant" | (typeof CLIP_TABS)[number]; label: string; icon: IconName }[] = [
  { id: "edit", label: "Edit", icon: "pencil" },
  { id: "text", label: "Text", icon: "text" },
  { id: "adjust", label: "Adjust", icon: "sliders" },
  { id: "enhance", label: "Enhance", icon: "wand" },
  { id: "background", label: "Background", icon: "image" },
  { id: "speed", label: "Speed", icon: "clock" },
  { id: "transcript", label: "Transcript", icon: "captions" },
  { id: "assistant", label: "Assistant", icon: "sparkle" },
];
/** The Image editor's tool strip: the panel tools' ids are MediaPanel tabs. */
const IMAGE_TOOLS: ImageTool[] = [
  { id: "move", label: "Move", icon: "pointer", group: "select" },
  { id: "hand", label: "Hand", icon: "hand", group: "select" },
  { id: "media", label: "Photos", icon: "image", group: "content" },
  { id: "text", label: "Text", icon: "text", group: "content" },
  { id: "shapes", label: "Shapes", icon: "star", group: "content" },
  { id: "filters", label: "Filters", icon: "blend", group: "edit" },
  { id: "effects", label: "Effects", icon: "sparkle", group: "edit" },
  { id: "size", label: "Canvas size", icon: "crop", group: "edit" },
];
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
  const inEditor = view === "editor" || view === "image";
  /** A cut-out photo shown as it was, while Background → "Hold to see the original" is held. */
  const [peek, setPeek] = useState<string | null>(null);
  /** Image editor → New image: preset sizes, a photo, or a recent image. */
  const [newImageOpen, setNewImageOpen] = useState(false);
  /** Image editor: the tool picked in its tool strip (a panel's tool opens that panel beside it). */
  const [imageTool, setImageTool] = useState("move");
  /** Image editor's options bar → Remove background: what it's doing, while it runs. */
  const [cutting, setCutting] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(() => remembered("craftora.left", true));
  // Always open at start: it has no button any more (owner, 2026-11-12), only Ctrl+Alt+B hides it.
  const [rightOpen, setRightOpen] = useState(true);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** A block just added from the right panel, for the timeline to zoom in to (`at` makes each one new). */
  const [revealed, setRevealed] = useState<{ clipId: string; at: number } | null>(null);
  /** The clip whose transition is selected on the timeline. */
  const [selectedTransition, setSelectedTransition] = useState<string | null>(null);
  /** The effect, filter or transition (its clip id) whose settings panel is open in its tab, instead of the tiles. */
  const [fxDetail, setFxDetail] = useState<string | null>(null);
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
    const width = roomFor(dragged, rightOpen && inEditor ? panelWidth : 0, SIDE_WIDTH);
    setSideWidth(width);
    rememberText("craftora.sideWidth", String(width));
  };
  const resizePanel = (dragged: number) => {
    const width = roomFor(dragged, leftOpen && inEditor ? sideWidth : 0, PANEL_WIDTH);
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
  const [rightTab, setRightTab] = useState<"edit" | "transcript" | "assistant" | "sound" | "voice" | FxTab | (typeof CLIP_TABS)[number]>("edit");
  /** "AI edit" from the timeline, waiting for the Assistant tab to send it. */
  const [aiAsk, setAiAsk] = useState<{ id: string; text: string } | null>(null);
  /** The export pop-up (Export, next to Queue). */
  const [exportOpen, setExportOpen] = useState(false);
  // Where the Sound or Voice-over panel's Back button goes: the tab it was opened from.
  const panelBack = useRef<typeof rightTab>("edit");
  // A voice-over take: where on the timeline it started, and the preview kept quiet while it records.
  const voiceAt = useRef(0);
  const [voiceSilent, setVoiceSilent] = useState(false);
  // The take's microphone levels so far (VoicePanel `onLevel`), for its live clip on the timeline; null when not recording.
  const [voiceLevels, setVoiceLevels] = useState<number[] | null>(null);
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
  // The Image editor is the editor's layout for an image project (Layers instead of the timeline, nothing timed).
  const imageMode = inEditor && Boolean(project.image);
  const duration = projectDuration(project);
  const playback = usePlayback(duration);
  // The editor's players go away with its page, but the clock wouldn't: leaving the editor pauses.
  const { pause } = playback;
  useEffect(() => {
    if (!inEditor) pause();
  }, [view, pause]);
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
  const downloadsCount = queue.jobs.filter((j) => (j.prefetch || j.record) && !folded(j, queue.jobs) && j.status !== "finished" && j.status !== "failed").length;

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
  const pendingSave = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (project.media.length === 0 && project.clips.length === 0) return;
    const save = () => {
      pendingSave.current = undefined;
      const entry: ProjectEntry = {
        id: projectId,
        name: projectName(project),
        savedAt: Date.now(),
        duration: projectDuration(project),
        clips: project.clips.length,
        thumbnail: coverOf(project),
        image: project.image ? true : undefined,
      };
      saveProject({ ...entry, version: 1, project })
        .then(() => setProjects((list) => [entry, ...list.filter((p) => p.id !== entry.id)]))
        .catch((err) => setError(`Couldn't save the project: ${errorText(err)}`));
    };
    pendingSave.current = save;
    const timer = window.setTimeout(save, AUTOSAVE_MS);
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
  const toggleRight = useCallback(() => setRightOpen((o) => !o), []);

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
  // The Sound panel belongs to a clip: with none selected, it goes back to where it was opened from, and comes back when
  // a clip with sound is selected again, until it's closed or another tab is picked (`soundOpen`).
  const [soundOpen, setSoundOpen] = useState(false);
  const selectedHasSound = Boolean(selected?.mediaId && project.media.find((m) => m.id === selected.mediaId)?.hasAudio);
  useEffect(() => {
    if (rightTab === "sound" && !selected?.mediaId) setRightTab(panelBack.current);
    else if (soundOpen && selectedHasSound && rightTab === panelBack.current) setRightTab("sound");
  }, [rightTab, selected, soundOpen, selectedHasSound]);
  // Library fonts the project's texts use: loaded for the preview once (Segoe UI shows until then, or if offline).
  const usedFonts = [...new Set(project.clips.map((c) => c.font ?? ""))].join(",");
  useEffect(() => {
    for (const id of usedFonts.split(",")) loadFont(id).catch(() => {});
  }, [usedFonts]);
  const pickTab = (tab: typeof rightTab) => {
    setSoundOpen(false);
    setRightTab(tab);
  };
  // A filter, effect or transition picked on the timeline shows its settings here; let go of it, and the panel goes back to Edit.
  const fxOpen = fxDetail !== null && fxDetail === selectedId;
  useEffect(() => {
    if ((FX_TABS as readonly string[]).includes(rightTab) && !fxOpen) setRightTab("edit");
  }, [rightTab, fxOpen]);
  // A selected transition belongs to the selected clip, while it still has one.
  const transitionClip = selected && selectedTransition === selected.id && selected.transition ? selected : null;

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
      if (!s.local || s.image || s.live || s.previewUrl.startsWith(RECORDINGS) || peaksTried.current.has(m.id)) continue;
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
      // Otherwise (or if that fails) a frame of the video.
      const canDraw = (m.hasVideo || s.image) && (s.local || !(s.live || !s.previewUrl)) && (inDesktopApp || !(s.previewProxy || !s.previewUrl));
      if (!sitePicture && !canDraw) continue;
      thumbTried.current.add(m.id);
      const kept = sitePicture ? keptThumbnail([sitePicture, ...(s.thumbnails ?? [])], s.url).then((t) => (t.startsWith("data:") ? t : undefined)) : Promise.resolve(undefined);
      const task = kept
        .then((thumb) => thumb ?? (canDraw && s.previewUrl ? captureThumbnail(s.previewUrl, s.image, s.previewHls) : undefined))
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

  // Closing stops everything still running (engine.rs `tie`), so ask first. Downloads are kept and go on next time.
  const running =
    queue.jobs.filter((j) => !resumable(j) && (j.status === "waiting" || j.status === "downloading" || j.status === "encoding" || j.status === "paused")).length +
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
        message: `${count === 1 ? "1 export or caption is" : `${count} exports or captions are`} not finished. Closing stops ${count === 1 ? "it" : "them"} and what ${count === 1 ? "it has" : "they have"} done so far is lost.`,
        note: "Downloads are kept and go on where they stopped next time.",
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
  // A finished download or export also plays Craftora's sound (public/mixkitvideogametreasure_edit.mp3), focused or not.
  const lastStatus = useRef(new Map<string, Job["status"]>());
  useEffect(() => {
    const before = lastStatus.current;
    lastStatus.current = new Map(queue.jobs.map((j) => [j.id, j.status]));
    // A download made only for an export says nothing when it ends: the export does.
    const ended = queue.jobs.filter((j) => {
      const was = before.get(j.id);
      return (was === "downloading" || was === "encoding") && (j.status === "finished" || j.status === "failed") && !j.prefetch?.forExport;
    });
    if (preference("finishSound") && ended.some((j) => j.status === "finished" && !j.record?.live)) void new Audio("/mixkitvideogametreasure_edit.mp3").play().catch(() => {});
    if (!inDesktopApp || document.hasFocus()) return;
    for (const j of ended) {
      const what = j.record?.live ? "Recording" : j.prefetch || j.record ? "Download" : "Export";
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
        [id]: stage === "model" ? `getting ready for captions, ${Math.floor(percent)}%` : stage === "sound" ? "getting the sound for captions…" : `making captions, ${Math.floor(percent)}%`,
      })),
    );
    // Each finished piece (about 5 minutes) shows while the rest is still being made.
    const unlines = onSpeechLines((id, lines) => {
      const current = projectRef.current.media.find((m) => m.id === id);
      if (!current) return;
      const before = current.captions?.partial ? current.captions.lines : [];
      api.refreshMedia(id, { captions: { label: SPOKEN, lines: [...before, ...lines], partial: true } });
    });
    return () => {
      void unlisten.then((stop) => stop());
      void unlines.then((stop) => stop());
    };
  }, [api]);
  // Media that captions can be made for from its sound: none yet, unfinished, made before each
  // sentence got its own line, or the site's automatic ones (sometimes in the wrong language). Not
  // while it's being done (a failed try can be tried again).
  const uncaptioned = inDesktopApp
    ? project.media.filter((m) => {
        const s = m.source;
        const machine = (label?: string) => Boolean(label?.endsWith("(automatic)"));
        const made = m.captions && !m.captions.partial && !machine(m.captions.label) && (m.captions.bySentence || m.captions.label !== SPOKEN);
        const going = captioning[m.id] && captioning[m.id] !== "couldn't make captions";
        return !made && !going && (!s.captions || machine(s.captions.label)) && m.hasAudio && !s.image && !s.live && !m.missing;
      })
    : [];
  // Only when asked (Transcript → Make captions): it keeps the processor busy for minutes.
  const makeSpokenCaptions = () => {
    for (const m of uncaptioned) {
      const s = m.source;
      stoppedCaptions.current.delete(m.id);
      setCaptioning((all) => ({ ...all, [m.id]: "captions waiting…" }));
      const done = (label?: string) =>
        setCaptioning((all) => {
          const { [m.id]: _, ...rest } = all;
          return label ? { ...rest, [m.id]: label } : rest;
        });
      speechTurn.current = speechTurn.current.then(async () => {
        while (!idle.current) await new Promise((r) => window.setTimeout(r, 3_000));
        if (stoppedCaptions.current.has(m.id)) return;
        return makeCaptions(m.id, s.url, Boolean(s.local), preference("captionsOnGpu"))
          .then((lines) => {
            done();
            // The finished file replaces the lines shown along the way.
            if (lines.length) api.refreshMedia(m.id, { captions: { label: SPOKEN, lines, bySentence: true } });
          })
          .catch(() => (stoppedCaptions.current.has(m.id) ? done() : done("couldn't make captions")));
      });
    }
  };
  /** Media whose captions Cancel stopped (queued ones then don't start). */
  const stoppedCaptions = useRef(new Set<string>());
  const makingCaptions = Object.keys(captioning).filter((id) => captioning[id] !== "couldn't make captions");
  const stopCaptions = (ids = makingCaptions) => {
    for (const id of ids) {
      stoppedCaptions.current.add(id);
      void cancelCaptions(id);
    }
    setCaptioning((all) => Object.fromEntries(Object.entries(all).filter(([id]) => !ids.includes(id))));
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

  /**
   * Queues a whole link to download, so it edits like a file on this PC. Returns the queue job's id.
   * `forExport`: only an export needs it, so it's kept out of the Downloads folder (jobs.rs `sources_dir`).
   */
  const downloadForEditing = (item: MediaItem, forExport = false) => {
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
      summary: `${forExport ? "Video for your export" : "Download for editing"} · ${formatClock(item.source.duration)} · ${stream?.label ?? "best quality"}`,
      kind: item.hasVideo ? "video" : "audio",
      status: "waiting",
      progress: 0,
      needsEncode: false,
      sizeMb: stream?.sizeMb ?? 0,
      fileName: item.name,
      command: `yt-dlp -f "${format}" ${item.hasVideo ? "--merge-output-format mp4" : "-x --audio-format m4a"} "${item.source.url}"`,
      thumbnail: item.source.thumbnail,
      prefetch: { mediaId: item.id, url: item.source.url, format, title: item.name, audioOnly: !item.hasVideo, forExport },
    });
    return id;
  };

  // Recordings in progress: every second or so the preview switches to the HLS playlist once the
  // first part is ready, and a live or unknown-length video's length catches up with the parts saved.
  const recordings = useRef(new Map<string, { mediaId: string; path: string }>());
  const startingRecordings = useRef(new Set<string>());
  const startRecording = (id: string, record: NonNullable<Job["record"]>, item?: MediaItem) => {
    startingRecordings.current.add(id);
    recordLive({ id, url: record.url, title: record.title, format: record.format })
      .then((path) => recordings.current.set(id, { mediaId: record.mediaId, path }))
      .catch((err) => {
        // A copy going on again keeps its row (and its parts) to retry: by now the media may be the
        // copy itself, which a download wouldn't replace.
        if (!item && !record.live) return queue.failed(id, errorText(err));
        queue.remove(id);
        const media = item ?? projectRef.current.media.find((m) => m.id === record.mediaId);
        if (!record.live) {
          if (media) downloadForEditing(media);
        } else {
          setError(`Couldn't record the live stream: ${errorText(err)}`);
        }
      });
  };

  /** A live link (or a link with no playable preview) is recorded into HLS while it plays, then joined into one MP4. */
  const recordForEditing = (item: MediaItem) => {
    const id = crypto.randomUUID();
    const isLive = Boolean(item.source.live);
    const stream = item.source.streams.find((s) => s.id === item.videoFormat);
    const record = {
      mediaId: item.id,
      live: isLive,
      url: item.source.url,
      title: item.name,
      format: isLive ? undefined : item.videoFormat,
    };
    queue.add({
      id,
      title: item.name,
      summary: isLive
        ? "Live stream · edit what's recorded while it plays"
        : `Download for editing · ${formatClock(item.source.duration)} · ${stream?.label ?? "best quality"}`,
      kind: "video",
      status: "downloading",
      phase: "recording",
      progress: null,
      needsEncode: false,
      sizeMb: stream?.sizeMb ?? 0,
      fileName: item.name,
      command: `ffmpeg -i <${isLive ? "live stream" : "stream"} of "${item.source.url}"> -f hls index.m3u8`,
      thumbnail: item.source.thumbnail,
      // Not live: a link the player can't play, copied while it's fetched so it plays at once (live.rs).
      record,
    });
    startRecording(id, record, item);
  };

  // A paused copy (or one kept across a restart) comes back "waiting": start FFmpeg again where it stopped.
  useEffect(() => {
    if (!inDesktopApp) return;
    for (const id of startingRecordings.current) {
      const job = queue.jobs.find((j) => j.id === id);
      if (!job || (job.status !== "downloading" && job.status !== "waiting")) startingRecordings.current.delete(id);
    }
    for (const job of queue.jobs) {
      if (!job.record || job.record.live || job.status !== "waiting" || startingRecordings.current.has(job.id)) continue;
      queue.started(job.id);
      startRecording(job.id, job.record);
    }
  }, [queue.jobs, queue.started]);

  const recordingIds = queue.jobs.filter((j) => j.record && j.status === "downloading").map((j) => j.id).join();
  useEffect(() => {
    if (!recordingIds) return;
    const catchUp = async () => {
      for (const id of recordingIds.split(",")) {
        const rec = recordings.current.get(id);
        const item = rec && projectRef.current.media.find((m) => m.id === rec.mediaId);
        if (!rec || !item) continue;
        const playlist = await fetch(recordingUrl(id)).then((r) => (r.ok ? r.text() : "")).catch(() => "");
        const seconds = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
        if (seconds <= 0 || (seconds <= item.source.duration && item.source.previewUrl === recordingUrl(id))) continue;
        if (!item.source.local) await allowLocal(rec.path).catch(() => {});
        const current = projectRef.current.media.find((m) => m.id === rec.mediaId);
        if (!current) continue;
        api.refreshMedia(current.id, {
          source: {
            ...current.source,
            url: rec.path,
            local: true,
            previewUrl: recordingUrl(id),
            previewHls: true,
            duration: Math.max(current.source.duration, seconds),
          },
        });
      }
    };
    const timer = window.setInterval(() => void catchUp(), 1000);
    return () => window.clearInterval(timer);
  }, [recordingIds, api]);

  // A finished "download for editing" takes over its link: the media becomes the local file.
  // A finished live recording does the same with the whole recorded MP4.
  const swapped = useRef(new Set<string>());
  useEffect(() => {
    for (const job of queue.jobs) {
      if (job.record && job.status === "failed" && !swapped.current.has(job.id)) {
        const item = projectRef.current.media.find((m) => m.id === job.record!.mediaId);
        if (item && !item.source.live && !item.source.local) {
          swapped.current.add(job.id);
          queue.remove(job.id);
          downloadForEditing(item);
          continue;
        }
      }
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
          if (job.prefetch || !job.record?.live) queue.downloaded(job.id, mediaId, path);
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
      if ((source.live || (!source.previewUrl && !source.downloadFirst && item.hasVideo)) && inDesktopApp) recordForEditing(item);
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
    // Settings → Preferences: onto the timeline one after another, or waiting under In this project.
    const place = preference("importToTimeline");
    const results = await Promise.allSettled(paths.map((path) => openLocal(path)));
    results.forEach((res, i) => {
      if (res.status === "fulfilled") {
        importSource(res.value, place);
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
      pendingSave.current?.();
      api.reset(opened);
      setProjectId(id);
      setSelectedId(null);
      playback.pause();
      playback.seek(0);
      setView(opened.image ? "image" : "editor");
      reconnect(opened.media);
    } catch (err) {
      setError(`Couldn't open the project: ${errorText(err)}`);
    }
  };

  const startProject = (next: Project) => {
    pendingSave.current?.();
    api.reset(next);
    setProjectId(crypto.randomUUID());
    setSelectedId(null);
    playback.pause();
    playback.seek(0);
    setView(next.image ? "image" : "editor");
  };
  const newProject = (image = false) => startProject(image ? newImageProject() : emptyProject());

  /** Image editor → Open a photo: a new image exactly the photo's size (at most `MAX_IMAGE_SIDE`), the photo its layer. */
  const openPhoto = async () => {
    const path = await pickMediaFile();
    if (!path) return;
    try {
      const source = await openLocal(path);
      if (!source.image) throw new Error("that isn't a picture");
      const img = new Image();
      img.src = source.previewUrl;
      await img.decode();
      const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const item = mediaFromSource(source);
      let next = newImageProject(Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
      next = applyEdit(next, { type: "importMedia", item });
      startProject(applyEdit(next, { type: "addClip", clipId: crypto.randomUUID(), mediaId: item.id, at: 0 }));
    } catch (err) {
      setError(`Couldn't open that photo: ${errorText(err)}`);
    }
  };

  /** Editor and Image editor each open the last project of their kind, or a new one. */
  const go = (next: View) => {
    const image = next === "image";
    if ((next === "editor" || image) && Boolean(project.image) !== image) {
      const last = projects.find((p) => Boolean(p.image) === image);
      if (last) void openProject(last.id);
      else newProject(image);
      // The first image: pick its size (or a photo) first.
      if (image && !last) setNewImageOpen(true);
      return;
    }
    setView(next);
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
  /** Puts a dropped tile on the timeline; the clip it made (and selected), if any. */
  /** The selected transition on every cut of its track (clips set apart have no cut). */
  const applyTransitionToAll = () => {
    if (!transitionClip?.transition) return;
    const order = trackOrder(project, transitionClip.trackId).filter((c) => !isBlock(c));
    api.checkpoint();
    order.forEach((c, i) => {
      if (i > 0 && meets(order[i - 1], c)) api.editLive({ type: "setTransition", clipId: c.id, transition: transitionClip.transition! });
    });
  };
  /** A finished voice-over take: saved as a file in the export folder, then on the timeline where it started. */
  const placeVoice = async (take: Blob) => {
    try {
      const path = await saveVoice(new Uint8Array(await take.arrayBuffer()));
      const item = importSource(await openLocal(path), false);
      const clipId = crypto.randomUUID();
      // A sound clip with no track given goes on a free track below the main one (actions.ts `place`).
      api.edit({ type: "addClip", clipId, mediaId: item.id, at: voiceAt.current });
      setSelectedId(clipId);
    } catch (err) {
      throw new Error(errorText(err));
    }
  };
  const voiceEnd = voiceAt.current + (voiceLevels?.length ?? 0) * LEVEL_STEP;
  const recording = voiceLevels && { start: voiceAt.current, end: voiceEnd, trackId: voiceTrack(project, voiceAt.current, voiceEnd), levels: voiceLevels };
  const openVoice = () => {
    if (rightTab !== "sound" && rightTab !== "voice") panelBack.current = rightTab;
    setRightTab("voice");
    if (!rightOpen) toggleRight();
  };
  /** Open an effect, filter or transition's settings panel (id = its clip) in its tab. */
  const openFx = (id: string, tab: FxTab) => {
    setFxDetail(id);
    setRightTab(tab);
    if (!rightOpen) toggleRight();
  };
  const applyFx = (item: FxItem, trackId: string | undefined | null, time: number) => {
    const done = dropEdits(project, item, trackId, time, [crypto.randomUUID(), crypto.randomUUID()]);
    if (!done) {
      setError(
        item.kind === "transition"
          ? "Put the playhead inside a clip (not at its very start or end) to add a transition there."
          : item.kind === "fade"
            ? "Drop a fade on a clip: it fades that clip's start or end."
            : "Drop it on a video or sound clip (pictures have no speed).",
      );
      return;
    }
    setError(null);
    api.checkpoint();
    for (const edit of done.edits) api.editLive(edit);
    if (done.select) setSelectedId(done.select);
    // A transition just added is the one selected.
    setSelectedTransition(item.kind === "transition" ? (done.select ?? null) : null);
    // A new block or shape: the timeline zooms in to it if it's too small to see at its zoom.
    if (done.select && done.edits.some((e) => e.type === "addBlock" || e.type === "addShape")) setRevealed({ clipId: done.select, at: Date.now() });
    // An Adjust layer does nothing until its sliders move: open its settings.
    if (item.kind === "adjust" && done.select) {
      setRightTab("filters");
      setFxDetail(done.select);
    }
    return done.select;
  };
  const duplicate = (clipId = selectedId) => {
    if (!clipId) return;
    const newClipId = crypto.randomUUID();
    api.edit({ type: "duplicateClip", clipId, newClipId });
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
  /** Brings in an .srt, .vtt or .lrc file (timed in the media's own seconds) for the selected clip, or the only video/sound on the timeline. */
  const openCaptions = async () => {
    const canCaption = (m?: MediaItem) => Boolean(m && (m.hasAudio || m.hasVideo) && !m.source.image);
    const selectedMedia = selected?.mediaId ? project.media.find((m) => m.id === selected.mediaId) : undefined;
    const onTimeline = project.media.filter((m) => canCaption(m) && project.clips.some((c) => c.mediaId === m.id));
    const target = canCaption(selectedMedia) ? selectedMedia : onTimeline.length === 1 ? onTimeline[0] : undefined;
    if (!target) {
      setError("Select the clip these captions belong to.");
      return;
    }
    setError(null);
    try {
      const opened = await openCaptionsFile();
      if (!opened) return;
      api.refreshMedia(target.id, { captions: { label: opened.name, lines: opened.lines } });
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
  const addText = (size?: number) => {
    const clipId = crypto.randomUUID();
    api.checkpoint();
    api.editLive({ type: "addText", clipId, at: playback.time });
    if (size) api.editLive({ type: "updateClip", clipId, patch: { size } });
    setSelectedId(clipId);
    setView("editor");
  };

  /** Queues `plan`, an export of `source` (the timeline, or one clip of it: Export this clip). */
  const queueExport = (plan: ExportPlan, source: Project) => {
    if (plan.kind === "empty") return;
    const id = crypto.randomUUID();
    // An edited video renders links from whole downloads (or copies in progress), which go on where
    // they were after a pause, and then the editor plays the files instead of streaming the links.
    const copies =
      plan.kind === "render"
        ? queue.jobs.filter((j) => j.record && !j.record.live && j.status !== "finished" && j.status !== "failed" && plan.spec.media.some((s) => s.id === j.record!.mediaId))
        : [];
    const links =
      plan.kind === "render"
        ? source.media.filter((m) => !m.source.local && !m.source.live && !copies.some((j) => j.record!.mediaId === m.id) && plan.spec.media.some((s) => s.id === m.id))
        : [];
    const after = [
      ...copies.map((j) => j.id),
      ...links.flatMap((m) => queue.jobs.find((j) => j.prefetch?.mediaId === m.id && j.status !== "failed")?.id ?? downloadForEditing(m, true) ?? []),
    ];
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
  /** Copy effects / Paste effects (clip right-click menu): a clip's filter, effect and Adjust. */
  const copiedEffects = useRef<ClipPatch | null>(null);
  const [canPasteEffects, setCanPasteEffects] = useState(false);
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
  /** The crop window (CropDialog) for a clip: its picture at `time` (the playhead when it's on the clip), upright. */
  const [cropping, setCropping] = useState<{ clipId: string; frame?: string; failed?: boolean; aspect: number } | null>(null);
  const openCrop = (clip: Clip, time: number) => {
    const media = project.media.find((m) => m.id === clip.mediaId);
    if (!media) return;
    setCropping({ clipId: clip.id, aspect: 16 / 9 });
    const at = Math.min(Math.max(time, clip.start), clipEnd(clip) - 0.05);
    void captureThumbnail(media.source.previewUrl, media.source.image, media.source.previewHls, media.source.image ? 0 : mediaTimeAt(clip, at), 1280).then(
      (frame) => {
        if (!frame) return setCropping((c) => (c?.clipId === clip.id ? { ...c, failed: true } : c));
        // The picture's own shape, for the window and its "Original" button.
        const img = new Image();
        img.onload = () => setCropping((c) => (c?.clipId === clip.id ? { ...c, frame, aspect: img.naturalWidth / img.naturalHeight } : c));
        img.src = frame;
      },
    );
  };
  const croppingClip = cropping && project.clips.find((c) => c.id === cropping.clipId);
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
      // Its length up front, so it fits the gap on this track (a 5 s picture didn't, and went on another track).
      api.editLive({ type: "addClip", clipId: stillId, mediaId: still.id, trackId: clip.trackId, at, length: FREEZE_LENGTH });
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
  /** "AI edit" on the timeline: the picked part of a clip and what to change go to the assistant, in its own tab. */
  const aiEdit = ({ clipId, start, end, text }: { clipId: string; start: number; end: number; text: string }) => {
    const clip = project.clips.find((c) => c.id === clipId);
    const name = project.media.find((m) => m.id === clip?.mediaId)?.name ?? clip?.text ?? "the clip";
    setAiAsk({ id: crypto.randomUUID(), text: `In “${name}”, only from ${start.toFixed(1)} s to ${end.toFixed(1)} s on the timeline: ${text}` });
    setRightTab("assistant");
    setRightOpen(true);
  };
  /** Remove a colour → Pick: the next click on the preview picks it; the clip's own key is off meanwhile, so its real colours show. One undo step. */
  const [picking, setPicking] = useState<{ clipId: string; before?: Clip["chroma"] } | null>(null);
  const startPick = (clip: Clip) => {
    api.checkpoint();
    if (clip.chroma) api.editLive({ type: "updateClip", clipId: clip.id, patch: { chroma: undefined } });
    playback.pause();
    setPicking({ clipId: clip.id, before: clip.chroma });
  };
  const endPick = (color?: string, unreadable?: boolean) => {
    if (!picking) return;
    const { clipId, before } = picking;
    setPicking(null);
    if (color) api.editLive({ type: "updateClip", clipId, patch: { chroma: { ...KEY_START, ...before, color } } });
    else if (before) api.editLive({ type: "updateClip", clipId, patch: { chroma: before } });
    if (unreadable) setError("Couldn't read the colour there. Download this video first (⬇ in Media), then pick again.");
  };
  const clipCommand = (command: ClipCommand, clip: Clip, time: number) => {
    const media = project.media.find((m) => m.id === clip.mediaId);
    const patch = (p: Partial<Clip>) => api.edit({ type: "updateClip", clipId: clip.id, patch: p });
    if (command.startsWith("speed-")) return api.edit({ type: "setSpeed", clipId: clip.id, speed: Number(command.slice(6)) });
    const actions: Record<Exclude<ClipCommand, `speed-${number}`>, () => void> = {
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
      deleteGap: () => {
        api.edit({ type: "deleteClip", clipId: clip.id, closeGap: true });
        setSelectedId(null);
      },
      split: () => api.edit({ type: "splitClip", clipId: clip.id, newClipId: crypto.randomUUID(), at: time }),
      duplicate: () => duplicate(clip.id),
      // shortcut: unmuting goes back to full volume (the level before muting isn't kept); keep it on the clip if people ask.
      mute: () => patch({ volume: clip.volume > 0 ? 0 : 1 }),
      copyEffects: () => {
        const { look, lookAmount, adjust, effect, effectStrength, effectSpeed } = clip;
        copiedEffects.current = { look, lookAmount, adjust, effect, effectStrength, effectSpeed };
        setCanPasteEffects(true);
      },
      // Replaces the clip's own filter, effect and Adjust (ones the copied clip didn't have are taken off).
      pasteEffects: () => copiedEffects.current && patch(copiedEffects.current),
      freeze: () => void freezeFrame(clip, time),
      reverse: () => patch({ reverse: !clip.reverse }),
      mirror: () => patch({ mirror: !clip.mirror }),
      rotate: () => patch({ rotate: ((clip.rotate ?? 0) + 90) % 360 || undefined }),
      crop: () => openCrop(clip, time),
      export: () => exportClip(clip),
      replace: () => void replaceClip(clip),
      reveal: () => media?.source.local && void revealFile(media.source.url),
    };
    actions[command as keyof typeof actions]();
  };

  // Keyboard shortcuts.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    // Picking a suggestion from the link field's list sends a keydown without a key.
    const key = e.key?.toLowerCase();
    if (!key) return;
    if (ctrl && key === "enter" && inEditor) return (e.preventDefault(), addToQueue());
    if (ctrl && key === "o" && inDesktopApp) return (e.preventDefault(), void importFiles());
    if (ctrl && key === "b") return (e.preventDefault(), e.altKey ? toggleRight() : toggleLeft());
    if (isTyping(e.target) || !inEditor) return;
    if (ctrl && key === "z" && !e.shiftKey) return (e.preventDefault(), api.undo());
    if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) return (e.preventDefault(), api.redo());
    if (ctrl && key === "d") return (e.preventDefault(), duplicate());
    // Image editor, as in photo editors: Ctrl+J copies the layer (onto its own layer), Ctrl+] / Ctrl+[ move it up / down.
    if (ctrl && imageMode && key === "j") return (e.preventDefault(), duplicate());
    if (ctrl && imageMode && (key === "]" || key === "[") && selected) {
      e.preventDefault();
      // Past the next layer up or down (empty tracks between layers don't count), as the Layers panel's drag does.
      const layers = layersOf(project);
      const next = layers[layers.findIndex((l) => l.clip.id === selected.id) + (key === "]" ? -1 : 1)];
      return next && api.edit({ type: "moveTrack", trackId: selected.trackId, to: project.tracks.indexOf(next.track) });
    }
    if (ctrl && key === "c" && selected) return (e.preventDefault(), copyClip(selected));
    if (ctrl && key === "x" && selected) return (e.preventDefault(), clipCommand("cut", selected, playback.time));
    if (ctrl && key === "v" && clipboard.current) return (e.preventDefault(), pasteClip());
    if (ctrl || e.altKey) return;
    // Already used where it was pressed: arrows in a menu, or on a panel edge being resized.
    if (e.defaultPrevented) return;
    if (e.shiftKey && key === "z") return (e.preventDefault(), void window.dispatchEvent(new Event("craftora:fit-timeline")));
    const target = e.target as HTMLElement;
    const onButton = target.tagName === "BUTTON" || target.getAttribute("role") === "button";
    const t = playback.time;
    const actions: Record<string, () => void> = {
      " ": () => !imageMode && playback.toggle(),
      s: split,
      delete: remove,
      backspace: remove,
      t: () => (imageMode ? setImageTool("text") : addText()),
      v: () => imageMode && setImageTool("move"),
      f: () => window.dispatchEvent(new Event("craftora:toggle-fullscreen")),
      // As in video players: 5 s; Shift steps one frame for exact edits.
      // The Image editor's arrows nudge the layer instead (Preview).
      arrowleft: () => !imageMode && playback.seek(t - (e.shiftKey ? 1 / 30 : 5)),
      arrowright: () => !imageMode && playback.seek(t + (e.shiftKey ? 1 / 30 : 5)),
      arrowup: () => !imageMode && window.dispatchEvent(new CustomEvent("craftora:volume", { detail: 0.1 })),
      arrowdown: () => !imageMode && window.dispatchEvent(new CustomEvent("craftora:volume", { detail: -0.1 })),
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

  /** Filters, Effects, Transitions or Shapes: the tiles (the left panel), or with `detail` a picked one's settings (the right panel). */
  const fxPanel = (tab: FxTab, detail: boolean) => (
    <FxPanel
      tab={tab}
      project={project}
      time={playback.time}
      playing={playback.playing}
      // A filter or effect block, or a clip with a filter or effect inside it.
      block={selected && (isBlock(selected) || (selected.mediaId && (selected.look || selected.effect))) ? selected : undefined}
      transition={
        transitionClip
          ? {
              clip: transitionClip,
              // At most half of either clip (model.ts `transitionLength`), and 5 s.
              max: Math.min(5, clipLength(transitionClip) / 2, clipLength(previousOnTrack(project, transitionClip) ?? transitionClip) / 2),
            }
          : undefined
      }
      onBlockChange={(patch, live) => selected && (live ? api.editLive : api.edit)({ type: "updateClip", clipId: selected.id, patch })}
      onBlockDuration={(seconds, live) =>
        selected && (live ? api.editLive : api.edit)({ type: "trimClip", clipId: selected.id, edge: "end", time: selected.start + Math.max(0.2, seconds) })
      }
      onRemoveBlock={() => {
        if (!selected) return;
        api.edit({ type: "deleteClip", clipId: selected.id });
        setSelectedId(null);
      }}
      onTransitionChange={(transition, live) => {
        if (!transitionClip) return;
        (live ? api.editLive : api.edit)({ type: "setTransition", clipId: transitionClip.id, transition });
        if (!transition) setSelectedTransition(null);
      }}
      onApplyToAll={applyTransitionToAll}
      onCheckpoint={api.checkpoint}
      detail={detail}
      onBack={() => {
        setFxDetail(null);
        // Back at the tiles (left), a tile clicked adds a new transition rather than swapping this one.
        setSelectedTransition(null);
        setRightTab("edit");
      }}
      onClose={() => {
        setFxDetail(null);
        toggleRight();
      }}
      onPick={(item) => {
        // Nothing picked (owner: "add them where the red pin is"): the top picture showing at the playhead takes it, as
        // if it were picked. A shape always gets a track of its own there.
        const t = playback.time;
        const target =
          selected ??
          (item.kind === "shape"
            ? null
            : (project.tracks.flatMap((tr) => project.clips.filter((c) => c.trackId === tr.id && !isBlock(c) && showsPicture(project, c) && t >= c.start && t < clipEnd(c)))[0] ?? null));
        // A transition tile always adds one at the playhead (never swaps the selected one: its Type does that).
        if (!target || item.kind === "transition") return applyFx(item, target?.trackId, t);
        // At the playhead on that clip (a filter or effect goes inside it, a transition on its cut); with the playhead
        // off it, at its start.
        const inside = t >= target.start && t < clipEnd(target);
        applyFx(item, target.trackId, inside ? t : target.start);
      }}
    />
  );

  /** The main menu: a pop-up from the toolbar's button in the editor, a column at the left of every other page. */
  const mainMenu = (rail: boolean) => (
    <Sidebar
      rail={rail}
      view={imageMode ? "image" : view === "image" ? "editor" : view}
      onViewChange={go}
      libraryCount={shownExports.length}
      downloadsCount={downloadsCount}
      engines={engines}
      activity={[
        // Downloads, exports and recordings running now, then captions being made.
        ...queue.jobs
          .filter((j) => j.status === "downloading" || j.status === "encoding")
          .map((j) => ({
            id: j.id,
            label: j.record?.live ? "Recording live" : j.prefetch || j.record || j.status === "downloading" ? "Downloading" : "Exporting",
            detail: j.rename ?? j.title,
            percent: j.record ? null : j.progress,
          })),
        ...project.media
          .filter((m) => captioning[m.id] && captioning[m.id] !== "couldn't make captions")
          .map((m) => {
            const text = captioning[m.id];
            const percent = /(\d+)%/.exec(text)?.[1];
            const label = text.replace(/,?\s*\d+%$/, "");
            return {
              id: `captions-${m.id}`,
              label: label[0].toUpperCase() + label.slice(1),
              detail: m.name,
              percent: percent ? Number(percent) : null,
              onCancel: () => stopCaptions([m.id]),
            };
          }),
      ]}
    />
  );

  /** Remove background for a clip's photo (a picture on this PC), or nothing for anything else. */
  const cutOutOf = (clip: Clip | null) => {
    const photo = project.media.find((m) => m.id === clip?.mediaId);
    if (!photo?.source.image || !photo.source.local || !inDesktopApp || photo.original) return undefined;
    return async (onStatus: (text: string) => void) => {
      const path = await removeBackground(photo.source.url, onStatus);
      api.edit({ type: "cutOut", mediaId: photo.id, source: await openLocal(path) });
    };
  };
  const quickCut = cutOutOf(selected);
  // The options bar: the selected layer's quick actions, or how to start a new image.
  const imageOptions = !selected ? (
    <>
      <button type="button" className="ws-opt" onClick={() => setNewImageOpen(true)}>
        New image…
      </button>
      <button type="button" className="ws-opt" onClick={() => void openPhoto()}>
        Open a photo…
      </button>
      {project.image && (
        <span className="ws-opt__note mono">
          {project.image.width} × {project.image.height}
        </span>
      )}
    </>
  ) : (
    <>
      <span className="ws-opt__name">{selected.name ?? (selected.text?.split("\n")[0] || project.media.find((m) => m.id === selected.mediaId)?.name || "Layer")}</span>
      {(quickCut || cutting) && (
        <button
          type="button"
          className="ws-opt"
          disabled={Boolean(cutting)}
          onClick={() => {
            setCutting("Getting ready…");
            quickCut?.(setCutting)
              .catch((err) => setError(`Couldn't remove the background: ${errorText(err)}`))
              .finally(() => setCutting(null));
          }}
        >
          <Icon name="wand" size={13} />
          {cutting ?? "Remove background"}
        </button>
      )}
      {selected.mediaId && project.media.find((m) => m.id === selected.mediaId)?.original && (
        <button type="button" className="ws-opt" onClick={() => selected.mediaId && api.edit({ type: "cutOut", mediaId: selected.mediaId })}>
          Restore
        </button>
      )}
      {showsPicture(project, selected) && (
        <>
          <button type="button" className="ws-opt" onClick={() => openCrop(selected, 0)}>
            Crop
          </button>
          <button type="button" className="ws-opt" onClick={() => api.edit({ type: "updateClip", clipId: selected.id, patch: { mirror: !selected.mirror } })}>
            Flip
          </button>
          <button type="button" className="ws-opt" onClick={() => api.edit({ type: "updateClip", clipId: selected.id, patch: { rotate: ((selected.rotate ?? 0) + 90) % 360 } })}>
            Turn
          </button>
        </>
      )}
      <button type="button" className="ws-opt" onClick={() => duplicate()}>
        Duplicate
      </button>
      <button type="button" className="ws-opt" onClick={remove}>
        Delete
      </button>
    </>
  );

  // The editor's pieces, shared by the video editor's layout and the Image editor's (ImageWorkspace).
  const mediaPanel = (only?: MediaTab) => (
    <MediaPanel
      still={imageMode ? { text: <AddText onAdd={addText} />, size: (
          <>
            <button type="button" className="btn btn--secondary" onClick={() => void openPhoto()}>
              Open a photo as a new image
            </button>
            <ImageSizePanel project={project} api={api} />
          </>
        ) } : undefined}
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
      onRecordVoice={inDesktopApp ? openVoice : undefined}
      fx={(tab) => fxPanel(tab, false)}
      only={only}
    />
  );
  const preview = (
    <Preview
      silent={voiceSilent}
      picking={picking ? { clipId: picking.clipId, onPicked: (color) => endPick(color), onCancel: (unreadable) => endPick(undefined, unreadable) } : undefined}
      // Background tab → hold to see the original: that photo drawn as it was before its cut-out.
      project={peek ? { ...project, media: project.media.map((m) => (m.id === peek && m.original ? { ...m, source: m.original } : m)) } : project}
      api={api}
      // An image is its first moment: arrow keys or an old playhead can't hide its layers.
      playback={imageMode ? { ...playback, time: 0, playing: false } : playback}
      frame={project.image ? { id: "image", label: "", ...project.image } : frameOf(effective)}
      still={imageMode && project.image ? { background: project.image.background } : undefined}
      duration={duration}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onSnapshot={takeSnapshot}
      onDropShape={(item, x, y) => {
        // At the playhead, where it was let go (same undo step as adding it).
        const id = applyFx(item, undefined, playback.time);
        if (id) api.editLive({ type: "updateClip", clipId: id, patch: { x, y } });
      }}
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
  );
  const panelBody = (
    <>
      {/* All eight in one row that scrolls sideways, ‹ › at its ends (like the popular editor). */}
      <div className="app__tabs">
        <IconTabs tabs={imageMode ? PANEL_TABS.filter((t) => !["speed", "transcript"].includes(t.id)) : PANEL_TABS} value={rightTab === "sound" || rightTab === "voice" || (FX_TABS as readonly string[]).includes(rightTab) ? null : (rightTab as (typeof PANEL_TABS)[number]["id"])} onPick={pickTab} label="Right panel" idPrefix="right-tab" />
      </div>
      {fxOpen && (FX_TABS as readonly string[]).includes(rightTab) ? (
        fxPanel(rightTab as FxTab, true)
      ) : rightTab === "transcript" ? (
        <Transcript
          project={project}
          api={api}
          time={playback.time}
          seek={playback.seek}
          captionStatus={project.media.map((m) => captioning[m.id]).find(Boolean)}
          onMakeCaptions={uncaptioned.length ? makeSpokenCaptions : undefined}
          onCancelCaptions={makingCaptions.length ? () => stopCaptions() : undefined}
          onSaveSrt={inDesktopApp ? () => void saveCaptionsFile() : undefined}
          onOpenCaptions={inDesktopApp ? () => void openCaptions() : undefined}
        />
      ) : rightTab === "assistant" ? (
        <AssistantPanel api={api} current={currentProject} playhead={currentTime} seek={playback.seek} request={aiAsk} onRequested={() => setAiAsk(null)} />
      ) : rightTab === "sound" && selected?.mediaId ? (
        <SoundPanel
          clip={selected}
          media={project.media.find((m) => m.id === selected.mediaId)}
          onChange={(patch, live) => (live ? api.editLive : api.edit)({ type: "updateClip", clipId: selected.id, patch })}
          onCheckpoint={api.checkpoint}
          onBack={() => pickTab(panelBack.current)}
          onClose={() => {
            pickTab(panelBack.current);
            toggleRight();
          }}
        />
      ) : rightTab === "voice" ? (
        <VoicePanel
          startAt={formatClock(playback.time)}
          onStart={(mute) => {
            voiceAt.current = playback.time;
            setVoiceLevels([]);
            setVoiceSilent(mute);
            if (!playback.playing) playback.toggle();
          }}
          onStop={(take) => {
            playback.pause();
            setVoiceSilent(false);
            // The live clip stays until the take is on the timeline in its place.
            return placeVoice(take).finally(() => setVoiceLevels(null));
          }}
          onLevel={(level) => setVoiceLevels((levels) => levels && [...levels, level])}
          onBack={() => setRightTab(panelBack.current)}
          onClose={() => {
            setRightTab(panelBack.current);
            toggleRight();
          }}
        />
      ) : (
        // Edit: the selected clip's settings (and the captions' style).
        <aside className="export" aria-label="Clip settings">
          <div className="export__body is-edit">
          {!selected && selectedId !== SHOWN_CAPTIONS && (rightTab === "text" ? <AddText onAdd={addText} /> : <p className="export__hint">{imageMode ? "Click a layer to change it here." : "Click a clip on the timeline to change it here."}</p>)}
          {rightTab === "edit" && (selectedId === SHOWN_CAPTIONS || selectedTrack?.name === "Captions") && (
            <CaptionStyle
              layout={project.captionLayout ?? CAPTIONS}
              onChange={(patch, live) => (live ? api.editLive : api.edit)({ type: "layoutCaptions", patch })}
              onCheckpoint={api.checkpoint}
              onSaveSrt={inDesktopApp ? () => void saveCaptionsFile() : undefined}
              onOpenCaptions={inDesktopApp ? () => void openCaptions() : undefined}
            />
          )}
          {rightTab === "edit" && selected && isBlock(selected) && (
            <p className="export__hint">
              {selected.effect ? "Effects" : "Filters"} have their own settings.{" "}
              <button type="button" className="btn btn--ghost" onClick={() => openFx(selected.id, selected.effect ? "effects" : "filters")}>
                Open its settings
              </button>
            </p>
          )}
          {selected && selectedTrack && !isBlock(selected) && (
            <Inspector
              key={selected.id}
              section={(CLIP_TABS as readonly string[]).includes(rightTab) ? (rightTab as ClipSection) : "edit"}
              clip={selected}
              track={selectedTrack}
              media={project.media.find((m) => m.id === selected.mediaId)}
              onRelink={(item) => void relink(item)}
              onPickColour={() => startPick(selected)}
              onAddText={addText}
              still={imageMode}
              imageSize={project.image}
              onCutOut={cutOutOf(selected)}
              onRestore={() => selected.mediaId && api.edit({ type: "cutOut", mediaId: selected.mediaId })}
              onPeek={(on) => setPeek(on ? (selected.mediaId ?? null) : null)}
              onPreview={(from, seconds) => {
                const back = playback.time;
                playback.seek(from);
                if (!playback.playing) playback.toggle();
                window.setTimeout(() => {
                  playback.pause();
                  // After the clock's last ticks (it stops a frame or two late), which would move the playhead on again.
                  requestAnimationFrame(() => requestAnimationFrame(() => playback.seek(back)));
                }, seconds * 1000 + 150);
              }}
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
              onCheckpoint={api.checkpoint}
              onFormat={(format) => selected.mediaId && api.edit({ type: "setMediaFormat", mediaId: selected.mediaId, ...format })}
              onSplit={split}
              onDuplicate={() => duplicate()}
              onOpenCrop={() => openCrop(selected, imageMode ? 0 : playback.time)}
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
    </>
  );

  return (
    <div className="app" style={{ "--side-w": `${sideWidth}px`, "--panel-w": `${roomFor(panelWidth, leftOpen && inEditor ? sideWidth : 0, PANEL_WIDTH)}px` } as CSSProperties}>
      <Ambient active={theme !== "classic"} />
      <Tooltip />
      {fetchReview.dialog}
      <NewImageDialog
        open={newImageOpen}
        recent={projects.filter((p) => p.image).slice(0, 6)}
        onCreate={(width, height, background) => {
          setNewImageOpen(false);
          startProject(newImageProject(width, height, background));
        }}
        onOpenPhoto={() => {
          setNewImageOpen(false);
          void openPhoto();
        }}
        onOpenProject={(id) => {
          setNewImageOpen(false);
          void openProject(id);
        }}
        onClose={() => setNewImageOpen(false)}
      />
      {exportOpen && inEditor && (
        <ExportDialog sub={projectName(project)} onClose={() => setExportOpen(false)}>
          <ExportPanel
            settings={effective}
            onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
            plan={plan}
            cutModeApplies={cutModeApplies(toExport, effective)}
            hasPicture={hasPicture}
            still={imageMode ? project.image : undefined}
            onAddToQueue={() => {
              addToQueue();
              // Queued: the Queue button next to Export shows it, so the pop-up's job is done.
              setExportOpen(false);
            }}
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
        </ExportDialog>
      )}
      <Toolbar
        queue={<QueueDock queue={queue} freshId={freshId} />}
        onExport={inEditor ? () => setExportOpen(true) : undefined}
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
        menu={inEditor ? mainMenu(false) : undefined}
        update={
          updates.status.kind === "available"
            ? { label: `Update to v${updates.status.version}`, onClick: () => void updates.install() }
            : updates.status.kind === "installing"
              ? { label: `Updating${updates.status.percent === null ? "…" : ` ${updates.status.percent}%`}` }
              : undefined
        }
      />

      {!inEditor && mainMenu(true)}

      <main className="app__work">
        {view === "home" && (
          <Home
            onImport={inDesktopApp ? () => void importFiles() : undefined}
            onPasteLink={() => urlRef.current?.focus()}
            busy={busy}
            projects={projects}
            currentId={project.clips.length || project.media.length ? projectId : null}
            onOpenProject={(id) => (id === projectId ? setView("editor") : void openProject(id))}
            onNewProject={() => newProject()}
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
            onNewProject={() => newProject()}
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
        {imageMode && project.image ? (
          <ImageWorkspace
            tools={IMAGE_TOOLS}
            activeTool={imageTool}
            // A panel's tool picked again closes its panel.
            onTool={(id) => setImageTool((now) => (now === id && id !== "move" ? "move" : id))}
            flyout={imageTool !== "move" && imageTool !== "hand" ? mediaPanel(imageTool as MediaTab) : null}
            options={imageOptions}
            canvas={preview}
            imageSize={project.image}
            properties={panelBody}
            layers={<LayersPanel project={project} api={api} selectedId={selectedId} onSelect={setSelectedId} />}
            canUndo={api.canUndo}
            canRedo={api.canRedo}
            onUndo={api.undo}
            onRedo={api.redo}
          />
        ) : inEditor && (
          <div
            className="app__editor"
            data-sized={timelineHeight ? "" : undefined}
            style={timelineHeight ? ({ "--tl-h": `${timelineHeight}px` } as CSSProperties) : undefined}
          >
            <div className="app__top">
              {leftOpen && mediaPanel()}
              {leftOpen && <EdgeResizer edge="right" width={sideWidth} limits={SIDE_WIDTH} label="Media panel width" onResize={resizeSide} />}
              {preview}
              {/* The right panel beside the preview; the timeline spans the full width under both. */}
              {rightOpen && <EdgeResizer edge="left" width={panelWidth} limits={PANEL_WIDTH} label="Right panel width" onResize={resizePanel} />}
              {/* Stays mounted when closed so it can slide away; inert keeps it out of Tab and clicks. */}
              <div className={`app__panel${rightOpen ? "" : " is-closed"}`} inert={!rightOpen}>
                {panelBody}
              </div>
            </div>
            <TimelineDivider height={timelineHeight} onResize={resizeTimeline} />
            <TimelineEditor
              project={project}
              api={api}
              revealed={revealed}
              playback={playback}
              duration={duration}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedTransition(null);
                setSelectedId(id);
                // Like a transition: a filter or effect block opens its settings panel in its own tab (Edit is only for clips).
                const clip = project.clips.find((c) => c.id === id);
                if (clip && isBlock(clip)) openFx(clip.id, clip.effect ? "effects" : "filters");
                // A clip (a video with an effect inside too) shows its own settings, like the popular editor: from the
                // Filters, Effects, Transitions or Shapes tiles, Edit (or Sound when it was left open: `soundOpen`).
                else if (clip && (FX_TABS as readonly string[]).includes(rightTab)) {
                  setFxDetail(null);
                  setRightTab(soundOpen && project.media.find((m) => m.id === clip.mediaId)?.hasAudio ? "sound" : "edit");
                }
              }}
              selectedTransition={transitionClip?.id ?? null}
              onOpenFx={(id, tab) => {
                setSelectedTransition(null);
                setSelectedId(id);
                openFx(id, tab);
              }}
              onOpenSound={(id) => {
                if (rightTab !== "sound" && rightTab !== "voice") panelBack.current = rightTab;
                setSelectedId(id);
                setSoundOpen(true);
                setRightTab("sound");
                if (!rightOpen) toggleRight();
              }}
              onSelectTransition={(id) => {
                setSelectedId(id);
                setSelectedTransition(id);
                openFx(id, "transitions");
              }}
              onSplit={split}
              onDuplicate={() => duplicate()}
              onCutSilences={() => void cutSilences()}
              cuttingSilences={cuttingSilences}
              onDelete={remove}
              onAddText={() => addText()}
              onRecordVoice={inDesktopApp ? openVoice : undefined}
              recording={recording}
              onDropFx={applyFx}
              onClipCommand={clipCommand}
              canPaste={canPaste}
              canPasteEffects={canPasteEffects}
              onAiEdit={aiEdit}
              onCover={(choice) => void chooseCover(choice)}
            />
          </div>
        )}
      </main>


      <TextMenu />
      {closeDialog}
      {croppingClip && (
        <CropDialog
          frame={cropping.frame}
          failed={cropping.failed}
          aspect={cropping.aspect}
          crop={croppingClip.crop}
          onDone={(crop) => {
            api.edit({ type: "updateClip", clipId: croppingClip.id, patch: { crop } });
            setCropping(null);
          }}
          onCancel={() => setCropping(null)}
        />
      )}
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
