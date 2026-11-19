import type { Clip } from "./model";
import { shapeBox } from "./shapes";

/** A layer's box on a `W` × `H` image, in pixels. */
export interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Placed = Pick<Clip, "size" | "x" | "y" | "crop" | "rotate" | "fill" | "shape" | "aspect">;

/** A picture's shape on screen (width / height) after its crop and quarter turn; `picture` is the file's own. */
function shownAspect(clip: Placed, picture: number) {
  const { left, top, right, bottom } = clip.crop;
  const upright = (picture * (1 - left - right)) / (1 - top - bottom);
  return clip.rotate === 90 || clip.rotate === 270 ? 1 / upright : upright;
}

/** Width of a size-1 picture as a share of the image width (Preview's `PictureLayer`: fit, or cover with `fill`). */
function fitWidth(clip: Pick<Clip, "fill">, aspect: number, W: number, H: number) {
  const wider = aspect >= W / H;
  return clip.fill ? (wider ? aspect / (W / H) : 1) : wider ? 1 : aspect / (W / H);
}

/** Where a picture or shape layer sits; `picture` = the picture file's width / height (unused for shapes). */
export function layerBox(clip: Placed, picture: number, W: number, H: number): PixelBox {
  if (clip.shape) return shapeBox(clip, W, H);
  const aspect = clip.aspect ? 1 / clip.aspect : shownAspect(clip, picture);
  const width = W * fitWidth(clip, aspect, W, H) * clip.size;
  const height = width / aspect;
  return { left: (W - width) * clip.x, top: (H - height) * clip.y, width, height };
}

// x/y are shares of the free space; with none (exactly as wide as the image) any x draws the same, so keep the old one.
export const share = (offset: number, free: number, old: number) => (Math.abs(free) < 1e-9 ? old : offset / free);

/**
 * The clip fields that put a layer at `box`, within what the Edit sliders allow (the export refuses a picture bigger than
 * the image fits). Pictures keep their current shape (the height follows the width); shapes take both sides.
 */
export function placeAt(clip: Placed, picture: number, W: number, H: number, box: PixelBox): Partial<Clip> {
  if (clip.shape) {
    const size = clamp(box.width / W, 0.02, 2);
    const aspect = clamp(box.height / (size * W), 0.05, 5);
    const [width, height] = [size * W, size * W * aspect];
    return { size, aspect, x: share(box.left, W - width, clip.x), y: share(box.top, H - height, clip.y) };
  }
  const aspect = clip.aspect ? 1 / clip.aspect : shownAspect(clip, picture);
  const fit = W * fitWidth(clip, aspect, W, H);
  const size = clamp(box.width / fit, 0.01, 1);
  const [width, height] = [size * fit, (size * fit) / aspect];
  return { size, x: share(box.left, W - width, clip.x), y: share(box.top, H - height, clip.y) };
}

const MIN_PICTURE = 0.1;
const MIN_ASPECT = 0.05;
const MAX_ASPECT = 5;

/**
 * New `size`, `aspect`, `x` and `y` for a photo or video clip after dragging one side (`n`/`s`/`e`/`w`) by `delta`
 * px on a `W` × `H` stage, keeping the opposite side put (`freeEdges` allows placing past the stage edges).
 */
export function stretchSide(
  clip: Pick<Clip, "size" | "x" | "y" | "fill">,
  box: PixelBox,
  side: "n" | "s" | "e" | "w",
  delta: number,
  W: number,
  H: number,
  freeEdges = false,
): { size: number; aspect: number; x: number; y: number } {
  const inFrame = (total: number, used: number, offset: number) => (total - used <= 0 ? 0.5 : clamp(offset / (total - used), 0, 1));
  const place = (total: number, used: number, offset: number, old: number) => (freeEdges ? share(offset, total - used, old) : inFrame(total, used, offset));
  const currentAspect = box.height / Math.max(1, box.width);
  const minAspect = Math.min(MIN_ASPECT, currentAspect);
  const maxAspect = Math.max(MAX_ASPECT, currentAspect);

  let width = box.width;
  let height = box.height;
  if (side === "e" || side === "w") {
    const room = freeEdges ? W : side === "w" ? box.left + box.width : W - box.left;
    const maxW = Math.min(height / minAspect, !clip.fill || height > H ? room : Infinity);
    const minW = Math.min(maxW, Math.max(height / maxAspect, clip.fill || height / H < MIN_PICTURE ? MIN_PICTURE * W : 0));
    width = clamp(box.width + (side === "w" ? -delta : delta), minW, maxW);
  } else {
    const room = freeEdges ? H : side === "n" ? box.top + box.height : H - box.top;
    const maxH = Math.min(width * maxAspect, !clip.fill || width > W ? room : Infinity);
    const minH = Math.min(maxH, Math.max(width * minAspect, clip.fill || width / W < MIN_PICTURE ? MIN_PICTURE * H : 0));
    height = clamp(box.height + (side === "n" ? -delta : delta), minH, maxH);
  }

  const aspect = clamp(height / Math.max(1, width), minAspect, maxAspect);
  const fit = W * fitWidth(clip, 1 / aspect, W, H);
  const size = clamp(width / fit, MIN_PICTURE, 1);
  const actualW = fit * size;
  const actualH = actualW * aspect;
  const left = side === "w" ? box.left + box.width - actualW : box.left;
  const top = side === "n" ? box.top + box.height - actualH : box.top;
  return {
    size,
    aspect,
    x: place(W, actualW, left, clip.x),
    y: place(H, actualH, top, clip.y),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
