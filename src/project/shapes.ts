/**
 * Shapes (the right panel's Shapes tab): vector paths in a 0..100 × 0..100 box, drawn as a
 * full-frame SVG in the preview and rasterised to a full-frame PNG for the export so both
 * show the exact same picture.
 */
import { BLOCK_LENGTH } from "./effects";
import { NO_CROP, type Clip } from "./model";

export const SHAPES = [
  { id: "rect", label: "Rectangle", path: "M 0 0 H 100 V 100 H 0 Z" },
  {
    id: "rounded-rect",
    label: "Rounded rectangle",
    path: "M 20 0 H 80 A 20 20 0 0 1 100 20 V 80 A 20 20 0 0 1 80 100 H 20 A 20 20 0 0 1 0 80 V 20 A 20 20 0 0 1 20 0 Z",
  },
  { id: "circle", label: "Circle", path: "M 50 0 A 50 50 0 1 1 50 100 A 50 50 0 1 1 50 0 Z" },
  { id: "triangle", label: "Triangle", path: "M 50 4 L 100 96 H 0 Z" },
  { id: "right-triangle", label: "Right triangle", path: "M 0 0 L 100 100 H 0 Z" },
  { id: "diamond", label: "Diamond", path: "M 50 0 L 100 50 L 50 100 L 0 50 Z" },
  { id: "pentagon", label: "Pentagon", path: "M 50 2 L 99 38 L 80 96 H 20 L 1 38 Z" },
  { id: "hexagon", label: "Hexagon", path: "M 25 5 H 75 L 100 50 L 75 95 H 25 L 0 50 Z" },
  { id: "octagon", label: "Octagon", path: "M 29 0 H 71 L 100 29 V 71 L 71 100 H 29 L 0 71 V 29 Z" },
  { id: "parallelogram", label: "Parallelogram", path: "M 22 10 H 100 L 78 90 H 0 Z" },
  { id: "trapezoid", label: "Trapezoid", path: "M 20 12 H 80 L 100 88 H 0 Z" },
  { id: "star", label: "Star", path: "M 50 2 L 62 36 L 98 37 L 69 59 L 79 94 L 50 73 L 21 94 L 31 59 L 2 37 L 38 36 Z" },
  {
    id: "sparkle",
    label: "Sparkle",
    path: "M 50 0 C 54 34 66 46 100 50 C 66 54 54 66 50 100 C 46 66 34 54 0 50 C 34 46 46 34 50 0 Z",
  },
  {
    id: "heart",
    label: "Heart",
    path: "M 50 22 C 38 2 4 4 4 34 C 4 60 50 84 50 96 C 50 84 96 60 96 34 C 96 4 62 2 50 22 Z",
  },
  { id: "crescent", label: "Crescent", path: "M 68 6 A 46 46 0 1 0 68 94 A 36 38 0 1 1 68 6 Z" },
  { id: "lightning", label: "Lightning", path: "M 58 2 L 16 56 H 48 L 38 98 L 84 42 H 52 Z" },
  { id: "drop", label: "Drop", path: "M 50 4 C 50 4 86 44 86 62 A 36 36 0 1 1 14 62 C 14 44 50 4 50 4 Z" },
  {
    id: "cloud",
    label: "Cloud",
    path: "M 25 80 A 19 19 0 0 1 22 43 A 24 24 0 0 1 68 35 A 21 21 0 0 1 88 56 A 18 18 0 0 1 76 80 Z",
  },
  {
    id: "ring",
    label: "Ring",
    path: "M 50 0 A 50 50 0 1 1 50 100 A 50 50 0 1 1 50 0 Z M 50 24 A 26 26 0 1 0 50 76 A 26 26 0 1 0 50 24 Z",
  },
  { id: "semicircle", label: "Semicircle", path: "M 0 75 A 50 50 0 0 1 100 75 Z" },
  { id: "plus", label: "Plus", path: "M 34 0 H 66 V 34 H 100 V 66 H 66 V 100 H 34 V 66 H 0 V 34 H 34 Z" },
  {
    id: "cross",
    label: "Cross",
    path: "M 20 4 L 50 34 L 80 4 L 96 20 L 66 50 L 96 80 L 80 96 L 50 66 L 20 96 L 4 80 L 34 50 L 4 20 Z",
  },
  { id: "check", label: "Check mark", path: "M 4 54 L 18 40 L 40 62 L 82 18 L 96 32 L 40 90 Z" },
  { id: "arrow", label: "Arrow", path: "M 0 34 H 56 V 14 L 100 50 L 56 86 V 66 H 0 Z" },
  {
    id: "double-arrow",
    label: "Double arrow",
    path: "M 0 50 L 32 18 V 36 H 68 V 18 L 100 50 L 68 82 V 64 H 32 V 82 Z",
  },
  { id: "chevron", label: "Chevron", path: "M 22 6 L 42 6 L 82 50 L 42 94 L 22 94 L 62 50 Z" },
  {
    id: "speech",
    label: "Speech bubble",
    path: "M 20 8 H 80 A 16 16 0 0 1 96 24 V 60 A 16 16 0 0 1 80 76 H 42 L 18 96 V 76 H 20 A 16 16 0 0 1 4 60 V 24 A 16 16 0 0 1 20 8 Z",
  },
  { id: "square-speech", label: "Square speech bubble", path: "M 4 8 H 96 V 74 H 44 L 18 96 V 74 H 4 Z" },
  {
    id: "thought",
    label: "Thought bubble",
    path: "M 26 68 A 16 16 0 0 1 24 37 A 21 21 0 0 1 64 30 A 18 18 0 0 1 82 48 A 15 15 0 0 1 72 68 Z M 26 76 A 6 6 0 1 1 26 88 A 6 6 0 1 1 26 76 Z M 14 88 A 4 4 0 1 1 14 96 A 4 4 0 1 1 14 88 Z",
  },
  { id: "line", label: "Line", path: "M 0 50 L 100 50", line: true },
  { id: "arrow-line", label: "Arrow line", path: "M 0 50 L 96 50 M 72 22 L 98 50 L 72 78", line: true },
] as const satisfies readonly { id: string; label: string; path: string; line?: boolean }[];

