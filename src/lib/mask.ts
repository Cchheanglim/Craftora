/**
 * Image editor layer masks (`Clip.mask`): a greyscale picture over the layer's own box, white shows, black hides. The
 * preview masks with CSS (`maskStyle`), the saved picture with a canvas (`applyMaskTo`), so the file is the screen.
 */
import type { CSSProperties } from "react";
import type { Clip } from "../project/model";

/** The largest side a mask is made at. */
const MAX_MASK_SIDE = 4096;

/** A new mask for a layer `width` × `height` image pixels big, all shown (white) or all hidden (black). */
export function blankMask(width: number, height: number, fill: "white" | "black"): string {
  const k = Math.min(1, MAX_MASK_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  const ctx = canvas.getContext("2d")!;
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
