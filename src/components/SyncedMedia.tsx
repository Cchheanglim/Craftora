import { useEffect, useRef, type CSSProperties, type SyntheticEvent } from "react";
import Hls from "hls.js";
import { HLS_RELAY, RECORDINGS, noteDiagnostic, sharpPreview } from "../lib/engine";

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
  /** The first frame is ready to show. */
  onReady?: () => void;
  /** True while this element can't play the current spot yet (loading or seeking). */
  onLoading?: (on: boolean) => void;
  /** The media can't be played at all (the server refused it, or the format is unsupported). */
  onFailed?: () => void;
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
export function SyncedMedia({ kind, src, time, playing, volume, muted, rate, reverse, className, style, onLoadedMetadata, onReady, onLoading, onFailed }: SyncedMediaProps) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  /**
   * Where the element should be. Seeks aren't stacked: while one is running, newer times
   * only update this, and the element jumps to the latest one when the seek lands. Stacked
   * seeks (from dragging the playhead) are what made the picture freeze while time ran on.
   */
  const target = useRef<number | null>(null);
  target.current = time;
  const playingRef = useRef(playing);
  playingRef.current = playing;

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
      if (!el.seeking && drift > PLAYING_TOLERANCE * Math.max(1, rate)) el.currentTime = time;
      if (el.paused) void el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (!el.seeking && drift > 0.04) el.currentTime = time;
    }
  }, [time, playing, reverse, rate]);

  // Loading only holds the clock for clips on screen now, and never for reversed clips,
  // which seek all the time by design.
  const tracked = time !== null && !reverse;
  const report = useRef(onLoading);
  report.current = onLoading;
  useEffect(() => {
    if (!tracked) return;
    const el = ref.current;
    // HAVE_FUTURE_DATA: enough to play on from here.
    if (el && el.readyState < 3) report.current?.(true);
    return () => report.current?.(false);
  }, [tracked]);
  const loadingNow = () => tracked && report.current?.(true);
  const readyNow = () => {
    const el = ref.current;
    if (el && el.readyState >= 3 && !el.seeking) report.current?.(false);
  };

  // A failed element never finishes loading: stop holding the clock and let the preview say so.
  const failed = () => {
    report.current?.(false);
    onFailed?.();
  };

  // Streams through the relay play with hls.js: the WebView's own HLS player refuses the relay's
  // address, and only the relay can send the page those streams' servers want. Live recordings too.
  const viaHls = src.startsWith(HLS_RELAY) || src.startsWith(RECORDINGS);
  const failedRef = useRef(failed);
  failedRef.current = failed;
  useEffect(() => {
    const el = ref.current;
    if (!el || !viaHls) return;
    // Start sharp: hls.js otherwise starts at its lowest quality until it has measured the
    // connection, and through the relay it can stay there. It still steps down if needed.
    // "Sharp" previews start at the top quality.
    const player = new Hls({ abrEwmaDefaultEstimate: sharpPreview() ? 50_000_000 : 5_000_000 });
    player.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal || data.response?.code)
        noteDiagnostic(`preview player: ${data.fatal ? "stopped" : "problem"}: ${data.details}${data.response?.code ? ` (answered ${data.response.code})` : ""} ${data.url ?? ""}`);
      if (data.fatal) failedRef.current();
    });
    player.loadSource(src);
    player.attachMedia(el);
    return () => player.destroy();
  }, [src, viaHls]);
  // Leaving hls.js (a stream that finished downloading): its cleanup removes the element's src,
  // which React had already set to the file, so the player would sit empty. Set it again.
  useEffect(() => {
    const el = ref.current;
    if (el && !viaHls && src && el.getAttribute("src") !== src) el.src = src;
  }, [src, viaHls]);

  const onSeeked = () => {
    const el = ref.current;
    const t = target.current;
    // Catch up with where the playhead went while this seek was running.
    const tolerance = reverse ? 0.02 : playingRef.current ? PLAYING_TOLERANCE : 0.04;
    if (el && t !== null && Math.abs(el.currentTime - t) > tolerance) {
      el.currentTime = t;
      return;
    }
    readyNow();
  };

  return kind === "video" ? (
    <video
      ref={ref}
      src={viaHls ? undefined : src}
      className={className}
      style={style}
      preload="auto"
      playsInline
      aria-hidden="true"
      onLoadedMetadata={onLoadedMetadata}
      onLoadedData={onReady}
      onError={failed}
      onSeeking={loadingNow}
      onWaiting={loadingNow}
      onSeeked={onSeeked}
      onCanPlay={readyNow}
      onPlaying={readyNow}
    />
  ) : (
    <audio
      ref={ref}
      src={viaHls ? undefined : src}
      preload="auto"
      aria-hidden="true"
      onError={failed}
      onSeeking={loadingNow}
      onWaiting={loadingNow}
      onSeeked={onSeeked}
      onCanPlay={readyNow}
      onPlaying={readyNow}
    />
  );
}
