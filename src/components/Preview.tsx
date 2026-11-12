import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import type { Frame } from "../types";
import { isBlock, isShape, isText, showsPicture, clipEnd, fadeAt, soundFadeAt, mediaTimeAt, peakBetween, peaksFor, textLines, trackOrder, trackSilent, transitionMix, CAPTIONS, TEXT_FONTS, type Clip, type Project } from "../project/model";
import { newShapeClip, shapeBox, shapeSvg } from "../project/shapes";
import type { FxItem } from "../project/effects";
import { fxDrag } from "./TimelineEditor";
import { SHOWN_CAPTIONS, withShownCaptions } from "../project/actions";
import type { ProjectApi } from "../project/useProject";
import type { Playback } from "../project/usePlayback";
import { formatTimecode } from "../lib/timecode";
import { RGB_SHARE, adjustSteps, blocksStyle, keyLine, sharpenWeight, toneCurve, warmthMatrix, type LookStep, type ToneOp } from "../project/effects";
import { setWindowFullscreen } from "../lib/engine";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { SyncedMedia } from "./SyncedMedia";
import "./Preview.css";

const FRAME = 1 / 30;
const SPEEDS = [0.5, 1, 1.5, 2];
/** Pixels within which a dragged picture or text snaps to the centre or the edges. */
const SNAP_PX = 6;
const MIN_PICTURE = 0.1;
const MIN_TEXT = 0.02;
const MAX_TEXT = 0.3;
const MIN_SHAPE = 0.02;
const MAX_SHAPE = 2;
// A shape's height as a share of its width, as the Inspector allows.
const MIN_ASPECT = 0.05;
const MAX_ASPECT = 5;

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
  /** A shape tile let go over the preview, with where its box goes (x/y like a clip's). */
  onDropShape?: (item: FxItem, x: number, y: number) => void;
  /** How making captions from the sound is going ("making captions, 40%"), while it is. */
  captionStatus?: string;
  /** Captions on (CC): shown here and exported. */
  showCaptions: boolean;
  onToggleCaptions: () => void;
  /** Makes captions from the sound (CC when there are none yet); absent when there's nothing to make. */
  onMakeCaptions?: () => void;
  /** Links' preview quality: a height, or none for the best the video has; separate from export quality. */
  quality?: { height?: number; heights: number[]; onChange: (height?: number) => void };
  /** Downloads a link for editing, so it plays from this PC (`downloadForEditing`); absent in the browser preview. */
  onDownload?: (mediaId: string) => void;
  /** No sound while a voice-over records (its speakers would get into the microphone). */
  silent?: boolean;
  /** Remove a colour → Pick: the next click on this clip's picture gives its colour (#rrggbb); Escape or a click beside it cancels. */
  picking?: { clipId: string; onPicked: (color: string) => void; onCancel: (unreadable?: boolean) => void };
}

const WAVE_BARS = 140;
// Quick places for captions; dragging them on the picture puts them anywhere ("Custom").
const CAPTION_PLACES = [
  { place: "top", label: "Top", y: 0.08 },
  { place: "center", label: "Middle", y: 0.5 },
  { place: "bottom", label: "Bottom", y: 0.9 },
];

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
/** Shapes also stretch from the middle of a side. */
type Edge = "n" | "s" | "e" | "w";

