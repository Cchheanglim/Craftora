import { memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { TRANSITION_KINDS, clipEnd, clipLength, clipPeaks, isBlock, mediaTimeAt, trackLabel, trackOrder, trackSilent, transitionLength, type Clip, type MediaItem, type Project, type Track, type TrackKind, type TrackSize } from "../project/model";
import { blockLabel, type FxItem } from "../project/effects";
import { fitsTrack, packedTrack, slotOn } from "../project/actions";
import type { ProjectApi } from "../project/useProject";
import type { Playback } from "../project/usePlayback";
import { formatClock } from "../lib/timecode";
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
const MIN_PPS = 2;
const MAX_PPS = 400;
/** Pixels the pointer must travel before a press on a clip becomes a drag. */
const DRAG_THRESHOLD = 3;

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
  /** A filter, effect or transition dropped on track `trackId` at `time`. */
  onDropFx: (item: FxItem, trackId: string, time: number) => void;
  /** A pick from a clip's right-click menu; `time`: the playhead if it's on the clip, else where it was clicked. */
  onClipCommand: (command: ClipCommand, clip: Clip, time: number) => void;
  /** Something has been copied, so Paste can put it at the playhead. */
  canPaste: boolean;
  /** Cover on the main track: from the frame at the playhead, a picture, or none. */
  onCover: (choice: "frame" | "picture" | "remove") => void;
}

/** What a clip's right-click menu can do (App `clipCommand` does it). */
export type ClipCommand = "copy" | "cut" | "paste" | "delete" | "freeze" | "reverse" | "mirror" | "rotate" | "crop" | "export" | "replace" | "reveal";

type DragMode = "move" | "start" | "end";

/** What the pointer is doing between press and release. */
type Gesture =
  | { kind: "scrub" }
  | { kind: "clip"; clipId: string; mode: DragMode; originX: number; originStart: number; originEdge: number; moved: boolean };

/** Where a clip being moved is drawn; the project only changes on release. */
interface Ghost {
  clipId: string;
  start: number;
  trackId: string;
}

const TRACK_ICON: Record<Track["kind"], IconName> = { video: "film", audio: "music", text: "text", effect: "sparkle" };

