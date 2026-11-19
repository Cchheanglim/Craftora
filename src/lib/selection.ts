/**
 * Image editor selections, like a photo editor's: which part of the picture the painting tools, Delete, Fill, New layer
 * from selection and the layer mask act on. One grey grid over the whole picture (255 = selected, 0 = not, between =
 * partly, from soft edges and Feather), at the picture's pixel size up to `maskSize`'s cap. Shapes come in picture px.
 */
import { maskAffine, maskSize, type MaskBox } from "./mask";
import { floodMask, multiply, type Affine } from "./paint";

export interface Selection {
  width: number;
  height: number;
  data: Uint8Array;
}

/** New = replace, Add (Shift), Subtract (Alt), Intersect (Shift+Alt). */
export type SelectMode = "new" | "add" | "subtract" | "intersect";

export type SelectTool = "marquee" | "ellipse" | "lasso" | "polygon" | "wand";
export const SELECT_TOOLS: readonly string[] = ["marquee", "ellipse", "lasso", "polygon", "wand"] satisfies SelectTool[];

/** The selection tools' options bar. `feather` in picture px, applied to each new shape; wand `tolerance` 0..255. */
export interface SelectSettings {
  mode: SelectMode;
  feather: number;
  tolerance: number;
  contiguous: boolean;
}
export const SELECT_START: SelectSettings = { mode: "new", feather: 0, tolerance: 32, contiguous: true };

type Pt = [number, number];

/** The grid size for a `W` × `H` picture. */
export const gridOf = (W: number, H: number) => maskSize(W, H);

export function emptySelection(W: number, H: number): Selection {
  const { width, height } = gridOf(W, H);
  return { width, height, data: new Uint8Array(width * height) };
}

export function selectAll(W: number, H: number): Selection {
  const sel = emptySelection(W, H);
  sel.data.fill(255);
  return sel;
}

export const isEmpty = (sel: Selection | null) => !sel || !sel.data.some((v) => v > 0);

/** The rectangle from corner `a` to corner `b`, as a polygon. */
export const rectPoints = (a: Pt, b: Pt): Pt[] => [a, [b[0], a[1]], b, [a[0], b[1]]];

/** The ellipse inside the rectangle from `a` to `b`, as a polygon. */
export function ellipsePoints(a: Pt, b: Pt, steps = 360): Pt[] {
  const [cx, cy, rx, ry] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2];
  return Array.from({ length: steps }, (_, i) => {
    const t = (i / steps) * 2 * Math.PI;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as Pt;
  });
}

/**
 * A closed polygon (picture px, any shape, crossing itself fills even-odd) on a `W` × `H` picture's grid, with smooth
 * edges: 4 sample rows per grid row, exact cover across each row.
 */
export function polygonSelection(W: number, H: number, points: readonly Pt[]): Selection {
  const sel = emptySelection(W, H);
  const { width: gw, height: gh, data } = sel;
  if (points.length < 3) return sel;
  const [kx, ky] = [gw / W, gh / H];
  const pts = points.map(([x, y]) => [x * kx, y * ky]);
  const ys = pts.map((p) => p[1]);
  const [y0, y1] = [Math.max(0, Math.floor(Math.min(...ys))), Math.min(gh, Math.ceil(Math.max(...ys)))];
  const acc = new Float32Array(gw);
  const xs: number[] = [];
  for (let j = y0; j < y1; j++) {
    acc.fill(0);
    for (let sub = 0; sub < 4; sub++) {
      const yc = j + (sub + 0.5) / 4;
      xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const [p, q] = [pts[i], pts[(i + 1) % pts.length]];
        if (p[1] <= yc !== q[1] <= yc) xs.push(p[0] + ((yc - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
      }
      xs.sort((m, n) => m - n);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const [a, b] = [Math.max(0, xs[i]), Math.min(gw, xs[i + 1])];
        if (b <= a) continue;
        const [ia, ib] = [Math.floor(a), Math.floor(b)];
        if (ia === ib) acc[ia] += b - a;
        else {
          acc[ia] += ia + 1 - a;
          for (let k = ia + 1; k < ib; k++) acc[k] += 1;
          if (ib < gw) acc[ib] += b - ib;
        }
      }
    }
    for (let x = 0; x < gw; x++) if (acc[x] > 0) data[j * gw + x] = Math.round(Math.min(1, acc[x] / 4) * 255);
  }
  return sel;
}

/** A new shape joined to the selection so far (null = nothing selected). */
export function combine(base: Selection | null, shape: Selection, mode: SelectMode): Selection | null {
  if (mode === "new" || (!base && mode === "add")) return isEmpty(shape) ? null : shape;
  if (!base || base.width !== shape.width || base.height !== shape.height) return mode === "add" ? shape : null;
  const out = new Uint8Array(base.data.length);
  const [a, b] = [base.data, shape.data];
  for (let i = 0; i < out.length; i++) out[i] = mode === "add" ? Math.max(a[i], b[i]) : mode === "subtract" ? Math.min(a[i], 255 - b[i]) : Math.min(a[i], b[i]);
  const sel = { width: base.width, height: base.height, data: out };
  return isEmpty(sel) ? null : sel;
}

export function invertSelection(sel: Selection): Selection {
  return { ...sel, data: sel.data.map((v) => 255 - v) };
}

/** One pass of a box blur `r` grid px wide each way, along rows (`step` 1) or columns (`step` = width); edges repeat. */
function boxPass(src: Float32Array, dst: Float32Array, lines: number, length: number, lineStep: number, step: number, r: number) {
  const n = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    const at = (i: number) => src[base + Math.min(length - 1, Math.max(0, i)) * step];
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += at(i);
    for (let i = 0; i < length; i++) {
      dst[base + i * step] = sum / n;
      sum += at(i + r + 1) - at(i - r);
    }
  }
}

