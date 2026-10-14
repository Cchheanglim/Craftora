import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The timeline's clock. Nothing on the timeline is a single video, so playback is driven
 * by time itself and every clip's media element follows it.
 */
export function usePlayback(duration: number) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timeRef = useRef(0);
  timeRef.current = time;

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const next = timeRef.current + ((now - last) / 1000) * speed;
      last = now;
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

  return { time, playing, speed, setSpeed, seek, toggle, pause: useCallback(() => setPlaying(false), []) };
}

export type Playback = ReturnType<typeof usePlayback>;
