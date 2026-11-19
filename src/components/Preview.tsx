import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import type { Frame } from "../types";
import { isBlock, isShape, isText, showsPicture, clipEnd, fadeAt, soundFadeAt, mediaTimeAt, peakBetween, peaksFor, textLines, trackOrder, trackSilent, transitionMix, CAPTIONS, TEXT_FONTS, type Clip, type Project } from "../project/model";
import { stretchSide } from "../project/layerBox";
import { newShapeClip, shapeBox, shapeSvg } from "../project/shapes";
import { motionAt, textMotion } from "../project/textMotion";
import type { FxItem } from "../project/effects";
import { fxDrag, mediaDrag } from "./TimelineEditor";
import { SHOWN_CAPTIONS, withShownCaptions } from "../project/actions";
import type { ProjectApi } from "../project/useProject";
import type { Playback } from "../project/usePlayback";
import { formatTimecode } from "../lib/timecode";
import { RGB_SHARE, adjustSteps, blocksStyle, duotoneMatrix, keyLine, posterLevels, sharpenWeight, toneCurve, warmthMatrix, type LookStep, type ToneOp } from "../project/effects";
import { CRAFTORA_MEDIA, setWindowFullscreen } from "../lib/engine";
import { textShadowFilter } from "../lib/textPicture";
import { hasStyle, styleFilter } from "../lib/layerStyle";
import { maskOn, maskStyle } from "../lib/mask";
import { gifFrameAt, loadGif, type DecodedGif } from "../lib/gif";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { SyncedMedia } from "./SyncedMedia";
import { LiveCanvas, PaintSurface, type LivePaint, type Painting } from "./PaintSurface";
import { SelectSurface, SelectionOutline, type Selecting } from "./SelectSurface";
import type { Selection } from "../lib/selection";
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
  /** The Image editor's Text tool: a click on the picture adds text there (x, y: 0..1); a click on a text picks it. */
  placeText?: (x: number, y: number) => void;
  /** The Image editor: a photo card from the Photos panel let go on the picture (x, y: 0..1 across it). */
  onDropMedia?: (mediaId: string, x: number, y: number) => void;
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
  /** The Image editor: the picture on its background colour, without play controls. */
  still?: { background: string };
  /** The Image editor's painting tools: strokes go onto the picture instead of moving layers. */
  painting?: Painting;
  /** The Image editor: clip id whose mask is shown alone over a black stage. */
  maskView?: string | null;
  /** The Image editor's selection tools (marquee, lasso, wand): they take every click on the picture. */
  selecting?: Selecting;
  /** The Image editor's selection, outlined over the picture whatever the tool. */
  selection?: Selection | null;
  /** Opens the right-click menu for a picture, video, shape or text on the stage. */
  onItemMenu?: (clipId: string, x: number, y: number) => void;
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
/** Shapes, photos and videos also stretch from any side. */
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
  fill: boolean;
  isText: boolean;
  isShape: boolean;
  /** A caption: moves and resizes every caption together. */
  captions: boolean;
  moved: boolean;
  /** Where it was (shares of the free space), kept when it can't move along an axis. */
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fraction of the free space for a box at `offset` px, snapped to the middle and the edges. */
function placeAlong(offset: number, free: number): number {
  if (free <= 0) return 0.5;
  for (const target of [0, free / 2, free]) if (Math.abs(offset - target) < SNAP_PX) return target / free;
  return clamp(offset / free, 0, 1);
}

/**
 * The Image editor's `placeAlong`: past the edges too, and a layer bigger than the picture moves as well (its share
 * of the free space, which is then negative). `old` stays when the layer is exactly as big as the picture.
 */
