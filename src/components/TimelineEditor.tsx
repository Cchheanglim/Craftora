import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { shapeLabel } from "../project/shapes";
import { TRANSITION_KINDS, clipEnd, clipLength, clipPeaks, isBlock, mainTrack, showsPicture, mediaTimeAt, previousOnTrack, trackLabel, trackSilent, transitionLength, type Clip, type MediaItem, type Project, type Track, type TrackSize } from "../project/model";
import { LOOKS, PICTURE_EFFECTS, blockLabel, type FxItem } from "../project/effects";
import { packedTrack, slotOn } from "../project/actions";
import type { ProjectApi } from "../project/useProject";
import type { Playback } from "../project/usePlayback";
import { formatClock, formatTimecode } from "../lib/timecode";
import { filmstrip, type Strip } from "../lib/thumbnail";
import { Icon, type IconName } from "./Icon";
import "./TimelineEditor.css";

/** Drag-and-drop type for media dragged from the library. */
/**
 * The media being dragged from the Media list onto a track, or null. A pointer drag rather than
 * HTML5 drag-and-drop: on Windows, Tauri takes over HTML5 drops (to receive files from File
 * Explorer), so dropping onto the timeline never worked in the desktop app.
 */
export const mediaDrag: { current: string | null } = { current: null };

/** Starts dragging `mediaId` from the Media list; a lane adds it where the pointer is let go. */
export const beginMediaDrag = (mediaId: string, e: ReactPointerEvent) => followDrag(mediaDrag, mediaId, e);

/** A filter, effect or transition being dragged from the right panel onto the timeline, or null. */
export const fxDrag: { current: FxItem | null } = { current: null };
export const beginFxDrag = (item: FxItem, e: ReactPointerEvent) => followDrag(fxDrag, item, e);

