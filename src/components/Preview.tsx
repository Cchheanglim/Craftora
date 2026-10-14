import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type SyntheticEvent } from "react";
import type { Frame } from "../types";
import { clipEnd, fadeAt, mainTrack, mediaTimeAt, type Clip, type Project } from "../project/model";
import type { ProjectApi } from "../project/useProject";
import type { Playback } from "../project/usePlayback";
import { formatTimecode } from "../lib/timecode";
import { setWindowFullscreen } from "../lib/engine";
import { Icon } from "./Icon";
import { SyncedMedia } from "./SyncedMedia";
import "./Preview.css";

const FRAME = 1 / 30;
const SPEEDS = [0.5, 1, 1.5, 2];
/** Pixels within which a dragged picture or text snaps to the centre or the edges. */
const SNAP_PX = 6;
const MIN_OVERLAY = 0.1;
const MIN_TEXT = 0.02;
const MAX_TEXT = 0.3;

interface PreviewProps {
  project: Project;
  api: ProjectApi;
  playback: Playback;
  frame: Frame;
  duration: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

type Corner = "nw" | "ne" | "sw" | "se";

/** A picture-in-picture or text being moved or resized on the preview. */
interface Gesture {
  clipId: string;
  mode: "move" | Corner;
  originX: number;
  originY: number;
  stage: DOMRect;
  box: DOMRect;
  size: number;
  isText: boolean;
  moved: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fraction of the free space for a box at `offset` px, snapped to the middle and the edges. */
function placeAlong(offset: number, free: number): number {
  if (free <= 0) return 0.5;
  for (const target of [0, free / 2, free]) if (Math.abs(offset - target) < SNAP_PX) return target / free;
  return clamp(offset / free, 0, 1);
}

/** Plays the timeline: every clip's media follows the playhead, stacked like the export. */
export function Preview({ project, api, playback, frame, duration, selectedId, onSelect }: PreviewProps) {
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  /** Set when a drag ends, so the click that follows doesn't count as a click on the screen. */
  const justDragged = useRef(false);
  const { time, playing } = playback;

  const toggleFullscreen = () => {
    const next = !fullscreen;
    setFullscreen(next);
    void setWindowFullscreen(next);
  };

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFullscreen(false);
        void setWindowFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // "F" from the global shortcuts.
  useEffect(() => {
    const onToggle = () => toggleFullscreen();
    window.addEventListener("craftora:toggle-fullscreen", onToggle);
    return () => window.removeEventListener("craftora:toggle-fullscreen", onToggle);
  });

  const main = mainTrack(project).id;
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i]));
  const mediaOf = (c: Clip) => project.media.find((m) => m.id === c.mediaId);
  const active = (c: Clip) => time >= c.start && time < clipEnd(c);
  const mediaTime = (c: Clip) => (active(c) ? mediaTimeAt(c, time) : null);
  const stageAspect = frame.width / frame.height;

  // Bottom to top: Video 1, then picture tracks from the lowest row up, then text.
  const pictures = project.clips
    .filter((c) => c.mediaId && project.tracks.find((t) => t.id === c.trackId)?.kind === "video")
    .sort((a, b) => (a.trackId === main ? -1 : b.trackId === main ? 1 : (trackIndex.get(b.trackId) ?? 0) - (trackIndex.get(a.trackId) ?? 0)));
  const sounds = project.clips.filter((c) => c.mediaId && project.tracks.find((t) => t.id === c.trackId)?.kind === "audio");
  const texts = project.clips.filter((c) => !c.mediaId);
  const nothingHere = !project.clips.some(active);
  const selected = project.clips.find((c) => c.id === selectedId);
  const editable = (c?: Clip) => Boolean(c && c.trackId !== main && project.tracks.find((t) => t.id === c.trackId)?.kind !== "audio");

  // Moving and resizing follow the pointer on the window, like the timeline.
  const onPointerMove = useRef<(e: PointerEvent) => void>(() => {});
  onPointerMove.current = (e) => {
    const g = gestureRef.current;
    if (!g) return;
    const dx = e.clientX - g.originX;
    const dy = e.clientY - g.originY;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < 3) return;
      g.moved = true;
      api.checkpoint();
    }
    const { stage, box } = g;
    const left0 = box.left - stage.left;
    const top0 = box.top - stage.top;
    if (g.mode === "move") {
      api.editLive({
        type: "updateClip",
        clipId: g.clipId,
        patch: { x: placeAlong(left0 + dx, stage.width - box.width), y: placeAlong(top0 + dy, stage.height - box.height) },
      });
      return;
    }
    // Resize from a corner, keeping the shape and the opposite corner where it is.
    const fromLeft = g.mode === "nw" || g.mode === "sw";
    const fromTop = g.mode === "nw" || g.mode === "ne";
    const scale = (box.width + (fromLeft ? -dx : dx)) / box.width;
    const size = g.isText ? clamp(g.size * scale, MIN_TEXT, MAX_TEXT) : clamp(g.size * scale, MIN_OVERLAY, 1);
    const ratio = size / g.size;
    const width = box.width * ratio;
    const height = box.height * ratio;
    const left = fromLeft ? left0 + box.width - width : left0;
    const top = fromTop ? top0 + box.height - height : top0;
    const free = (total: number, used: number, offset: number) => (total - used <= 0 ? 0.5 : clamp(offset / (total - used), 0, 1));
    api.editLive({
      type: "updateClip",
      clipId: g.clipId,
      patch: { size, x: free(stage.width, width, left), y: free(stage.height, height, top) },
    });
  };

  const beginGesture = (clip: Clip, mode: Gesture["mode"]) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !stageRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(clip.id);
    const box = (mode === "move" ? e.currentTarget : e.currentTarget.parentElement!).getBoundingClientRect();
    gestureRef.current = {
      clipId: clip.id,
      mode,
      originX: e.clientX,
      originY: e.clientY,
      stage: stageRef.current.getBoundingClientRect(),
      box,
      size: clip.size,
      isText: !clip.mediaId,
      moved: false,
    };
    const move = (ev: PointerEvent) => onPointerMove.current(ev);
    const up = () => {
      if (gestureRef.current?.moved) {
        justDragged.current = true;
        window.setTimeout(() => (justDragged.current = false), 0);
      }
      gestureRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const handles = (clip: Clip) =>
    (["nw", "ne", "sw", "se"] as Corner[]).map((corner) => (
      <span key={corner} className={`preview__handle is-${corner}`} onPointerDown={beginGesture(clip, corner)} aria-hidden="true" />
    ));

  return (
    <section className={fullscreen ? "preview is-fullscreen" : "preview"} aria-label="Preview">
      <div
        className="preview__screen"
        onClick={() => {
          if (justDragged.current) return;
          // With a picture or text selected, a click beside it lets go of it; otherwise it plays.
          if (editable(selected)) onSelect(null);
          else playback.toggle();
        }}
      >
        <div ref={stageRef} className="preview__stage" style={{ "--aspect": stageAspect } as CSSProperties}>
          {pictures.map((clip) => {
            const media = mediaOf(clip);
            if (!media?.source.previewUrl) return null;
            const t = mediaTime(clip);
            const isMain = clip.trackId === main;
            const separateSound = Boolean(media.source.previewAudioUrl);
            const isSelected = clip.id === selectedId && t !== null && !isMain;
            const rate = playback.speed * clip.speed;
            return (
              <PictureLayer
                key={clip.id}
                clip={clip}
                isMain={isMain}
                stageAspect={stageAspect}
                visible={t !== null}
                opacity={t === null ? 0 : fadeAt(clip, time)}
                selected={isSelected}
                onPointerDown={isMain ? undefined : beginGesture(clip, "move")}
                handles={isSelected ? handles(clip) : null}
              >
                {(onMeta, style) => (
                  <>
                    <SyncedMedia
                      kind="video"
                      src={media.source.previewUrl}
                      time={t}
                      playing={playing}
                      volume={clip.volume * fadeAt(clip, time)}
                      muted={muted || separateSound}
                      rate={rate}
                      reverse={clip.reverse}
                      className={clip.mirror ? "preview__video is-mirrored" : "preview__video"}
                      style={style}
                      onLoadedMetadata={onMeta}
                    />
                    {separateSound && (
                      <SyncedMedia
                        kind="audio"
                        src={media.source.previewAudioUrl!}
                        time={t}
                        playing={playing}
                        volume={clip.volume * fadeAt(clip, time)}
                        muted={muted}
                        rate={rate}
                        reverse={clip.reverse}
                      />
                    )}
                  </>
                )}
              </PictureLayer>
            );
          })}
          {sounds.map((clip) => {
            const media = mediaOf(clip);
            const src = media?.source.previewAudioUrl || media?.source.previewUrl;
            if (!src) return null;
            return (
              <SyncedMedia
                key={clip.id}
                kind="audio"
                src={src}
                time={mediaTime(clip)}
                playing={playing}
                volume={clip.volume * fadeAt(clip, time)}
                muted={muted}
                rate={playback.speed * clip.speed}
                reverse={clip.reverse}
              />
            );
          })}
          {texts.filter(active).map((clip) => {
            const isSelected = clip.id === selectedId;
            return (
              <div
                key={clip.id}
                className={isSelected ? "preview__text is-selected" : "preview__text"}
                style={{
                  left: `${clip.x * 100}%`,
                  top: `${clip.y * 100}%`,
                  translate: `${-clip.x * 100}% ${-clip.y * 100}%`,
                  fontSize: `${clip.size * 100}cqh`,
                  color: clip.color,
                  opacity: fadeAt(clip, time),
                }}
                onPointerDown={beginGesture(clip, "move")}
                onClick={(e) => e.stopPropagation()}
              >
                {clip.text}
                {isSelected && handles(clip)}
              </div>
            );
          })}
        </div>
        {nothingHere && duration > 0 && <p className="preview__note">Nothing on the timeline here</p>}
      </div>

      <div className="preview__transport" onClick={(e) => e.stopPropagation()}>
        <div className="preview__buttons">
          <button type="button" className="btn btn--icon" aria-label="Previous frame" onClick={() => playback.seek(time - FRAME)}>
            <Icon name="stepBack" size={15} />
          </button>
          <button type="button" className="preview__play" aria-label={playing ? "Pause" : "Play"} onClick={playback.toggle} disabled={duration <= 0}>
            <Icon name={playing ? "pause" : "play"} size={15} />
          </button>
          <button type="button" className="btn btn--icon" aria-label="Next frame" onClick={() => playback.seek(time + FRAME)}>
            <Icon name="stepForward" size={15} />
          </button>
        </div>
        <p className="preview__clock mono">
          <span>{formatTimecode(time)}</span>
          <span className="preview__total"> / {formatTimecode(duration)}</span>
        </p>
        <div className="preview__right">
          <label htmlFor="speed" className="sr-only">
            Playback speed
          </label>
          <select id="speed" className="field mono" value={playback.speed} onChange={(e) => playback.setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--icon" aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} onClick={() => setMuted((m) => !m)}>
            <Icon name={muted ? "volumeOff" : "volume"} />
          </button>
          <button
            type="button"
            className="btn btn--icon"
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            title={fullscreen ? "Exit full screen (Esc)" : "Full screen (F)"}
            onClick={toggleFullscreen}
          >
            <Icon name={fullscreen ? "minimize" : "maximize"} />
          </button>
        </div>
      </div>
    </section>
  );
}

interface PictureLayerProps {
  clip: Clip;
  isMain: boolean;
  stageAspect: number;
  visible: boolean;
  opacity: number;
  selected: boolean;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  handles: ReactNode;
  children: (onMeta: (e: SyntheticEvent<HTMLVideoElement>) => void, style: CSSProperties) => ReactNode;
}

/**
 * One picture on the stage, placed like the export: Video 1 fitted inside the frame,
 * other tracks at their size and position. The crop is a window onto the video.
 */
function PictureLayer({ clip, isMain, stageAspect, visible, opacity, selected, onPointerDown, handles, children }: PictureLayerProps) {
  // The video's own shape, known once it has loaded.
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const { left, top, right, bottom } = clip.crop;
  const keptW = 1 - left - right;
  const keptH = 1 - top - bottom;
  const aspect = (videoAspect * keptW) / keptH;

  let box: CSSProperties;
  if (isMain) {
    // Fitted inside the frame, centred, like FFmpeg's scale + pad.
    const wide = aspect >= stageAspect;
    box = {
      width: wide ? "100%" : `${(aspect / stageAspect) * 100}%`,
      height: wide ? `${(stageAspect / aspect) * 100}%` : "100%",
      left: "50%",
      top: "50%",
      translate: "-50% -50%",
    };
  } else {
    box = {
      width: `${clip.size * 100}%`,
      aspectRatio: String(aspect),
      left: `${clip.x * 100}%`,
      top: `${clip.y * 100}%`,
      translate: `${-clip.x * 100}% ${-clip.y * 100}%`,
    };
  }
  const video: CSSProperties = {
    width: `${100 / keptW}%`,
    height: `${100 / keptH}%`,
    left: `${(-left / keptW) * 100}%`,
    top: `${(-top / keptH) * 100}%`,
  };

  return (
    <div
      className={[isMain ? "preview__picture is-main" : "preview__picture", selected && "is-selected"].filter(Boolean).join(" ")}
      style={{ ...box, visibility: visible ? "visible" : "hidden", opacity }}
      onPointerDown={onPointerDown}
      onClick={onPointerDown ? (e) => e.stopPropagation() : undefined}
    >
      <div className="preview__crop">
        {children((e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight) setVideoAspect(v.videoWidth / v.videoHeight);
        }, video)}
      </div>
      {handles}
    </div>
  );
}
