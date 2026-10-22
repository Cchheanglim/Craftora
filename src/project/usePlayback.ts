import { useCallback, useEffect, useRef, useState } from "react";

/** Loading longer than this is reported as slow, so the preview can say so and suggest a download. */
const SLOW_MS = 8000;

/**
 * The timeline's clock. Nothing on the timeline is a single video, so playback is driven
 * by time itself and every clip's media element follows it. While a playing clip is still
 * loading (after a jump, or on a slow link) the clock waits for it, so the picture never
 * falls behind the time display.
 */
export function usePlayback(duration: number) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [waiting, setWaiting] = useState(false);
  const [slow, setSlow] = useState(false);
  const slowTimer = useRef<number | undefined>(undefined);
  const timeRef = useRef(0);
  timeRef.current = time;
  /**
   * Media elements still loading. The clock holds for as long as any is: it used to give up after
   * 8 s and run on without the picture. Media that fails stops loading (SyncedMedia's onFailed).
   */
  const loading = useRef(new Set<string>());

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const elapsed = now - last;
      last = now;
      if (loading.current.size > 0) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const next = timeRef.current + (elapsed / 1000) * speed;
      if (next >= duration) {
        setTime(duration);
        setPlaying(false);
        return;
      }
      setTime(next);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, duration]);

  // Keep the playhead inside the timeline when clips are removed or shortened.
  useEffect(() => {
    if (timeRef.current > duration) setTime(duration);
  }, [duration]);

  const seek = useCallback((t: number) => setTime(Math.min(Math.max(0, t), duration)), [duration]);

  const toggle = useCallback(() => {
    if (duration <= 0) return;
    setPlaying((p) => {
      // At the end, Play starts over.
      if (!p && timeRef.current >= duration - 0.01) setTime(0);
      return !p;
    });
  }, [duration]);

  /** Media elements report here while they can't play yet (see SyncedMedia's onLoading). */
  const setLoading = useCallback((id: string, on: boolean) => {
    const set = loading.current;
    if (on === set.has(id)) return;
    if (on) set.add(id);
    else set.delete(id);
    setWaiting(set.size > 0);
    if (set.size > 0 && slowTimer.current === undefined) {
      slowTimer.current = window.setTimeout(() => setSlow(true), SLOW_MS);
    } else if (set.size === 0) {
      window.clearTimeout(slowTimer.current);
      slowTimer.current = undefined;
      setSlow(false);
    }
  }, []);

  return {
    time,
    playing,
    speed,
    /** Something on screen is still loading; the clock is holding. */
    waiting,
    /** It has been loading for a while (a slow website). */
    slow,
    setSpeed,
    seek,
    toggle,
    setLoading,
    pause: useCallback(() => setPlaying(false), []),
  };
}

export type Playback = ReturnType<typeof usePlayback>;