/** Soft edges `radius` picture px wide (three box blurs ≈ a Gaussian of that size), on a `W`-wide picture. */
export function featherSelection(sel: Selection, radius: number, W: number): Selection {
  const r = Math.round(radius * (sel.width / W));
  if (r < 1) return sel;
  const { width: w, height: h } = sel;
  const a = Float32Array.from(sel.data);
  const b = new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    boxPass(a, b, h, w, w, 1, r);
    boxPass(b, a, w, h, 1, w, r);
  }
  return { width: w, height: h, data: Uint8Array.from(a, (v) => Math.round(v)) };
}

/**
 * Grows (`by` > 0) or shrinks (`by` < 0) the selection by `by` picture px, with rounded corners (a 3-4 chamfer distance
 * from the half-selected line). The result has hard edges.
 */
export function expandSelection(sel: Selection, by: number, W: number): Selection {
  const r = Math.abs(by) * (sel.width / W);
  if (r < 0.5) return sel;
  const grow = by > 0;
  const { width: w, height: h } = sel;
  const far = 1e9;
  // Distance (×3) from each pixel to the nearest pixel that counts as "in" (in = selected when growing, unselected when shrinking).
  const d = new Float64Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = sel.data[i] >= 128 === grow ? 0 : far;
  const near = (i: number, x: number, y: number, dx: number, dy: number, cost: number) => {
    const [nx, ny] = [x + dx, y + dy];
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) d[i] = Math.min(d[i], d[ny * w + nx] + cost);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      near(i, x, y, -1, 0, 3), near(i, x, y, 0, -1, 3), near(i, x, y, -1, -1, 4), near(i, x, y, 1, -1, 4);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      near(i, x, y, 1, 0, 3), near(i, x, y, 0, 1, 3), near(i, x, y, 1, 1, 4), near(i, x, y, -1, 1, 4);
    }
  const limit = r * 3;
  return { width: w, height: h, data: Uint8Array.from(d, (v) => (v <= limit === grow ? 255 : 0)) };
}

/** The selection moved `dx`, `dy` picture px on a `W` × `H` picture; what goes past the edges is lost. */
export function moveSelection(sel: Selection, dx: number, dy: number, W: number, H: number): Selection {
  const { width: w, height: h } = sel;
  const [gx, gy] = [Math.round(dx * (w / W)), Math.round(dy * (h / H))];
  const out = new Uint8Array(w * h);
  for (let y = Math.max(0, gy); y < Math.min(h, h + gy); y++) out.set(sel.data.subarray((y - gy) * w + Math.max(0, -gx), (y - gy) * w + Math.min(w, w - gx)), y * w + Math.max(0, gx));
  return { width: w, height: h, data: out };
}

/** The smallest box around everything selected, in picture px (null = nothing). */
export function selectionBounds(sel: Selection, W: number, H: number): { left: number; top: number; width: number; height: number } | null {
  const { width: w, height: h, data } = sel;
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  if (x1 < 0) return null;
  const [kx, ky] = [W / w, H / h];
  return { left: x0 * kx, top: y0 * ky, width: (x1 + 1 - x0) * kx, height: (y1 + 1 - y0) * ky };
}

/**
 * The selection's outline (where it crosses half-selected) as an SVG path in its own grid px, `width` × `height` for the
 * viewBox. Drawn on a grid of at most `maxSide` px so a speckled magic-wand pick stays quick to draw.
 */
