import type { KeyboardEvent, PointerEvent } from "react";

/** How narrow and wide the left sidebar and the right panel can be dragged. */
export const SIDE_WIDTH = { min: 220, max: 400, usual: 232 };
export const PANEL_WIDTH = { min: 320, max: 560, usual: 340 };
/** What the middle (preview, timeline, pages) keeps however wide the two sides are dragged. */
export const MIDDLE_ROOM = 600;

/** `width` for one side, no wider than leaves the middle its room next to the other side (`other`). */
export const roomFor = (width: number, other: number, limits: { min: number }) =>
  Math.max(limits.min, Math.min(width, window.innerWidth - other - MIDDLE_ROOM));

/**
 * The grab strip on the inner edge of the left sidebar (`edge` "right") or the right panel
 * (`edge` "left"): drag it, or use the arrow keys, to make that panel wider or narrower.
 */
export function EdgeResizer({
  edge,
  width,
  limits,
  label,
  onResize,
}: {
  edge: "left" | "right";
  width: number;
  limits: { min: number; max: number };
  label: string;
  onResize: (width: number) => void;
}) {
  const fit = (w: number) => Math.round(Math.min(limits.max, Math.max(limits.min, w)));
  // Moving right widens the sidebar (its right edge) and narrows the right panel (its left edge).
  const sign = edge === "right" ? 1 : -1;
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const bar = e.currentTarget;
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("is-dragging");
    const [startX, start] = [e.clientX, width];
    const move = (ev: globalThis.PointerEvent) => onResize(fit(start + sign * (ev.clientX - startX)));
    const end = () => {
      bar.classList.remove("is-dragging");
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", end);
      bar.removeEventListener("pointercancel", end);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
  };
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 16 : e.key === "ArrowLeft" ? -16 : 0;
    if (!step) return;
    e.preventDefault();
    onResize(fit(width + sign * step));
  };
  return (
    <div
      className={`app__edge ${edge === "right" ? "is-side" : "is-panel"}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      tabIndex={0}
      onPointerDown={drag}
      onKeyDown={nudge}
    />
  );
}