/** A picture-in-picture, shape or text being moved or resized on the preview. */
interface Gesture {
  clipId: string;
  mode: "move" | Corner | Edge;
  originX: number;
  originY: number;
  stage: DOMRect;
  box: DOMRect;
  size: number;
  isText: boolean;
  isShape: boolean;
  /** A caption: moves and resizes every caption together. */
  captions: boolean;
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
/** Text's edge (outline or box) as classes; see Preview.css. */
const textClass = (clip: Clip, selected: boolean) => ["preview__text", selected && "is-selected", clip.edge && `is-${clip.edge}`].filter(Boolean).join(" ");

/** The clip's font, falling back like the export does for letters it lacks. Impact is bold by design. */
function textFont(clip: Clip): CSSProperties {
  const font = TEXT_FONTS.find((f) => f.id === clip.font);
  // A style preset's edge colour and strength (Preview.css reads them; project.rs draws the same).
  const edge = {
    ...(clip.edgeColor && { "--edge-color": clip.edgeColor }),
    ...(clip.edgeSize && { "--edge-k": clip.edgeSize }),
  } as CSSProperties;
  return font ? { ...edge, fontFamily: `${font.css}, "Segoe UI", sans-serif`, fontWeight: font.id === "impact" ? 400 : undefined } : edge;
}

export function Preview({ project, api, playback, frame, duration, selectedId, onSelect, onSnapshot, captionStatus, showCaptions, onToggleCaptions, onMakeCaptions, quality, onDownload, onDropShape, silent, picking }: PreviewProps) {
  const [mutedByHand, setMuted] = useState(false);
  const muted = mutedByHand || Boolean(silent);
  // Up / Down (App.tsx) set the preview's volume in tenths, shown for a moment.
  const [level, setLevel] = useState(1);
  const [levelShown, setLevelShown] = useState(false);
  useEffect(() => {
    let hide = 0;
    const onVolume = (e: Event) => {
      const step = (e as CustomEvent<number>).detail;
      setMuted(false);
      setLevel((v) => Math.min(1, Math.max(0, Math.round((v + step) * 10) / 10)));
      setLevelShown(true);
      window.clearTimeout(hide);
      hide = window.setTimeout(() => setLevelShown(false), 1000);
    };
    window.addEventListener("craftora:volume", onVolume);
    return () => {
      window.removeEventListener("craftora:volume", onVolume);
      window.clearTimeout(hide);
    };
  }, []);
  // Exactly the captions the export adds (see `withShownCaptions`), unless they're on the timeline.
  const shownCaptions = useMemo(
    () => (showCaptions ? withShownCaptions(project).clips.filter((c) => c.trackId.startsWith(SHOWN_CAPTIONS)) : []),
    [project, showCaptions],
  );
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
  const trackMuted = (c: Clip) => trackSilent(project.tracks.find((t) => t.id === c.trackId));
  const trackHidden = (c: Clip) => Boolean(project.tracks.find((t) => t.id === c.trackId)?.hidden);
  const mediaOf = (c: Clip) => project.media.find((m) => m.id === c.mediaId);
  const active = (c: Clip) => time >= c.start && time < clipEnd(c);
  const mediaTime = (c: Clip) => (active(c) ? mediaTimeAt(c, time) : null);
  /** A clip whose turn comes within a few seconds waits on its first frame (no black flash at a cut). */
  const cueOf = (c: Clip) => (!active(c) && c.start >= time && c.start - time < 5 ? mediaTimeAt(c, c.start) : undefined);
  const stageAspect = frame.width / frame.height;

  // Each magnetic track's clips in play order, for transitions.
  const orders = new Map(project.tracks.map((t) => [t.id, trackOrder(project, t.id)]));
  // Bottom track first; on a track, later clips over earlier ones (an incoming transition
  // covers the outgoing clip). The same order as the export.
  const layer = (c: Clip) => (project.tracks.length - (trackIndex.get(c.trackId) ?? 0)) * 10_000 + (orders.get(c.trackId)?.indexOf(c) ?? 0);
  const byLayer = (a: Clip, b: Clip) => layer(a) - layer(b);
  const pictures = project.clips.filter((c) => showsPicture(project, c)).sort(byLayer);
  /** Fades and transitions together: how visible and how loud a clip is now. */
  const mix = (c: Clip) => {
    const fade = fadeAt(c, time);
    const order = orders.get(c.trackId);
    const t = order ? transitionMix(order, c, time) : { picture: 1, sound: 1, white: 0, shift: 0, lift: 0, zoom: 1, turn: 0, reveal: "" };
    return { ...t, picture: fade * t.picture, sound: fade * soundFadeAt(c, time) * t.sound };
  };
  // Sound files (pictures play their own sound).
  const sounds = project.clips.filter((c) => c.mediaId && !showsPicture(project, c));
  const texts = project.clips.filter((c) => isText(c) && !trackHidden(c)).sort(byLayer);
  const shapes = project.clips.filter((c) => isShape(c) && !trackHidden(c)).sort(byLayer);
  const overlays = [...texts, ...shapes].sort(byLayer);
  // Filter and effect blocks showing now change the pictures (not text), lowest track first.
  const blocks = blocksStyle(
    project.clips.filter((c) => isBlock(c) && active(c) && !trackHidden(c)).sort(byLayer),
    time,
    stageRef.current?.clientWidth ?? frame.width,
    stageRef.current?.clientHeight ?? frame.height,
  );
  const captionTracks = new Set(project.tracks.filter((t) => t.name === "Captions").map((t) => t.id));
  const hasCaptions = project.media.some((m) => m.captions) || captionTracks.size > 0;
  const isCaption = (c: Clip) => c.trackId.startsWith(SHOWN_CAPTIONS) || captionTracks.has(c.trackId);
  const layout = project.captionLayout ?? CAPTIONS;
  const captionPlace = (layout.x === 0.5 && CAPTION_PLACES.find((p) => p.y === layout.y)?.place) || "custom";
  const nothingHere = !project.clips.some(active);
  // A link playing here: when it's slow or can't play, the message offers to download it.
  const linkHere = project.clips.filter(active).map(mediaOf).find((m) => m && !m.source.local && !m.source.live);
  const downloadHere = linkHere && onDownload && (
    <button
      type="button"
      className="btn btn--secondary preview__download"
      title="Download the whole video: it then plays from this PC, smoothly and offline"
      onClick={(e) => {
        e.stopPropagation();
        onDownload(linkHere.id);
      }}
    >
      <Icon name="download" size={13} />
      Download for editing
    </button>
  );
  const selected = project.clips.find((c) => c.id === selectedId);
  const editable = (c?: Clip) => Boolean(c && (!c.mediaId || showsPicture(project, c)));

  // The combined radio wave across the timeline, shown right under the video.
  const timelineWave = useMemo(() => {
    if (duration <= 0) return [];
    const audible = project.clips.filter((c) => {
      const t = project.tracks.find((tr) => tr.id === c.trackId);
      const m = project.media.find((x) => x.id === c.mediaId);
      return c.mediaId && t && !trackSilent(t) && c.volume > 0 && m?.hasAudio && !m.source.image;
    });
    const mediaPeaks = new Map(project.media.map((m) => [m.id, peaksFor(m)]));
    return Array.from({ length: WAVE_BARS }, (_, i) => {
      const t = ((i + 0.5) / WAVE_BARS) * duration;
      const [from, to] = [(i / WAVE_BARS) * duration, ((i + 1) / WAVE_BARS) * duration];
      let sum = 0;
      for (const c of audible) {
        if (to <= c.start || from >= clipEnd(c)) continue;
        const full = mediaPeaks.get(c.mediaId!);
        const m = project.media.find((x) => x.id === c.mediaId);
        if (!full?.length || !m) continue;
        // The loudest moment of this clip within the bar's stretch of the timeline.
        const [a, b] = [mediaTimeAt(c, Math.max(from, c.start)), mediaTimeAt(c, Math.min(to, clipEnd(c)) - 0.001)];
        const inClip = Math.min(Math.max(t, c.start), clipEnd(c) - 0.001);
        sum += peakBetween(full, Math.max(0.1, m.source.duration), a, b) * c.volume * fadeAt(c, inClip) * soundFadeAt(c, inClip);
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
    const change = (patch: { x: number; y: number; size?: number; aspect?: number }) =>
      api.editLive(g.captions ? { type: "layoutCaptions", patch } : { type: "updateClip", clipId: g.clipId, patch });
    if (g.mode === "move") {
      change({ x: placeAlong(left0 + dx, stage.width - box.width), y: placeAlong(top0 + dy, stage.height - box.height) });
      return;
    }
    const free = (total: number, used: number, offset: number) => (total - used <= 0 ? 0.5 : clamp(offset / (total - used), 0, 1));
    if (g.isShape) {
      // Shapes stretch freely: a side handle moves that side, a corner both (Shift keeps the shape); the opposite stays.
      const has = (side: string) => g.mode.includes(side);
      let width = box.width + (has("w") ? -dx : has("e") ? dx : 0);
      let height = box.height + (has("n") ? -dy : has("s") ? dy : 0);
      if (e.shiftKey && g.mode.length === 2) {
        const k = Math.max(width / box.width, height / box.height);
        [width, height] = [box.width * k, box.height * k];
      }
      width = clamp(width, MIN_SHAPE * stage.width, MAX_SHAPE * stage.width);
      height = clamp(height, width * MIN_ASPECT, width * MAX_ASPECT);
      const left = has("w") ? left0 + box.width - width : left0;
      const top = has("n") ? top0 + box.height - height : top0;
      change({ size: width / stage.width, aspect: height / width, x: free(stage.width, width, left), y: free(stage.height, height, top) });
      return;
    }
    // Resize from a corner, keeping the shape and the opposite corner where it is.
    const fromLeft = g.mode === "nw" || g.mode === "sw";
    const fromTop = g.mode === "nw" || g.mode === "ne";
    const scale = (box.width + (fromLeft ? -dx : dx)) / box.width;
    const size = g.isShape
      ? clamp(g.size * scale, MIN_SHAPE, MAX_SHAPE)
      : g.isText
        ? clamp(g.size * scale, MIN_TEXT, MAX_TEXT)
        : clamp(g.size * scale, MIN_PICTURE, 1);
    const ratio = size / g.size;
    const width = box.width * ratio;
    const height = box.height * ratio;
    const left = fromLeft ? left0 + box.width - width : left0;
    const top = fromTop ? top0 + box.height - height : top0;
    change({ size, x: free(stage.width, width, left), y: free(stage.height, height, top) });
  };

  const beginGesture = (clip: Clip, mode: Gesture["mode"]) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !stageRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const captions = isCaption(clip);
    // Captions not on the timeline aren't clips: they're picked as a whole.
    onSelect(clip.trackId.startsWith(SHOWN_CAPTIONS) ? SHOWN_CAPTIONS : clip.id);
    const stage = stageRef.current.getBoundingClientRect();
    const elBox = (mode === "move" ? e.currentTarget : e.currentTarget.parentElement!).getBoundingClientRect();
    // A rotated shape's DOM bounding rect is its wider axis-aligned envelope; keep the unrotated box for drag maths.
    const box =
      isShape(clip) && clip.rotate && stage.width > 0 && stage.height > 0
        ? (() => {
            const b = shapeBox(clip, stage.width, stage.height);
            return new DOMRect(stage.left + b.left, stage.top + b.top, b.width, b.height);
          })()
        : elBox;
    gestureRef.current = {
      clipId: clip.id,
      mode,
      originX: e.clientX,
      originY: e.clientY,
      stage,
      box,
      size: clip.size,
      isText: isText(clip),
      isShape: isShape(clip),
      captions,
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
    (isShape(clip) ? ["nw", "ne", "sw", "se", "n", "s", "e", "w"] : ["nw", "ne", "sw", "se"]).map((corner) => (
      <span key={corner} className={`preview__handle is-${corner}`} onPointerDown={beginGesture(clip, corner as Corner | Edge)} aria-hidden="true" />
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
        <div
          ref={stageRef}
          className="preview__stage"
          style={{ "--aspect": stageAspect } as CSSProperties}
          onPointerUp={(e) => {
            // A shape tile dragged from the right panel and let go here lands centred where the pointer is.
            const item = fxDrag.current;
            if (item?.kind !== "shape" || !onDropShape || !stageRef.current) return;
            const r = stageRef.current.getBoundingClientRect();
            const shape = newShapeClip("", item.id);
            const w = shape.size;
            const h = (shape.size * (shape.aspect ?? 1) * frame.width) / frame.height;
            const along = (at: number, used: number) => (used >= 1 ? 0.5 : clamp((at - used / 2) / (1 - used), 0, 1));
            onDropShape(item, along((e.clientX - r.left) / r.width, w), along((e.clientY - r.top) / r.height, h));
          }}
        >
          {picking && <ColourPicker stage={stageRef} picking={picking} />}
          {pictures.some((c) => {
            // A link with nothing playable, or whose preview failed, would otherwise just be black.
            const source = mediaOf(c)?.source;
            return mediaTime(c) !== null && source && !source.local && (!source.previewUrl || failed.has(source.previewUrl));
          }) && (
            <span className="preview__loading">
              <span className="preview__failed">
                This video can't play in the preview you have to download it first.{" "}
                {downloadHere ?? "Download it with ⬇ under In this project to watch and edit it."}
              </span>
            </span>
          )}
          {WARMTH_FILTERS}
          <AdjustFilters clips={project.clips} />
          <KeyFilters clips={project.clips} />
          <div
            className="preview__pictures"
            style={{ filter: blocks.filter, transform: [blocks.transform, blocks.mirror && "scaleX(-1)"].filter(Boolean).join(" ") || undefined }}
          >
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
                time={time}
                stageAspect={stageAspect}
                stageWidth={stageRef.current?.clientWidth ?? frame.width}
                visible={t !== null && !trackHidden(clip)}
                opacity={t === null ? 0 : mix(clip).picture}
                white={t === null ? 0 : mix(clip).white}
                shift={t === null ? 0 : mix(clip).shift}
                lift={t === null ? 0 : mix(clip).lift}
                zoom={t === null ? 1 : mix(clip).zoom}
                turn={t === null ? 0 : mix(clip).turn}
                reveal={t === null ? "" : mix(clip).reveal}
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
                        cue={cueOf(clip)}
                        playing={running}
                        volume={clip.volume * mix(clip).sound * level}
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
                        cue={cueOf(clip)}
                        playing={running}
                        volume={clip.volume * mix(clip).sound * level}
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
          {blocks.layers.map((layer, i) => (
            <span key={i} className="preview__fx-layer" style={{ background: layer.color, opacity: layer.opacity, mixBlendMode: layer.blend }} aria-hidden="true" />
          ))}
          </div>
          {blocks.bars > 0 && (
            <>
              <span className="preview__bar is-top" style={{ height: `${blocks.bars * 100}%` }} aria-hidden="true" />
              <span className="preview__bar is-bottom" style={{ height: `${blocks.bars * 100}%` }} aria-hidden="true" />
            </>
          )}
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
                cue={cueOf(clip)}
                playing={running}
                volume={clip.volume * mix(clip).sound * level}
                muted={muted || trackMuted(clip)}
                rate={playback.speed * clip.speed}
                reverse={clip.reverse}
                onLoading={(on) => playback.setLoading(`${clip.id}:audio`, on)}
                onFailed={() => fail(src)}
              />
            );
          })}
          {overlays.filter(active).map((clip) => {
            const isSelected = clip.id === selectedId;
            if (isShape(clip)) {
              return (
                <ShapeLayer
                  key={clip.id}
                  clip={clip}
                  frame={frame}
                  opacity={fadeAt(clip, time)}
                  selected={isSelected}
                  onPointerDown={beginGesture(clip, "move")}
                  handles={isSelected ? handles(clip) : null}
                />
              );
            }
            return (
              <div
                key={clip.id}
                className={textClass(clip, isSelected)}
                style={{
                  left: `${clip.x * 100}%`,
                  top: `${clip.y * 100}%`,
                  translate: `${-clip.x * 100}% ${-clip.y * 100}%`,
                  fontSize: `${clip.size * 100}cqh`,
                  color: clip.color,
                  opacity: fadeAt(clip, time),
                  ...textFont(clip),
                }}
                onPointerDown={beginGesture(clip, "move")}
                onClick={(e) => e.stopPropagation()}
              >
                {textLines(clip.text ?? "", clip.size, frame, clip.font)}
                {isSelected && handles(clip)}
              </div>
            );
          })}
          {shownCaptions.filter(active).map((clip) => (
            <div
              key={clip.id}
              className={textClass(clip, selectedId === SHOWN_CAPTIONS)}
              title="Captions: drag to move them all, drag a corner to resize"
              style={{
                left: `${clip.x * 100}%`,
                top: `${clip.y * 100}%`,
                translate: `${-clip.x * 100}% ${-clip.y * 100}%`,
                fontSize: `${clip.size * 100}cqh`,
                color: clip.color,
                ...textFont(clip),
              }}
              onPointerDown={beginGesture(clip, "move")}
              onClick={(e) => e.stopPropagation()}
            >
              {textLines(clip.text ?? "", clip.size, frame, clip.font)}
              {selectedId === SHOWN_CAPTIONS && handles(clip)}
            </div>
          ))}
        </div>
        {nothingHere && duration > 0 && <p className="preview__note">Nothing on the timeline here</p>}
        {levelShown && <p className="preview__level mono">Volume {Math.round(level * 100)}%</p>}
        {/* While a link stays slow, the message stays between its short waits. */}
        {playing && (playback.waiting || playback.slow) && (
          <p className="preview__waiting">
            {playback.slow && linkHere ? "Still loading from the website…" : "Loading…"}
            {playback.slow && downloadHere}
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
          <Select
            id="speed"
            className="mono"
            value={String(playback.speed)}
            options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))}
            onChange={(s) => playback.setSpeed(Number(s))}
          />
          {quality && (
            <>
              <label htmlFor="preview-quality" className="sr-only">
                Preview quality
              </label>
              <Select
                id="preview-quality"
                className="mono"
                title="Preview quality (exports use the quality picked in Export)"
                value={String(quality.height ?? "")}
                options={[{ value: "", label: "Best" }, ...quality.heights.map((h) => ({ value: String(h), label: `${h}p` }))]}
                onChange={(h) => quality.onChange(h ? Number(h) : undefined)}
              />
            </>
          )}
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
          {/* Only the percent fits in this bar: the whole status shows in Working on and Transcript. */}
          {captionStatus && /\d+%$/.test(captionStatus) && (
            <span className="preview__cc-status" title={captionStatus}>
              {/\d+%$/.exec(captionStatus)?.[0]}
            </span>
          )}
          {!hasCaptions && !captionStatus && onMakeCaptions && (
            <button
              type="button"
              className="btn btn--icon preview__cc"
              aria-label="Make captions from the sound"
              title="No captions yet: click to make them from the sound"
              onClick={() => {
                onMakeCaptions();
                if (!showCaptions) onToggleCaptions();
              }}
            >
              <Icon name="captionsOff" />
            </button>
          )}
          {(hasCaptions || captionStatus) && (
            <button
              type="button"
              className={showCaptions ? "btn btn--icon preview__cc is-on" : "btn btn--icon preview__cc"}
              aria-label="Captions"
              aria-pressed={showCaptions}
              title={showCaptions ? "Captions on: click to hide them" : "Captions off: click to show them"}
              onClick={onToggleCaptions}
            >
              <Icon name={showCaptions ? "captions" : "captionsOff"} />
            </button>
          )}
          {hasCaptions && showCaptions && (
            <>
              <label htmlFor="caption-place" className="sr-only">
                Where captions appear
              </label>
              <Select<string>
                id="caption-place"
                title="Where captions appear"
                value={captionPlace}
                options={[
                  ...CAPTION_PLACES.map(({ place, label }) => ({ value: place as string, label })),
                  ...(captionPlace === "custom" ? [{ value: "custom", label: "Custom", disabled: true }] : []),
                ]}
                onChange={(place) => {
                  const preset = CAPTION_PLACES.find((p) => p.place === place);
                  if (preset) api.edit({ type: "layoutCaptions", patch: { x: 0.5, y: preset.y } });
                }}
              />
            </>
          )}
          <button type="button" className="btn btn--icon" aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} onClick={() => setMuted((m) => !m)}>
            <Icon name={muted || level === 0 ? "volumeOff" : "volume"} />
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

/**
 * Exposure, Highlights, Shadows and Sharpen (Edit → Adjust), for each value a clip uses (effects.ts `stepsFilter` points
 * at them): the tone curve sampled at 33 points (straight lines between, within 1/255 of the export's curve), Sharpen as
 * the export's 3×3 kernel. Sharpen works on the preview's own pixels, fewer than the video's, so it looks a little
 * coarser here than in the export.
 */
/**
 * Remove a colour → Pick: a crosshair over the stage; a click on the clip's picture reads the colour there (5 × 5 pixels
 * of the frame the preview shows, averaged, so noise doesn't decide it). Escape or a click beside the picture cancels.
 */
function ColourPicker({ stage, picking }: { stage: RefObject<HTMLDivElement | null>; picking: NonNullable<PreviewProps["picking"]> }) {
  const { clipId, onPicked, onCancel } = picking;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const pick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    const el = stage.current?.querySelector<HTMLVideoElement | HTMLImageElement>(`[data-clip="${CSS.escape(clipId)}"] :is(video, img)`);
    if (!el) return onCancel();
    const r = el.getBoundingClientRect();
    const mirrored = el.classList.contains("is-mirrored");
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return onCancel();
    const [w, h] = el instanceof HTMLVideoElement ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 5;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!w || !h || !ctx) return onCancel(true);
    try {
      ctx.drawImage(el, (mirrored ? 1 - fx : fx) * w - 2, fy * h - 2, 5, 5, 0, 0, 5, 5);
      const d = ctx.getImageData(0, 0, 5, 5).data;
      const avg = [0, 1, 2].map((c) => Math.round(Array.from({ length: 25 }, (_, i) => d[i * 4 + c]).reduce((a, b) => a + b) / 25));
      onPicked(`#${avg.map((v) => v.toString(16).padStart(2, "0")).join("")}`);
    } catch {
      // A video from another site the preview may show but not read.
      onCancel(true);
    }
  };
  return (
    <div className="preview__picker" onClick={pick} onPointerDown={(e) => e.stopPropagation()} role="button" aria-label="Click the colour to remove">
      <span className="preview__picker-hint">Click the colour to remove · Esc to cancel</span>
    </div>
  );
}

/** Remove a colour: one filter per keyed clip, `key-<clip id>`, effects.ts `keyLine` drawn as the export draws it. */
function KeyFilters({ clips }: { clips: Clip[] }) {
  const keyed = clips.flatMap((c) => {
    const line = c.chroma && keyLine(c.chroma);
    return line ? [{ id: c.id, line }] : [];
  });
  if (!keyed.length) return null;
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      {keyed.map(({ id, line: [r, g, b, edge, width] }) => (
        <filter key={id} id={`key-${id}`} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={`1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 ${r} ${g} ${b} 0 0.5`} />
          <feComponentTransfer>
            <feFuncA type="linear" slope={-1 / width} intercept={edge / width} />
          </feComponentTransfer>
        </filter>
      ))}
    </svg>
  );
}

