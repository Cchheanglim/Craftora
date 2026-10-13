import { useCallback, useEffect, useReducer } from "react";
import type { Job } from "../types";

/** How many jobs may download or encode at the same time. */
const MAX_RUNNING = 2;

type Action =
  | { type: "add"; job: Job }
  | { type: "pause"; id: string }
  | { type: "resume"; id: string }
  | { type: "cancel"; id: string }
  | { type: "pauseAll" }
  | { type: "resumeAll" }
  | { type: "clearFinished" }
  | { type: "tick"; now: number };

const isRunning = (j: Job) => j.status === "downloading" || j.status === "encoding";

function reducer(jobs: Job[], action: Action): Job[] {
  switch (action.type) {
    case "add":
      return [action.job, ...jobs];
    case "pause":
      return jobs.map((j) => (j.id === action.id && isRunning(j) ? { ...j, status: "paused" } : j));
    case "resume":
      return jobs.map((j) => (j.id === action.id && j.status === "paused" ? { ...j, status: "waiting" } : j));
    case "cancel":
      return jobs.filter((j) => j.id !== action.id);
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

/**
 * Stand-in for progress events from the Tauri backend: advances running jobs
 * and starts waiting ones (oldest first) while a slot is free.
 * Delete once yt-dlp/FFmpeg report real progress.
 */
function simulateTick(jobs: Job[], now: number): Job[] {
  let running = jobs.filter(isRunning).length;
  const next = jobs.map((j): Job => {
    if (j.status === "downloading") {
      const progress = Math.min(100, j.progress + 6);
      if (progress < 100) return { ...j, progress };
      return j.needsEncode
        ? { ...j, status: "encoding", progress: 0 }
        : { ...j, status: "finished", progress: 100, finishedAt: now };
    }
    if (j.status === "encoding") {
      const progress = Math.min(100, j.progress + 9);
      return progress < 100 ? { ...j, progress } : { ...j, status: "finished", progress: 100, finishedAt: now };
    }
    return j;
  });
  for (let i = next.length - 1; i >= 0 && running < MAX_RUNNING; i--) {
    if (next[i].status === "waiting") {
      next[i] = { ...next[i], status: "downloading" };
      running++;
    }
  }
  return next;
}

export function useQueue(initial: Job[]) {
  const [jobs, dispatch] = useReducer(reducer, initial);
  const active = jobs.some((j) => isRunning(j) || j.status === "waiting");

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => dispatch({ type: "tick", now: Date.now() }), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  return {
    jobs,
    add: useCallback((job: Job) => dispatch({ type: "add", job }), []),
    pause: useCallback((id: string) => dispatch({ type: "pause", id }), []),
    resume: useCallback((id: string) => dispatch({ type: "resume", id }), []),
    cancel: useCallback((id: string) => dispatch({ type: "cancel", id }), []),
    pauseAll: useCallback(() => dispatch({ type: "pauseAll" }), []),
    resumeAll: useCallback(() => dispatch({ type: "resumeAll" }), []),
    clearFinished: useCallback(() => dispatch({ type: "clearFinished" }), []),
  };
}

export type Queue = ReturnType<typeof useQueue>;
