import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExportSettings, Job, MediaSource, Range } from "./types";
import { DEMO_JOBS, DEMO_SOURCES } from "./data/demo";
import { planExport } from "./lib/exportPlan";
import { useQueue } from "./state/useQueue";
import { Toolbar } from "./components/Toolbar";
import { Rail, type View } from "./components/Rail";
import { Editor } from "./components/Editor";
import { ExportPanel } from "./components/ExportPanel";
import { QueueDock } from "./components/QueueDock";
import { Library } from "./components/Library";
import "./App.css";

function defaultSettings(source: MediaSource, previous?: ExportSettings): ExportSettings {
  const pick = (kind: "video" | "audio", preferred: string) => {
    const streams = source.streams.filter((s) => s.kind === kind);
    return (streams.find((s) => s.id === preferred) ?? streams[0])?.id ?? "";
  };
  const hasAudio = source.streams.some((s) => s.kind === "audio");
  return {
    output: previous?.output === "audio" && hasAudio ? "audio" : "video",
    videoStreamId: pick("video", "1080p"),
    audioStreamId: pick("audio", ""),
    videoContainer: previous?.videoContainer ?? "mp4",
    audioContainer: previous?.audioContainer ?? "mp3",
    mirror: false,
    reverse: false,
    cutMode: previous?.cutMode ?? "fast",
  };
}

const FIRST = DEMO_SOURCES[0];

export default function App() {
  const [view, setView] = useState<View>("workspace");
  const [url, setUrl] = useState(FIRST.url);
  const [source, setSource] = useState<MediaSource>(FIRST);
  const [range, setRange] = useState<Range>({ start: 84, end: 225.5 });
  const [settings, setSettings] = useState<ExportSettings>(() => defaultSettings(FIRST));
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const queue = useQueue(DEMO_JOBS);

  const plan = useMemo(() => planExport(source, range, settings), [source, range, settings]);

  const fetchSource = (link: string) => {
    setFetching(true);
    setFetchError(null);
    // Stand-in for `yt-dlp --dump-json` through Tauri: only the demo links resolve.
    window.setTimeout(() => {
      const found = DEMO_SOURCES.find((s) => s.url.toLowerCase() === link.toLowerCase());
      if (found) {
        setSource(found);
        setRange({ start: 0, end: found.duration });
        setSettings((prev) => defaultSettings(found, prev));
        setView("workspace");
      } else {
        setFetchError("Can't fetch this link yet: the yt-dlp engine isn't connected. Clear the field to pick a demo link.");
      }
      setFetching(false);
    }, 450);
  };

  const addToQueue = useCallback(() => {
    const job: Job = {
      id: crypto.randomUUID(),
      title: source.title,
      summary: plan.summary,
      kind: settings.output,
      status: "waiting",
      progress: 0,
      needsEncode: plan.cutMode === "precise",
      sizeMb: plan.sizeMb,
      fileName: plan.fileName,
      command: plan.command,
    };
    queue.add(job);
    setFreshId(job.id);
    setQueuedCount((n) => n + 1);
  }, [source.title, plan, settings.output, queue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && view === "workspace") {
        e.preventDefault();
        addToQueue();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addToQueue, view]);

  const finishedCount = queue.jobs.filter((j) => j.status === "finished").length;

  return (
    <div className="app">
      <Toolbar
        url={url}
        onUrlChange={(next) => {
          setUrl(next);
          setFetchError(null);
        }}
        onFetch={fetchSource}
        fetching={fetching}
        error={fetchError}
        suggestions={DEMO_SOURCES}
      />
      <Rail view={view} onViewChange={setView} libraryCount={finishedCount} />
      <main className="app__main">
        <div className="app__work">
          {view === "workspace" ? (
            <>
              <Editor
                key={source.url}
                source={source}
                range={range}
                onRangeChange={setRange}
                mirrored={settings.output === "video" && settings.mirror}
              />
              <ExportPanel
                source={source}
                settings={settings}
                plan={plan}
                onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
                onAddToQueue={addToQueue}
                queuedCount={queuedCount}
              />
            </>
          ) : (
            <Library jobs={queue.jobs} onOpenWorkspace={() => setView("workspace")} />
          )}
        </div>
        <QueueDock queue={queue} freshId={freshId} />
      </main>
    </div>
  );
}