function AdjustFilters({ clips }: { clips: Clip[] }) {
  const used = useMemo(() => {
    const steps = new Map<string, LookStep>();
    for (const c of clips) {
      for (const step of adjustSteps(c.adjust)) {
        if (["exposure", "highlights", "shadows", "sharpen"].includes(step[0])) steps.set(`${step[0]}-${Math.round(step[1] * 100)}`, step);
      }
    }
    return [...steps];
  }, [clips]);
  if (!used.length) return null;
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      {used.map(([id, [op, v]]) => {
        if (op === "sharpen") {
          const a = sharpenWeight(v);
          return (
            <filter key={id} id={id} colorInterpolationFilters="sRGB">
              <feConvolveMatrix order={3} kernelMatrix={`0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0`} divisor={1} preserveAlpha="true" edgeMode="duplicate" />
            </filter>
          );
        }
        const table = Array.from({ length: 33 }, (_, i) => toneCurve(op as ToneOp, v, i / 32).toFixed(4)).join(" ");
        return (
          <filter key={id} id={id} colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              <feFuncR type="table" tableValues={table} />
              <feFuncG type="table" tableValues={table} />
              <feFuncB type="table" tableValues={table} />
            </feComponentTransfer>
          </filter>
        );
      })}
    </svg>
  );
}

