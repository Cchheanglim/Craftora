import { useCallback, useEffect, useRef, useState } from "react";

/** A video that hasn't loaded after this long stops holding the clock (it may be broken). */
const MAX_WAIT_MS = 8000;

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
  const timeRef = useRef(0);
  timeRef.current = time;
  /** Media elements still loading, with when they started. */
  const loading = useRef(new Map<string, number>());

  const isLoading = () => {
    const now = performance.now();
    for (const since of loading.current.values()) if (now - since < MAX_WAIT_MS) return true;
    return false;
  };

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const elapsed = now - last;
      last = now;
      if (isLoading()) {
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
    const map = loading.current;
    if (on === map.has(id)) return;
    if (on) map.set(id, performance.now());
    else map.delete(id);
    setWaiting(map.size > 0);
  }, []);

  return {
    time,
    playing,
    speed,
    /** Something on screen is still loading; the clock is holding. */
    waiting,
    setSpeed,
    seek,
    toggle,
    setLoading,
    pause: useCallback(() => setPlaying(false), []),
  };
}

export type Playback = ReturnType<typeof usePlayback>;
