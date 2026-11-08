import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Job } from "../types";
import { cancelJob, discardDownload, downloadMedia, onJobEvent, pauseJob, startJob, startRender, type JobEvent } from "../lib/engine";
import { loadPausedDownloads, savePausedDownloads } from "../lib/storage";

/** How many jobs may download or encode at the same time, unless Settings says otherwise. */
export const MAX_RUNNING = 2;

type Action =
  | { type: "add"; job: Job }
  | { type: "started"; id: string }
  | { type: "engine"; event: JobEvent }
  | { type: "failed"; id: string; message: string }
  | { type: "retry"; id: string }
  | { type: "remove"; id: string }
  | { type: "edit"; id: string; patch: Pick<Job, "rename" | "outputPath"> }
  | { type: "downloaded"; id: string; mediaId: string; path: string }
  | { type: "pause"; id: string }
  | { type: "resume"; id: string }
  | { type: "pauseAll" }
  | { type: "resumeAll" }
  | { type: "clearFinished" }
  | { type: "tick"; now: number };

const isRunning = (j: Job) => j.status === "downloading" || j.status === "encoding";
/** Downloads of a whole link go on where they stopped (jobs.rs and live.rs keep their parts); exports and cuts start again. */
export const resumable = (j: Job) =>
  Boolean(j.prefetch || (j.record && !j.record.live) || (j.spec && !j.spec.local && j.spec.start <= 0.05 && j.spec.end >= j.spec.duration - 0.05));
const update = (jobs: Job[], id: string, patch: Partial<Job>) =>
  jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));

/**
 * An export's own video download ("Video for your export") has no row while its export is queued: the export's row
 * shows it. (Exports aren't kept after a restart; the download is, and then shows by itself.)
 */
export const folded = (j: Job, jobs: Job[]) =>
  Boolean(j.prefetch?.forExport) &&
  jobs.some((e) => e.after?.includes(j.id) || (j.status === "finished" && e.render?.media.some((m) => m.id === j.prefetch!.mediaId)));

/** An export waiting for its video shows that download as its first step: Downloading, then Encoding. */
export function shownAs(job: Job, jobs: Job[]): Job {
  const video = jobs.find((j) => job.after?.includes(j.id) && j.status !== "finished" && j.status !== "failed");
  if (!video || (job.status !== "waiting" && job.status !== "paused")) return job;
  const { status, phase, progress, downloadedBytes, totalBytes, speedBps, etaSeconds } = video;
  // Pause all pauses the export too: it shows paused, with the download's progress so far.
  return { ...job, status: job.status === "paused" ? "paused" : status, phase, progress, downloadedBytes, totalBytes, speedBps, etaSeconds };
}

export function reducer(jobs: Job[], action: Action): Job[] {
  switch (action.type) {
    case "add":
      return [action.job, ...jobs];
    case "started":
      // An edited video's links are downloaded before it starts: it only encodes.
      return jobs.map((j) =>
        j.id === action.id ? { ...j, ...(j.render ? { status: "encoding", phase: "encoding" } : { status: "downloading", phase: "downloading" }), progress: null, error: undefined } : j,
      );
    case "engine":
      return applyEngineEvent(jobs, action.event);
    case "failed":
      return update(jobs, action.id, { status: "failed", error: action.message });
    case "retry": {
      // An export tries its failed video download again too (it goes on where it stopped).
      const after = jobs.find((j) => j.id === action.id)?.after ?? [];
      return jobs.map((j) =>
        j.id === action.id || (after.includes(j.id) && j.status === "failed") ? { ...j, status: "waiting", progress: 0, error: undefined } : j,
      );
    }
    case "remove":
      return jobs.filter((j) => j.id !== action.id);
    case "edit":
      return update(jobs, action.id, action.patch);
    case "downloaded":
      // Exports waiting for this download render its file instead of the link.
      return jobs.map((j) =>
        j.render && j.after?.includes(action.id)
          ? {
              ...j,
              after: j.after.filter((id) => id !== action.id),
              render: { ...j.render, media: j.render.media.map((m) => (m.id === action.mediaId ? { ...m, src: action.path, local: true } : m)) },
            }
          : j,
      );
    case "pause":
      return jobs.map((j) => (j.id === action.id && isRunning(j) ? { ...j, status: "paused" } : j));
    case "resume":
      return jobs.map((j) => (j.id === action.id && j.status === "paused" ? { ...j, status: "waiting" } : j));
    case "pauseAll":
      // A live recording isn't paused: it has Stop instead.
      return jobs.map((j) => ((isRunning(j) && !j.record?.live) || j.status === "waiting" ? { ...j, status: "paused" } : j));
    case "resumeAll":
      return jobs.map((j) => (j.status === "paused" ? { ...j, status: "waiting" } : j));
    case "clearFinished":
      return jobs.filter((j) => j.status !== "finished");
    case "tick":
      return simulateTick(jobs, action.now);
  }
}