/**
 * Warmth (Edit → Adjust) and RGB split have no CSS filter function: SVG filters for each value, that the colour steps
 * point at (effects.ts `stepsFilter`). In sRGB like the CSS functions and the export; hidden by size, not `display: none`
 * (that would switch the filters off).
 */
const WARMTH_FILTERS = (
  <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
    {Array.from({ length: 201 }, (_, i) => i - 100).map((w) => (
      <filter key={w} id={`warmth-${w}`} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={warmthMatrix(w / 100)} />
      </filter>
    ))}
    {/* RGB split, by Strength 0–100: red moved left and blue right by a share of the picture's own width (the export's
        rgbashift), green kept, added back together. */}
    {Array.from({ length: 101 }, (_, k) => {
      const dx = (RGB_SHARE * k) / 50;
      return (
        <filter key={`rgb-${k}`} id={`rgb-${k}`} colorInterpolationFilters="sRGB" primitiveUnits="objectBoundingBox">
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r" />
          <feOffset in="r" dx={-dx} result="red" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="green" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b" />
          <feOffset in="b" dx={dx} result="blue" />
          <feComposite in="red" in2="green" operator="arithmetic" k2={1} k3={1} result="rg" />
          <feComposite in="rg" in2="blue" operator="arithmetic" k2={1} k3={1} />
        </filter>
      );
    })}
  </svg>
);

