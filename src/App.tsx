import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExportSettings, Job, Layer, LayerKind, MediaSource, Range } from "./types";
import { DEMO_JOBS, DEMO_SOURCES } from "./data/demo";
import { planExport } from "./lib/exportPlan";
import { layerFromSource, layerSpec } from "./lib/layers";
import {
  engineStatus,
  fetchMedia,
  inDesktopApp,
  onFileDrop,
  openLocal,
  pickMediaFile,
  type EngineStatus,
} from "./lib/engine";
import { useQueue } from "./state/useQueue";
import { Toolbar } from "./components/Toolbar";
import { Rail, type View } from "./components/Rail";
import { Editor } from "./components/Editor";
import { ExportPanel } from "./components/ExportPanel";
import { QueueDock } from "./components/QueueDock";
import { Library } from "./components/Library";
import { EmptyWorkspace } from "./components/EmptyWorkspace";
import "./App.css";

function defaultSettings(source: MediaSource, previous?: ExportSettings): ExportSettings {
  const first = (kind: "video" | "audio", prefer?: (label: string) => boolean) => {
    const streams = source.streams.filter((s) => s.kind === kind);
    return ((prefer && streams.find((s) => prefer(s.label))) ?? streams[0])?.id ?? "";
  };
  const hasAudio = source.streams.some((s) => s.kind === "audio");
  const hasVideo = source.streams.some((s) => s.kind === "video");
  return {
    output: (previous?.output === "audio" && hasAudio) || !hasVideo ? "audio" : "video",
    // 1080p is a sensible default when offered; otherwise the best available.
    videoStreamId: first("video", (label) => label.startsWith("1080p")),
    audioStreamId: first("audio"),
    videoContainer: previous?.videoContainer ?? "mp4",
    audioContainer: previous?.audioContainer ?? "mp3",
    mirror: false,
    reverse: false,
    cutMode: previous?.cutMode ?? "fast",
  };
}

/** The demo source opens pre-trimmed in the browser preview; real links open whole. */
const DEMO = DEMO_SOURCES[0];