function applyEngineEvent(jobs: Job[], event: JobEvent): Job[] {
  switch (event.kind) {
    case "progress":
      return update(jobs, event.id, {
        status: event.phase === "downloading" || event.phase === "recording" ? "downloading" : "encoding",
        phase: event.phase,
        progress: event.percent,
        downloadedBytes: event.downloadedBytes ?? undefined,
        totalBytes: event.totalBytes ?? undefined,
        speedBps: event.speedBps ?? undefined,
        etaSeconds: event.etaSeconds ?? undefined,
      });
    case "done":
      return update(jobs, event.id, {
        status: "finished",
        progress: 100,
        outputPath: event.path,
        sizeMb: event.sizeBytes / 1_000_000,
        finishedAt: Date.now(),
      });
    case "failed":
      return update(jobs, event.id, { status: "failed", error: event.message });
    case "cancelled":
      return jobs.filter((j) => j.id !== event.id);
    case "paused":
      return update(jobs, event.id, { status: "paused", speedBps: undefined, etaSeconds: undefined });
  }
}

/**
 * Demo mode only (plain browser tab): advances simulated jobs and starts waiting
 * ones, oldest first, while a slot is free.
 */
function simulateTick(jobs: Job[], now: number): Job[] {
  let running = jobs.filter(isRunning).length;
  const next = jobs.map((j): Job => {
    const progress = j.progress ?? 0;
    if (j.status === "downloading") {
      const p = Math.min(100, progress + 6);
      if (p < 100) return { ...j, progress: p };
      return j.needsEncode
        ? { ...j, status: "encoding", phase: "encoding", progress: 0 }
        : { ...j, status: "finished", progress: 100, finishedAt: now };
    }
    if (j.status === "encoding") {
      const p = Math.min(100, progress + 9);
      return p < 100 ? { ...j, progress: p } : { ...j, status: "finished", progress: 100, finishedAt: now };
    }
    return j;
  });
  for (let i = next.length - 1; i >= 0 && running < MAX_RUNNING; i--) {
    if (next[i].status === "waiting") {
      next[i] = { ...next[i], status: "downloading", phase: "downloading" };
      running++;
    }
  }
  return next;
}

/**
 * The export queue. With `real`, jobs run through the Rust engine; otherwise they are
 * simulated so the UI can be explored in a browser.
 */