function placeFree(offset: number, free: number, old: number): number {
  if (Math.abs(free) < 1) return old;
  for (const target of [0, free / 2, free]) if (Math.abs(offset - target) < SNAP_PX) return target / free;
  return offset / free;
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

export function Preview({ project, api, playback, frame, duration, selectedId, onSelect, onSnapshot, captionStatus, showCaptions, onToggleCaptions, onMakeCaptions, quality, onDownload, onDropShape, onDropMedia, placeText, silent, picking, still, painting, maskView, selecting, selection, onItemMenu }: PreviewProps) {
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
  const fail = useCallback((src: string) => setFailed((all) => (all.has(src) ? all : new Set(all).add(src))), []);
  const loadingCbs = useRef(new Map<string, (on: boolean) => void>());
  const onMediaLoading = (key: string) => {
    let fn = loadingCbs.current.get(key);
    if (!fn) {
      fn = (on: boolean) => playback.setLoading(key, on);
      loadingCbs.current.set(key, fn);
    }
    return fn;
  };
  const failCbs = useRef(new Map<string, () => void>());
  const onMediaFailed = (src: string) => {
    let fn = failCbs.current.get(src);
    if (!fn) {
      fn = () => fail(src);
      failCbs.current.set(src, fn);
    }
    return fn;
  };
  const stageRef = useRef<HTMLDivElement>(null);
  // A layer being painted, shown from its canvas until its saved photo has loaded (1.5 s at most: a photo that came
  // out the same as before never loads again).
  const [live, setLive] = useState<LivePaint | null>(null);
  useEffect(() => {
    if (!live?.settled) return;
    const done = window.setTimeout(() => setLive((l) => (l === live ? null : l)), 1500);
    return () => window.clearTimeout(done);
  }, [live]);
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

  // Full screen: the bars and the cursor fade after a moment without the mouse moving (owner), like a video player;
  // a move or a key brings them back, and they stay while the pointer is on them.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!fullscreen) return setIdle(false);
    let timer = 0;
    const wake = (e: Event) => {
      setIdle(false);
      window.clearTimeout(timer);
      if (e.target instanceof Element && e.target.closest(".preview__transport, .preview__wave")) return;
      timer = window.setTimeout(() => setIdle(true), 2500);
    };
    wake(new Event("start"));
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
    };
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
  const viewingMaskClip = still && maskView ? project.clips.find((c) => c.id === maskView && Boolean(c.mask)) : undefined;
  // Sound files (pictures play their own sound).
  const sounds = project.clips.filter((c) => c.mediaId && !showsPicture(project, c));
  const texts = project.clips.filter((c) => isText(c) && (!trackHidden(c) || viewingMaskClip?.id === c.id)).sort(byLayer);
  const shapes = project.clips.filter((c) => isShape(c) && (!trackHidden(c) || viewingMaskClip?.id === c.id)).sort(byLayer);
  const overlays = [...texts, ...shapes].sort(byLayer);
  // The Image editor stacks every layer by the Layers order (photos over text too), 1 at the bottom (lib/compose.ts
  // draws the same order); the video editor keeps pictures under text, as its export does.
  const stack = still ? new Map([...pictures, ...overlays].sort(byLayer).map((c, i) => [c.id, i + 1])) : undefined;
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
  const waveKey = project.clips
    .map((c) => `${c.id}:${c.trackId}:${c.mediaId ?? ""}:${c.start}:${c.in}:${c.out}:${c.speed}:${c.reverse ? 1 : 0}:${c.volume}:${c.fadeIn}:${c.fadeOut}:${c.soundFadeIn ?? 0}:${c.soundFadeOut ?? 0}`)
    .join("|");
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
  }, [waveKey, project.media, project.tracks, duration]);

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
      change(
        still
          ? { x: placeFree(left0 + dx, stage.width - box.width, g.x), y: placeFree(top0 + dy, stage.height - box.height, g.y) }
          : { x: placeAlong(left0 + dx, stage.width - box.width), y: placeAlong(top0 + dy, stage.height - box.height) },
      );
      return;
    }
    const free = (total: number, used: number, offset: number) => (total - used <= 0 ? 0.5 : clamp(offset / (total - used), 0, 1));
    if (g.isShape && !(e.shiftKey && g.mode.length === 2)) {
      // Shapes stretch freely: a side handle moves that side, a corner both (Shift+corner keeps the shape below); the opposite stays.
      const has = (side: string) => g.mode.includes(side);
      const width = clamp(box.width + (has("w") ? -dx : has("e") ? dx : 0), MIN_SHAPE * stage.width, MAX_SHAPE * stage.width);
      const height = clamp(box.height + (has("n") ? -dy : has("s") ? dy : 0), width * MIN_ASPECT, width * MAX_ASPECT);
      const left = has("w") ? left0 + box.width - width : left0;
      const top = has("n") ? top0 + box.height - height : top0;
      change({ size: width / stage.width, aspect: height / width, x: free(stage.width, width, left), y: free(stage.height, height, top) });
      return;
    }
    if (g.mode.length === 1) {
      // Photos and videos: dragging a side stretches only that side, keeping the opposite side put.
      change(
        stretchSide(
          { size: g.size, x: g.x, y: g.y, fill: g.fill },
          { left: left0, top: top0, width: box.width, height: box.height },
          g.mode as Edge,
          g.mode === "e" || g.mode === "w" ? dx : dy,
          stage.width,
          stage.height,
          Boolean(still),
        ),
      );
      return;
    }
    // Resize from a corner, keeping the shape and the opposite corner where it is.
    const fromLeft = g.mode === "nw" || g.mode === "sw";
    const fromTop = g.mode === "nw" || g.mode === "ne";
    const scale = (box.width + (fromLeft ? -dx : dx)) / box.width;
    const size = g.isText ? clamp(g.size * scale, MIN_TEXT, MAX_TEXT) : g.isShape ? clamp(g.size * scale, MIN_SHAPE, MAX_SHAPE) : clamp(g.size * scale, MIN_PICTURE, 1);
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
    // Image editor: Ctrl+click picks the next layer down under the pointer (a click picks the top one).
    if (still && mode === "move" && (e.ctrlKey || e.metaKey)) {
      const under = [...new Set(document.elementsFromPoint(e.clientX, e.clientY).map((el) => stageRef.current!.contains(el) && el.closest<HTMLElement>("[data-clip]")?.dataset.clip).filter(Boolean))] as string[];
      onSelect(under[(under.indexOf(selectedId ?? "") + 1) % under.length] ?? clip.id);
      return;
    }
    const captions = isCaption(clip);
    // Captions not on the timeline aren't clips: they're picked as a whole.
    onSelect(clip.trackId.startsWith(SHOWN_CAPTIONS) ? SHOWN_CAPTIONS : clip.id);
    const stage = stageRef.current.getBoundingClientRect();
    const el = mode === "move" ? e.currentTarget : e.currentTarget.parentElement!;
    const elBox = el.getBoundingClientRect();
    // A rotated shape's DOM bounding rect is its wider axis-aligned envelope; keep the unrotated box for drag maths.
    // A turned text or photo: its own box, about the same middle (its layout size, scaled as the stage is shown).
    const k = stage.width / Math.max(1, stageRef.current.offsetWidth);
    const box =
      isShape(clip) && clip.rotate && stage.width > 0 && stage.height > 0
        ? (() => {
            const b = shapeBox(clip, stage.width, stage.height);
            return new DOMRect(stage.left + b.left, stage.top + b.top, b.width, b.height);
          })()
        : !isShape(clip) && (clip.mediaId ? clip.angle : clip.rotate)
          ? new DOMRect(elBox.left + (elBox.width - el.offsetWidth * k) / 2, elBox.top + (elBox.height - el.offsetHeight * k) / 2, el.offsetWidth * k, el.offsetHeight * k)
          : elBox;
    gestureRef.current = {
      clipId: clip.id,
      mode,
      originX: e.clientX,
      originY: e.clientY,
      stage,
      box,
      size: clip.size,
      fill: Boolean(clip.fill),
      isText: isText(clip),
      isShape: isShape(clip),
      captions,
      moved: false,
      x: clip.x,
      y: clip.y,
    };
    const move = (ev: PointerEvent) => onPointerMove.current(ev);
    const up = () => {
      if (gestureRef.current) {
        justDragged.current = true;
        window.setTimeout(() => (justDragged.current = false), 100);
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

  // Image editor: the arrows nudge the selected layer 1 image pixel (Shift: 10), a held key one undo step, as in photo editors.
  const nudge = useRef<(e: KeyboardEvent) => void>(() => {});
  nudge.current = (e) => {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    const clip = project.clips.find((c) => c.id === selectedId);
    const el = e.target as HTMLElement;
    if (!still || !dir || !clip || !stageRef.current || e.defaultPrevented || project.tracks.find((t) => t.id === clip.trackId)?.locked || e.ctrlKey || e.altKey || e.metaKey || el.closest("input, textarea, select, [contenteditable]")) return;
    const stage = stageRef.current.getBoundingClientRect();
    const box = isShape(clip)
      ? shapeBox(clip, stage.width, stage.height)
      : stageRef.current.querySelector(`[data-clip="${CSS.escape(clip.id)}"]`)?.getBoundingClientRect();
    if (!box || stage.width <= 0) return;
    e.preventDefault();
    const step = ((e.shiftKey ? 10 : 1) * stage.width) / frame.width;
    const along = (now: number, free: number, d: number) => (free <= 0 ? now : Math.min(1, Math.max(0, now + (d * step) / free)));
    if (!e.repeat) api.checkpoint();
    api.editLive({ type: "updateClip", clipId: clip.id, patch: { x: along(clip.x, stage.width - box.width, dir[0]), y: along(clip.y, stage.height - box.height, dir[1]) } });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => nudge.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openItemMenu = (clip: Clip) => (e: ReactMouseEvent<HTMLElement>) => {
    if (clip.trackId.startsWith(SHOWN_CAPTIONS)) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(clip.id);
    onItemMenu?.(clip.id, e.clientX, e.clientY);
  };

  const handles = (clip: Clip) =>
    (isText(clip) ? ["nw", "ne", "sw", "se"] : ["nw", "ne", "sw", "se", "n", "s", "e", "w"]).map((corner) => (
      <span key={corner} className={`preview__handle is-${corner}`} onPointerDown={beginGesture(clip, corner as Corner | Edge)} onContextMenu={openItemMenu(clip)} aria-hidden="true" />
    ));

  return (
    <section className={fullscreen ? (idle ? "preview is-fullscreen is-idle" : "preview is-fullscreen") : "preview"} aria-label="Preview">
      <div
        className="preview__screen"
        onClick={() => {
          if (justDragged.current) {
            justDragged.current = false;
            return;
          }
          // With a picture or text selected, a click beside it lets go of it; otherwise it plays.
          if (editable(selected) || selectedId === SHOWN_CAPTIONS || still) onSelect(null);
          else playback.toggle();
        }}
      >
        <div
          ref={stageRef}
          className={still && !still.background ? "preview__stage is-clear" : "preview__stage"}
          style={{ "--aspect": stageAspect, background: still?.background || undefined } as CSSProperties}
          onPointerUp={(e) => {
            // A photo card dragged from the Photos panel: placed where it was let go (owner: drag to add).
            const mediaId = mediaDrag.current;
            if (still && mediaId && onDropMedia && stageRef.current) {
              const r = stageRef.current.getBoundingClientRect();
              onDropMedia(mediaId, clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
              return;
            }
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
          {placeText && (
            <div
              className="preview__placer"
              aria-hidden="true"
              // The click mustn't reach the screen, whose click beside a layer lets go of it (the new text).
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => {
                e.stopPropagation();
                const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.matches(".preview__text[data-clip]"));
                if (hit) return onSelect((hit as HTMLElement).dataset.clip ?? null);
                const r = e.currentTarget.getBoundingClientRect();
                placeText(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
              }}
            />
          )}
          {painting && <PaintSurface painting={painting} project={project} width={frame.width} height={frame.height} onLive={setLive} />}
          {selecting ? (
            <SelectSurface selecting={selecting} width={frame.width} height={frame.height} />
          ) : (
            selection && <SelectionOutline selection={selection} width={frame.width} height={frame.height} />
          )}
          {live && live.clipId === null && <LiveCanvas canvas={live.canvas} className="preview__paint-live" />}
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
          {still && <StyleFilters clips={project.clips} height={stageRef.current?.clientHeight ?? frame.height} />}
          <KeyFilters clips={project.clips} />
          {viewingMaskClip && <div style={{ position: "absolute", inset: 0, background: "#000", zIndex: 99990, pointerEvents: "none" }} aria-hidden="true" />}
          <div
            className="preview__pictures"
            style={viewingMaskClip ? undefined : { filter: blocks.filter, transform: [blocks.transform, blocks.mirror && "scaleX(-1)"].filter(Boolean).join(" ") || undefined }}
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
                z={stack?.get(clip.id)}
                clip={clip}
                time={time}
                stageAspect={stageAspect}
                stageWidth={stageRef.current?.clientWidth ?? frame.width}
                visible={t !== null && !trackHidden(clip)}
                opacity={t === null ? 0 : mix(clip).picture * (clip.opacity ?? 1) * ownFill(clip)}
                white={t === null ? 0 : mix(clip).white}
                shift={t === null ? 0 : mix(clip).shift}
                lift={t === null ? 0 : mix(clip).lift}
                zoom={t === null ? 1 : mix(clip).zoom}
                turn={t === null ? 0 : mix(clip).turn}
                reveal={t === null ? "" : mix(clip).reveal}
                scaleX={t === null ? 1 : (mix(clip).scaleX ?? 1)}
                transFilter={t === null ? "" : (mix(clip).filter ?? "")}
                selected={isSelected}
                poster={poster}
                mask={still ? maskStyle(clip) : undefined}
                viewingMask={viewingMaskClip?.id === clip.id}
                onPointerDown={beginGesture(clip, "move")}
                onContextMenu={openItemMenu(clip)}
                handles={isSelected ? handles(clip) : null}
              >
                {(onShape, style, onReady, onLoadedMetadata) =>
                  media.source.image ? (
                    <>
                      {live?.clipId === clip.id && <LiveCanvas canvas={live.canvas} className={clip.mirror ? "preview__video is-mirrored" : "preview__video"} style={style} />}
                      {media.source.animated && canPlay ? (
                        <GifLayer
                          src={media.source.previewUrl}
                          time={still ? 0 : time - clip.start}
                          className={clip.mirror ? "preview__video is-mirrored" : "preview__video"}
                          style={live?.clipId === clip.id ? { ...style, visibility: "hidden" } : style}
                          onError={onMediaFailed(media.source.previewUrl)}
                          onShape={onShape}
                          onReady={() => {
                            onReady();
                            setLive((l) => (l?.clipId === clip.id && l.settled ? null : l));
                          }}
                        />
                      ) : (
                        <img
                          src={(canPlay ? media.source.previewUrl : poster) || poster}
                          // Craftora's own addresses answer with CORS: asking for it lets Remove a colour → Pick read the photo.
                          crossOrigin={((canPlay ? media.source.previewUrl : poster) || poster)?.startsWith(CRAFTORA_MEDIA) ? "anonymous" : undefined}
                          alt=""
                          className={clip.mirror ? "preview__video is-mirrored" : "preview__video"}
                          style={live?.clipId === clip.id ? { ...style, visibility: "hidden" } : style}
                          draggable={false}
                          onError={() => {
                            if (canPlay) fail(media.source.previewUrl);
                          }}
                          onLoad={(e) => {
                            onShape(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
                            onReady();
                            // The painted photo is in: its canvas can go.
                            setLive((l) => (l?.clipId === clip.id && l.settled ? null : l));
                          }}
                        />
                      )}
                    </>
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
                        onLoading={onMediaLoading(`${clip.id}:video`)}
                        onFailed={onMediaFailed(media.source.previewUrl)}
                        className={clip.mirror ? "preview__video is-mirrored" : "preview__video"}
                        style={style}
                        onLoadedMetadata={onLoadedMetadata}
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
                        onLoading={onMediaLoading(`${clip.id}:audio`)}
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
                onLoading={onMediaLoading(`${clip.id}:audio`)}
                onFailed={onMediaFailed(src)}
              />
            );
          })}
          {overlays.filter(active).map((clip) => {
            const isSelected = clip.id === selectedId;
            const viewingMask = viewingMaskClip?.id === clip.id;
            const m = mix(clip);
            const sw = stageRef.current?.clientWidth ?? frame.width;
            const transTransform =
              [
                (m.shift !== 0 || m.lift !== 0) && `translate(${m.shift * sw}px, ${(m.lift * sw) / stageAspect}px)`,
                m.turn !== 0 && `rotate(${m.turn}deg)`,
                m.zoom !== 1 && `scale(${m.zoom})`,
                (m.scaleX ?? 1) !== 1 && `scaleX(${m.scaleX})`,
              ]
                .filter(Boolean)
                .join(" ") || undefined;
            if (isShape(clip)) {
              return (
                <ShapeLayer
                  key={clip.id}
                  z={stack?.get(clip.id)}
                  clip={clip}
                  // Drawn at the size shown, so an outline is as thick against the picture as in the export.
                  frame={{ ...frame, width: sw, height: stageRef.current?.clientHeight ?? frame.height }}
                  opacity={m.picture * ownFill(clip)}
                  transFilter={m.filter}
                  transTransform={transTransform}
                  reveal={m.reveal}
                  selected={isSelected}
                  still={Boolean(still)}
                  viewingMask={viewingMask}
                  onPointerDown={beginGesture(clip, "move")}
                  onContextMenu={openItemMenu(clip)}
                  handles={isSelected ? handles(clip) : null}
                />
              );
            }
            // Its animation at this moment, as the export draws it (textMotion.ts). Picked and paused, it shows as set: a
            // text added at the playhead would otherwise sit at its own first moment, invisible, and couldn't be dragged.
            const lines = textLines(clip.text ?? "", clip.size, frame, clip.font, clip.spacing);
            const pose = motionAt(isSelected && !playing ? undefined : textMotion(clip, lines), time - clip.start, lines);
            const shadows = still && textShadowFilter(clip);
            return (
              <div
                key={clip.id}
                className={textClass(clip, isSelected)}
                data-clip={clip.id}
                style={{
                  left: `${clip.x * 100}%`,
                  top: `calc(${clip.y * 100}% + ${pose.dy * 100}cqh)`,
                  translate: `${-clip.x * 100}% ${-clip.y * 100}%`,
                  scale: pose.scale,
                  transform: transTransform,
                  fontSize: `${clip.size * 100}cqh`,
                  color: clip.color,
                  opacity: viewingMask ? 1 : m.picture * pose.alpha * (clip.opacity ?? 1) * ownFill(clip),
                  // The Image editor's layer blend mode (lib/compose.ts draws the same with globalCompositeOperation).
                  mixBlendMode: viewingMask ? undefined : clip.blend,
                  zIndex: viewingMask ? 99991 : stack?.get(clip.id),
                  filter: viewingMask ? undefined : [styled(clip), m.filter].filter(Boolean).join(" ") || undefined,
                  ...revealStyle(m.reveal),
                  ...textFont(clip),
                  // The Image editor's own (textPicture.ts draws them into the saved picture).
                  ...(still && { textShadow: shadows || viewingMask ? "none" : undefined, letterSpacing: clip.spacing ? `${clip.spacing}em` : undefined, rotate: clip.rotate ? `${clip.rotate}deg` : undefined }),
                  ...(viewingMask && { background: "transparent", boxShadow: "none" }),
                }}
                onPointerDown={beginGesture(clip, "move")}
                onContextMenu={openItemMenu(clip)}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Softness and glow on the letters only: not the box edge or the selection outline; its mask likewise. */}
                {shadows || viewingMask || (still && maskOn(clip)) ? (
                  <span style={{ display: "block", visibility: viewingMask ? "hidden" : undefined, filter: shadows || undefined, ...(still && maskStyle(clip)) }}>{pose.text}</span>
                ) : (
                  pose.text
                )}
                {viewingMask && clip.mask && (
                  <img
                    src={clip.mask}
                    alt=""
                    draggable={false}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", background: "#000", pointerEvents: "none" }}
                  />
                )}
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
        {nothingHere && duration > 0 && !still && <p className="preview__note">Nothing on the timeline here</p>}
        {levelShown && <p className="preview__level mono">Volume {Math.round(level * 100)}%</p>}
        {/* While a link stays slow, the message stays between its short waits. */}
        {playing && (playback.waiting || playback.slow) && (
          <p className="preview__waiting">
            {playback.slow && linkHere ? "Still loading from the website…" : "Loading…"}
            {playback.slow && downloadHere}
          </p>
        )}
      </div>

      {timelineWave.length > 0 && !still && (
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

      <div className="preview__transport" hidden={Boolean(still)} onClick={(e) => e.stopPropagation()}>
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
          {/* Only the percent fits in this bar: the whole status shows in Running now and Transcript. */}
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

/** Image editor layer styles (lib/layerStyle.ts), sized for the stage as it's shown. */
function StyleFilters({ clips, height }: { clips: Clip[]; height: number }) {
  // A text or photo is turned by CSS after its filter; a shape is drawn turned.
  const markup = clips
    .filter((c) => hasStyle(c.style))
    .map((c) => styleFilter(`style-${c.id}`, c.style!, height, c.fillOpacity ?? 1, undefined, c.shape ? 0 : c.mediaId ? (c.angle ?? 0) : (c.rotate ?? 0)))
    .join("");
  return markup ? <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} /> : null;
}

/** A layer's style filter (it draws the layer's Fill itself), or none. */
const styled = (clip: Clip) => (hasStyle(clip.style) ? `url(#style-${clip.id})` : undefined);
/** The Fill a layer's opacity carries: none when its style filter draws it. */
const ownFill = (clip: Clip) => (hasStyle(clip.style) ? 1 : (clip.fillOpacity ?? 1));

function AdjustFilters({ clips }: { clips: Clip[] }) {
  const adjustKey = clips.map((c) => (c.adjust ? JSON.stringify(c.adjust) : "")).join("|");
  const used = useMemo(() => {
    const steps = new Map<string, LookStep>();
    for (const c of clips) {
      for (const step of adjustSteps(c.adjust)) {
        if (["exposure", "highlights", "shadows", "posterize", "sharpen"].includes(step[0])) steps.set(`${step[0]}-${Math.round(step[1] * 100)}`, step);
      }
    }
    return [...steps];
  }, [adjustKey]);
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
        // Posterize: flat steps (the n-th share of the range shows the n-th of `levels` even values).
        const levels = posterLevels(v);
        const type = op === "posterize" ? "discrete" : "table";
        const table =
          op === "posterize"
            ? Array.from({ length: levels }, (_, i) => (i / (levels - 1)).toFixed(4)).join(" ")
            : Array.from({ length: 33 }, (_, i) => toneCurve(op as ToneOp, v, i / 32).toFixed(4)).join(" ");
        return (
          <filter key={id} id={id} colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              <feFuncR type={type} tableValues={table} />
              <feFuncG type={type} tableValues={table} />
              <feFuncB type={type} tableValues={table} />
            </feComponentTransfer>
          </filter>
        );
      })}
    </svg>
  );
}

/** A transition's `reveal` string as CSS: a gradient is a mask, anything else is a clip-path. */
const revealStyle = (reveal?: string): CSSProperties =>
  !reveal ? {} : reveal.includes("gradient") ? { maskImage: reveal, WebkitMaskImage: reveal } : { clipPath: reveal };

/**
 * Warmth (Edit → Adjust), RGB split, Duotone, Neon edges and Dissolve have no CSS filter function: SVG filters for each
 * value, that the colour steps and transitions point at (effects.ts `stepsFilter`, `blocksStyle`; model.ts
 * `transitionMix`). In sRGB like the CSS functions and the export; hidden by size, not `display: none` (that would
 * switch the filters off).
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
    {Array.from({ length: 101 }, (_, k) => (
      <filter key={`duotone-${k}`} id={`duotone-${k}`} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={duotoneMatrix(k / 50)} />
      </filter>
    ))}
    {Array.from({ length: 101 }, (_, k) => {
      const s = k / 50;
      return (
        <filter key={`neon-${k}`} id={`neon-${k}`} colorInterpolationFilters="sRGB">
          <feConvolveMatrix
            order={3}
            kernelMatrix={`${-s} ${-s} ${-s} ${-s} ${8 * s + Math.max(0, 1 - s)} ${-s} ${-s} ${-s} ${-s}`}
            divisor={1}
            preserveAlpha="true"
            edgeMode="duplicate"
          />
        </filter>
      );
    })}
    {Array.from({ length: 51 }, (_, k) => (
      <filter key={`dissolve-${k}`} id={`dissolve-${k}`} colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves={1} seed={1} result="n" />
        <feComponentTransfer in="n" result="m">
          <feFuncA type="linear" slope={20} intercept={(k / 50) * 21 - 20} />
        </feComponentTransfer>
        <feComposite in="SourceGraphic" in2="m" operator="in" />
      </filter>
    ))}
    {Array.from({ length: 24 }, (_, i) => {
      const r = i + 1;
      const b = 2 * r + 1;
      return (
        <filter key={`pixelate-${r}`} id={`pixelate-${r}`} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feFlood x={r} y={r} width={1} height={1} />
          <feComposite x={0} y={0} width={b} height={b} />
          <feTile result="t" />
          <feComposite in="SourceGraphic" in2="t" operator="in" />
          <feMorphology operator="dilate" radius={r} />
        </filter>
      );
    })}
    {Array.from({ length: 101 }, (_, k) => {
      const s = k / 50;
      const d = 0.035 * s;
      const w = 0.22 * Math.min(1, s);
      const c = 1 - 3 * w;
      return (
        <filter key={`kaleido-${k}`} id={`kaleido-${k}`} colorInterpolationFilters="sRGB" primitiveUnits="objectBoundingBox">
          <feOffset in="SourceGraphic" dx={-d} dy={-d} result="f1" />
          <feOffset in="SourceGraphic" dx={d} dy={-d} result="f2" />
          <feOffset in="SourceGraphic" dx={0} dy={d} result="f3" />
          <feComposite in="SourceGraphic" in2="f1" operator="arithmetic" k2={c} k3={w} result="m1" />
          <feComposite in="m1" in2="f2" operator="arithmetic" k2={1} k3={w} result="m2" />
          <feComposite in="m2" in2="f3" operator="arithmetic" k2={1} k3={w} />
        </filter>
      );
    })}
    {Array.from({ length: 101 }, (_, k) => {
      const s = k / 50;
      const d = (0.6 * RGB_SHARE * k) / 50;
      return (
        <filter key={`lens-${k}`} id={`lens-${k}`} colorInterpolationFilters="sRGB" primitiveUnits="objectBoundingBox">
          <feTurbulence type="fractalNoise" baseFrequency="0.003" numOctaves={1} seed={5} result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale={0.04 * s} xChannelSelector="R" yChannelSelector="G" result="d" />
          <feColorMatrix in="d" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r" />
          <feOffset in="r" dx={-d} dy={-d} result="red" />
          <feColorMatrix in="d" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="green" />
          <feColorMatrix in="d" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b" />
          <feOffset in="b" dx={d} dy={d} result="blue" />
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
  /** CSS `clip-path` or mask for a wipe, circle, smooth or radial transition ("" = none). */
  reveal: string;
  /** Horizontal scale about the box centre from a squeeze transition (1 = none). */
  scaleX: number;
  /** CSS filter from a blur or dissolve transition ("" = none). */
  transFilter: string;
  selected: boolean;
  poster?: string;
  /** The Image editor: its layer mask over the box's pixels (lib/mask.ts `maskStyle`), not over the selection frame. */
  mask?: CSSProperties;
  /** The Image editor: show the mask greyscale alone in place of the layer's pixels. */
  viewingMask?: boolean;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu?: (e: ReactMouseEvent<HTMLElement>) => void;
  handles: ReactNode;
  /** The Image editor: its place in the stack (Layers order), photos and text and shapes together. */
  z?: number;
  /** Renders the picture: a video or an image. It reports its pixel size and when it's ready. */
  children: (onShape: (width: number, height: number) => void, style: CSSProperties, onReady: () => void, onLoadedMetadata: (e: SyntheticEvent<HTMLVideoElement>) => void) => ReactNode;
}

/**
 * One picture on the stage, placed like the export: fitted inside the frame, scaled by its
 * size, at its position. The crop is a window onto the video.
 */
function PictureLayer({ clip, time, stageAspect, stageWidth, visible, opacity, white, shift, lift, zoom, turn, reveal, scaleX, transFilter, selected, poster, mask, viewingMask, onPointerDown, onContextMenu, handles, z, children }: PictureLayerProps) {
  // The video's own shape, known once it has loaded.
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [ready, setReady] = useState(false);
  const onShape = useCallback((width: number, height: number) => {
    if (width && height) setVideoAspect(width / height);
  }, []);
  const onLoadedMetadata = useCallback((e: SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth, videoHeight } = e.currentTarget;
    if (videoWidth && videoHeight) setVideoAspect(videoWidth / videoHeight);
  }, []);
  const onReady = useCallback(() => setReady(true), []);
  const { left, top, right, bottom } = clip.crop;
  const keptW = 1 - left - right;
  const keptH = 1 - top - bottom;
  const upright = (videoAspect * keptW) / keptH;
  // A quarter turn swaps the picture's shape; the crop window turns inside the box (the export: crop, then transpose).
  const rotate = clip.rotate ?? 0;
  const sideways = rotate === 90 || rotate === 270;
  const aspect = clip.aspect ? 1 / clip.aspect : sideways ? 1 / upright : upright;
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
    ...revealStyle(reveal),
  };
  const video = useMemo<CSSProperties>(
    () => ({
      width: `${100 / keptW}%`,
      height: `${100 / keptH}%`,
      left: `${(-left / keptW) * 100}%`,
      top: `${(-top / keptH) * 100}%`,
    }),
    [keptW, keptH, left, top],
  );

  return (
    <div
      className={selected ? "preview__picture is-selected" : "preview__picture"}
      data-clip={clip.id}
      style={{
        ...box,
        visibility: visible || viewingMask ? "visible" : "hidden",
        opacity: viewingMask ? 1 : opacity,
        mixBlendMode: viewingMask ? undefined : clip.blend,
        zIndex: viewingMask ? 99991 : z,
        filter: viewingMask ? undefined : styled(clip),
        rotate: clip.angle ? `${clip.angle}deg` : undefined,
      }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onClick={onPointerDown ? (e) => e.stopPropagation() : undefined}
    >
      {/* The mask goes on the box's pixels, not on the box itself, which also holds the selection frame. */}
      <div style={mask?.maskImage && !viewingMask ? { position: "absolute", inset: 0, ...mask } : { display: "contents" }}>
      <div className="preview__crop" style={turned}>
        <div
          className="preview__clip-fx"
          style={
            fx || zoom !== 1 || turn !== 0 || scaleX !== 1 || transFilter
              ? {
                  filter: [fx?.filter, transFilter].filter(Boolean).join(" ") || undefined,
                  transform:
                    [
                      turn !== 0 && `rotate(${turn}deg)`,
                      zoom !== 1 && `scale(${zoom})`,
                      scaleX !== 1 && `scaleX(${scaleX})`,
                      fx?.transform,
                      fx?.mirror && "scaleX(-1)",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined,
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
          {children(onShape, video, onReady, onLoadedMetadata)}
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
      </div>
      {viewingMask && clip.mask && (
        <img
          src={clip.mask}
          alt=""
          draggable={false}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", background: "#000", zIndex: 1, pointerEvents: "none" }}
        />
      )}
      {visible && !ready && !poster && <span className="preview__loading">Loading video…</span>}
      {handles}
    </div>
  );
}

function GifLayer({
  src,
  time,
  className,
  style,
  onShape,
  onReady,
  onError,
}: {
  src: string;
  time: number;
  className: string;
  style: CSSProperties;
  onShape: (width: number, height: number) => void;
  onReady: () => void;
  onError: () => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [gif, setGif] = useState<DecodedGif | null>(null);
  const callbacks = useRef({ onShape, onReady, onError });
  callbacks.current = { onShape, onReady, onError };

  useEffect(() => {
    let cancelled = false;
    setGif(null);
    loadGif(src).then(
      (decoded) => {
        if (cancelled) return;
        const first = decoded.frames[0];
        if (first) callbacks.current.onShape(first.width, first.height);
        setGif(decoded);
        callbacks.current.onReady();
      },
      () => {
        if (!cancelled) callbacks.current.onError();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    const frame = gif?.frames[gifFrameAt(gif.times, gif.length, time)] ?? gif?.frames[0];
    if (!canvas || !ctx || !frame) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(frame, 0, 0);
  }, [gif, time]);

  if (!gif) return null;
  return <canvas ref={ref} width={gif.frames[0]?.width} height={gif.frames[0]?.height} className={className} style={style} />;
}

interface ShapeLayerProps {
  clip: Clip;
  frame: Frame;
  opacity: number;
  transFilter?: string;
  transTransform?: string;
  reveal?: string;
  selected: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu?: (e: ReactMouseEvent<HTMLElement>) => void;
  handles: ReactNode;
  /** The Image editor: its place in the stack (Layers order), photos and text and shapes together. */
  z?: number;
  /** The Image editor (its layer mask is drawn only there). */
  still?: boolean;
  /** The Image editor: show the mask greyscale alone over the shape's box. */
  viewingMask?: boolean;
}

/** One shape on the stage: a full-frame SVG picture with a hit box over its bounding box. */
function ShapeLayer({ clip, frame, opacity, transFilter, transTransform, reveal, selected, onPointerDown, onContextMenu, handles, z, still, viewingMask }: ShapeLayerProps) {
  const src = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shapeSvg(clip, frame.width, frame.height))}`,
    [clip.shape, clip.color, clip.size, clip.aspect, clip.x, clip.y, clip.opacity, clip.outline, clip.rotate, clip.points, frame.width, frame.height],
  );
  const box = shapeBox(clip, frame.width, frame.height);
  // The picture covers the frame, so its mask is placed on the shape's box there, turned with it.
  const mask = still ? maskStyle(clip, { width: frame.width, height: frame.height, box: { ...box, angle: clip.rotate ?? 0 } }) : undefined;
  const shapeStyle: CSSProperties = {
    opacity,
    mixBlendMode: clip.blend,
    zIndex: z,
    filter: [styled(clip), transFilter].filter(Boolean).join(" ") || undefined,
    transform: transTransform,
    ...revealStyle(reveal),
  };
  return (
    <>
      {mask?.maskImage ? (
        // Masked inside, styled outside: the layer style follows the masked pixels, as the saved picture draws it.
        <div className="preview__shape" style={shapeStyle}>
          <img src={src} alt="" draggable={false} style={{ display: "block", width: "100%", height: "100%", ...mask }} />
        </div>
      ) : (
        <img className="preview__shape" src={src} alt="" draggable={false} style={shapeStyle} />
      )}
      <div
        className={selected ? "preview__shape-box is-selected" : "preview__shape-box"}
        data-clip={clip.id}
        style={{
          left: `${(box.left / frame.width) * 100}%`,
          top: `${(box.top / frame.height) * 100}%`,
          width: `${(box.width / frame.width) * 100}%`,
          height: `${(box.height / frame.height) * 100}%`,
          transform: clip.rotate ? `rotate(${clip.rotate}deg)` : undefined,
          zIndex: viewingMask ? 99991 : z,
        }}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        onClick={(e) => e.stopPropagation()}
      >
        {viewingMask && clip.mask && (
          <img
            src={clip.mask}
            alt=""
            draggable={false}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", background: "#000", pointerEvents: "none" }}
          />
        )}
        {handles}
      </div>
    </>
  );
}