export default function App() {
  const [view, setView] = useState<View>("workspace");
  const [url, setUrl] = useState(inDesktopApp ? "" : DEMO.url);
  const [source, setSource] = useState<MediaSource | null>(inDesktopApp ? null : DEMO);
  const [range, setRange] = useState<Range>({ start: 84, end: 225.5 });
  const [settings, setSettings] = useState<ExportSettings>(() => defaultSettings(DEMO));
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [engines, setEngines] = useState<EngineStatus | "checking" | "browser">(inDesktopApp ? "checking" : "browser");
  const [dragging, setDragging] = useState(false);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [mainVolume, setMainVolume] = useState(1);
  const [addingLayer, setAddingLayer] = useState(false);
  const queue = useQueue(inDesktopApp ? [] : DEMO_JOBS, inDesktopApp);

  useEffect(() => {
    if (inDesktopApp) void engineStatus().then(setEngines);
  }, []);

  const plan = useMemo(
    () => (source ? planExport(source, range, settings, layers, mainVolume) : null),
    [source, range, settings, layers, mainVolume],
  );

  const openSource = (next: MediaSource) => {
    setSource(next);
    setRange({ start: 0, end: next.duration });
    setSettings((prev) => defaultSettings(next, prev));
    setLayers([]);
    setMainVolume(1);
    setView("workspace");
  };

  const fetchSource = async (link: string) => {
    setUrl(link);
    setFetching(true);
    setFetchError(null);
    try {
      if (inDesktopApp) {
        openSource(await fetchMedia(link));
      } else {
        // Browser preview: only the demo links resolve.
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        const found = DEMO_SOURCES.find((s) => s.url.toLowerCase() === link.toLowerCase());
        if (!found) throw new Error("Real links need the desktop app. In this browser preview, clear the field to pick a demo link.");
        openSource(found);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  };

  /** A file on this PC: read with ffprobe, no internet needed. */
  const openFile = async (path?: string) => {
    const chosen = path ?? (await pickMediaFile());
    if (!chosen) return;
    setUrl("");
    setFetching(true);
    setFetchError(null);
    try {
      openSource(await openLocal(chosen));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  };

  // Dropping a file anywhere on the window opens it.
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;
  useEffect(() => {
    if (!inDesktopApp) return;
    const unlisten = onFileDrop((state) => {
      if (state === "over") setDragging(true);
      else if (state === "left") setDragging(false);
      else {
        setDragging(false);
        if (state.dropped[0]) void openFileRef.current(state.dropped[0]);
      }
    });
    return () => void unlisten.then((stop) => stop());
  }, []);

  /** Adds a file from this PC as a layer on the clip. */
  const addLayer = async (kind: LayerKind) => {
    const path = await pickMediaFile();
    if (!path) return;
    setAddingLayer(true);
    setFetchError(null);
    try {
      const file = await openLocal(path);
      const has = (k: LayerKind) => file.streams.some((s) => s.kind === k);
      if (!has(kind)) {
        throw new Error(kind === "video" ? "That file has no picture. Add it with Add audio instead." : "That file has no sound.");
      }
      setLayers((prev) => [...prev, layerFromSource(file, kind)]);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingLayer(false);
    }
  };

  const addToQueue = useCallback(() => {
    if (!source || !plan) return;
    const id = crypto.randomUUID();
    const isVideo = settings.output === "video";
    const job: Job = {
      id,
      title: source.title,
      summary: plan.summary,
      kind: settings.output,
      status: "waiting",
      progress: 0,
      needsEncode: plan.cutMode === "precise" || (isVideo && (settings.mirror || settings.reverse)),
      sizeMb: plan.sizeMb,
      fileName: plan.fileName,
      command: plan.command,
      spec: inDesktopApp
        ? {
            id,
            url: source.url,
            format: plan.stream.id,
            output: settings.output,
            container: isVideo ? settings.videoContainer : settings.audioContainer,
            start: range.start,
            end: range.end,
            duration: source.duration,
            cutMode: plan.cutMode,
            mirror: isVideo && settings.mirror,
            reverse: isVideo && settings.reverse,
            fileName: plan.fileName,
            local: source.local ?? false,
            layers: layers.map(layerSpec),
            mainVolume,
          }
        : undefined,
    };
    queue.add(job);
    setFreshId(job.id);
    setQueuedCount((n) => n + 1);
  }, [source, plan, settings, range, queue, layers, mainVolume]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && view === "workspace" && source) {
        e.preventDefault();
        addToQueue();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addToQueue, view, source]);

  const finishedCount = queue.jobs.filter((j) => j.status === "finished").length;

  return (
    <div className="app">
      <Toolbar
        url={url}
        onUrlChange={(next) => {
          setUrl(next);
          setFetchError(null);
        }}
        onFetch={(link) => void fetchSource(link)}
        fetching={fetching}
        error={fetchError}
        suggestions={DEMO_SOURCES}
        onOpenFile={inDesktopApp ? () => void openFile() : undefined}
      />
      <Rail view={view} onViewChange={setView} libraryCount={finishedCount} engines={engines} />
      <main className="app__main">
        <div className="app__work">
          {view === "library" ? (
            <Library jobs={queue.jobs} onOpenWorkspace={() => setView("workspace")} />
          ) : source && plan ? (
            <>
              <Editor
                key={source.url}
                source={source}
                range={range}
                onRangeChange={setRange}
                mirrored={settings.output === "video" && settings.mirror}
                layers={layers}
                mainVolume={mainVolume}
              />
              <ExportPanel
                source={source}
                settings={settings}
                plan={plan}
                onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
                onAddToQueue={addToQueue}
                queuedCount={queuedCount}
                layers={
                  inDesktopApp
                    ? {
                        items: layers,
                        add: (kind) => void addLayer(kind),
                        update: (id, patch) => setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l))),
                        remove: (id) => setLayers((prev) => prev.filter((l) => l.id !== id)),
                        mainVolume,
                        setMainVolume,
                        clipLength: range.end - range.start,
                        videoOutput: settings.output === "video",
                        adding: addingLayer,
                      }
                    : undefined
                }
              />
            </>
          ) : (
            <EmptyWorkspace
              fetching={fetching}
              onTrySample={() => void fetchSource(DEMO.url)}
              onOpenFile={inDesktopApp ? () => void openFile() : undefined}
            />
          )}
        </div>
        <QueueDock queue={queue} freshId={freshId} />
      </main>
      {dragging && (
        <div className="app__drop" role="status">
          <span>Drop to open this file</span>
        </div>
      )}
    </div>
  );
}
