import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { clipEnd, clipLength, type Clip, type Project, type Track } from "../project/model";
import type { ProjectApi } from "../project/useProject";
import type { Playback } from "../project/usePlayback";
import { formatClock } from "../lib/timecode";
import { Icon, type IconName } from "./Icon";
import "./TimelineEditor.css";

/** Drag-and-drop type for media dragged from the library. */
export const MEDIA_DRAG_TYPE = "application/x-craftora-media";

const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const SNAP_PX = 7;
const MIN_PPS = 2;
const MAX_PPS = 400;

interface TimelineEditorProps {
  project: Project;
  api: ProjectApi;
  playback: Playback;
  duration: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSplit: () => void;
  onDelete: () => void;
  onAddText: () => void;
}

type DragMode = "move" | "start" | "end";

interface Drag {
  clipId: string;
  mode: DragMode;
  originX: number;
  originStart: number;
  originEdge: number;
  moved: boolean;
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
  onDelete,
  onAddText,
}: TimelineEditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const laneRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<Drag | null>(null);
  const scrubbing = useRef(false);
  const [pps, setPps] = useState(40);
  // 0 until measured, so the first automatic fit uses the real width.
  const [viewWidth, setViewWidth] = useState(0);
  const [fitted, setFitted] = useState(false);

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

  const beginDrag = (clip: Clip, mode: DragMode) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(clip.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      clipId: clip.id,
      mode,
      originX: e.clientX,
      originStart: clip.start,
      originEdge: mode === "end" ? clipEnd(clip) : clip.start,
      moved: false,
    };
  };

  const onDragMove = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.originX;
    if (!drag.moved) {
      if (Math.abs(dx) < 3) return;
      drag.moved = true;
      api.checkpoint();
    }
    const dt = dx / pps;
    const clip = project.clips.find((c) => c.id === drag.clipId);
    if (!clip) return;
    if (drag.mode === "move") {
      let start = drag.originStart + dt;
      // Snap either edge of the clip.
      const snappedStart = snap(start, clip.id);
      const snappedEnd = snap(start + clipLength(clip), clip.id) - clipLength(clip);
      start = Math.abs(snappedStart - start) <= Math.abs(snappedEnd - start) ? snappedStart : snappedEnd;
      api.editLive({ type: "moveClip", clipId: clip.id, start, trackId: laneAt(e.clientY) });
    } else {
      api.editLive({ type: "trimClip", clipId: clip.id, edge: drag.mode, time: snap(drag.originEdge + dt, clip.id) });
    }
  };

  const endDrag = () => {
    if (dragRef.current?.moved) api.editLive({ type: "settle" });
    dragRef.current = null;
  };

  const scrub = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    scrubbing.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    playback.seek(timeAt(e.clientX));
  };

  const onDrop = (track: Track) => (e: DragEvent<HTMLDivElement>) => {
    const mediaId = e.dataTransfer.getData(MEDIA_DRAG_TYPE);
    if (!mediaId) return;
    e.preventDefault();
    api.edit({ type: "addClip", clipId: crypto.randomUUID(), mediaId, trackId: track.id, at: timeAt(e.clientX) });
  };

  const step = RULER_STEPS.find((s) => s * pps >= 70) ?? 3600;
  const ticks: number[] = [];
  for (let t = 0; t * pps < contentWidth; t += step) ticks.push(t);

  const selected = project.clips.find((c) => c.id === selectedId);
  const canSplit = selected && playback.time > selected.start && playback.time < clipEnd(selected);

  return (
    <section className="tl" aria-label="Timeline">
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
        <button type="button" className="btn btn--ghost" title="Delete the selected clip (Delete)" onClick={onDelete} disabled={!selected}>
          <Icon name="trash" size={14} />
          Delete
        </button>
        <span className="tl__sep" aria-hidden="true" />
        <button type="button" className="btn btn--ghost" title="Add text at the playhead (T)" onClick={onAddText}>
          <Icon name="text" size={14} />
          Text
        </button>
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
          {project.tracks.map((track) => (
            <div key={track.id} className={`tl__head is-${track.kind}`}>
              <Icon name={TRACK_ICON[track.kind]} size={13} />
              <span className="truncate">{track.name}</span>
            </div>
          ))}
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
            <div
              className="tl__ruler mono"
              onPointerDown={scrub}
              onPointerMove={(e) => scrubbing.current && playback.seek(timeAt(e.clientX))}
              onPointerUp={() => (scrubbing.current = false)}
            >
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
                  if (e.button !== 0) return;
                  onSelect(null);
                  playback.seek(timeAt(e.clientX));
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) e.preventDefault();
                }}
                onDrop={onDrop(track)}
              >
                {project.clips
                  .filter((c) => c.trackId === track.id)
                  .map((clip) => {
                    const media = project.media.find((m) => m.id === clip.mediaId);
                    const label = clip.text ?? media?.name ?? "Clip";
                    const isSelected = clip.id === selectedId;
                    return (
                      <div
                        key={clip.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                        aria-label={`${label}, ${formatClock(clip.start)} to ${formatClock(clipEnd(clip))}`}
                        className={`tl__clip is-${track.kind}${isSelected ? " is-selected" : ""}`}
                        style={{ left: clip.start * pps, width: Math.max(4, clipLength(clip) * pps) }}
                        onPointerDown={beginDrag(clip, "move")}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelect(clip.id);
                          }
                        }}
                      >
                        <span
                          className="tl__trim is-start"
                          onPointerDown={beginDrag(clip, "start")}
                          onPointerMove={onDragMove}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          aria-hidden="true"
                        />
                        <span className="tl__label truncate">{label}</span>
                        <span
                          className="tl__trim is-end"
                          onPointerDown={beginDrag(clip, "end")}
                          onPointerMove={onDragMove}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          aria-hidden="true"
                        />
                      </div>
                    );
                  })}
              </div>
            ))}

            <span className="tl__playhead" style={{ left: playback.time * pps }} aria-hidden="true" />
            {project.clips.length === 0 && (
              <p className="tl__empty">Drag media here from the left, or press + on a file to add it.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
