import { type Crop } from "./model";

/**
 * The crop window's maths (components/CropDialog.tsx): a clip's crop as a box over its upright picture (before mirror
 * and rotate, as the export crops), in fractions of the picture's width and height, and the box's moves and resizes,
 * always inside the picture and keeping at least `MIN_KEEP` of it each way.
 */
export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The least of the picture a crop keeps, each way (the export checks the same: project.rs). */
export const MIN_KEEP = 0.05;

/** A corner or side of the box being dragged. */
export type CropHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** The crop window's shape buttons: `ratio` is width / height on screen, null for any shape, "picture" for the clip's own. */
export const CROP_RATIOS: { id: string; label: string; ratio: number | "picture" | null }[] = [
  { id: "free", label: "Free", ratio: null },
  { id: "picture", label: "Original", ratio: "picture" },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10_000) / 10_000;

export function boxOf(c: Crop): CropBox {
  return { x: c.left, y: c.top, w: 1 - c.left - c.right, h: 1 - c.top - c.bottom };
}

/** The crop for `b`, rounded, and kept inside the picture. */
export function cropOf(b: CropBox): Crop {
  const w = clamp(b.w, MIN_KEEP, 1);
  const h = clamp(b.h, MIN_KEEP, 1);
  const x = clamp(b.x, 0, 1 - w);
  const y = clamp(b.y, 0, 1 - h);
  return { left: round(x), top: round(y), right: round(Math.max(0, 1 - x - w)), bottom: round(Math.max(0, 1 - y - h)) };
}

/**
 * A screen shape (width / height) as the box's own `w / h` in fractions, on a picture `picture` wide per unit high
 * (e.g. 16:9 on a 16:9 video is 1). Null stays null (any shape).
 */
export function boxRatio(ratio: number | "picture" | null, picture: number): number | null {
  if (ratio === null) return null;
  return ratio === "picture" ? 1 : ratio / picture;
}

/** `b` moved by `dx`, `dy` (fractions), stopping at the picture's edges. */
export function moveBox(b: CropBox, dx: number, dy: number): CropBox {
  return { ...b, x: clamp(b.x + dx, 0, 1 - b.w), y: clamp(b.y + dy, 0, 1 - b.h) };
}

/**
 * `b` with `handle` dragged by `dx`, `dy` (fractions): the opposite side or corner stays put. With `ratio` (the box's
 * own w / h, from `boxRatio`), the shape is kept: a corner follows the pointer's larger pull, a side grows the other way
 * about the middle. Always inside the picture and at least `MIN_KEEP` each way.
 */
export function resizeBox(b: CropBox, handle: CropHandle, dx: number, dy: number, ratio: number | null = null): CropBox {
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  // The edges that stay.
  const right = b.x + b.w;
  const bottom = b.y + b.h;
  let x = b.x;
  let y = b.y;
  let w = b.w;
  let h = b.h;
  if (west) {
    x = clamp(b.x + dx, 0, right - MIN_KEEP);
    w = right - x;
  }
  if (east) w = clamp(b.w + dx, MIN_KEEP, 1 - b.x);
  if (north) {
    y = clamp(b.y + dy, 0, bottom - MIN_KEEP);
    h = bottom - y;
  }
  if (south) h = clamp(b.h + dy, MIN_KEEP, 1 - b.y);
  if (ratio === null) return { x, y, w, h };

  // The shape kept: the size the pointer asks for, then as large as fits from the anchor.
  const corner = (west || east) && (north || south);
  if (corner) {
    if (w / ratio > h) h = w / ratio;
    else w = h * ratio;
  } else if (west || east) h = w / ratio;
  else w = h * ratio;
  // Room from what stays: the opposite edge for a dragged side, the middle for the other way.
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const roomW = west ? right : east ? 1 - b.x : 2 * Math.min(cx, 1 - cx);
  const roomH = north ? bottom : south ? 1 - b.y : 2 * Math.min(cy, 1 - cy);
  const fit = Math.min(1, roomW / w, roomH / h);
  w *= fit;
  h *= fit;
  // At least MIN_KEEP each way, in the shape (the smaller side sets it).
  const grow = Math.max(1, MIN_KEEP / w, MIN_KEEP / h);
  w = Math.min(w * grow, 1);
  h = Math.min(h * grow, 1);
  x = west ? right - w : east ? b.x : clamp(cx - w / 2, 0, 1 - w);
  y = north ? bottom - h : south ? b.y : clamp(cy - h / 2, 0, 1 - h);
  return { x, y, w, h };
}

/** The largest box of shape `ratio` (box w / h) inside the picture, centred on `b`'s middle as far as it can be. */
export function fitRatio(b: CropBox, ratio: number): CropBox {
  const w = ratio >= 1 ? 1 : ratio;
  const h = ratio >= 1 ? 1 / ratio : 1;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}