export type ShapeId = (typeof SHAPES)[number]["id"];

export const shapeLabel = (id?: string) => SHAPES.find((s) => s.id === id)?.label ?? "Shape";

/** A shape clip's bounding box in frame pixels (`W` × `H`). */
export function shapeBox(
  clip: Partial<Pick<Clip, "size" | "aspect" | "x" | "y">>,
  W: number,
  H: number,
): { left: number; top: number; width: number; height: number } {
  const width = (clip.size ?? 0.25) * W;
  const height = width * (clip.aspect ?? 1);
  const left = (W - width) * (clip.x ?? 0.5);
  const top = (H - height) * (clip.y ?? 0.5);
  return { left, top, width, height };
}

/** Whole-frame SVG document for a shape clip on a `W` × `H` frame. */
export function shapeSvg(
  clip: Partial<Pick<Clip, "shape" | "color" | "size" | "aspect" | "x" | "y" | "opacity" | "outline" | "rotate">>,
  W: number,
  H: number,
): string {
  const def = SHAPES.find((s) => s.id === clip.shape) ?? SHAPES[0];
  const { left, top, width: w, height: h } = shapeBox(clip, W, H);
  const cx = left + w / 2;
  const cy = top + h / 2;
  const angle = Number.isFinite(clip.rotate) ? clip.rotate! : 0;
  const opacity = Math.min(1, Math.max(0, clip.opacity ?? 1));
  // Only #rrggbb may go into the SVG attribute; anything else falls back to white.
  const color = clip.color && /^#[0-9a-fA-F]{6}$/.test(clip.color) ? clip.color : "#ffffff";
  const stroked = Boolean((clip.outline && clip.outline > 0) || def.line);
  const paint = stroked
    ? `fill="none" stroke="${color}" stroke-width="${(clip.outline && clip.outline > 0 ? clip.outline : 0.01) * H}" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"`
    : `fill="${color}" fill-rule="evenodd"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><g transform="translate(${cx} ${cy}) rotate(${angle}) translate(${-w / 2} ${-h / 2}) scale(${w / 100} ${h / 100})" opacity="${opacity}"><path d="${def.path}" ${paint} /></g></svg>`;
}

/** Rasterises `shapeSvg` onto a `W` × `H` canvas as a PNG data URL (undefined on failure). */
export function shapePng(
  clip: Partial<Pick<Clip, "shape" | "color" | "size" | "aspect" | "x" | "y" | "opacity" | "outline" | "rotate">>,
  W: number,
  H: number,
): Promise<string | undefined> {
  if (typeof Image === "undefined" || typeof document === "undefined") return Promise.resolve(undefined);
  const svg = shapeSvg(clip, W, H);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        canvas.getContext("2d")!.drawImage(img, 0, 0, W, H);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(undefined);
      }
    };
    img.onerror = () => resolve(undefined);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** A new shape clip with its default look and size when dropped on the timeline. */
export function newShapeClip(id: string, shape: ShapeId, start = 0, length = BLOCK_LENGTH, trackId = ""): Clip {
  const line = Boolean(SHAPES.find((s) => s.id === shape)?.line);
  return {
    id,
    trackId,
    shape,
    start,
    in: 0,
    out: length,
    speed: 1,
    volume: 1,
    mirror: false,
    reverse: false,
    rotate: 0,
    fadeIn: 0,
    fadeOut: 0,
    crop: NO_CROP,
    color: "#ffffff",
    size: line ? 0.4 : 0.25,
    aspect: line ? 0.12 : 1,
    x: 0.5,
    y: 0.5,
    opacity: 1,
    outline: 0,
  };
}