export function outlinePath(sel: Selection, maxSide = 2048): { d: string; width: number; height: number } {
  const f = Math.max(1, Math.ceil(Math.max(sel.width, sel.height) / maxSide));
  const [w, h] = [Math.ceil(sel.width / f), Math.ceil(sel.height / f)];
  const on = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) on[y * w + x] = sel.data[Math.min(sel.height - 1, y * f + (f >> 1)) * sel.width + Math.min(sel.width - 1, x * f + (f >> 1))] >= 128 ? 1 : 0;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? on[y * w + x] : 0);
  // Each selected pixel's sides that face an unselected one, as edges going clockwise round it (vertex = y·(w+1)+x),
  // then joined into closed loops so the ants run on without a break; corners only where the line turns.
  const V = w + 1;
  const next = new Map<number, number[]>();
  const edge = (a: number, b: number) => {
    const out = next.get(a);
    if (out) out.push(b);
    else next.set(a, [b]);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!on[y * w + x]) continue;
      if (!at(x, y - 1)) edge(y * V + x, y * V + x + 1);
      if (!at(x + 1, y)) edge(y * V + x + 1, (y + 1) * V + x + 1);
      if (!at(x, y + 1)) edge((y + 1) * V + x + 1, (y + 1) * V + x);
      if (!at(x - 1, y)) edge((y + 1) * V + x, y * V + x);
    }
  const parts: string[] = [];
  const xy = (v: number) => `${v % V} ${Math.floor(v / V)}`;
  for (const start of next.keys()) {
    if (!next.has(start)) continue;
    let [cur, dir] = [start, 0];
    let d = `M${xy(start)}`;
    do {
      const out = next.get(cur)!;
      const to = out.pop()!;
      if (!out.length) next.delete(cur);
      if (dir && to - cur !== dir) d += `L${xy(cur)}`;
      [dir, cur] = [to - cur, to];
    } while (cur !== start && next.has(cur));
    parts.push(`${d}Z`);
  }
  return { d: parts.join(""), width: w, height: h };
}

/**
 * Magic wand: the pixels like the clicked one in `rgba` (the picture drawn at the selection's grid size, `width` ×
 * `height` as `gridOf` gives), clicked at (`x`, `y`) picture px on a `W` × `H` picture.
 */
export function wandSelection(rgba: Uint8ClampedArray, width: number, height: number, x: number, y: number, W: number, H: number, tolerance: number, contiguous: boolean): Selection {
  const hit = floodMask(rgba, width, height, x * (width / W), y * (height / H), tolerance, contiguous);
  return { width, height, data: hit.map((v) => v * 255) };
}

/** A selection from an RGBA image's alpha (`rgba` = the picture's grid size): see-through = not selected. */
export function selectionFromAlpha(rgba: Uint8ClampedArray, width: number, height: number): Selection {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
  return { width, height, data };
}

/** The selection as a canvas the grid's size: black, as opaque as it's selected (for `destination-in` and masks). */
export function selectionCanvas(sel: Selection): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = sel.width;
  canvas.height = sel.height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(sel.width, sel.height);
  for (let i = 0; i < sel.data.length; i++) img.data[i * 4 + 3] = sel.data[i];
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * The selection over a layer's own pixels (`w` × `h`; `toLayer` = picture px → layer px, as PaintSurface's sessions
 * have), as a canvas that size: opaque where selected. Painting, Delete and Fill keep to it with `destination-in`.
 */
export function selectionInLayer(sel: Selection, W: number, H: number, toLayer: Affine, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d")!;
  const m = multiply(toLayer, [W / sel.width, 0, 0, H / sel.height, 0, 0]);
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(selectionCanvas(sel), 0, 0);
  return canvas;
}

/** `paint` (a canvas the layer's size) kept to the selection `inLayer` (from `selectionInLayer`), in place. */
export function keepTo(paint: HTMLCanvasElement, inLayer: HTMLCanvasElement | undefined) {
  if (!inLayer) return paint;
  const ctx = paint.getContext("2d")!;
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(inLayer, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return paint;
}

/** A layer mask (PNG data URL) over `box` (the layer's mask box) that shows the selected part and hides the rest. */
export function selectionMask(sel: Selection, W: number, H: number, box: MaskBox): string {
  const size = maskSize(box.width, box.height);
  const keep = selectionInLayer(sel, W, H, maskAffine(box, size), size.width, size.height);
  const white = document.createElement("canvas");
  [white.width, white.height] = [size.width, size.height];
  const w = white.getContext("2d")!;
  w.fillStyle = "#ffffff";
  w.fillRect(0, 0, size.width, size.height);
  keepTo(white, keep);
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [size.width, size.height];
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(white, 0, 0);
  return canvas.toDataURL("image/png");
}
