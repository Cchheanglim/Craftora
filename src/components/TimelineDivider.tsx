import type { KeyboardEvent, PointerEvent } from "react";

/** The timeline keeps its tools, the ruler and one track; it never takes more than this share of the editor. */
const MIN_HEIGHT = 110;
const MAX_SHARE = 0.75;

/**
 * The bar between the preview and the timeline (the element right after it): drag it, or use
 * the arrow keys, to make the timeline taller and the preview smaller, or the other way round.
 */
export function TimelineDivider({ height, onResize }: { height: number | null; onResize: (height: number) => void }) {
  const fit = (bar: HTMLElement, h: number) => Math.round(Math.min(Math.max(h, MIN_HEIGHT), (bar.parentElement?.clientHeight ?? h) * MAX_SHARE));
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    const bar = e.currentTarget;
    const timeline = bar.nextElementSibling as HTMLElement | null;
    if (e.button !== 0 || !timeline) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const [startY, start] = [e.clientY, timeline.offsetHeight];
    const move = (ev: globalThis.PointerEvent) => onResize(fit(bar, start - (ev.clientY - startY)));
    const end = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", end);
      bar.removeEventListener("pointercancel", end);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
  };
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowUp" ? 16 : e.key === "ArrowDown" ? -16 : 0;
    const timeline = e.currentTarget.nextElementSibling as HTMLElement | null;
    if (!step || !timeline) return;
    e.preventDefault();
    onResize(fit(e.currentTarget, timeline.offsetHeight + step));
  };
  return (
    <div
      className="app__divider"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Preview and timeline size"
      aria-valuenow={height ?? undefined}
      title="Drag to resize the preview and the timeline"
      tabIndex={0}
      onPointerDown={drag}
      onKeyDown={nudge}
    />
  );
}
