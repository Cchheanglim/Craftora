import type { Clip } from "../project/model";
import { layerBox } from "../project/layerBox";

/** The Image editor's painting tools: Brush (B), Eraser (E), Paint bucket and Gradient (G / Shift+G), Eyedropper (I). */
export type PaintTool = "brush" | "eraser" | "bucket" | "gradient" | "eyedropper";
export const PAINT_TOOLS: readonly string[] = ["brush", "eraser", "bucket", "gradient", "eyedropper"] satisfies PaintTool[];

/** Brush and Eraser: `size` is the tip's width in the picture's pixels; the rest go 0..1. */
export interface BrushSettings {
  size: number;
  /** 1 = a hard edge, 0 = soft all the way from the middle. */
  hardness: number;
  /** The most one stroke covers, however often it goes over a spot. */
  opacity: number;
  /** How much each dab adds (going over a spot again in the same stroke builds up to `opacity`). */
  flow: number;
}

export interface BucketSettings {
  /** How different a colour may be from the clicked one and still fill (0..255, per channel). */
  tolerance: number;
  /** Only the area joined to the clicked pixel; off = every matching pixel of the layer. */
  contiguous: boolean;
  opacity: number;
}

export interface GradientSettings {
  kind: "linear" | "radial";
  /** Foreground to background colour, or foreground to see-through. */
  to: "background" | "clear";
  opacity: number;
}

export interface PaintSettings {
  brush: BrushSettings;
  eraser: BrushSettings;
  bucket: BucketSettings;
  gradient: GradientSettings;
}

export const PAINT_START: PaintSettings = {
  brush: { size: 30, hardness: 0.8, opacity: 1, flow: 1 },
  eraser: { size: 50, hardness: 0.8, opacity: 1, flow: 1 },
  bucket: { tolerance: 32, contiguous: true, opacity: 1 },
  gradient: { kind: "linear", to: "background", opacity: 1 },
};
/** The brush tip's least and greatest width (picture pixels). */
export const BRUSH_MIN = 1;
export const BRUSH_MAX = 1000;

/** Foreground and background colours (#rrggbb): brush, bucket and gradient paint with them. */
export interface PaintColours {
  fg: string;
  bg: string;
}
export const COLOURS_START: PaintColours = { fg: "#000000", bg: "#ffffff" };

/** A 2D affine map, as DOMMatrix's a..f: (x, y) → (a·x + c·y + e, b·x + d·y + f). */
export type Affine = readonly [number, number, number, number, number, number];
type Point = readonly [number, number];

/** `m` after `n`: apply `n` first, then `m` (DOMMatrix `m.multiply(n)`). */
export function multiply(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
const chain = (...ms: Affine[]) => ms.reduce(multiply);
const translate = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];
const scale = (sx: number, sy: number): Affine => [sx, 0, 0, sy, 0, 0];
/** Turned clockwise on screen (y down), as canvas `rotate` and CSS `rotate` turn. */
const rotate = (deg: number): Affine => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
};
/** Mirrored left-right about the line x = `cx`. */
const mirrorX = (cx: number): Affine => [-1, 0, 0, 1, 2 * cx, 0];

export function invert(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export function apply(m: Affine, [x, y]: Point): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** How many of the picture's pixels one pixel of the mapped thing covers (the map's scale, same both ways). */
export const scaleOf = (m: Affine) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

type Placed = Pick<Clip, "size" | "x" | "y" | "crop" | "rotate" | "fill" | "shape" | "aspect" | "mirror" | "angle">;

/**
 * A photo layer's own pixel → the picture's pixel (`W` × `H`), as compose.ts `drawPicture` draws it and the preview
 * shows it: the crop window, the layer's mirror, the Mirror effect (`effectMirror`), the quarter turn, the box, then
 * `angle` about the box's middle. `natural` = the photo file's size.
 */
