import { useEffect, useRef, type CSSProperties } from "react";

interface SyncedMediaProps {
  kind: "video" | "audio";
  src: string;
  /** Where this element should be on its own timeline right now; null while it's off. */
  time: number | null;
  playing: boolean;
  /** 0–1 (higher values are capped; the export can go louder). */
  volume: number;
  muted: boolean;
  speed: number;
  className?: string;
  style?: CSSProperties;
}

/** Seconds of drift tolerated while playing before re-seeking (seeking itself stutters). */
const PLAYING_TOLERANCE = 0.25;

/**
 * A video or audio element that follows the editor's playhead: a layer, or the separate
 * sound stream of a video-only preview.
 */
export function SyncedMedia({ kind, src, time, playing, volume, muted, speed, className, style }: SyncedMediaProps) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = Math.min(1, Math.max(0, volume));
    el.muted = muted;
    el.playbackRate = speed;
  }, [volume, muted, speed]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (time === null || (el.duration && time >= el.duration)) {
      if (!el.paused) el.pause();
      return;
    }
    const drift = Math.abs(el.currentTime - time);
    if (playing) {
      if (drift > PLAYING_TOLERANCE) el.currentTime = time;
      if (el.paused) void el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (drift > 0.04) el.currentTime = time;
    }
  }, [time, playing]);

  return kind === "video" ? (
    <video ref={ref} src={src} className={className} style={style} preload="auto" playsInline aria-hidden="true" />
  ) : (
    <audio ref={ref} src={src} preload="auto" aria-hidden="true" />
  );
}