/** Track height and waveform size choices (the header's … menu). */
const SIZES: { size: TrackSize; label: string }[] = [
  { size: "s", label: "Small" },
  { size: "m", label: "Medium" },
  { size: "l", label: "Large" },
];
const ROW_PX: Record<TrackSize, number> = { s: 28, m: 44, l: 72 };
/** A track's row height when it was changed in its menu (each kind has its usual one in the CSS). */
const rowStyle = (t: Track) => (t.height ? { height: ROW_PX[t.height] } : undefined);
const WAVE_HEIGHT: Record<TrackSize, string> = { s: "22%", m: "42%", l: "78%" };

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
  onDropFx,
  onClipCommand,
  canPaste,
  onCover,
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
  // 0 until measured, so the first automatic fit uses the real width.
  const [viewWidth, setViewWidth] = useState(0);
  const [fitted, setFitted] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
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
  const mainTrack = [...project.tracks].reverse().find((t) => t.kind === "video");
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

  // Track the visible width for "fit" and the content width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewWidth(el.clientWidth));
    observer.observe(el);
    setViewWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const fit = () => setPps(Math.min(MAX_PPS, Math.max(MIN_PPS, (viewWidth - 40) / Math.max(duration * 1.5, 15))));

  // Fit the first time something lands on the timeline.
  useEffect(() => {
    if (!fitted && duration > 0 && viewWidth > 0) {
      fit();
      setFitted(true);
    }
    if (duration === 0) setFitted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, viewWidth]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playback.playing) return;
    const x = playback.time * pps;
    if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 80;
    else if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
  }, [playback.time, playback.playing, pps]);

  const contentWidth = Math.max(viewWidth, (Math.max(duration, 10) + 10) * pps);
  const timeAt = (clientX: number) => {
    const rect = contentRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left) / pps);
  };
  const getTimeAt = (clientX: number, g: Extract<Gesture, { kind: "clip" }>) =>
    contentRef.current ? timeAt(clientX) : g.originEdge + (clientX - g.originX) / pps;

  /** Snaps to the playhead and to other clips' edges when within a few pixels. */
  const snap = (t: number, ignore: string) => {
    const targets = [0, playback.time];
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
  const onPointerUp = useRef<() => void>(() => {});

  onPointerMove.current = (e) => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.kind === "scrub") {
      playback.seek(timeAt(e.clientX));
      return;
    }
    const dx = e.clientX - g.originX;
    if (!g.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD && !laneChanged(g.clipId, e.clientY)) return;
      g.moved = true;
      // Trims change the project live; moves only on release (see onPointerUp).
      if (g.mode !== "move") api.checkpoint();
    }
    const dt = dx / pps;
    const clip = project.clips.find((c) => c.id === g.clipId);
    if (!clip) return;
    if (g.mode === "move") {
      let start = g.originStart + dt;
      // Snap either edge of the clip.
      const snappedStart = snap(start, clip.id);
      const snappedEnd = snap(start + clipLength(clip), clip.id) - clipLength(clip);
      start = Math.abs(snappedStart - start) <= Math.abs(snappedEnd - start) ? snappedStart : snappedEnd;
      // A video can also go on an audio track (just its sound); otherwise clips keep their kind.
      const lane = project.tracks.find((t) => t.id === laneAt(e.clientY));
      const trackId = lane && !lane.locked && fitsTrack(project, clip, lane) ? lane.id : (ghostRef.current?.trackId ?? clip.trackId);
      setGhost({ clipId: clip.id, start: Math.max(0, start), trackId });
    } else {
      const scroller = scrollRef.current;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (e.clientX > r.right - 36) scroller.scrollLeft += 14;
        else if (e.clientX < r.left + 36) scroller.scrollLeft = Math.max(0, scroller.scrollLeft - 14);
      }
      api.editLive({ type: "trimClip", clipId: clip.id, edge: g.mode, time: snap(getTimeAt(e.clientX, g), clip.id) });
    }
  };

  onPointerUp.current = () => {
    const g = gestureRef.current;
    gestureRef.current = null;
    setScrubbing(false);
    if (!g || g.kind !== "clip" || !g.moved) return;
    const final = ghostRef.current;
    setGhost(null);
    if (g.mode === "move" && final) {
      api.edit({ type: "moveClip", clipId: final.clipId, start: final.start, trackId: final.trackId });
    }
    api.editLive({ type: "settle" });
  };

  const laneChanged = (clipId: string, clientY: number) => {
    const clip = project.clips.find((c) => c.id === clipId);
    const lane = laneAt(clientY);
    return Boolean(clip && lane && lane !== clip.trackId);
  };

  const startGesture = (g: Gesture) => {
    gestureRef.current = g;
    const move = (e: PointerEvent) => onPointerMove.current(e);
    const up = () => {
      onPointerUp.current();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const beginDrag = (clip: Clip, mode: DragMode) => (e: ReactPointerEvent<HTMLElement>) => {
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
    });
  };

  /** Press on the ruler, the playhead or empty track space: move the playhead and follow the pointer. */
  const beginScrub = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    playback.pause();
    playback.seek(timeAt(e.clientX));
    setScrubbing(true);
    startGesture({ kind: "scrub" });
  };

  const onMediaDrop = (track: Track) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (track.locked) return;
    const mediaId = mediaDrag.current;
    if (mediaId) api.edit({ type: "addClip", clipId: crypto.randomUUID(), mediaId, trackId: track.id, at: timeAt(e.clientX) });
    else if (fxDrag.current) onDropFx(fxDrag.current, track.id, timeAt(e.clientX));
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
  if (ghost) {
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
  /** Seconds a clip on a magnetic track overlaps the one before it (its transition). */
  const overlap = (c: Clip) => {
    if (ghost || !isMagnetic(c.trackId)) return 0;
    const order = trackOrder(project, c.trackId);
    const i = order.findIndex((o) => o.id === c.id);
    return i > 0 ? transitionLength(order[i - 1], c) : 0;
  };
  const addTrack = (kind: TrackKind) => {
    setAddOpen(false);
    api.edit({ type: "addTrack", trackId: `${kind}-${crypto.randomUUID().slice(0, 8)}`, kind });
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
        <div
          className="tl__add"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setAddOpen(false);
          }}
        >
          <button
            type="button"
            className="btn btn--ghost"
            aria-expanded={addOpen}
            aria-haspopup="menu"
            title="Add a track"
            onClick={() => setAddOpen((o) => !o)}
          >
            <Icon name="plus" size={14} />
            Track
          </button>
          {addOpen && (
            <div className="tl__menu" role="menu">
              {(["video", "audio", "text"] as TrackKind[]).map((kind) => (
                <button key={kind} type="button" role="menuitem" onClick={() => addTrack(kind)} autoFocus={kind === "video"}>
                  <Icon name={TRACK_ICON[kind]} size={13} />
                  {kind === "video" ? "Video track" : kind === "audio" ? "Audio track" : "Text track"}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="tl__zoom">
          <button type="button" className="btn btn--icon" aria-label="Zoom out" onClick={() => setPps((p) => Math.max(MIN_PPS, p / 1.5))}>
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
        <div className="tl__heads">
          <div className="tl__ruler-spacer" />
          {project.tracks.map((track) => {
            const clipCount = project.clips.filter((c) => c.trackId === track.id).length;
            const name = trackLabel(project, track);
            const hasSound = track.kind === "video" || track.kind === "audio";
            const menuOpen = menu?.trackId === track.id;
            return (
              <div key={track.id} className={`tl__head is-${track.kind}`} style={rowStyle(track)} role="group" aria-label={name}>
                {track.id === mainTrack?.id ? (
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
                    <span>Cover</span>
                  </button>
                ) : (
                  <span className="tl__head-gap" aria-hidden="true" />
                )}
                {track.id === mainTrack?.id && <span className="tl__head-gap" aria-hidden="true" />}
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
                  title={
                    track.hidden
                      ? "Hidden from the preview and the export. Click to show."
                      : track.kind === "video"
                        ? "Hide its pictures (the sound still plays)"
                        : track.kind === "audio"
                          ? "Turn this track off: left out of the preview and the export"
                          : "Hide this track"
                  }
                  onClick={() => api.edit({ type: "updateTrack", trackId: track.id, patch: { hidden: !track.hidden || undefined } })}
                >
                  <Icon name={track.hidden ? "eyeOff" : "eye"} size={12} />
                </button>
                <button
                  type="button"
                  className="tl__head-btn"
                  aria-pressed={Boolean(track.muted)}
                  aria-label={track.muted ? `Unmute ${name}` : `Mute ${name}`}
                  title={!hasSound ? `${track.kind === "text" ? "Text" : "Effects"} have no sound` : track.muted ? "Track is muted. Click to unmute." : "Mute this track"}
                  disabled={!hasSound}
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
                            aria-checked={(track.height ?? "m") === size}
                            autoFocus={(track.height ?? "m") === size}
                            onClick={() => api.edit({ type: "updateTrack", trackId: track.id, patch: { height: size === "m" ? undefined : size } })}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {hasSound && (
                        <>
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
                        </>
                      )}
                      {track.kind !== "effect" && (
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
                      )}
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
        </div>

        <div
          ref={scrollRef}
          className="tl__scroll"
          onWheel={(e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            setPps((p) => Math.min(MAX_PPS, Math.max(MIN_PPS, p * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
          }}
        >
          <div ref={contentRef} className="tl__content" style={{ width: contentWidth }}>
            <div className="tl__ruler mono" onPointerDown={beginScrub}>
              {ticks.map((t) => (
                <span key={t} style={{ left: t * pps }}>
                  {formatClock(t)}
                </span>
              ))}
            </div>

            {project.tracks.map((track) => (
              <div
                key={track.id}
                ref={(el) => {
                  if (el) laneRefs.current.set(track.id, el);
                  else laneRefs.current.delete(track.id);
                }}
                className={["tl__lane", `is-${track.kind}`, track.locked && "is-locked", track.hidden && "is-hidden"].filter(Boolean).join(" ")}
                style={rowStyle(track)}
                onPointerDown={(e) => {
                  onSelect(null);
                  beginScrub(e);
                }}
                onPointerUp={onMediaDrop(track)}
              >
                {project.clips
                  .filter((c) => where(c).trackId === track.id)
                  // Later clips on top, so a transition's overlap shows on the incoming clip.
                  .sort((a, b) => where(a).start - where(b).start)
                  .map((clip) => {
                    const media = project.media.find((m) => m.id === clip.mediaId);
                    const label = isBlock(clip) ? blockLabel(clip) : (clip.text ?? media?.name ?? "Clip");
                    const isSelected = clip.id === selectedId;
                    const isGhost = clip.id === ghost?.clipId;
                    const { start } = where(clip);
                    const length = clipLength(clip);
                    // Pictures on a video track show their frames along the clip.
                    const picture = media && track.kind === "video" ? (media.source.image ? media.source.previewUrl : media.source.thumbnail) : undefined;
                    const strip = media && track.kind === "video" ? (strips[media.source.previewUrl] ?? (picture ? { url: picture, frames: 1 } : undefined)) : undefined;
                    const classes = [
                      "tl__clip",
                      `is-${track.kind}`,
                      isSelected && "is-selected",
                      isGhost && "is-dragging",
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
                          <ClipFrames clip={clip} strip={strip} pps={pps} cellHeight={ROW_PX[track.height ?? "m"] - 10} duration={media.source.image ? 0 : media.source.duration} />
                        )}
                        {clip.fadeIn > 0 && <span className="tl__fade is-in" style={{ width: clip.fadeIn * pps }} aria-hidden="true" />}
                        {clip.fadeOut > 0 && <span className="tl__fade is-out" style={{ width: clip.fadeOut * pps }} aria-hidden="true" />}
                        {overlap(clip) > 0 && (
                          <span
                            className="tl__trans"
                            style={{ width: overlap(clip) * pps }}
                            title={TRANSITION_KINDS.find((t) => t.kind === clip.transition?.kind)?.label}
                            aria-hidden="true"
                          />
                        )}
                        {media?.hasAudio && !media.source.image && (
                          <ClipWave clip={clip} media={media} bars={Math.min(1500, Math.max(8, Math.round((length * pps) / 4)))} muted={trackSilent(track)} height={track.wave && WAVE_HEIGHT[track.wave]} />
                        )}
                        {media?.source.chapters
                          ?.filter((ch) => ch.start > clip.in + 0.2 && ch.start < clip.out - 0.2)
                          .map((ch) => {
                            const frac = (clip.reverse ? clip.out - ch.start : ch.start - clip.in) / Math.max(0.1, clip.out - clip.in);
                            return <span key={ch.start} className="tl__chapter" style={{ left: `${frac * 100}%` }} title={ch.title} />;
                          })}
                        <span className="tl__trim is-start" title="Drag to trim start" onPointerDown={beginDrag(clip, "start")} aria-hidden="true" />
                        {!strip && (media?.source.thumbnail || (media?.source.image && media.source.previewUrl)) && (
                          <img
                            className="tl__thumb"
                            src={media.source.thumbnail || media.source.previewUrl}
                            alt=""
                            draggable={false}
                            aria-hidden="true"
                          />
                        )}
                        <span className="tl__label truncate">
                          {media?.missing && "Missing · "}
                          {label}
                          {media && <span className="tl__length mono">{formatClock(length)}</span>}
                        </span>
                        {(clip.speed !== 1 || clip.reverse) && (
                          <span className="tl__tag mono" aria-hidden="true">
                            {clip.reverse ? "◀ " : ""}
                            {clip.speed !== 1 ? `${clip.speed}×` : ""}
                          </span>
                        )}
                        <span className="tl__trim is-end" title="Drag to change duration" onPointerDown={beginDrag(clip, "end")} aria-hidden="true" />
                      </div>
                    );
                  })}
              </div>
            ))}

            {coverMenu && createPortal(
              <>
                <div className="tl__menu-catcher" onPointerDown={() => setCoverMenu(null)} />
                <div
                  className="tl__menu tl__clip-menu"
                  role="menu"
                  aria-label="Cover"
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
                  picture={track?.kind === "video" && Boolean(media)}
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

            <div
              className="tl__playhead"
              style={{ left: playback.time * pps }}
              onPointerDown={beginScrub}
              title="Drag to move through the video (← → step, Shift for seconds)"
              aria-hidden="true"
            />
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
 * A video clip's frames along it: as many as fit at their own shape, each the frame
 * of the moment it sits over (so trimmed, slowed or reversed clips show the right ones). The strip
 * is set once, as a CSS variable, not copied into every frame. `duration` 0: a still picture.
 */
const ClipFrames = memo(function ClipFrames({ clip, strip, pps, cellHeight, duration }: { clip: Clip; strip: Strip; pps: number; cellHeight: number; duration: number }) {
  const cell = (Math.max(12, cellHeight) * 16) / 9;
  const count = Math.min(200, Math.max(1, Math.ceil((clipLength(clip) * pps) / cell)));
  const frameAt = (j: number) => {
    if (strip.frames === 1 || duration <= 0) return 0;
    const t = Math.min(clip.start + ((j + 0.5) * cell) / pps, clipEnd(clip));
    return Math.min(strip.frames - 1, Math.max(0, Math.floor((mediaTimeAt(clip, t) / duration) * strip.frames)));
  };
  return (
    <span className="tl__frames" style={{ "--strip": `url("${strip.url}")` } as CSSProperties} aria-hidden="true">
      {Array.from({ length: count }, (_, j) => (
        <span key={j} style={{ width: cell, backgroundSize: `${strip.frames * cell}px 100%`, backgroundPosition: `${-frameAt(j) * cell}px 0` }} />
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
      <div
        className="tl__menu-catcher"
        onPointerDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="tl__menu tl__clip-menu"
        role="menu"
        aria-label="Clip"
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
