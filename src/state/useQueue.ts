import { useCallback, useEffect, useReducer } from "react";
import type { Job } from "../types";
import { cancelJob, downloadMedia, onJobEvent, startJob, startRender, type JobEvent } from "../lib/engine";

/** How many jobs may download or encode at the same time. */
const MAX_RUNNING = 2;

type Action =
  | { type: "add"; job: Job }
  | { type: "started"; id: string }
  | { type: "engine"; event: JobEvent }
  | { type: "failed"; id: string; message: string }
  | { type: "retry"; id: string }
  | { type: "remove"; id: string }
  | { type: "pause"; id: string }
  | { type: "resume"; id: string }
  | { type: "pauseAll" }
  | { type: "resumeAll" }
  | { type: "clearFinished" }
  | { type: "tick"; now: number };

const isRunning = (j: Job) => j.status === "downloading" || j.status === "encoding";
const update = (jobs: Job[], id: string, patch: Partial<Job>) =>
  jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));

function reducer(jobs: Job[], action: Action): Job[] {
  switch (action.type) {
    case "add":
      return [action.job, ...jobs];
    case "started":
      return update(jobs, action.id, { status: "downloading", phase: "downloading", progress: null, error: undefined });
    case "engine":
      return applyEngineEvent(jobs, action.event);
    case "failed":
      return update(jobs, action.id, { status: "failed", error: action.message });
    case "retry":
      return update(jobs, action.id, { status: "waiting", progress: 0, error: undefined });
    case "remove":
      return jobs.filter((j) => j.id !== action.id);
    case "pause":
      return jobs.map((j) => (j.id === action.id && isRunning(j) ? { ...j, status: "paused" } : j));
    case "resume":
      return jobs.map((j) => (j.id === action.id && j.status === "paused" ? { ...j, status: "waiting" } : j));
    case "pauseAll":
      return jobs.map((j) => (isRunning(j) || j.status === "waiting" ? { ...j, status: "paused" } : j));
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
export function useQueue(initial: Job[], real: boolean) {
  const [jobs, dispatch] = useReducer(reducer, initial);

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
    let free = MAX_RUNNING - jobs.filter((j) => isRunning(j) && !j.record).length;
    for (const job of [...jobs].reverse()) {
      if (free <= 0) break;
      if (job.status !== "waiting" || !(job.spec || job.render || job.prefetch)) continue;
      free--;
      dispatch({ type: "started", id: job.id });
      const run = job.prefetch ? downloadMedia({ id: job.id, ...job.prefetch }) : job.render ? startRender(job.render) : startJob(job.spec!);
      run.catch((err: Error) => dispatch({ type: "failed", id: job.id, message: err.message }));
    }
  }, [jobs, real]);

  // Demo mode: simulated progress.
  const simulating = !real && jobs.some((j) => isRunning(j) || j.status === "waiting");
  useEffect(() => {
    if (!simulating) return;
    const timer = window.setInterval(() => dispatch({ type: "tick", now: Date.now() }), 1000);
    return () => window.clearInterval(timer);
  }, [simulating]);

  const cancel = useCallback(
    (id: string) => {
      if (real) void cancelJob(id);
      dispatch({ type: "remove", id });
    },
    [real],
  );

  return {
    jobs,
    /** Real jobs can be cancelled but not paused; yt-dlp section downloads can't resume. */
    canPause: !real,
    add: useCallback((job: Job) => dispatch({ type: "add", job }), []),
    cancel,
    retry: useCallback((id: string) => dispatch({ type: "retry", id }), []),
    remove: useCallback((id: string) => dispatch({ type: "remove", id }), []),
    pause: useCallback((id: string) => dispatch({ type: "pause", id }), []),
    resume: useCallback((id: string) => dispatch({ type: "resume", id }), []),
    pauseAll: useCallback(() => dispatch({ type: "pauseAll" }), []),
    resumeAll: useCallback(() => dispatch({ type: "resumeAll" }), []),
    clearFinished: useCallback(() => dispatch({ type: "clearFinished" }), []),
  };
}

export type Queue = ReturnType<typeof useQueue>;
