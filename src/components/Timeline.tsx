import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { Range } from "../types";
import { formatClock, formatTimecode } from "../lib/timecode";
import "./Timeline.css";

/** Shortest clip the handles allow, in seconds. */
export const MIN_CLIP = 0.5;

const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

interface TimelineProps {
  duration: number;
  range: Range;
  playhead: number;
  onSeek: (seconds: number) => void;
  onRangeChange: (range: Range) => void;
}

type Drag = "scrub" | "start" | "end";

export function Timeline({ duration, range, playhead, onSeek, onRangeChange }: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);

  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const apply = (drag: Drag, t: number) => {
    if (drag === "scrub") onSeek(t);
    else if (drag === "start") onRangeChange({ start: Math.min(t, range.end - MIN_CLIP), end: range.end });
    else onRangeChange({ start: range.start, end: Math.max(t, range.start + MIN_CLIP) });
  };

  const begin = (drag: Drag) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = drag;
    trackRef.current!.setPointerCapture(e.pointerId);
    apply(drag, timeAt(e.clientX));
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) apply(dragRef.current, timeAt(e.clientX));
  };

  const end = () => {
    dragRef.current = null;
  };

  const nudge = (which: "start" | "end") => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const current = which === "start" ? range.start : range.end;
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = current - step;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = current + step;
    if (e.key === "Home") next = which === "start" ? 0 : range.start + MIN_CLIP;
    if (e.key === "End") next = which === "end" ? duration : range.end - MIN_CLIP;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    apply(which, Math.min(duration, Math.max(0, next)));
  };

  const step = RULER_STEPS.find((s) => duration / s <= 8) ?? 3600;
  const ticks: number[] = [];
  for (let t = 0; t < duration - step * 0.35; t += step) ticks.push(t);

  return (
    <div className="timeline">
      <div
        ref={trackRef}
        className="timeline__track"
        onPointerDown={begin("scrub")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {ticks.map((t) => (
          <span key={t} className="timeline__grid" style={{ left: `${pct(t)}%` }} aria-hidden="true" />
        ))}
        <span className="timeline__shade" style={{ left: 0, width: `${pct(range.start)}%` }} aria-hidden="true" />
        <span className="timeline__shade" style={{ left: `${pct(range.end)}%`, right: 0 }} aria-hidden="true" />
        <span
          className="timeline__range"
          style={{ left: `${pct(range.start)}%`, width: `${pct(range.end - range.start)}%` }}
          aria-hidden="true"
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label="In point"
          aria-valuemin={0}
          aria-valuemax={Math.round(range.end - MIN_CLIP)}
          aria-valuenow={Math.round(range.start)}
          aria-valuetext={formatTimecode(range.start)}
          className="timeline__handle timeline__handle--in"
          style={{ left: `${pct(range.start)}%` }}
          onPointerDown={begin("start")}
          onKeyDown={nudge("start")}
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Out point"
          aria-valuemin={Math.round(range.start + MIN_CLIP)}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(range.end)}
          aria-valuetext={formatTimecode(range.end)}
          className="timeline__handle timeline__handle--out"
          style={{ left: `${pct(range.end)}%` }}
          onPointerDown={begin("end")}
          onKeyDown={nudge("end")}
        />
        <span className="timeline__playhead" style={{ left: `${pct(playhead)}%` }} aria-hidden="true" />
      </div>

      <div className="timeline__ruler mono" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ left: `${pct(t)}%` }}>
            {formatClock(t)}
          </span>
        ))}
        <span className="timeline__ruler-end">{formatClock(duration)}</span>
      </div>
    </div>
  );
}
