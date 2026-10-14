import { useEffect, useRef, type CSSProperties, type SyntheticEvent } from "react";

interface SyncedMediaProps {
  kind: "video" | "audio";
  src: string;
  /** Where this element should be on its own timeline right now; null while it's off. */
  time: number | null;
  playing: boolean;
  /** 0–1 (higher values are capped; the export can go louder). */
  volume: number;
  muted: boolean;
  /** Playback rate: the preview speed times the clip's own speed. */
  rate: number;
  /**
   * The media runs backwards. Browsers can't play in reverse, so while playing the
   * picture steps back by seeking (choppier than the export) and the sound is silent.
   */
  reverse?: boolean;
  className?: string;
  style?: CSSProperties;
  onLoadedMetadata?: (e: SyntheticEvent<HTMLVideoElement>) => void;
}

/** Seconds of drift tolerated while playing before re-seeking (seeking itself stutters). */
const PLAYING_TOLERANCE = 0.25;
/** Browsers accept roughly this range for playbackRate. */
const MIN_RATE = 0.0625;
const MAX_RATE = 16;

/**
 * A video or audio element that follows the editor's playhead: a layer, or the separate
 * sound stream of a video-only preview.
 */
export function SyncedMedia({ kind, src, time, playing, volume, muted, rate, reverse, className, style, onLoadedMetadata }: SyncedMediaProps) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  /** Where a reversed clip should be; caught up after each seek lands. */
  const target = useRef<number | null>(null);
  target.current = reverse ? time : null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = Math.min(1, Math.max(0, volume));
    el.muted = muted || Boolean(reverse);
    el.playbackRate = Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
  }, [volume, muted, rate, reverse]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (time === null || (el.duration && time >= el.duration)) {
      if (!el.paused) el.pause();
      return;
    }
    const drift = Math.abs(el.currentTime - time);
    if (reverse) {
      // Step to the playhead whenever the previous seek has landed.
      if (!el.paused) el.pause();
      if (!el.seeking && drift > 0.02) el.currentTime = time;
      return;
    }
    if (playing) {
      if (drift > PLAYING_TOLERANCE * Math.max(1, rate)) el.currentTime = time;
      if (el.paused) void el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (drift > 0.04) el.currentTime = time;
    }
  }, [time, playing, reverse, rate]);

  const onSeeked = () => {
    const el = ref.current;
    const t = target.current;
    if (el && t !== null && Math.abs(el.currentTime - t) > 0.02) el.currentTime = t;
  };

  return kind === "video" ? (
    <video
      ref={ref}
      src={src}
      className={className}
      style={style}
      preload="auto"
      playsInline
      aria-hidden="true"
      onLoadedMetadata={onLoadedMetadata}
      onSeeked={onSeeked}
    />
  ) : (
    <audio ref={ref} src={src} preload="auto" aria-hidden="true" onSeeked={onSeeked} />
  );
}