interface PictureLayerProps {
  clip: Clip;
  time: number;
  stageAspect: number;
  stageWidth: number;
  visible: boolean;
  opacity: number;
  /** 0–1: how white a flash transition makes it now. */
  white: number;
  /** Frame widths moved right by a slide transition (negative = left). */
  shift: number;
  /** Frame heights moved down by a slide transition (negative = up). */
  lift: number;
  /** Scale about the box centre from a zoom or spin transition (1 = none). */
  zoom: number;
  /** Degrees turned clockwise about the box centre by a spin transition (0 = none). */
  turn: number;
  /** CSS `clip-path` for a wipe or circle transition ("" = none). */
  reveal: string;
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
function PictureLayer({ clip, time, stageAspect, stageWidth, visible, opacity, white, shift, lift, zoom, turn, reveal, selected, poster, onPointerDown, handles, children }: PictureLayerProps) {
  // The video's own shape, known once it has loaded.
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [ready, setReady] = useState(false);
  const { left, top, right, bottom } = clip.crop;
  const keptW = 1 - left - right;
  const keptH = 1 - top - bottom;
  const upright = (videoAspect * keptW) / keptH;
  // A quarter turn swaps the picture's shape; the crop window turns inside the box (the export: crop, then transpose).
  const rotate = clip.rotate ?? 0;
  const sideways = rotate === 90 || rotate === 270;
  const aspect = sideways ? 1 / upright : upright;
  const turned: CSSProperties | undefined = rotate
    ? {
        inset: "auto",
        left: "50%",
        top: "50%",
        width: sideways ? `${100 / aspect}%` : "100%",
        height: sideways ? `${100 * aspect}%` : "100%",
        transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
      }
    : undefined;

  // Size 1 fits the frame keeping the shape (FFmpeg: force_original_aspect_ratio=decrease), or
  // with `fill` covers it, the frame cutting off what spills over (=increase).
  const wider = aspect >= stageAspect;
  const fitWidth = clip.fill ? (wider ? aspect / stageAspect : 1) : wider ? 1 : aspect / stageAspect;
  const boxWidth = stageWidth * fitWidth * clip.size;
  // A filter or effect on this clip itself changes only its box, timed to the clip's span.
  const own = clip.look || clip.effect || adjustSteps(clip.adjust).length ? blocksStyle([clip], time, boxWidth, boxWidth / aspect) : undefined;
  // A removed colour goes first, from the picture as it comes (the export keys before the colour steps too).
  const key = clip.chroma && keyLine(clip.chroma) ? `url(#key-${clip.id})` : undefined;
  const fx = key ? { mirror: false, bars: 0, layers: [], ...own, filter: [key, own?.filter].filter(Boolean).join(" ") } : own;
  const box: CSSProperties = {
    width: `${fitWidth * clip.size * 100}%`,
    aspectRatio: String(aspect),
    left: `${clip.x * 100}%`,
    top: `${clip.y * 100}%`,
    translate: `${-clip.x * 100}% ${-clip.y * 100}%`,
    transform: shift !== 0 || lift !== 0 ? `translate(${shift * stageWidth}px, ${(lift * stageWidth) / stageAspect}px)` : undefined,
    clipPath: reveal || undefined,
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
      data-clip={clip.id}
      style={{ ...box, visibility: visible ? "visible" : "hidden", opacity }}
      onPointerDown={onPointerDown}
      onClick={onPointerDown ? (e) => e.stopPropagation() : undefined}
    >
      <div className="preview__crop" style={turned}>
        <div
          className="preview__clip-fx"
          style={
            fx || zoom !== 1 || turn !== 0
              ? {
                  filter: fx?.filter,
                  transform: [turn !== 0 && `rotate(${turn}deg)`, zoom !== 1 && `scale(${zoom})`, fx?.transform, fx?.mirror && "scaleX(-1)"].filter(Boolean).join(" ") || undefined,
                }
              : undefined
          }
        >
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
      </div>
      {/* A flash transition whitens the clip itself (the export fades its picture to white). */}
      {white > 0 && <span className="preview__fx-layer" style={{ background: "#fff", opacity: white }} aria-hidden="true" />}
      {fx?.layers.map((layer, i) => (
        <span key={i} className="preview__fx-layer" style={{ background: layer.color, opacity: layer.opacity, mixBlendMode: layer.blend }} aria-hidden="true" />
      ))}
      {fx && fx.bars > 0 && (
        <>
          <span className="preview__bar is-top" style={{ height: `${fx.bars * 100}%` }} aria-hidden="true" />
          <span className="preview__bar is-bottom" style={{ height: `${fx.bars * 100}%` }} aria-hidden="true" />
        </>
      )}
      {visible && !ready && !poster && <span className="preview__loading">Loading video…</span>}
      {handles}
    </div>
  );
}

interface ShapeLayerProps {
  clip: Clip;
  frame: Frame;
  opacity: number;
  selected: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  handles: ReactNode;
}

/** One shape on the stage: a full-frame SVG picture with a hit box over its bounding box. */
function ShapeLayer({ clip, frame, opacity, selected, onPointerDown, handles }: ShapeLayerProps) {
  const src = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shapeSvg(clip, frame.width, frame.height))}`,
    [clip.shape, clip.color, clip.size, clip.aspect, clip.x, clip.y, clip.opacity, clip.outline, clip.rotate, frame.width, frame.height],
  );
  const box = shapeBox(clip, frame.width, frame.height);
  return (
    <>
      <img className="preview__shape" src={src} alt="" draggable={false} style={{ opacity }} />
      <div
        className={selected ? "preview__shape-box is-selected" : "preview__shape-box"}
        style={{
          left: `${(box.left / frame.width) * 100}%`,
          top: `${(box.top / frame.height) * 100}%`,
          width: `${(box.width / frame.width) * 100}%`,
          height: `${(box.height / frame.height) * 100}%`,
          transform: clip.rotate ? `rotate(${clip.rotate}deg)` : undefined,
        }}
        onPointerDown={onPointerDown}
        onClick={(e) => e.stopPropagation()}
      >
        {handles}
      </div>
    </>
  );
}