export function useQueue(initial: Job[], real: boolean, maxRunning = MAX_RUNNING) {
  // Real mode also brings back downloads paused before Craftora was last closed.
  const [jobs, dispatch] = useReducer(reducer, real ? [...loadPausedDownloads(), ...initial] : initial);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  // Downloads paused, waiting, or stopped by closing Craftora come back next time; stopped ones go on by themselves.
  const kept = real
    ? JSON.stringify(
        jobs
          .filter((j) => resumable(j) && (j.status === "paused" || j.status === "waiting" || isRunning(j)))
          .map((j) => ({ ...j, status: j.status === "paused" ? "paused" : "waiting", speedBps: undefined, etaSeconds: undefined })),
      )
    : "";
  useEffect(() => {
    if (real) savePausedDownloads(JSON.parse(kept));
  }, [real, kept]);

  // Real mode: follow the engine's progress events.
  useEffect(() => {
    if (!real) return;
    const unlisten = onJobEvent((event) => dispatch({ type: "engine", event }));
    return () => void unlisten.then((stop) => stop());
  }, [real]);

  // Real mode: start waiting jobs, oldest first, while a slot is free.
  useEffect(() => {
    if (!real) return;
    // A live recording runs for hours: it doesn't take a download slot.
    let free = maxRunning - jobs.filter((j) => isRunning(j) && !j.record).length;
    for (const job of [...jobs].reverse()) {
      if (free <= 0) break;
      if (job.status !== "waiting" || !(job.spec || job.render || job.prefetch)) continue;
      if (job.after?.length) {
        // A download it waits for was cancelled or failed: its own error says why.
        const lost = job.after.find((id) => !jobs.some((j) => j.id === id && j.status !== "failed"));
        if (lost)
          dispatch({
            type: "failed",
            id: job.id,
            message: jobs.find((j) => j.id === lost)?.error ?? "The video it needs didn't download. Download it again, then add the export to the queue again.",
          });
        continue;
      }
      free--;
      dispatch({ type: "started", id: job.id });
      const run = job.prefetch ? downloadMedia({ id: job.id, ...job.prefetch }) : job.render ? startRender(job.render) : startJob(job.spec!);
      run.catch((err: Error) => dispatch({ type: "failed", id: job.id, message: err.message }));
    }
  }, [jobs, real, maxRunning]);

  // Demo mode: simulated progress.
  const simulating = !real && jobs.some((j) => isRunning(j) || j.status === "waiting");
  useEffect(() => {
    if (!simulating) return;
    const timer = window.setInterval(() => dispatch({ type: "tick", now: Date.now() }), 1000);
    return () => window.clearInterval(timer);
  }, [simulating]);

  const cancel = useCallback(
    (id: string) => {
      const all = jobsRef.current;
      const job = all.find((j) => j.id === id);
      // An export's own video download goes with it, unless another export waits for it too.
      const own = all.filter((v) => v.prefetch?.forExport && job?.after?.includes(v.id) && !all.some((e) => e.id !== id && e.after?.includes(v.id)));
      for (const target of [id, ...own.map((v) => v.id)]) {
        const j = all.find((x) => x.id === target);
        if (real) void cancelJob(target);
        // A download that isn't running may still have saved parts: they're removed here.
        if (real && j && resumable(j) && !isRunning(j)) void discardDownload(target).catch(() => {});
        dispatch({ type: "remove", id: target });
      }
    },
    [real],
  );
  const pause = useCallback(
    (id: string) => {
      // Real downloads stop now and say "paused" when they have (a `paused` engine event).
      if (real) void pauseJob(id);
      else dispatch({ type: "pause", id });
    },
    [real],
  );
  const pauseAll = useCallback(() => {
    if (real) for (const j of jobsRef.current) if (isRunning(j) && !j.record?.live) void pauseJob(j.id);
    dispatch({ type: "pauseAll" });
  }, [real]);

  return {
    jobs,
    /** Everything but live recordings. Downloads go on from where they were (`resumable`); exports start again. */
    canPauseJob: useCallback((job: Job) => !job.record?.live, []),
    add: useCallback((job: Job) => dispatch({ type: "add", job }), []),
    started: useCallback((id: string) => dispatch({ type: "started", id }), []),
    cancel,
    retry: useCallback((id: string) => dispatch({ type: "retry", id }), []),
    remove: useCallback((id: string) => dispatch({ type: "remove", id }), []),
    /** A download's chosen name, or where its file is now. */
    edit: useCallback((id: string, patch: Pick<Job, "rename" | "outputPath">) => dispatch({ type: "edit", id, patch }), []),
    /** A download for editing finished as `path`: exports waiting for it can start. */
    downloaded: useCallback((id: string, mediaId: string, path: string) => dispatch({ type: "downloaded", id, mediaId, path }), []),
    pause,
    resume: useCallback((id: string) => dispatch({ type: "resume", id }), []),
    pauseAll,
    resumeAll: useCallback(() => dispatch({ type: "resumeAll" }), []),
    clearFinished: useCallback(() => dispatch({ type: "clearFinished" }), []),
  };
}

export type Queue = ReturnType<typeof useQueue>;
