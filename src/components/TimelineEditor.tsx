import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { TRANSITION_KINDS, clipEnd, clipLength, trackOrder, transitionLength, type Clip, type Project, type Track, type TrackKind } from "../project/model";
import { fitsTrack, packedTrack, slotOn } from "../project/actions";
import type { ProjectApi } from "../project/useProject";
import type { Playback } from "../project/usePlayback";
import { formatClock } from "../lib/timecode";
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
export function beginMediaDrag(mediaId: string, e: ReactPointerEvent) {
  const [x, y] = [e.clientX, e.clientY];
  const move = (ev: PointerEvent) => {
    if (mediaDrag.current || Math.hypot(ev.clientX - x, ev.clientY - y) < 4) return;
    mediaDrag.current = mediaId;
    document.body.classList.add("is-dragging-media");
  };
  // Lanes read `mediaDrag` in their own pointerup, which runs before this window listener.
  const end = () => {
    mediaDrag.current = null;
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
  onDelete: () => void;
  onAddText: () => void;
}

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

const TRACK_ICON: Record<Track["kind"], IconName> = { video: "film", audio: "music", text: "text" };

export function TimelineEditor({
  project,
  api,
  playback,
  duration,
  selectedId,
  onSelect,
  onSplit,
  onDuplicate,
  onDelete,
  onAddText,
}: TimelineEditorProps) {
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

  // Track the visible width for "fit" and the content width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewWidth(el.clientWidth));
    observer.observe(el);
    setViewWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const fit = () => setPps(Math.min(MAX_PPS, Math.max(MIN_PPS, (viewWidth - 40) / Math.max(duration, 5))));

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
      const trackId = lane && fitsTrack(project, clip, lane) ? lane.id : (ghostRef.current?.trackId ?? clip.trackId);
      setGhost({ clipId: clip.id, start: Math.max(0, start), trackId });
    } else {
      api.editLive({ type: "trimClip", clipId: clip.id, edge: g.mode, time: snap(g.originEdge + dt, clip.id) });
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
    if (e.button !== 0) return;
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
    const mediaId = mediaDrag.current;
    if (mediaId) api.edit({ type: "addClip", clipId: crypto.randomUUID(), mediaId, trackId: track.id, at: timeAt(e.clientX) });
  };

  const step = RULER_STEPS.find((s) => s * pps >= 70) ?? 3600;
  const ticks: number[] = [];
  for (let t = 0; t * pps < contentWidth; t += step) ticks.push(t);

  const selected = project.clips.find((c) => c.id === selectedId);
  const canSplit = selected && playback.time > selected.start && playback.time < clipEnd(selected);

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
    <section className={scrubbing ? "tl is-scrubbing" : "tl"} aria-label="Timeline">
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
            return (
              <div key={track.id} className={`tl__head is-${track.kind}`}>
                <Icon name={TRACK_ICON[track.kind]} size={13} />
                <span className="truncate">{track.name}</span>
                <button
                  type="button"
                  className="tl__head-btn"
                  aria-pressed={Boolean(track.magnetic)}
                  aria-label={`Magnet for ${track.name}`}
                  title={
                    track.magnetic
                      ? "Magnet on: clips stay back to back and can have transitions. Click to turn off."
                      : "Magnet off: clips go anywhere. Click to keep them back to back."
                  }
                  onClick={() => api.edit({ type: "setMagnetic", trackId: track.id, magnetic: !track.magnetic })}
                >
                  <Icon name="magnet" size={12} />
                </button>
                <button
                  type="button"
                  className="tl__head-btn"
                  aria-label={`Remove ${track.name}`}
                  title={
                    clipCount
                      ? `Remove ${track.name} and its ${clipCount} clip${clipCount === 1 ? "" : "s"} (Ctrl+Z brings it back)`
                      : `Remove ${track.name}`
                  }
                  onClick={() => api.edit({ type: "removeTrack", trackId: track.id })}
                >
                  <Icon name="x" size={12} />
                </button>
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
                className={`tl__lane is-${track.kind}`}
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
                    const label = clip.text ?? media?.name ?? "Clip";
                    const isSelected = clip.id === selectedId;
                    const isGhost = clip.id === ghost?.clipId;
                    const { start } = where(clip);
                    const length = clipLength(clip);
                    const classes = [
                      "tl__clip",
                      `is-${track.kind}`,
                      isSelected && "is-selected",
                      isGhost && "is-dragging",
                      media?.missing && "is-missing",
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
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelect(clip.id);
                          }
                        }}
                      >
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
                        <span className="tl__trim is-start" onPointerDown={beginDrag(clip, "start")} aria-hidden="true" />
                        <span className="tl__label truncate">
                          {media?.missing && "Missing · "}
                          {label}
                        </span>
                        {(clip.speed !== 1 || clip.reverse) && (
                          <span className="tl__tag mono" aria-hidden="true">
                            {clip.reverse ? "◀ " : ""}
                            {clip.speed !== 1 ? `${clip.speed}×` : ""}
                          </span>
                        )}
                        <span className="tl__trim is-end" onPointerDown={beginDrag(clip, "end")} aria-hidden="true" />
                      </div>
                    );
                  })}
              </div>
            ))}

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
