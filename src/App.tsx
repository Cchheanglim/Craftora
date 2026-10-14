import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExportSettings, Job, MediaSource } from "./types";
import { DEMO_JOBS, DEMO_SOURCES } from "./data/demo";
import {
  engineStatus,
  fetchMedia,
  inDesktopApp,
  onFileDrop,
  openLocal,
  pickMediaFiles,
  type EngineStatus,
} from "./lib/engine";
import { useQueue } from "./state/useQueue";
import { useProject } from "./project/useProject";
import { usePlayback } from "./project/usePlayback";
import { cutModeApplies, frameOf, planExport } from "./project/exportPlan";
import { clipEnd, emptyProject, mainTrack, mediaFromSource, projectDuration, type Project } from "./project/model";
import { Toolbar } from "./components/Toolbar";
import { Sidebar, type View } from "./components/Sidebar";
import { Home } from "./components/Home";
import { Preview } from "./components/Preview";
import { TimelineEditor } from "./components/TimelineEditor";
import { Inspector } from "./components/Inspector";
import { ExportPanel } from "./components/ExportPanel";
import { QueueDock } from "./components/QueueDock";
import { Library } from "./components/Library";
import "./App.css";

const DEMO = DEMO_SOURCES[0];

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
        trackId: mainTrack(project).id,
        mediaId: item.id,
        start: 0,
        in: 84,
        out: 225.5,
        volume: 1,
        mirror: false,
        reverse: false,
        size: 0.4,
        position: "bottom-right",
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
  const urlRef = useRef<HTMLInputElement>(null);

  const api = useProject(() => (inDesktopApp ? emptyProject() : demoProject()));
  const { project } = api;
  const duration = projectDuration(project);
  const playback = usePlayback(duration);
  const queue = useQueue(inDesktopApp ? [] : DEMO_JOBS, inDesktopApp);

  useEffect(() => {
    if (inDesktopApp) void engineStatus().then(setEngines);
  }, []);

  const toggleLeft = useCallback(() => setLeftOpen((o) => (remember("craftora.left", !o), !o)), []);
  const toggleRight = useCallback(() => setRightOpen((o) => (remember("craftora.right", !o), !o)), []);

  // A timeline with nothing visual can only be saved as sound.
  const hasPicture = project.clips.some((c) => !c.mediaId || project.tracks.find((t) => t.id === c.trackId)?.kind === "video");
  const effective: ExportSettings = useMemo(() => (hasPicture ? settings : { ...settings, output: "audio" }), [hasPicture, settings]);
  const plan = useMemo(() => planExport(project, effective), [project, effective]);
  const selected = project.clips.find((c) => c.id === selectedId) ?? null;

  /** Puts fetched or opened media in the library; with `place`, also on the timeline. */
  const importSource = useCallback(
    (source: MediaSource, place: boolean) => {
      const item = mediaFromSource(source);
      api.edit({ type: "importMedia", item });
      if (place) api.edit({ type: "addClip", clipId: crypto.randomUUID(), mediaId: item.id });
      setView("editor");
    },
    [api],
  );

  const fetchSource = async (link: string) => {
    setUrl(link);
    setBusy(true);
    setError(null);
    try {
      if (inDesktopApp) {
        importSource(await fetchMedia(link), project.clips.length === 0);
      } else {
        // Browser preview: only the demo links resolve.
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        const found = DEMO_SOURCES.find((s) => s.url.toLowerCase() === link.toLowerCase());
        if (!found) throw new Error("Real links need the desktop app. In this browser preview, clear the field to pick a demo link.");
        importSource(found, project.clips.length === 0);
      }
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
    for (const path of paths) {
      try {
        importSource(await openLocal(path), place);
        place = false;
      } catch (err) {
        failed.push(`${path.split(/[\\/]/).pop()}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
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

  const addMedia = (mediaId: string) => {
    api.edit({ type: "addClip", clipId: crypto.randomUUID(), mediaId, at: playback.time });
    setView("editor");
  };

  /** The selected clip, or else the Video 1 clip under the playhead. */
  const splitTarget = () => {
    const t = playback.time;
    const inside = (id?: string | null) => project.clips.find((c) => c.id === id && t > c.start && t < clipEnd(c));
    return inside(selectedId) ?? project.clips.find((c) => c.trackId === mainTrack(project).id && t > c.start && t < clipEnd(c));
  };
  const split = () => {
    const clip = splitTarget();
    if (clip) api.edit({ type: "splitClip", clipId: clip.id, newClipId: crypto.randomUUID(), at: playback.time });
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
    };
    queue.add(job);
    setFreshId(id);
    setQueuedCount((n) => n + 1);
  }, [plan, effective.output, queue]);

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

  const finished = queue.jobs.filter((j) => j.status === "finished");
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
        suggestions={DEMO_SOURCES}
        onImport={inDesktopApp ? () => void importFiles() : undefined}
        inputRef={urlRef}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={toggleLeft}
        onToggleRight={view === "editor" ? toggleRight : undefined}
      />
      <Sidebar
        view={view}
        onViewChange={setView}
        collapsed={!leftOpen}
        libraryCount={finished.length}
        engines={engines}
        media={project.media}
        onImport={inDesktopApp ? () => void importFiles() : undefined}
        onAddMedia={addMedia}
        onRemoveMedia={(mediaId) => api.edit({ type: "removeMedia", mediaId })}
        usedMedia={usedMedia}
      />

      <main className="app__work">
        {view === "home" && (
          <Home
            onImport={inDesktopApp ? () => void importFiles() : undefined}
            onPasteLink={() => urlRef.current?.focus()}
            onTrySample={() => void fetchSource(DEMO.url)}
            busy={busy}
            current={project.clips.length ? { clips: project.clips.length, duration, onContinue: () => setView("editor") } : undefined}
            recent={finished}
          />
        )}
        {view === "library" && <Library jobs={queue.jobs} onOpenWorkspace={() => setView("editor")} />}
        {view === "editor" && (
          <div className="app__editor">
            <Preview project={project} playback={playback} frame={frameOf(effective)} duration={duration} />
            <TimelineEditor
              project={project}
              api={api}
              playback={playback}
              duration={duration}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onSplit={split}
              onDelete={remove}
              onAddText={addText}
            />
          </div>
        )}
      </main>

      {showPanel && (
        <ExportPanel
          settings={effective}
          onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
          plan={plan}
          cutModeApplies={cutModeApplies(project, effective)}
          hasPicture={hasPicture}
          onAddToQueue={addToQueue}
          queuedCount={queuedCount}
        >
          {selected && selectedTrack && (
            <Inspector
              key={selected.id}
              clip={selected}
              track={selectedTrack}
              media={project.media.find((m) => m.id === selected.mediaId)}
              onChange={(patch, live) => (live ? api.editLive : api.edit)({ type: "updateClip", clipId: selected.id, patch })}
              onCheckpoint={api.checkpoint}
              onFormat={(format) => selected.mediaId && api.edit({ type: "setMediaFormat", mediaId: selected.mediaId, ...format })}
              onSplit={split}
              onDelete={remove}
              canSplit={playback.time > selected.start && playback.time < clipEnd(selected)}
            />
          )}
        </ExportPanel>
      )}

      <QueueDock queue={queue} freshId={freshId} />
      {dragging && (
        <div className="app__drop" role="status">
          <span>Drop to import into Media</span>
        </div>
      )}
    </div>
  );
}
