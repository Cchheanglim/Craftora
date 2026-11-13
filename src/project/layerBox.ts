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
function fitWidth(clip: Placed, aspect: number, W: number, H: number) {
  const wider = aspect >= W / H;
  return clip.fill ? (wider ? aspect / (W / H) : 1) : wider ? 1 : aspect / (W / H);
}

/** Where a picture or shape layer sits; `picture` = the picture file's width / height (unused for shapes). */
export function layerBox(clip: Placed, picture: number, W: number, H: number): PixelBox {
  if (clip.shape) return shapeBox(clip, W, H);
  const aspect = shownAspect(clip, picture);
  const width = W * fitWidth(clip, aspect, W, H) * clip.size;
  const height = width / aspect;
  return { left: (W - width) * clip.x, top: (H - height) * clip.y, width, height };
}

// x/y are shares of the free space; with none (exactly as wide as the image) any x draws the same, so keep the old one.
const share = (offset: number, free: number, old: number) => (Math.abs(free) < 1e-9 ? old : offset / free);

/**
 * The clip fields that put a layer at `box`, within what the Edit sliders allow (the export refuses a picture bigger than
 * the image fits). Pictures keep their shape (the height follows the width); shapes take both sides.
 */
export function placeAt(clip: Placed, picture: number, W: number, H: number, box: PixelBox): Partial<Clip> {
  if (clip.shape) {
    const size = clamp(box.width / W, 0.02, 2);
    const aspect = clamp(box.height / (size * W), 0.05, 5);
    const [width, height] = [size * W, size * W * aspect];
    return { size, aspect, x: share(box.left, W - width, clip.x), y: share(box.top, H - height, clip.y) };
  }
  const aspect = shownAspect(clip, picture);
  const fit = W * fitWidth(clip, aspect, W, H);
  const size = clamp(box.width / fit, 0.01, 1);
  const [width, height] = [size * fit, (size * fit) / aspect];
  return { size, x: share(box.left, W - width, clip.x), y: share(box.top, H - height, clip.y) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
