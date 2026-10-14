import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Layer, MediaSource, Range } from "../types";
import { formatTimecode } from "../lib/timecode";
import { POSITIONS } from "../lib/layers";
import { Icon } from "./Icon";
import { SyncedMedia } from "./SyncedMedia";
import { MIN_CLIP, Timeline } from "./Timeline";
import { TimeField } from "./TimeField";
import "./Editor.css";

const FRAME = 1 / 30;
const SPEEDS = ["0.5", "1", "1.5", "2"];

interface EditorProps {
  source: MediaSource;
  range: Range;
  onRangeChange: (range: Range) => void;
  mirrored: boolean;
  layers: Layer[];
  /** Loudness of the clip's own sound, 0–1 in the preview. */
  mainVolume: number;
}

/** "none": the source has no playable preview (the editor is remounted per source). */
type LoadState = "loading" | "ready" | "error" | "none";

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName));

export function Editor({ source, range, onRangeChange, mirrored, layers, mainVolume }: EditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState("1");
  const [load, setLoad] = useState<LoadState>(source.previewUrl ? "loading" : "none");
  /** Width ÷ height of the clip's picture, so layers sit on the picture, not the letterbox. */
  const [aspect, setAspect] = useState(16 / 9);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = Math.min(1, mainVolume);
  }, [mainVolume]);

  // While playing, follow the video every frame so layers and separate sound stay in step.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (videoRef.current) setTime(videoRef.current.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  /** Where a layer's own timeline is now, or null while it isn't showing. */
  const layerTime = (layer: Layer) => {
    const t = time - range.start - layer.start;
    return time >= range.start && time <= range.end && t >= 0 && t < layer.duration ? t : null;
  };

  const duration = source.duration;
  const clamp = (t: number) => Math.min(duration, Math.max(0, t));

  const seek = useCallback(
    (t: number) => {
      const next = Math.min(duration, Math.max(0, t));
      if (videoRef.current) videoRef.current.currentTime = next;
      setTime(next);
    },
    [duration],
  );

  /** Plays the clip: from the in point if the playhead is outside it, stopping at the out point. */
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (video.currentTime < range.start || video.currentTime >= range.end - 0.05) {
      video.currentTime = range.start;
    }
    void video.play().catch(() => setLoad("error"));
  }, [range.start, range.end]);

  const setIn = useCallback(
    () => onRangeChange({ start: Math.min(time, range.end - MIN_CLIP), end: range.end }),
    [time, range.end, onRangeChange],
  );
  const setOut = useCallback(
    () => onRangeChange({ start: range.start, end: Math.max(time, range.start + MIN_CLIP) }),
    [time, range.start, onRangeChange],
  );

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = Number(speed);
  }, [speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const video = videoRef.current;
      const key = e.key.toLowerCase();
      const actions: Record<string, () => void> = {
        " ": togglePlay,
        k: () => video?.pause(),
        l: () => void video?.play(),
        j: () => seek(time - 5),
        i: setIn,
        o: setOut,
        arrowleft: () => seek(time - (e.shiftKey ? 1 : FRAME)),
        arrowright: () => seek(time + (e.shiftKey ? 1 : FRAME)),
      };
      const action = actions[key];
      if (!action) return;
      // Let focused buttons and sliders keep Space and arrows for themselves.
      const target = e.target as HTMLElement;
      if ((key === " " && target.tagName === "BUTTON") || (key.startsWith("arrow") && target.getAttribute("role") === "slider")) return;
      e.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seek, setIn, setOut, time]);

  const commitIn = (t: number) => {
    if (t >= range.end - MIN_CLIP) return "In must be before Out";
    onRangeChange({ start: clamp(t), end: range.end });
    return null;
  };
  const commitOut = (t: number) => {
    if (t > duration) return `The video ends at ${formatTimecode(duration)}`;
    if (t <= range.start + MIN_CLIP) return "Out must be after In";
    onRangeChange({ start: range.start, end: t });
    return null;
  };

  return (
    <section className="editor" aria-label="Editor">
      <header className="editor__head">
        <h1 className="truncate">{source.title}</h1>
        <p>
          {source.uploader} · <span className="mono">{formatTimecode(duration).slice(0, 8)}</span> ·{" "}
          {source.streams.length} streams
        </p>
      </header>

      <div className="editor__preview">
        {/* The stage has the clip's own shape, so layers land where they will in the export. */}
        <div className="editor__stage" style={{ "--aspect": aspect } as CSSProperties}>
          {source.previewUrl && (
            <video
              ref={videoRef}
              src={source.previewUrl}
              className={mirrored ? "editor__video is-mirrored" : "editor__video"}
              preload="metadata"
              playsInline
              // A separate sound stream plays instead (video-only previews such as YouTube's).
              muted={muted || Boolean(source.previewAudioUrl)}
              onClick={togglePlay}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
                v.volume = Math.min(1, mainVolume);
                v.currentTime = range.start;
                setTime(range.start);
                setLoad("ready");
              }}
              onError={() => setLoad("error")}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                setTime(t);
                if (t >= range.end && !e.currentTarget.paused) {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = range.end;
                }
              }}
            />
          )}
          {source.previewAudioUrl && (
            <SyncedMedia
              kind="audio"
              src={source.previewAudioUrl}
              time={time}
              playing={playing}
              volume={mainVolume}
              muted={muted}
              speed={Number(speed)}
            />
          )}
          {layers.map((layer) => {
            const t = layerTime(layer);
            if (layer.kind === "audio") {
              return (
                <SyncedMedia key={layer.id} kind="audio" src={layer.previewUrl} time={t} playing={playing} volume={layer.volume} muted={muted} speed={Number(speed)} />
              );
            }
            const { x, y } = layer.size >= 1 ? POSITIONS.center : POSITIONS[layer.position];
            return (
              <SyncedMedia
                key={layer.id}
                kind="video"
                src={layer.previewUrl}
                time={t}
                playing={playing}
                volume={layer.hasAudio ? layer.volume : 0}
                muted={muted}
                speed={Number(speed)}
                className="editor__layer"
                style={{
                  left: `${x * 100}%`,
                  top: `${y * 100}%`,
                  width: `${layer.size * 100}%`,
                  transform: `translate(${-x * 100}%, ${-y * 100}%)`,
                  visibility: t === null ? "hidden" : "visible",
                }}
              />
            );
          })}
        </div>
        {load === "ready" && (mirrored || (source.previewHasAudio === false && !source.previewAudioUrl)) && (
          <span className="editor__badge">
            {[mirrored && "Mirrored preview", source.previewHasAudio === false && !source.previewAudioUrl && "Silent preview · the saved file keeps its sound"]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        {load !== "ready" && (
          <div className="editor__overlay" role="status">
            {load === "loading" && "Loading preview…"}
            {load === "none" && "This link has no playable preview. Set the range by typing times or dragging the handles."}
            {load === "error" && (
              <>
                <Icon name="alert" size={16} />
                <span>Preview unavailable. Check your connection; trimming and export still work.</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="editor__transport">
        <div className="editor__buttons">
          <button type="button" className="btn btn--icon" aria-label="Previous frame" onClick={() => seek(time - FRAME)}>
            <Icon name="stepBack" size={15} />
          </button>
          <button
            type="button"
            className="editor__play"
            aria-label={playing ? "Pause" : "Play clip"}
            onClick={togglePlay}
          >
            <Icon name={playing ? "pause" : "play"} size={15} />
          </button>
          <button type="button" className="btn btn--icon" aria-label="Next frame" onClick={() => seek(time + FRAME)}>
            <Icon name="stepForward" size={15} />
          </button>
        </div>
        <p className="editor__clock mono">
          <span>{formatTimecode(time)}</span>
          <span className="editor__clock-total"> / {formatTimecode(duration)}</span>
        </p>
        <div className="editor__playback">
          <label htmlFor="speed" className="sr-only">
            Playback speed
          </label>
          <select id="speed" className="field mono" value={speed} onChange={(e) => setSpeed(e.target.value)}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--icon"
            aria-label={muted ? "Unmute" : "Mute"}
            aria-pressed={muted}
            onClick={() => setMuted((m) => !m)}
          >
            <Icon name={muted ? "volumeOff" : "volume"} />
          </button>
        </div>
      </div>

      <Timeline duration={duration} range={range} playhead={time} onSeek={seek} onRangeChange={onRangeChange} />

      <div className="editor__range">
        <div className="editor__point">
          <TimeField id="tc-in" label="In" value={range.start} onCommit={commitIn} />
          <button type="button" className="btn btn--secondary" onClick={setIn} aria-label="Set In to playhead" title="Set In to playhead">
            <span className="editor__set-word">Set</span> <kbd>I</kbd>
          </button>
        </div>
        <div className="editor__point">
          <TimeField id="tc-out" label="Out" value={range.end} onCommit={commitOut} />
          <button type="button" className="btn btn--secondary" onClick={setOut} aria-label="Set Out to playhead" title="Set Out to playhead">
            <span className="editor__set-word">Set</span> <kbd>O</kbd>
          </button>
        </div>
        <div className="editor__length">
          <span>Clip length</span>
          <output className="mono" htmlFor="tc-in tc-out">
            {formatTimecode(range.end - range.start)}
          </output>
        </div>
        <button type="button" className="btn btn--secondary" onClick={() => onRangeChange({ start: 0, end: duration })}>
          Whole video
        </button>
        <p className="editor__keys">
          <kbd>Space</kbd> play <kbd>J</kbd> −5 s <kbd>K</kbd> pause <kbd>L</kbd> play <kbd>←</kbd>
          <kbd>→</kbd> frame
        </p>
      </div>
    </section>
  );
}
