/**
 * Image editor layer masks (`Clip.mask`): a greyscale picture over the layer's own box, white shows, black hides. The
 * preview masks with CSS (`maskStyle`), the saved picture with a canvas (`applyMaskTo`), so the file is the screen.
 */
import type { CSSProperties } from "react";
import { layerBox } from "../project/layerBox";
import { isShape, isText, textLines, type Clip } from "../project/model";
import { shapeBox } from "../project/shapes";
import { hexOf, multiply, photoToImage, rgbOf, type Affine, type PaintColours } from "./paint";
import { textLayout } from "./textPicture";

/** The largest side a mask is made at. */
const MAX_MASK_SIDE = 4096;

function maskCanvas(width: number, height: number) {
  const k = Math.min(1, MAX_MASK_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  return [canvas, canvas.getContext("2d")!] as const;
}

/** A new mask for a layer `width` × `height` image pixels big, all shown (white) or all hidden (black). */
export function blankMask(width: number, height: number, fill: "white" | "black"): string {
  const [canvas, ctx] = maskCanvas(width, height);
  ctx.fillStyle = fill === "white" ? "#ffffff" : "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** The layer's mask is used: it has one and it isn't switched off. */
export const maskOn = (clip: Pick<Clip, "mask" | "maskOff">): clip is Pick<Clip, "maskOff"> & { mask: string } => Boolean(clip.mask && !clip.maskOff);

/**
 * The layer's mask as CSS on the element holding its pixels; nothing when it has none or it's switched off. `place`: for
 * an element covering the whole `width` × `height` frame (a shape's picture), the layer's box in it and its turn.
 */
export function maskStyle(clip: Pick<Clip, "mask" | "maskOff">, place?: { width: number; height: number; box: MaskBox }): CSSProperties {
  if (!maskOn(clip)) return {};
  let image = `url("${clip.mask}")`;
  if (place) {
    const { width, height, box } = place;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="${clip.mask}" x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" preserveAspectRatio="none" transform="rotate(${box.angle ?? 0} ${box.left + box.width / 2} ${box.top + box.height / 2})"/></svg>`;
    image = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  }
  return {
    maskImage: image,
    maskMode: "luminance",
    maskSize: "100% 100%",
    maskRepeat: "no-repeat",
    WebkitMaskImage: image,
    WebkitMaskSize: "100% 100%",
    WebkitMaskRepeat: "no-repeat",
  };
}

/** Where a mask lies on a canvas: the layer's box (before its turn) and its turn about the box centre, in degrees. */
export interface MaskBox {
  left: number;
  top: number;
  width: number;
  height: number;
  angle?: number;
}

/**
 * Keeps only what the mask shows of what's already on `ctx` (one layer's own pixels): the mask's brightness becomes
 * alpha (as CSS `mask-mode: luminance`), stretched over `box`; everything outside the box goes, as CSS hides it.
 */
export function applyMaskTo(ctx: CanvasRenderingContext2D, mask: CanvasImageSource & { width: number; height: number }, box: MaskBox) {
  const alpha = document.createElement("canvas");
  alpha.width = mask.width;
  alpha.height = mask.height;
  const actx = alpha.getContext("2d")!;
  actx.drawImage(mask, 0, 0);
  const data = actx.getImageData(0, 0, alpha.width, alpha.height);
  lumaToAlpha(data.data);
  actx.putImageData(data, 0, 0);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.globalCompositeOperation = "destination-in";
  ctx.translate(box.left + box.width / 2, box.top + box.height / 2);
  ctx.rotate(((box.angle ?? 0) * Math.PI) / 180);
  ctx.drawImage(alpha, -box.width / 2, -box.height / 2, box.width, box.height);
  ctx.restore();
}

/** RGBA pixels in place: alpha = luminance × alpha (CSS mask luminance weights), colour white. */
export function lumaToAlpha(px: Uint8ClampedArray) {
  for (let i = 0; i < px.length; i += 4) {
    px[i + 3] = Math.round(((0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) * px[i + 3]) / 255);
    px[i] = px[i + 1] = px[i + 2] = 255;
  }
}

/** RGBA pixels in place: opaque greyscale from the alpha channel (alpha 255 = white, 0 = black). */
export function alphaToGrey(px: Uint8ClampedArray) {
  for (let i = 0; i < px.length; i += 4) {
    px[i] = px[i + 1] = px[i + 2] = px[i + 3];
    px[i + 3] = 255;
  }
}

/** A cut-out photo's alpha channel turned into a greyscale layer mask sized to `clip`'s mask box on `W` × `H`. */
export function cutoutMask(clip: Clip, cutout: HTMLImageElement, W: number, H: number): string {
  const nw = Math.max(1, cutout.naturalWidth || cutout.width);
  const nh = Math.max(1, cutout.naturalHeight || cutout.height);
  const box = clipMaskBox(clip, W, H, nw / nh);
  const [canvas, ctx] = maskCanvas(box.width, box.height);
  const toMask = multiply(maskAffine({ ...box, angle: 0 }, canvas), photoToImage({ ...clip, angle: 0 }, { width: nw, height: nh }, W, H, false));
  ctx.setTransform(toMask[0], toMask[1], toMask[2], toMask[3], toMask[4], toMask[5]);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cutout, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  alphaToGrey(data.data);
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Rec. 709 luminance (0..255), matching `lumaToAlpha`. */
export const lumaOf = (r: number, g: number, b: number) => Math.min(255, Math.max(0, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)));

/** A `#rrggbb` colour as its Rec. 709 grey `#vvvvvv` (black stays black, white stays white). */
export function greyHex(hex: string): string {
  const [r, g, b] = rgbOf(hex);
  const v = lumaOf(r, g, b);
  return hexOf(v, v, v);
}

/** Both paint swatches converted to their Rec. 709 greys. */
export const greysOf = (colours: PaintColours): PaintColours => ({ fg: greyHex(colours.fg), bg: greyHex(colours.bg) });

/** The layer's mask box and turn (deg) on a `W` × `H` image: shapes, text, or photos (`photoAspect` = natural w/h). */
export function clipMaskBox(clip: Clip, W: number, H: number, photoAspect = W / H): MaskBox {
  if (isShape(clip)) return { ...shapeBox(clip, W, H), angle: clip.rotate ?? 0 };
  if (isText(clip)) {
    const look = { ...clip, text: textLines(clip.text ?? "", clip.size, { width: W, height: H }, clip.font, clip.spacing), color: clip.color ?? "#ffffff" };
    const { left, top, width, height } = textLayout(look, W, H);
    return { left, top, width, height, angle: clip.rotate ?? 0 };
  }
  return { ...layerBox(clip, photoAspect, W, H), angle: clip.angle ?? 0 };
}

/** Picture pixel → mask pixel: inverts placing the `mask` (`width` × `height`) over `box` and turning by `box.angle`. */
export function maskAffine(box: MaskBox, mask: { width: number; height: number }): Affine {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const r = ((box.angle ?? 0) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(r), Math.sin(r)];
  const sx = mask.width / Math.max(1e-6, box.width);
  const sy = mask.height / Math.max(1e-6, box.height);
  return [
    cos * sx,
    -sin * sy,
    sin * sx,
    cos * sy,
    (-cx * cos - cy * sin + box.width / 2) * sx,
    (cx * sin - cy * cos + box.height / 2) * sy,
  ];
}