export function photoToImage(clip: Placed, natural: { width: number; height: number }, W: number, H: number, effectMirror = false): Affine {
  const box = layerBox(clip, natural.width / natural.height, W, H);
  const [bw, bh] = [box.width, box.height];
  const turn = clip.rotate ?? 0;
  const [iw, ih] = turn === 90 || turn === 270 ? [bh, bw] : [bw, bh];
  const { left, top, right, bottom } = clip.crop;
  const [pw, ph] = [iw / (1 - left - right), ih / (1 - top - bottom)];
  const [px, py] = [(-left / (1 - left - right)) * iw, (-top / (1 - top - bottom)) * ih];
  // The photo in its crop window (iw × ih), mirrored as a whole picture, then the window mirrored by the effect.
  let m = chain(translate(px, py), scale(pw / natural.width, ph / natural.height));
  if (clip.mirror) m = multiply(mirrorX(px + pw / 2), m);
  if (effectMirror) m = multiply(mirrorX(iw / 2), m);
  // The window turned a quarter in the box, then the box placed and turned about its middle.
  m = chain(translate(bw / 2, bh / 2), rotate(turn), translate(-iw / 2, -ih / 2), m);
  return chain(translate(box.left + bw / 2, box.top + bh / 2), rotate(clip.angle ?? 0), translate(-bw / 2, -bh / 2), m);
}

/**
 * Brush dabs from `from` to `to`, one every `spacing` px. `carry` = how far the pointer went since the last dab (0 right
 * after one); returns the dabs and the new carry for the next piece of the stroke.
 */
export function dabsAlong(from: Point, to: Point, spacing: number, carry: number): { dabs: [number, number][]; carry: number } {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const dabs: [number, number][] = [];
  let at = spacing - carry;
  for (; at <= length; at += spacing) {
    const t = at / length;
    dabs.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
  return { dabs, carry: carry + length - dabs.length * spacing };
}

/** Dabs every quarter of the tip's width (at least every pixel). */
export const dabSpacing = (diameter: number) => Math.max(1, diameter / 4);

/**
 * Where a tip of `hardness` is solid (alpha 1) and where it fades to nothing: gradient stops from the middle (0) to the
 * edge (1). A hard tip is solid to its edge; a soft one eases out from `hardness` of the way.
 */
export function tipStops(hardness: number): [number, number][] {
  const h = Math.min(0.99, Math.max(0, hardness));
  return [0, 0.25, 0.5, 0.75, 1].map((k) => [h + (1 - h) * k, 1 - k * k * (3 - 2 * k)]);
}

/** "#rrggbb" → [r, g, b]. */
export const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const hexOf = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * The paint bucket: which pixels of an RGBA image (`w` × `h`) a click at (`x`, `y`) fills, 1 per filled pixel. A pixel
 * fills when every channel is within `tolerance` of the clicked one (any two see-through pixels match); `contiguous`
 * keeps it to the area joined to the click (4 neighbours, a scanline fill: no recursion, any size).
 */
export function floodMask(data: Uint8ClampedArray, w: number, h: number, x: number, y: number, tolerance: number, contiguous: boolean): Uint8Array {
  const mask = new Uint8Array(w * h);
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return mask;
  const s = (y * w + x) * 4;
  const [r, g, b, a] = [data[s], data[s + 1], data[s + 2], data[s + 3]];
  const like = (i: number) => {
    const o = i * 4;
    if (a === 0 && data[o + 3] === 0) return true;
    return Math.abs(data[o] - r) <= tolerance && Math.abs(data[o + 1] - g) <= tolerance && Math.abs(data[o + 2] - b) <= tolerance && Math.abs(data[o + 3] - a) <= tolerance;
  };
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (like(i)) mask[i] = 1;
    return mask;
  }
  const stack = [x, y];
  while (stack.length) {
    const sy = stack.pop()!;
    const sx = stack.pop()!;
    const row = sy * w;
    if (mask[row + sx] || !like(row + sx)) continue;
    let l = sx;
    let r2 = sx;
    while (l > 0 && !mask[row + l - 1] && like(row + l - 1)) l--;
    while (r2 < w - 1 && !mask[row + r2 + 1] && like(row + r2 + 1)) r2++;
    mask.fill(1, row + l, row + r2 + 1);
    // One seed per run of matching pixels above and below the filled span.
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let open = false;
      for (let nx = l; nx <= r2; nx++) {
        const fits = !mask[nrow + nx] && like(nrow + nx);
        if (fits && !open) stack.push(nx, ny);
        open = fits;
      }
    }
  }
  return mask;
}
