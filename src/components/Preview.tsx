import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Frame } from "../types";
import { clipEnd, fadeAt, mediaTimeAt, peaksFor, trackOrder, transitionMix, type Clip, type Project } from "../project/model";
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
const MIN_PICTURE = 0.1;
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
  /** Saves a PNG snapshot of the current preview frame and imports it into Media. */
  onSnapshot?: (bytes: Uint8Array) => Promise<void>;
}

const WAVE_BARS = 140;

/** Draws the visible preview stage onto a canvas and encodes it as a PNG. */
async function captureStagePng(stage: HTMLElement, width: number, height: number): Promise<Uint8Array | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  const sr = stage.getBoundingClientRect();
  if (!sr.width || !sr.height) return null;
  const sx = width / sr.width;
  const sy = height / sr.height;
  for (const pic of stage.querySelectorAll<HTMLElement>(".preview__picture")) {
    if (pic.style.visibility === "hidden") continue;
    const media = pic.querySelector<HTMLVideoElement | HTMLImageElement>("video, img");
    const crop = pic.querySelector<HTMLElement>(".preview__crop");
    if (!media || !crop) continue;
    const cr = crop.getBoundingClientRect();
    const mr = media.getBoundingClientRect();
    ctx.save();
    ctx.globalAlpha = Number(pic.style.opacity || 1);
    ctx.beginPath();
    ctx.rect((cr.left - sr.left) * sx, (cr.top - sr.top) * sy, cr.width * sx, cr.height * sy);
    ctx.clip();
    const mx = (mr.left - sr.left) * sx;
    const my = (mr.top - sr.top) * sy;
    const mw = mr.width * sx;
    const mh = mr.height * sy;
    if (media.classList.contains("is-mirrored")) {
      ctx.translate(mx + mw, my);
      ctx.scale(-1, 1);
      ctx.drawImage(media, 0, 0, mw, mh);
    } else {
      ctx.drawImage(media, mx, my, mw, mh);
    }
    ctx.restore();
  }
  try {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
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
export function Preview({ project, api, playback, frame, duration, selectedId, onSelect, onSnapshot }: PreviewProps) {
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [snapping, setSnapping] = useState(false);
  /** Preview files that failed to load (refused by their server, or unplayable). */
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const fail = (src: string) => setFailed((all) => (all.has(src) ? all : new Set(all).add(src)));
  const stageRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  /** Set when a drag ends, so the click that follows doesn't count as a click on the screen. */
  const justDragged = useRef(false);
  const { time, playing } = playback;
  // While a clip loads, everything holds together: sound must not run on under a stuck picture.
  const running = playing && !playback.waiting;

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

  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i]));
  const trackKind = (c: Clip) => project.tracks.find((t) => t.id === c.trackId)?.kind;
  const trackMuted = (c: Clip) => Boolean(project.tracks.find((t) => t.id === c.trackId)?.muted);
  const mediaOf = (c: Clip) => project.media.find((m) => m.id === c.mediaId);
  const active = (c: Clip) => time >= c.start && time < clipEnd(c);
  const mediaTime = (c: Clip) => (active(c) ? mediaTimeAt(c, time) : null);
  const stageAspect = frame.width / frame.height;

  // Each magnetic track's clips in play order, for transitions.
  const orders = new Map(project.tracks.filter((t) => t.magnetic).map((t) => [t.id, trackOrder(project, t.id)]));
  // Bottom track first; on a track, later clips over earlier ones (an incoming transition
  // covers the outgoing clip). The same order as the export.
  const layer = (c: Clip) => (project.tracks.length - (trackIndex.get(c.trackId) ?? 0)) * 10_000 + (orders.get(c.trackId)?.indexOf(c) ?? 0);
  const byLayer = (a: Clip, b: Clip) => layer(a) - layer(b);
  const pictures = project.clips.filter((c) => c.mediaId && trackKind(c) === "video").sort(byLayer);
  /** Fades and transitions together: how visible and how loud a clip is now. */
  const mix = (c: Clip) => {
    const fade = fadeAt(c, time);
    const order = orders.get(c.trackId);
    const t = order ? transitionMix(order, c, time) : { picture: 1, sound: 1 };
    return { picture: fade * t.picture, sound: fade * t.sound };
  };
  const sounds = project.clips.filter((c) => c.mediaId && trackKind(c) === "audio");
  const texts = project.clips.filter((c) => !c.mediaId).sort(byLayer);
  const nothingHere = !project.clips.some(active);
  const selected = project.clips.find((c) => c.id === selectedId);
  const editable = (c?: Clip) => Boolean(c && trackKind(c) !== "audio");

  // The combined radio wave across the timeline, shown right under the video.
  const timelineWave = useMemo(() => {
    if (duration <= 0) return [];
    const audible = project.clips.filter((c) => {
      const t = project.tracks.find((tr) => tr.id === c.trackId);
      const m = project.media.find((x) => x.id === c.mediaId);
      return c.mediaId && t && t.kind !== "text" && !t.muted && c.volume > 0 && m?.hasAudio && !m.source.image;
    });
    const mediaPeaks = new Map(project.media.map((m) => [m.id, peaksFor(m)]));
    return Array.from({ length: WAVE_BARS }, (_, i) => {
      const t = ((i + 0.5) / WAVE_BARS) * duration;
      let sum = 0;
      for (const c of audible) {
        if (t < c.start || t >= clipEnd(c)) continue;
        const full = mediaPeaks.get(c.mediaId!);
        const m = project.media.find((x) => x.id === c.mediaId);
        if (!full?.length || !m) continue;
        const mt = mediaTimeAt(c, t);
        const idx = Math.min(full.length - 1, Math.max(0, Math.floor((mt / Math.max(0.1, m.source.duration)) * full.length)));
        sum += full[idx] * c.volume * fadeAt(c, t);
      }
      return Math.max(6, Math.min(100, Math.round(sum)));
    });
  }, [project.clips, project.media, project.tracks, duration]);

  const scrubWave = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || duration <= 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const seekAt = (clientX: number) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) playback.seek(clamp((clientX - r.left) / r.width, 0, 1) * duration);
    };
    playback.pause();
    seekAt(e.clientX);
    const move = (ev: PointerEvent) => seekAt(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const takeSnapshot = async () => {
    if (!onSnapshot || !stageRef.current || snapping) return;
    setSnapping(true);
    try {
      const bytes = await captureStagePng(stageRef.current, frame.width, frame.height);
      if (bytes) await onSnapshot(bytes);
    } finally {
      setSnapping(false);
    }
  };

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
    const size = g.isText ? clamp(g.size * scale, MIN_TEXT, MAX_TEXT) : clamp(g.size * scale, MIN_PICTURE, 1);
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
          {pictures.some((c) => {
            // A link with nothing playable, or whose preview failed, would otherwise just be black.
            const source = mediaOf(c)?.source;
            return mediaTime(c) !== null && source && !source.local && (!source.previewUrl || failed.has(source.previewUrl));
          }) && <span className="preview__loading">This video can't play in the preview. Download it with ⬇ in Media to watch and edit it.</span>}
          {pictures.map((clip) => {
            const media = mediaOf(clip);
            const canPlay = Boolean(media?.source.previewUrl && !failed.has(media.source.previewUrl));
            const poster = media?.source.thumbnail && !media.source.thumbnail.includes("#t=") ? media.source.thumbnail : undefined;
            if (!media || (!canPlay && !poster)) return null;
            const t = mediaTime(clip);
            const separateSound = Boolean(media.source.previewAudioUrl);
            const isSelected = clip.id === selectedId && t !== null;
            const rate = playback.speed * clip.speed;
            return (
              <PictureLayer
                key={clip.id}
                clip={clip}
                stageAspect={stageAspect}
                visible={t !== null}
                opacity={t === null ? 0 : mix(clip).picture}
                selected={isSelected}
                poster={poster}
                onPointerDown={beginGesture(clip, "move")}
                handles={isSelected ? handles(clip) : null}
              >
                {(onShape, style, onReady) =>
                  media.source.image ? (
                    <img
                      src={(canPlay ? media.source.previewUrl : poster) || poster}
                      alt=""
                      className={clip.mirror ? "preview__video is-mirrored" : "preview__video"}
                      style={style}
                      draggable={false}
                      onError={() => {
                        if (canPlay) fail(media.source.previewUrl);
                      }}
                      onLoad={(e) => {
                        onShape(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
                        onReady();
                      }}
                    />
                  ) : (
                  <>
                    {canPlay && (
                      <SyncedMedia
                        kind="video"
                        src={media.source.previewUrl}
                        time={t}
                        playing={running}
                        volume={clip.volume * mix(clip).sound}
                        muted={muted || trackMuted(clip) || separateSound}
                        rate={rate}
                        reverse={clip.reverse}
                        onLoading={(on) => playback.setLoading(`${clip.id}:video`, on)}
                        onFailed={() => fail(media.source.previewUrl)}
                        className={clip.mirror ? "preview__video is-mirrored" : "preview__video"}
                        style={style}
                        onLoadedMetadata={(e) => onShape(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
                        onReady={onReady}
                      />
                    )}
                    {separateSound && (
                      <SyncedMedia
                        kind="audio"
                        src={media.source.previewAudioUrl!}
                        time={t}
                        playing={running}
                        volume={clip.volume * mix(clip).sound}
                        muted={muted || trackMuted(clip)}
                        rate={rate}
                        reverse={clip.reverse}
                        onLoading={(on) => playback.setLoading(`${clip.id}:audio`, on)}
                      />
                    )}
                  </>
                  )
                }
              </PictureLayer>
            );
          })}
          {sounds.map((clip) => {
            const media = mediaOf(clip);
            const src = media?.source.previewAudioUrl || media?.source.previewUrl;
            if (!src || failed.has(src)) return null;
            return (
              <SyncedMedia
                key={clip.id}
                kind="audio"
                src={src}
                time={mediaTime(clip)}
                playing={running}
                volume={clip.volume * mix(clip).sound}
                muted={muted || trackMuted(clip)}
                rate={playback.speed * clip.speed}
                reverse={clip.reverse}
                onLoading={(on) => playback.setLoading(`${clip.id}:audio`, on)}
                onFailed={() => fail(src)}
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
        {playing && playback.waiting && (
          <p className="preview__waiting">
            {playback.slow ? "Still loading from the website… Download it with ⬇ in Media for smooth editing." : "Loading…"}
          </p>
        )}
      </div>

      {timelineWave.length > 0 && (
        <div
          className="preview__wave"
          role="slider"
          aria-label="Audio wave"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          title="Click or drag along the audio wave to jump through the video"
          onPointerDown={scrubWave}
          onClick={(e) => e.stopPropagation()}
        >
          {timelineWave.map((h, i) => {
            const barTime = ((i + 0.5) / timelineWave.length) * duration;
            const past = barTime <= time;
            return <span key={i} className={past ? "is-past" : undefined} style={{ height: `${muted ? 8 : h}%` }} />;
          })}
        </div>
      )}

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
          {onSnapshot && (
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Save snapshot of current frame"
              title="Snapshot: save this frame as a PNG and add it to Media"
              disabled={nothingHere || snapping}
              onClick={() => void takeSnapshot()}
            >
              <Icon name="camera" />
            </button>
          )}
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
  stageAspect: number;
  visible: boolean;
  opacity: number;
  selected: boolean;
  poster?: string;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  handles: ReactNode;
  /** Renders the picture: a video or an image. It reports its pixel size and when it's ready. */
  children: (onShape: (width: number, height: number) => void, style: CSSProperties, onReady: () => void) => ReactNode;
}

/**
 * One picture on the stage, placed like the export: fitted inside the frame, scaled by its
 * size, at its position. The crop is a window onto the video.
 */
function PictureLayer({ clip, stageAspect, visible, opacity, selected, poster, onPointerDown, handles, children }: PictureLayerProps) {
  // The video's own shape, known once it has loaded.
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [ready, setReady] = useState(false);
  const { left, top, right, bottom } = clip.crop;
  const keptW = 1 - left - right;
  const keptH = 1 - top - bottom;
  const aspect = (videoAspect * keptW) / keptH;

  // Size 1 fits the frame keeping the shape (FFmpeg: force_original_aspect_ratio=decrease), or
  // with `fill` covers it, the frame cutting off what spills over (=increase).
  const wider = aspect >= stageAspect;
  const fitWidth = clip.fill ? (wider ? aspect / stageAspect : 1) : wider ? 1 : aspect / stageAspect;
  const box: CSSProperties = {
    width: `${fitWidth * clip.size * 100}%`,
    aspectRatio: String(aspect),
    left: `${clip.x * 100}%`,
    top: `${clip.y * 100}%`,
    translate: `${-clip.x * 100}% ${-clip.y * 100}%`,
  };
  const video: CSSProperties = {
    width: `${100 / keptW}%`,
    height: `${100 / keptH}%`,
    left: `${(-left / keptW) * 100}%`,
    top: `${(-top / keptH) * 100}%`,
  };

  return (
    <div
      className={selected ? "preview__picture is-selected" : "preview__picture"}
      style={{ ...box, visibility: visible ? "visible" : "hidden", opacity }}
      onPointerDown={onPointerDown}
      onClick={onPointerDown ? (e) => e.stopPropagation() : undefined}
    >
      <div className="preview__crop">
        {!ready && poster && (
          <img
            src={poster}
            alt=""
            className={clip.mirror ? "preview__video is-mirrored" : "preview__video"}
            style={video}
            draggable={false}
            onLoad={(e) => {
              if (e.currentTarget.naturalWidth && e.currentTarget.naturalHeight) {
                setVideoAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight);
              }
            }}
          />
        )}
        {children(
          (width, height) => {
            if (width && height) setVideoAspect(width / height);
          },
          video,
          () => setReady(true),
        )}
      </div>
      {visible && !ready && !poster && <span className="preview__loading">Loading video…</span>}
      {handles}
    </div>
  );
}