/** Holds `value` in `holder` once the pointer has moved a little, until it's let go. */
function followDrag<T>(holder: { current: T | null }, value: T, e: ReactPointerEvent) {
  const [x, y] = [e.clientX, e.clientY];
  const move = (ev: PointerEvent) => {
    if (holder.current || Math.hypot(ev.clientX - x, ev.clientY - y) < 4) return;
    holder.current = value;
    document.body.classList.add("is-dragging-media");
  };
  // Lanes read the holder in their own pointerup, which runs before this window listener.
  const end = () => {
    holder.current = null;
    document.body.classList.remove("is-dragging-media");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const SNAP_PX = 7;
/** A new block narrower than this many pixels is zoomed in to. */
const REVEAL_PX = 40;
const MIN_PPS = 2;
const MAX_PPS = 400;
/** Pixels the pointer must travel before a press on a clip becomes a drag. */
const DRAG_THRESHOLD = 3;
/** A length on the timeline: seconds, or minutes and seconds once it's a minute or more. */
const fadeLength = (s: number) => (s < 60 ? `${s.toFixed(1)} s` : formatClock(s));

interface TimelineEditorProps {
  project: Project;
  api: ProjectApi;
  playback: Playback;
  duration: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onCutSilences: () => void;
  cuttingSilences?: boolean;
  onDelete: () => void;
  onAddText: () => void;
  /** Opens the Voice-over recorder (desktop app only). */
  onRecordVoice?: () => void;
  /** A filter, effect or transition dropped on track `trackId` at `time`. */
  /** `trackId` null: dropped in the empty space around the tracks (a filter, effect or shape gets its own track). */
  onDropFx: (item: FxItem, trackId: string | null, time: number) => void;
  /** A block just added from the right panel: zoomed in to when it's too small to see or grab. */
  revealed?: { clipId: string; at: number } | null;
  /** The clip whose transition (from the clip before it) is selected: outlined, its controls in the right panel. */
  selectedTransition?: string | null;
  onSelectTransition?: (clipId: string) => void;
  /** A click on a clip's sound wave: open its Sound panel. */
  onOpenSound?: (clipId: string) => void;
  /** A click on the filter or effect inside a clip: open its settings in that tab. */
  onOpenFx?: (clipId: string, tab: "filters" | "effects") => void;
  /** A pick from a clip's right-click menu; `time`: the playhead if it's on the clip, else where it was clicked. */
  onClipCommand: (command: ClipCommand, clip: Clip, time: number) => void;
  /** Something has been copied, so Paste can put it at the playhead. */
  canPaste: boolean;
  /** Cover on the main track: from the frame at the playhead, a picture, or none. */
  onCover: (choice: "frame" | "picture" | "remove") => void;
  /**
   * A voice-over being recorded: drawn as a growing clip from `start` to `end` (seconds on the timeline) on track
   * `trackId`, the track the take will land on; null: a new row below all the tracks (the take gets a new track).
   * `levels`: the microphone's loudness, 0 to 1, one value per 0.1 s of the take so far, oldest first.
   */
  recording?: { start: number; end: number; trackId: string | null; levels: number[] } | null;
}

/** What a clip's right-click menu can do (App `clipCommand` does it). */
export type ClipCommand = "copy" | "cut" | "paste" | "delete" | "freeze" | "reverse" | "mirror" | "rotate" | "crop" | "export" | "replace" | "reveal";

type DragMode = "move" | "start" | "end";

/** What the pointer is doing between press and release. */
type Gesture =
  | { kind: "scrub" }
  | { kind: "clip"; clipId: string; mode: DragMode; originX: number; originStart: number; originEdge: number; moved: boolean; onWave: boolean }
  | { kind: "transition"; clipId: string; originX: number; origin: number };

/** Where a clip being moved is drawn; the project only changes on release. */
/** Where the track buttons being folded away is remembered on this PC. */
const HEADS_HIDDEN = "craftora.trackHeadsHidden";

interface Ghost {
  clipId: string;
  start: number;
  trackId: string;
  /** Over the empty space above the top track or below the bottom one: let go, and it gets a new track there. */
  newTrack?: "top" | "bottom";
}

/** Track height and waveform size choices (the header's … menu). */
const SIZES: { size: TrackSize; label: string }[] = [
  { size: "s", label: "Small" },
  { size: "m", label: "Medium" },
  { size: "l", label: "Large" },
];
const ROW_PX: Record<TrackSize, number> = { s: 28, m: 40, l: 52 };
/** A track's row size: as set in its menu, else large for the main track and the tracks over it (as tall as each other), medium for the sound below. */
const rowSize = (t: Track, large: boolean): TrackSize => t.height ?? (large ? "l" : "m");
/** Share of a video clip's row its sound-wave band takes, by the track's Waveform size. */
const WAVE_SHARE: Record<TrackSize, number> = { s: 0.1, m: 0.17, l: 0.28 };
/** The name bar along the top of a video or sound clip. */
const LABEL_PX = 14;

export function TimelineEditor({
  project,
  api,
  playback,
  duration,
  selectedId,
  onSelect,
  onSplit,
  onDuplicate,
  onCutSilences,
  cuttingSilences,
  onDelete,
  onAddText,
  onRecordVoice,
  onDropFx,
  revealed,
  selectedTransition,
  onSelectTransition,
  onOpenSound,
  onOpenFx,
  onClipCommand,
  canPaste,
  onCover,
  recording,
}: TimelineEditorProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const laneRefs = useRef(new Map<string, HTMLDivElement>());
  const gestureRef = useRef<Gesture | null>(null);
  const [ghost, setGhostState] = useState<Ghost | null>(null);
  const ghostRef = useRef<Ghost | null>(null);
  const setGhost = (g: Ghost | null) => {
    ghostRef.current = g;
    setGhostState(g);
  };
  const [pps, setPps] = useState(40);
  // The track buttons folded away (the line between them and the clips), remembered on this PC.
  const [headsHidden, setHeadsHidden] = useState(() => {
    try {
      return localStorage.getItem(HEADS_HIDDEN) === "1";
    } catch {
      return false;
    }
  });
  // 0 until measured, so the first automatic fit uses the real width.
  const [viewWidth, setViewWidth] = useState(0);
  const [scrollbar, setScrollbar] = useState(0);
  const [fitted, setFitted] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [fadeDrag, setFadeDrag] = useState<{ clipId: string; edge: "trans" } | null>(null);
  const [trimTip, setTrimTip] = useState<{ clipId: string; edge: "start" | "end" } | null>(null);
  // Each video's filmstrip, made in the background (by preview address); until then its clips show its picture.
  const [strips, setStrips] = useState<Record<string, Strip>>({});
  useEffect(() => {
    for (const m of project.media) {
      const s = m.source;
      if (!m.hasVideo || s.image || s.live || s.previewHls || s.previewProxy || !s.previewUrl || strips[s.previewUrl]) continue;
      void filmstrip(s.previewUrl, s.duration).then((strip) => strip && setStrips((all) => ({ ...all, [s.previewUrl]: strip })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.media]);
  /** The clip whose right-click menu is open, where, and at what time it acts. */
  const [clipMenu, setClipMenu] = useState<{ clipId: string; x: number; y: number; time: number } | null>(null);
  const [coverMenu, setCoverMenu] = useState<{ x: number; y: number } | null>(null);
  const main = mainTrack(project);
  /** The main track or one above it (pictures, text, effects). */
  const overMain = (t: Track) => !main || project.tracks.indexOf(t) <= project.tracks.indexOf(main);
  /** The track whose … menu is open, and where to draw it. */
  const [menu, setMenu] = useState<{ trackId: string; x: number; y: number; up: boolean } | null>(null);
  // The menus sit at a fixed place on screen: they close when the timeline moves under them
  // (resized with the bar above it, scrolled) or the window changes size.
  const menuOpen = Boolean(menu || coverMenu || clipMenu);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => {
      setMenu(null);
      setCoverMenu(null);
      setClipMenu(null);
    };
    const size = sectionRef.current?.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const now = sectionRef.current?.getBoundingClientRect();
      // It reports once when it starts watching: only a real change closes them.
      if (now && size && (now.top !== size.top || now.height !== size.height)) close();
    });
    if (sectionRef.current) observer.observe(sectionRef.current);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuOpen]);

  // Track the visible width for "fit" and the content width, and the scrollbar under the clips:
  // the heads leave the same room below so both sides centre their rows on the same lines.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setViewWidth(el.clientWidth);
      setScrollbar(el.offsetHeight - el.clientHeight);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  // Zoomed all the way out, the whole edit fits however long it is (a 2-hour video too).
  const minPps = Math.min(MIN_PPS, (viewWidth - 40) / Math.max(duration * 1.5, 15));
  const fit = () => setPps(Math.min(MAX_PPS, Math.max(minPps, (viewWidth - 40) / Math.max(duration * 1.5, 15))));
  const minPpsRef = useRef(minPps);
  minPpsRef.current = minPps;

  // Where to scroll once a new zoom is drawn (the layout effect below applies it).
  const scrollTo = useRef<number | null>(null);
  // The zoom asked for last, which may not be drawn yet (a pinch sends many steps a frame).
  const ppsNow = useRef(pps);
  ppsNow.current = pps;
  // Ctrl + wheel and a touchpad pinch (which arrives as Ctrl + wheel) zoom the timeline about the pointer: the moment
  // under it stays under it. Our own listener: React's can't stop the window zooming itself instead.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !contentRef.current) return;
      e.preventDefault();
      // A pinch follows the fingers (its steps add up to the pinch's scale); a wheel notch (about 100) zooms 1.2×.
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 33 : e.deltaY;
      const from = ppsNow.current;
      const next = Math.min(MAX_PPS, Math.max(minPpsRef.current, from * Math.min(1.2, Math.max(1 / 1.2, Math.exp(-delta / 100)))));
      if (next === from) return;
      // The pointer's place in the view, and the scroll still waiting to be applied (from an earlier step this frame).
      const x = e.clientX - contentRef.current.getBoundingClientRect().left - el.scrollLeft;
      const at = ((scrollTo.current ?? el.scrollLeft) + x) / from;
      scrollTo.current = at * next - x;
      ppsNow.current = next;
      setPps(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Fit the first time something lands on the timeline.
  useEffect(() => {
    if (!fitted && duration > 0 && viewWidth > 0) {
      fit();
      setFitted(true);
    }
    if (duration === 0) setFitted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, viewWidth]);

  // A new block narrower than this at the current zoom (a 5 s effect on a zoomed-out long video is a sliver): zoom in so
  // it's a fifth of the view, centred, with room for its name and edges.
  useEffect(() => {
    const clip = revealed && project.clips.find((c) => c.id === revealed.clipId);
    if (!clip || viewWidth === 0 || clipLength(clip) * pps >= REVEAL_PX) return;
    const next = Math.min(MAX_PPS, viewWidth / 5 / clipLength(clip));
    scrollTo.current = (clip.start + clipLength(clip) / 2) * next - viewWidth / 2;
    setPps(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);
  // After the wider content is drawn, so it can scroll that far.
  useLayoutEffect(() => {
    if (scrollTo.current === null || !scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0, scrollTo.current);
    scrollTo.current = null;
  }, [pps]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playback.playing) return;
    const x = playback.time * pps;
    if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 80;
    else if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
  }, [playback.time, playback.playing, pps]);

  const contentWidth = Math.max(viewWidth, (Math.max(duration, 10, playback.time, recording?.end ?? 0) + 10) * pps);
  const timeAt = (clientX: number) => {
    const rect = contentRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left) / pps);
  };
  const getTimeAt = (clientX: number, g: Extract<Gesture, { kind: "clip" }>) =>
    contentRef.current ? timeAt(clientX) : g.originEdge + (clientX - g.originX) / pps;

  /** Snaps to the playhead and to other clips' edges when within a few pixels. */
  // `playhead`: also the playhead itself (not when it's the playhead being dragged: it would stick to itself).
  const snap = (t: number, ignore: string, playhead = true) => {
    const targets = playhead ? [0, playback.time] : [0];
    for (const c of project.clips) if (c.id !== ignore) targets.push(c.start, clipEnd(c));
    let best = t;
    let bestPx = SNAP_PX;
    for (const target of targets) {
      const px = Math.abs(target - t) * pps;
      if (px < bestPx) {
        best = target;
        bestPx = px;
      }
    }
    return best;
  };

  const laneAt = (clientY: number) => {
    for (const [id, el] of laneRefs.current) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) return id;
    }
    return undefined;
  };

  // Pointer moves and releases are followed on the window, so a drag keeps working when
  // the pointer leaves the clip or the clip moves to another track. These read the latest
  // props through refs that are refreshed on every render.
  const onPointerMove = useRef<(e: PointerEvent) => void>(() => {});
  const onPointerUp = useRef<(e: PointerEvent) => void>(() => {});

  /** Near the timeline's left or right edge, a drag scrolls it along. */
  const scrollAtEdge = (clientX: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    if (clientX > r.right - 36) scroller.scrollLeft += 14;
    else if (clientX < r.left + 36) scroller.scrollLeft = Math.max(0, scroller.scrollLeft - 14);
  };

  onPointerMove.current = (e) => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.kind === "scrub") {
      scrollAtEdge(e.clientX);
      // The playhead snaps to cuts and clip edges, so it lands exactly on a join.
      playback.seek(snap(timeAt(e.clientX), "", false));
      return;
    }
    if (g.kind === "transition") {
      scrollAtEdge(e.clientX);
      const clip = project.clips.find((c) => c.id === g.clipId);
      if (!clip?.transition) return;
      const raw = g.origin + (g.originX - e.clientX) / pps;
      const duration = Math.min(5, Math.max(0.1, Math.round(raw * 10) / 10));
      api.editLive({
        type: "setTransition",
        clipId: clip.id,
        transition: { ...clip.transition, duration },
      });
      return;
    }
    const dx = e.clientX - g.originX;
    if (!g.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD && !laneChanged(g.clipId, e.clientY)) return;
      g.moved = true;
      // Trims change the project live; moves only on release (see onPointerUp).
      if (g.mode !== "move") {
        api.checkpoint();
        setTrimTip({ clipId: g.clipId, edge: g.mode });
      }
    }
    const dt = dx / pps;
    const clip = project.clips.find((c) => c.id === g.clipId);
    if (!clip) return;
    if (g.mode === "move") {
      let start = g.originStart + dt;
      // Snap either edge of the clip.
      const snappedStart = snap(start, clip.id);
      const snappedEnd = snap(start + clipLength(clip), clip.id) - clipLength(clip);
      // An edge that found nothing comes back unmoved (0 away): the other edge's snap still wins.
      const startSnaps = snappedStart !== start;
      const endSnaps = snappedEnd !== start;
      if (startSnaps && (!endSnaps || Math.abs(snappedStart - start) <= Math.abs(snappedEnd - start))) start = snappedStart;
      else if (endSnaps) start = snappedEnd;
      // Any track takes any clip, unless it's locked; the empty space above or below the tracks makes a new one.
      const lane = project.tracks.find((t) => t.id === laneAt(e.clientY));
      const newTrack = lane ? undefined : edgeAt(e.clientY);
      const trackId = lane && !lane.locked ? lane.id : newTrack ? clip.trackId : (ghostRef.current?.trackId ?? clip.trackId);
      setGhost({ clipId: clip.id, start: Math.max(0, start), trackId, newTrack });
    } else {
      scrollAtEdge(e.clientX);
      api.editLive({ type: "trimClip", clipId: clip.id, edge: g.mode, time: snap(getTimeAt(e.clientX, g), clip.id) });
    }
  };

  onPointerUp.current = (e) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    setScrubbing(false);
    setFadeDrag(null);
    setTrimTip(null);
    if (!g) return;
    if (g.kind === "transition") {
      api.editLive({ type: "settle" });
      return;
    }
    if (g.kind === "clip" && !g.moved && g.onWave) onOpenSound?.(g.clipId);
    if (g.kind !== "clip" || !g.moved) return;
    const final = ghostRef.current;
    setGhost(null);
    // A filter or effect block let go over a video or picture goes inside it (like dropping one from the panel).
    const block = project.clips.find((c) => c.id === g.clipId);
    const lane = laneAt(e.clientY);
    const time = contentRef.current ? timeAt(e.clientX) : -1;
    const into =
      g.mode === "move" && block && isBlock(block) && (block.look || block.effect) && lane
        ? project.clips.find((c) => c.trackId === lane && c.mediaId && showsPicture(project, c) && time >= c.start && time < clipEnd(c))
        : undefined;
    if (block && into) {
      api.checkpoint();
      api.editLive({
        type: "updateClip",
        clipId: into.id,
        patch: block.look ? { look: block.look, lookAmount: block.lookAmount ?? 1 } : { effect: block.effect, effectStrength: block.effectStrength, effectSpeed: block.effectSpeed },
      });
      api.editLive({ type: "deleteClip", clipId: block.id });
      onSelect(into.id);
      return;
    }
    if (g.mode === "move" && final?.newTrack) {
      const trackId = `track-${crypto.randomUUID().slice(0, 8)}`;
      api.checkpoint();
      api.editLive({ type: "addTrack", trackId, below: final.newTrack === "bottom" });
      api.editLive({ type: "moveClip", clipId: final.clipId, start: final.start, trackId });
      api.editLive({ type: "settle" });
      return;
    }
    if (g.mode === "move" && final) {
      api.edit({ type: "moveClip", clipId: final.clipId, start: final.start, trackId: final.trackId });
    }
    api.editLive({ type: "settle" });
  };

  const laneChanged = (clipId: string, clientY: number) => {
    const clip = project.clips.find((c) => c.id === clipId);
    const lane = laneAt(clientY);
    return Boolean(clip && ((lane && lane !== clip.trackId) || (!lane && edgeAt(clientY))));
  };

  /** Above the top track or below the bottom one, within the timeline: where a dragged clip gets a new track. */
  const edgeAt = (clientY: number): "top" | "bottom" | undefined => {
    const lanes = [...laneRefs.current.values()].map((el) => el.getBoundingClientRect());
    const box = scrollRef.current?.getBoundingClientRect();
    if (!lanes.length || !box) return undefined;
    if (clientY >= box.top && clientY < Math.min(...lanes.map((r) => r.top))) return "top";
    if (clientY >= Math.max(...lanes.map((r) => r.bottom)) && clientY <= box.bottom) return "bottom";
    return undefined;
  };

  const startGesture = (g: Gesture) => {
    gestureRef.current = g;
    const move = (e: PointerEvent) => onPointerMove.current(e);
    const up = (e: PointerEvent) => {
      onPointerUp.current(e);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const beginDrag = (clip: Clip, mode: DragMode) => (e: ReactPointerEvent<HTMLElement>) => {
    // A right-click only opens the clip's menu: it never reaches the lane, which would move the playhead there.
    if (e.button === 2) return e.stopPropagation();
    // On a locked track a press just moves the playhead (the lane does that).
    if (e.button !== 0 || project.tracks.find((t) => t.id === clip.trackId)?.locked) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(clip.id);
    startGesture({
      kind: "clip",
      clipId: clip.id,
      mode,
      originX: e.clientX,
      originStart: clip.start,
      originEdge: mode === "end" ? clipEnd(clip) : clip.start,
      moved: false,
      onWave: mode === "move" && Boolean((e.target as Element).closest(".tl__wave-band")),
    });
  };

  const beginTransition = (clip: Clip) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !clip.transition || project.tracks.find((t) => t.id === clip.trackId)?.locked) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onSelectTransition?.(clip.id);
    api.checkpoint();
    setFadeDrag({ clipId: clip.id, edge: "trans" });
    startGesture({ kind: "transition", clipId: clip.id, originX: e.clientX, origin: clip.transition.duration });
  };

  /** Press on the ruler, the playhead or empty track space: move the playhead and follow the pointer. */
  const beginScrub = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    playback.pause();
    playback.seek(snap(timeAt(e.clientX), "", false));
    setScrubbing(true);
    startGesture({ kind: "scrub" });
  };

  const onMediaDrop = (track: Track) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (track.locked) return;
    const mediaId = mediaDrag.current;
    if (mediaId) api.edit({ type: "addClip", clipId: crypto.randomUUID(), mediaId, trackId: track.id, at: timeAt(e.clientX) });
    // A transition dropped a few pixels from a cut goes on that cut, however far out the timeline is zoomed (further
    // into a clip it cuts the clip there).
    else if (fxDrag.current) onDropFx(fxDrag.current, track.id, fxDrag.current.kind === "transition" ? snap(timeAt(e.clientX), "", false) : timeAt(e.clientX));
  };

  const step = RULER_STEPS.find((s) => s * pps >= 70) ?? 3600;
  const ticks: number[] = [];
  for (let t = 0; t * pps < contentWidth; t += step) ticks.push(t);

  const selected = project.clips.find((c) => c.id === selectedId);
  const selectedMedia = selected?.mediaId ? project.media.find((m) => m.id === selected.mediaId) : undefined;
  const canSplit = selected && playback.time > selected.start && playback.time < clipEnd(selected);
  const canCutSilences = Boolean(selected && selectedMedia?.hasAudio && !selectedMedia.source.image);

  // While a clip is being moved: it follows the pointer, and on a magnetic track the other
  // clips close up behind it and open a gap where it would land.
  const isMagnetic = (trackId: string) => Boolean(project.tracks.find((t) => t.id === trackId)?.magnetic);
  const placed = new Map<string, { start: number; trackId: string }>();
  // Headed for a new track: the clip stays put (dimmed) and the dashed "New track" outline shows where it goes.
  if (ghost && !ghost.newTrack) {
    const dragged = project.clips.find((c) => c.id === ghost.clipId);
    if (dragged) {
      for (const trackId of new Set([ghost.trackId, dragged.trackId])) {
        if (!isMagnetic(trackId)) continue;
        const gapAt = trackId === ghost.trackId ? slotOn(project, trackId, dragged.id, ghost.start) : Infinity;
        packedTrack(project, trackId, dragged.id).forEach(({ clip, start }, i) => {
          placed.set(clip.id, { start: i >= gapAt ? start + clipLength(dragged) : start, trackId });
        });
      }
      placed.set(dragged.id, { start: ghost.start, trackId: ghost.trackId });
    }
  }
  const where = (c: Clip) => placed.get(c.id) ?? { start: c.start, trackId: c.trackId };
  /** Seconds a clip overlaps the one before it (its transition). */
  const overlap = (c: Clip) => {
    if (ghost) return 0;
    const prev = previousOnTrack(project, c);
    return prev ? transitionLength(prev, c) : 0;
  };

  return (
    <section ref={sectionRef} className={scrubbing ? "tl is-scrubbing" : "tl"} aria-label="Timeline">
      <div className="tl__toolbar" role="toolbar" aria-label="Timeline tools">
        <button type="button" className="btn btn--icon" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={api.undo} disabled={!api.canUndo}>
          <Icon name="undo" />
        </button>
        <button type="button" className="btn btn--icon" aria-label="Redo" title="Redo (Ctrl+Y)" onClick={api.redo} disabled={!api.canRedo}>
          <Icon name="redo" />
        </button>
        <span className="tl__sep" aria-hidden="true" />
        <button type="button" className="btn btn--ghost" title="Split at the playhead (S)" onClick={onSplit} disabled={!canSplit}>
          <Icon name="scissors" size={14} />
          Split
        </button>
        <button type="button" className="btn btn--ghost" title="Duplicate the selected clip (Ctrl+D)" onClick={onDuplicate} disabled={!selected}>
          <Icon name="copy" size={14} />
          Duplicate
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          title="Find and cut out silent pauses in the selected clip"
          onClick={onCutSilences}
          disabled={!canCutSilences || cuttingSilences}
        >
          <Icon name="waveform" size={14} />
          {cuttingSilences ? "Cutting…" : "Cut silences"}
        </button>
        <button type="button" className="btn btn--ghost" title="Delete the selected clip (Delete)" onClick={onDelete} disabled={!selected}>
          <Icon name="trash" size={14} />
          Delete
        </button>
        <span className="tl__sep" aria-hidden="true" />
        <button type="button" className="btn btn--ghost" title="Add text at the playhead (T)" onClick={onAddText}>
          <Icon name="text" size={14} />
          Text
        </button>
        {onRecordVoice && (
          <button type="button" className="btn btn--ghost" title="Record your voice over the video, from the playhead" onClick={onRecordVoice}>
            <Icon name="mic" size={14} />
            Voice-over
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost"
          title="Add a track at the top: it takes videos, pictures, sound, text and effects"
          onClick={() => api.edit({ type: "addTrack", trackId: `track-${crypto.randomUUID().slice(0, 8)}` })}
        >
          <Icon name="plus" size={14} />
          Track
        </button>
        <div className="tl__zoom">
          <button type="button" className="btn btn--icon" aria-label="Zoom out" onClick={() => setPps((p) => Math.max(minPps, p / 1.5))}>
            <Icon name="minus" size={14} />
          </button>
          <button type="button" className="btn btn--icon" aria-label="Fit timeline" title="Fit" onClick={fit}>
            <Icon name="fit" size={14} />
          </button>
          <button type="button" className="btn btn--icon" aria-label="Zoom in" onClick={() => setPps((p) => Math.min(MAX_PPS, p * 1.5))}>
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>

      <div className="tl__body">
        <div className={headsHidden ? "tl__heads is-hidden" : "tl__heads"} style={{ paddingBottom: scrollbar }} inert={headsHidden}>
          <div className="tl__ruler-spacer" />
          <div className="tl__lanes">
          {project.tracks.map((track) => {
            const clipCount = project.clips.filter((c) => c.trackId === track.id).length;
            const name = trackLabel(project, track);
            const menuOpen = menu?.trackId === track.id;
            return (
              <div key={track.id} className={track.id === main?.id ? "tl__head is-main" : "tl__head"} style={{ height: ROW_PX[rowSize(track, overMain(track))] }} role="group" aria-label={name}>
                {track.id === main?.id ? (
                  <button
                    type="button"
                    className="tl__cover"
                    aria-label="Cover"
                    aria-haspopup="menu"
                    aria-expanded={Boolean(coverMenu)}
                    title="The project's cover: shown for it in Craftora and built into exported videos"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setCoverMenu(coverMenu ? null : { x: r.left, y: r.bottom + 4 });
                    }}
                  >
                    {project.cover ? <img src={project.cover} alt="" /> : <Icon name="image" size={13} />}
                  </button>
                ) : (
                  <span className="tl__head-gap" aria-hidden="true" />
                )}
                {track.id === main?.id && <span className="tl__head-gap" aria-hidden="true" />}
                <button
                  type="button"
                  className="tl__head-btn"
                  aria-pressed={Boolean(track.locked)}
                  aria-label={track.locked ? `Unlock ${name}` : `Lock ${name}`}
                  title={track.locked ? "Locked: its clips can't be moved or changed. Click to unlock." : "Lock this track"}
                  onClick={() => api.edit({ type: "updateTrack", trackId: track.id, patch: { locked: !track.locked || undefined } })}
                >
                  <Icon name={track.locked ? "lock" : "unlock"} size={12} />
                </button>
                {/* Every track has the same three buttons. */}
                <button
                  type="button"
                  className="tl__head-btn"
                  aria-pressed={Boolean(track.hidden)}
                  aria-label={track.hidden ? `Show ${name}` : `Hide ${name}`}
                  title={track.hidden ? "Hidden from the preview and the export. Click to show." : "Hide its pictures, text and effects (the sound still plays)"}
                  onClick={() => api.edit({ type: "updateTrack", trackId: track.id, patch: { hidden: !track.hidden || undefined } })}
                >
                  <Icon name={track.hidden ? "eyeOff" : "eye"} size={12} />
                </button>
                <button
                  type="button"
                  className="tl__head-btn"
                  aria-pressed={Boolean(track.muted)}
                  aria-label={track.muted ? `Unmute ${name}` : `Mute ${name}`}
                  title={track.muted ? "Track is muted. Click to unmute." : "Mute this track"}
                  onClick={() => api.edit({ type: "setTrackMuted", trackId: track.id, muted: !track.muted })}
                >
                  <Icon name={track.muted ? "volumeOff" : "volume"} size={12} />
                </button>
                <div
                  className="tl__head-more"
                  onBlur={(e) => {
                    // The menu is drawn on the page itself (a portal), outside this box in the page.
                    if (!e.currentTarget.contains(e.relatedTarget) && !(e.relatedTarget instanceof Element && e.relatedTarget.closest(".tl__track-menu"))) setMenu(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setMenu(null);
                  }}
                >
                  <button
                    type="button"
                    className="tl__head-btn"
                    aria-expanded={menuOpen}
                    aria-haspopup="menu"
                    aria-label={`More for ${name}`}
                    title="Track height, waveform size and more"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      // Upwards when there's no room under the button.
                      const up = r.bottom + 260 > window.innerHeight;
                      setMenu(menuOpen ? null : { trackId: track.id, x: r.left, y: up ? window.innerHeight - r.top + 4 : r.bottom + 4, up });
                    }}
                  >
                    <Icon name="more" size={12} />
                  </button>
                  {menuOpen && createPortal(
                    // On the page itself, so the timeline's scrolling box (and a glass theme's blur) can't cut it off.
                    <div className="tl__menu tl__track-menu" role="menu" style={{ position: "fixed", left: menu.x, ...(menu.up ? { top: "auto", bottom: menu.y } : { top: menu.y }) }}>
                      <p className="tl__menu-label">Track height</p>
                      <div className="tl__sizes" role="group" aria-label="Track height">
                        {SIZES.map(({ size, label }) => (
                          <button
                            key={size}
                            type="button"
                            role="menuitemradio"
                            aria-checked={rowSize(track, overMain(track)) === size}
                            autoFocus={rowSize(track, overMain(track)) === size}
                            onClick={() => api.edit({ type: "updateTrack", trackId: track.id, patch: { height: size } })}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="tl__menu-label">Waveform size</p>
                      <div className="tl__sizes" role="group" aria-label="Waveform size">
                        {SIZES.map(({ size, label }) => (
                          <button
                            key={size}
                            type="button"
                            role="menuitemradio"
                            aria-checked={(track.wave ?? "m") === size}
                            onClick={() => api.edit({ type: "updateTrack", trackId: track.id, patch: { wave: size === "m" ? undefined : size } })}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={Boolean(track.magnetic)}
                        title="Clips stay back to back and can have transitions"
                        onClick={() => {
                          setMenu(null);
                          api.edit({ type: "setMagnetic", trackId: track.id, magnetic: !track.magnetic });
                        }}
                      >
                        <Icon name="magnet" size={13} />
                        {track.magnetic ? "Magnet on" : "Magnet off"}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        title={clipCount ? `Removes its ${clipCount} clip${clipCount === 1 ? "" : "s"} too (Ctrl+Z brings it back)` : undefined}
                        onClick={() => {
                          setMenu(null);
                          api.edit({ type: "removeTrack", trackId: track.id });
                        }}
                      >
                        <Icon name="trash" size={13} />
                        Remove track
                      </button>
                    </div>,
                    document.body,
                  )}
                </div>
              </div>
            );
          })}
          {/* The new track a voice-over being recorded will get: an empty head (tracks are unnamed). */}
          {recording?.trackId === null && <div className="tl__head is-recording" style={{ height: ROW_PX.m }} role="group" aria-label="Voice-over" />}
          </div>
        </div>
        {/* The line between the track buttons and the clips: click it to fold the buttons away (and back). */}
        <button
          type="button"
          className="tl__heads-toggle"
          title={headsHidden ? "Show panel" : "Hide panel"}
          aria-label={headsHidden ? "Show the track buttons" : "Hide the track buttons"}
          aria-expanded={!headsHidden}
          onClick={() => {
            try {
              localStorage.setItem(HEADS_HIDDEN, headsHidden ? "0" : "1");
            } catch {
              /* not remembered: shown next time */
            }
            setHeadsHidden(!headsHidden);
          }}
        />

        <div
          ref={scrollRef}
          className="tl__scroll"
        >
          {/* A press anywhere here (a track, or the empty space above and below them) moves the playhead;
              the ruler and clips handle their own presses. */}
          <div
            ref={contentRef}
            className="tl__content"
            style={{ width: contentWidth }}
            onPointerDown={(e) => {
              onSelect(null);
              beginScrub(e);
            }}
            onPointerUp={(e) => {
              if (fxDrag.current && !(e.target as Element).closest(".tl__lane")) onDropFx(fxDrag.current, null, timeAt(e.clientX));
            }}
          >
            <div className="tl__ruler mono" style={{ "--minor": `${(step * pps) / 5}px` } as CSSProperties} onPointerDown={beginScrub}>
              {ticks.map((t) => (
                <span key={t} style={{ left: t * pps }}>
                  {formatClock(t)}
                </span>
              ))}
            </div>

            <div className="tl__lanes">
            {ghost?.newTrack &&
              (() => {
                const dragged = project.clips.find((c) => c.id === ghost.clipId);
                return (
                  dragged && (
                    <div className={`tl__new-track is-${ghost.newTrack}`} style={{ left: ghost.start * pps, width: Math.max(4, clipLength(dragged) * pps) }} aria-hidden="true">
                      New track
                    </div>
                  )
                );
              })()}
            {project.tracks.map((track) => (
              <div
                key={track.id}
                ref={(el) => {
                  if (el) laneRefs.current.set(track.id, el);
                  else laneRefs.current.delete(track.id);
                }}
                className={["tl__lane", track.id === main?.id && "is-main", track.locked && "is-locked", track.hidden && "is-hidden"].filter(Boolean).join(" ")}
                style={{ height: ROW_PX[rowSize(track, overMain(track))] }}
                onPointerUp={onMediaDrop(track)}
              >
                {project.clips
                  .filter((c) => where(c).trackId === track.id)
                  // Later clips on top, so a transition's overlap shows on the incoming clip.
                  .sort((a, b) => where(a).start - where(b).start)
                  .map((clip) => {
                    const media = project.media.find((m) => m.id === clip.mediaId);
                    const label = isBlock(clip) ? blockLabel(clip) : clip.shape ? shapeLabel(clip.shape) : (clip.text ?? media?.name ?? "Clip");
                    // With its transition selected, only the transition shows as selected (App keeps the clip as selectedId).
                    const isSelected = clip.id === selectedId && selectedTransition !== clip.id;
                    const isGhost = clip.id === ghost?.clipId;
                    const { start } = where(clip);
                    const length = clipLength(clip);
                    // Videos and pictures show their frames along the clip.
                    const picture = media?.hasVideo ? (media.source.image ? media.source.previewUrl : media.source.thumbnail) : undefined;
                    const strip = media?.hasVideo ? (strips[media.source.previewUrl] ?? (picture ? { url: picture, frames: 1 } : undefined)) : undefined;
                    // Video clips: a name bar, the frames, then a band for the sound wave.
                    const rowPx = ROW_PX[rowSize(track, overMain(track))];
                    const waveBand = media?.hasAudio && !media.source.image ? Math.max(6, Math.round(rowPx * WAVE_SHARE[track.wave ?? "m"])) : 0;
                    const classes = [
                      "tl__clip",
                      media && "is-media",
                      `is-${isBlock(clip) ? "effect" : !media ? "text" : media.hasVideo ? "video" : "audio"}`,
                      isSelected && "is-selected",
                      isGhost && "is-dragging",
                      fadeDrag?.clipId === clip.id && "is-fading",
                      trimTip?.clipId === clip.id && "is-fading",
                      media?.missing && "is-missing",
                      strip && "has-frames",
                    ].filter(Boolean);
                    return (
                      <div
                        key={clip.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                        aria-label={`${label}, ${formatClock(clip.start)} to ${formatClock(clipEnd(clip))}`}
                        className={classes.join(" ")}
                        style={{ left: start * pps, width: Math.max(4, length * pps) }}
                        onPointerDown={beginDrag(clip, "move")}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onSelect(clip.id);
                          const onClip = playback.time >= clip.start && playback.time < clipEnd(clip);
                          // Kept on screen: about 230 × 400 px.
                          const x = Math.min(e.clientX, window.innerWidth - 236);
                          const y = Math.min(e.clientY, window.innerHeight - 404);
                          setClipMenu({ clipId: clip.id, x, y, time: onClip ? playback.time : timeAt(e.clientX) });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelect(clip.id);
                          }
                        }}
                      >
                        {strip && media && (
                          <ClipFrames clip={clip} strip={strip} pps={pps} cellHeight={rowPx - 10 - LABEL_PX - waveBand} duration={media.source.image ? 0 : media.source.duration} />
                        )}
                        {clip.fadeIn > 0 && <span className="tl__fade is-in" style={{ width: clip.fadeIn * pps }} aria-hidden="true" />}
                        {clip.fadeOut > 0 && <span className="tl__fade is-out" style={{ width: clip.fadeOut * pps }} aria-hidden="true" />}
                        {overlap(clip) > 0 && clip.transition && (
                          <span
                            className={selectedTransition === clip.id ? "tl__trans is-selected" : "tl__trans"}
                            style={{ width: Math.max(14, overlap(clip) * pps) }}
                            title="Click to set it up; drag left or right to change its length"
                            onPointerDown={beginTransition(clip)}
                            aria-hidden="true"
                          >
                            <Icon name="transition" size={12} />
                            {(selectedTransition === clip.id || (fadeDrag?.clipId === clip.id && fadeDrag.edge === "trans")) && (
                              <span className="tl__fade-tip mono">
                                {TRANSITION_KINDS.find((t) => t.kind === clip.transition?.kind)?.label} {fadeLength(clip.transition.duration)}
                              </span>
                            )}
                          </span>
                        )}
                        {media?.hasAudio && !media.source.image && (
                          // Clicked (not dragged), it opens the Sound panel (onPointerUp); a fade shows as the wave itself getting smaller.
                          <div className="tl__wave-band" style={media.hasVideo ? { height: `${waveBand}px` } : undefined} title="Click for volume and sound fades">
                            <ClipWave clip={clip} media={media} bars={Math.min(1500, Math.max(8, Math.round((length * pps) / 4)))} muted={trackSilent(track)} />
                          </div>
                        )}
                        {media?.source.chapters
                          ?.filter((ch) => ch.start > clip.in + 0.2 && ch.start < clip.out - 0.2)
                          .map((ch) => {
                            const frac = (clip.reverse ? clip.out - ch.start : ch.start - clip.in) / Math.max(0.1, clip.out - clip.in);
                            return <span key={ch.start} className="tl__chapter" style={{ left: `${frac * 100}%` }} title={ch.title} />;
                          })}
                        <span className="tl__trim is-start" title="Drag to trim start" onPointerDown={beginDrag(clip, "start")} aria-hidden="true" />
                        {/* "#t=" marks a video's address (shown as a frame elsewhere), which an <img> can't draw. */}
                        {!strip && (media?.source.thumbnail || (media?.source.image && media.source.previewUrl)) && !media.source.thumbnail?.includes("#t=") && (
                          <img
                            className="tl__thumb"
                            src={media.source.thumbnail || media.source.previewUrl}
                            alt=""
                            draggable={false}
                            aria-hidden="true"
                          />
                        )}
                        <span className="tl__label">
                          <span className="tl__name truncate">
                            {isBlock(clip) && <Icon name={clip.effect ? "sparkle" : clip.look ? "blend" : "sliders"} size={12} />}
                            {/* A filter and an effect inside the clip (dropped on it): small badges in its name bar, so the
                                clip itself stays free to click; each opens its settings. */}
                            {clip.mediaId &&
                              ([
                                ["filters", "blend", LOOKS.find((l) => l.id === clip.look)?.label],
                                ["effects", "sparkle", PICTURE_EFFECTS.find((f) => f.id === clip.effect)?.label],
                              ] as const).map(
                                ([tab, icon, name]) =>
                                  name && (
                                    <button
                                      key={tab}
                                      type="button"
                                      className="tl__badge"
                                      title={`${tab === "filters" ? "Filter" : "Effect"}: ${name} (click for its settings)`}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={() => onOpenFx?.(clip.id, tab)}
                                    >
                                      <Icon name={icon} size={12} />
                                    </button>
                                  ),
                              )}
                            {media?.hasAudio && !media.source.image && clip.volume <= 0 && (
                              <button
                                type="button"
                                className="tl__badge"
                                title="Sound off: click for volume"
                                aria-label="Sound off: open the sound settings"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={() => onOpenSound?.(clip.id)}
                              >
                                <Icon name="volumeOff" size={12} />
                              </button>
                            )}
                            {media?.missing && "Missing · "}
                            {label}
                          </span>
                          {(media || isBlock(clip)) && <span className="tl__length mono">{media ? formatTimecode(length) : fadeLength(length)}</span>}
                        </span>
                        {(clip.speed !== 1 || clip.reverse) && (
                          <span className="tl__tag mono">
                            {clip.reverse ? "◀ " : ""}
                            {clip.speed !== 1 ? `${clip.speed}×` : ""}
                            {clip.smooth && clip.speed < 1 ? " smooth" : ""}
                          </span>
                        )}
                        {trimTip?.clipId === clip.id && <span className={`tl__fade-tip mono tl__trim-tip is-${trimTip.edge}`}>{fadeLength(length)}</span>}
                        <span className="tl__trim is-end" title="Drag to change duration" onPointerDown={beginDrag(clip, "end")} aria-hidden="true" />
                      </div>
                    );
                  })}
                {recording && recording.trackId === track.id && <RecordingClip recording={recording} pps={pps} />}
              </div>
            ))}
            {/* Not a real track yet: no laneRefs entry, takes no drops. */}
            {recording?.trackId === null && (
              <div className="tl__lane is-recording" style={{ height: ROW_PX.m }}>
                <RecordingClip recording={recording} pps={pps} />
              </div>
            )}
            </div>

            {coverMenu && createPortal(
              <>
                {/* Presses stop here: through the portal they'd still reach the timeline, moving the playhead. */}
                <div
                  className="tl__menu-catcher"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setCoverMenu(null);
                  }}
                />
                <div
                  className="tl__menu tl__clip-menu"
                  role="menu"
                  aria-label="Cover"
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{ position: "fixed", left: coverMenu.x, top: Math.min(coverMenu.y, window.innerHeight - 140) }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setCoverMenu(null);
                  }}
                >
                  {(
                    [
                      ["frame", "Use the frame at the playhead", "camera"],
                      ["picture", "Pick a picture…", "image"],
                      ["remove", "No cover", "x"],
                    ] as const
                  ).map(([choice, label, icon], i) => (
                    <button
                      key={choice}
                      type="button"
                      role="menuitem"
                      autoFocus={i === 0}
                      disabled={choice === "remove" && !project.cover}
                      onClick={() => {
                        setCoverMenu(null);
                        onCover(choice);
                      }}
                    >
                      <Icon name={icon} size={13} />
                      <span className="tl__menu-text">{label}</span>
                    </button>
                  ))}
                </div>
              </>,
              document.body,
            )}
            {clipMenu && (() => {
              const clip = project.clips.find((c) => c.id === clipMenu.clipId);
              if (!clip) return null;
              const track = project.tracks.find((t) => t.id === clip.trackId);
              const media = project.media.find((m) => m.id === clip.mediaId);
              return (
                <ClipMenu
                  x={clipMenu.x}
                  y={clipMenu.y}
                  clip={clip}
                  picture={Boolean(media?.hasVideo)}
                  video={Boolean(media && !media.source.image)}
                  local={Boolean(media?.source.local)}
                  locked={Boolean(track?.locked)}
                  canPaste={canPaste}
                  onPick={(command) => {
                    setClipMenu(null);
                    onClipCommand(command, clip, clipMenu.time);
                  }}
                  onClose={() => setClipMenu(null)}
                />
              );
            })()}

            <div className="tl__playhead" style={{ left: playback.time * pps }} aria-hidden="true" />
            {project.clips.length === 0 && (
              <p className="tl__empty">Drag media here from the left, or press + on a file to add it.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * A clip's sound wave. Drawn again only when the clip, its media, the zoom or mute change, not on
 * every frame of playback (a long clip has up to 1,500 bars).
 */
const ClipWave = memo(function ClipWave({ clip, media, bars, muted, height }: { clip: Clip; media: MediaItem; bars: number; muted: boolean; height?: string }) {
  return (
    <span className="tl__wave" style={height ? { height } : undefined} aria-hidden="true">
      {clipPeaks(clip, media, bars, muted).map((h, i) => (
        <span key={i} style={{ height: `${h}%` }} />
      ))}
    </span>
  );
});

/**
 * A voice-over being recorded: a red clip from where the take started to now, the microphone's wave growing inside
 * it. Not a real clip: nothing to press (CSS lets clicks through).
 */
function RecordingClip({ recording, pps }: { recording: NonNullable<TimelineEditorProps["recording"]>; pps: number }) {
  const { levels } = recording;
  const length = recording.end - recording.start;
  const width = Math.max(4, length * pps);
  // At most 1,500 bars, and no more than fit at 2 px each (1 px bar + 1 px gap, .tl__wave's grid), so the wave never
  // runs past the clip's end: neighbours merge into their loudest.
  const group = Math.ceil(levels.length / Math.min(1500, Math.max(1, Math.floor(width / 2))));
  const bars = group <= 1 ? levels : Array.from({ length: Math.ceil(levels.length / group) }, (_, i) => Math.max(...levels.slice(i * group, (i + 1) * group)));
  return (
    <div className="tl__clip is-audio is-recording" style={{ left: recording.start * pps, width }} aria-label="Voice-over, recording">
      <span className="tl__label">
        <span className="tl__name truncate">
          <span className="tl__rec-dot" aria-hidden="true" />
          Recording
        </span>
        <span className="tl__length mono">{formatTimecode(length)}</span>
      </span>
      <span className="tl__wave" aria-hidden="true">
        {bars.map((level, i) => (
          <span key={i} style={{ height: `${Math.max(4, level * 100)}%` }} />
        ))}
      </span>
    </div>
  );
}

/**
 * A video clip's frames along it: as many as fit at their own shape, each the frame
 * of the moment it sits over (so trimmed, slowed or reversed clips show the right ones). The strip
 * is set once, as a CSS variable, not copied into every frame. `duration` 0: a still picture.
 */
const ClipFrames = memo(function ClipFrames({ clip, strip, pps, cellHeight, duration }: { clip: Clip; strip: Strip; pps: number; cellHeight: number; duration: number }) {
  const cell = (Math.max(12, cellHeight) * 16) / 9;
  const count = Math.min(200, Math.max(1, Math.ceil((clipLength(clip) * pps) / cell)));
  // At most 200 frames: on a long clip zoomed in, each is wider (cropped top and bottom, not stretched) so they reach its end.
  const w = Math.max(cell, (clipLength(clip) * pps) / count);
  const frameAt = (j: number) => {
    if (strip.frames === 1 || duration <= 0) return 0;
    const t = Math.min(clip.start + ((j + 0.5) * w) / pps, clipEnd(clip));
    return Math.min(strip.frames - 1, Math.max(0, Math.floor((mediaTimeAt(clip, t) / duration) * strip.frames)));
  };
  const size = w > cell ? `${strip.frames * w}px ${(w * 9) / 16}px` : `${strip.frames * cell}px 100%`;
  return (
    <span className="tl__frames" style={{ "--strip": `url("${strip.url}")` } as CSSProperties} aria-hidden="true">
      {Array.from({ length: count }, (_, j) => (
        <span key={j} style={{ width: w, backgroundSize: size, backgroundPosition: `${-frameAt(j) * w}px center` }} />
      ))}
    </span>
  );
});

/**
 * A clip's right-click menu: copy, cut, paste, delete, Edit ▸ (freeze, reverse,
 * mirror, rotate, crop), export it, replace it, open its file. Escape or a click anywhere else closes it.
 */
function ClipMenu({
  x,
  y,
  clip,
  picture,
  video,
  local,
  locked,
  canPaste,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  clip: Clip;
  /** A picture on a video track: mirror, rotate and crop apply. */
  picture: boolean;
  /** Moving media (not a still picture or text): freeze and reverse apply. */
  video: boolean;
  /** A file on this PC: it has a folder to open. */
  local: boolean;
  /** On a locked track: only what doesn't change it. */
  locked: boolean;
  canPaste: boolean;
  onPick: (command: ClipCommand) => void;
  onClose: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  // Closing waits a moment, so the pointer can cut across the rows below on its way into the list.
  const closing = useRef(0);
  const holdEdit = (open: boolean) => {
    window.clearTimeout(closing.current);
    if (open) setEditOpen(true);
    else closing.current = window.setTimeout(() => setEditOpen(false), 350);
  };
  useEffect(() => () => window.clearTimeout(closing.current), []);
  const item =(command: ClipCommand, label: string, icon: IconName, enabled: boolean, keys?: string, checked?: boolean) => (
    <button
      key={command}
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      disabled={!enabled}
      onClick={() => onPick(command)}
    >
      <Icon name={icon} size={13} />
      <span className="tl__menu-text">{label}</span>
      {keys && <kbd>{keys}</kbd>}
    </button>
  );
  const media = Boolean(clip.mediaId);
  return createPortal(
    <>
      {/* Presses stop here: React passes them through the portal to the timeline, which would move the playhead and
          drop the selection (Paste and Freeze frame then used the wrong time). */}
      <div
        className="tl__menu-catcher"
        onPointerDown={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="tl__menu tl__clip-menu"
        role="menu"
        aria-label="Clip"
        onPointerDown={(e) => e.stopPropagation()}
        style={{ position: "fixed", left: x, top: y }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            // Up and down through the menu's buttons.
            e.preventDefault();
            const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
          }
        }}
      >
        {item("copy", "Copy", "copy", true, "Ctrl C")}
        {item("cut", "Cut", "scissors", !locked, "Ctrl X")}
        {item("paste", "Paste", "clipboard", canPaste, "Ctrl V")}
        {item("delete", "Delete", "trash", !locked, "Del")}
        <hr />
        <div className="tl__submenu" onMouseEnter={() => holdEdit(true)} onMouseLeave={() => holdEdit(false)}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={editOpen}
            disabled={locked || !(video || picture)}
            // Hovering already opened it: a click must not close it again.
            onClick={() => setEditOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") setEditOpen(true);
            }}
          >
            <Icon name="sliders" size={13} />
            <span className="tl__menu-text">Edit</span>
            <span aria-hidden="true">›</span>
          </button>
          {editOpen && (
            <div
              className="tl__menu tl__submenu-list"
              role="menu"
              aria-label="Edit"
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") setEditOpen(false);
              }}
            >
              {item("freeze", "Freeze frame", "snowflake", video && picture)}
              {item("reverse", "Reverse", "rotate", video, undefined, clip.reverse)}
              {item("mirror", "Mirror", "flip", picture, undefined, clip.mirror)}
              {item("rotate", `Rotate${clip.rotate ? ` · ${clip.rotate}°` : ""}`, "rotate", picture)}
              {item("crop", "Crop…", "crop", picture)}
            </div>
          )}
        </div>
        <hr />
        {item("export", "Export this clip", "upload", media)}
        {item("replace", "Replace clip…", "image", media && !locked)}
        {item("reveal", "Open file location", "folder", local)}
      </div>
    </>,
    document.body,
  );
}
