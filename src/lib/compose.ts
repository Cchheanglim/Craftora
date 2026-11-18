/**
 * The Image editor's picture, drawn by the page as the preview shows it (Preview.tsx `PictureLayer`, `ShapeLayer`, the
 * text layer): one engine draws both, so the saved file is what's on screen. Rust only writes the bytes (`save_image`).
 * Every layer feature is drawn here and in the preview, nowhere else.
 */
import { invoke } from "@tauri-apps/api/core";
import { adjustSteps, blocksStyle, effectStrength, keyLine, vignetteStops } from "../project/effects";
import { layerBox } from "../project/layerBox";
import { clipEnd, isShape, isText, showsPicture, textLines, trackOrder, type Clip, type Project } from "../project/model";
import { shapeSvg } from "../project/shapes";
import { allowLocal } from "./engine";
import { hasStyle, styleFilter } from "./layerStyle";
import { textCanvas } from "./textPicture";

/** How to save: the picture's size, see-through or on its background colour, and the file type. */
export interface ComposeOptions {
  width: number;
  height: number;
  transparent?: boolean;
  type: "image/png" | "image/jpeg" | "image/webp";
  /** JPG and WebP: 1–100. */
  quality?: number;
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("A picture in the image couldn't be read. Open it again, then save."));
    img.src = src;
  });
}

function sheet(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  return [canvas, ctx] as const;
}

/** The SVG filters a CSS filter string points at (the preview's AdjustFilters, KeyFilters, warmth and RGB split). */
function checkFilters(filter: string) {
  for (const [, id] of filter.matchAll(/url\(#([^)]+)\)/g)) {
    if (!document.getElementById(id)) throw new Error("An adjustment on a picture couldn't be drawn. Try saving again.");
  }
}

/**
 * A photo opened in Craftora, read through Rust (cutout.rs `cutout_source`): drawn from its preview address it would
 * mark the canvas as another site's, which then can't be saved.
 */
export async function photo(path: string): Promise<HTMLImageElement> {
  // A project reopened after a restart hasn't let this file be read yet.
  await allowLocal(path);
  const src = URL.createObjectURL(new Blob([await invoke<ArrayBuffer>("cutout_source", { path })]));
  return load(src).finally(() => URL.revokeObjectURL(src));
}

/**
 * Draws a layer at `opacity` times its Fill, in its blend mode (the preview's `opacity` and `mix-blend-mode`: the
 * canvas takes the same mode names, "normal" being "source-over").
 */
function mixed(ctx: CanvasRenderingContext2D, clip: Clip, opacity: number, draw: () => void, styleDrawn = false) {
  // A layer style's filter draws the Fill itself (it leaves the effects at full).
  const styled = hasStyle(clip.style);
  ctx.globalAlpha = opacity * (styled ? 1 : (clip.fillOpacity ?? 1));
  ctx.globalCompositeOperation = clip.blend && clip.blend !== "normal" ? clip.blend : "source-over";
  ctx.filter = styled && !styleDrawn ? `url(#compose-style-${clip.id})` : "none";
  draw();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
}

/** One photo layer as `PictureLayer` draws it: crop window, mirror, filter and effects, quarter turn, then its box. */
async function drawPicture(out: CanvasRenderingContext2D, clip: Clip, path: string, W: number, H: number) {
  const img = await photo(path);
  const box = layerBox(clip, img.naturalWidth / img.naturalHeight, W, H);
  const [bw, bh] = [Math.round(box.width), Math.round(box.height)];
  const rotate = clip.rotate ?? 0;
  const sideways = rotate === 90 || rotate === 270;
  // The crop box: the box itself, or turned a quarter inside it.
  const [iw, ih] = sideways ? [bh, bw] : [bw, bh];
  const { left, top, right, bottom } = clip.crop;
  const [keptW, keptH] = [1 - left - right, 1 - top - bottom];

  // The picture as the crop window shows it (`.preview__video`, mirrored by its own `scale: -1 1`).
  const [picture, pctx] = sheet(iw, ih);
  const [pw, ph] = [iw / keptW, ih / keptH];
  const [px, py] = [(-left / keptW) * iw, (-top / keptH) * ih];
  if (clip.mirror) {
    pctx.translate(px + pw / 2, 0);
    pctx.scale(-1, 1);
    pctx.translate(-(px + pw / 2), 0);
  }
  pctx.drawImage(img, px, py, pw, ph);

  // `.preview__clip-fx`: its filter, then its mirror (CSS filters before transforms).
  const own = clip.look || clip.effect || adjustSteps(clip.adjust).length ? blocksStyle([clip], 0, bw, bh) : undefined;
  const key = clip.chroma && keyLine(clip.chroma) ? `url(#key-${clip.id})` : undefined;
  const filter = [key, own?.filter].filter(Boolean).join(" ");
  let inner = picture;
  if (filter || own?.mirror) {
    checkFilters(filter);
    const [fx, fctx] = sheet(iw, ih);
    if (own?.mirror) {
      fctx.translate(iw, 0);
      fctx.scale(-1, 1);
    }
    fctx.filter = filter || "none";
    fctx.drawImage(picture, 0, 0);
    inner = fx;
  }

  // `.preview__picture`: the crop box turned in it, then the effect's colour layers and cinema bars over the box.
  const [layer, lctx] = sheet(bw, bh);
  lctx.translate(bw / 2, bh / 2);
  lctx.rotate((rotate * Math.PI) / 180);
  lctx.drawImage(inner, -iw / 2, -ih / 2);
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const fxLayer of own?.layers ?? []) {
    if (clip.effect !== "vignette") continue;
    // Vignette's radial-gradient(circle farthest-corner at 50% 50%, …).
    const gradient = lctx.createRadialGradient(bw / 2, bh / 2, 0, bw / 2, bh / 2, Math.hypot(bw / 2, bh / 2));
    for (const [at, colour] of vignetteStops(effectStrength(clip))) gradient.addColorStop(at, colour);
    lctx.globalAlpha = fxLayer.opacity;
    lctx.fillStyle = gradient;
    lctx.fillRect(0, 0, bw, bh);
    lctx.globalAlpha = 1;
  }
  if (own && own.bars > 0) {
    lctx.fillStyle = "#000";
    lctx.fillRect(0, 0, bw, own.bars * bh);
    lctx.fillRect(0, bh - own.bars * bh, bw, own.bars * bh);
  }
  const [x, y] = [Math.round(box.left), Math.round(box.top)];
  if (!clip.angle) return mixed(out, clip, clip.opacity ?? 1, () => out.drawImage(layer, x, y));
  // Turned about its middle after its style, as the preview's CSS `rotate` comes after its filter: the style drawn on the
  // upright layer with room round it (its filter knows the turn, so the shadow still falls the way the light says).
  // Rule: never draw with a canvas `filter` under a rotation (Chromium filters in the turned space: the stroke came out
  // distorted); text arrives already turned and is filtered with no transform, which is why it passes no turn.
  let turned = layer;
  let m = 0;
  if (hasStyle(clip.style)) {
    const s = clip.style!;
    m = Math.ceil(H * ((s.stroke?.size ?? 0) + (s.shadow ? s.shadow.distance + 1.5 * s.shadow.size : 0) + (s.glow ? 1.5 * s.glow.size : 0))) + 4;
    const [styled, sctx] = sheet(bw + 2 * m, bh + 2 * m);
    sctx.filter = `url(#compose-style-${clip.id})`;
    sctx.drawImage(layer, m, m);
    turned = styled;
  }
  mixed(
    out,
    clip,
    clip.opacity ?? 1,
    () => {
      out.save();
      out.translate(x + bw / 2, y + bh / 2);
      out.rotate((clip.angle! * Math.PI) / 180);
      out.drawImage(turned, -bw / 2 - m, -bh / 2 - m);
      out.restore();
    },
    true,
  );
}

/** Draws the picture: the background colour (unless see-through), then every layer from the bottom of the Layers list up. */
export async function composeImage(project: Project, options: ComposeOptions): Promise<Blob> {
  // A JPG can't be see-through: a see-through picture saves on white (a canvas left clear turns black).
  const onWhite = options.type === "image/jpeg" && project.image && !project.image.background;
  const canvas = await composeCanvas(onWhite ? { ...project, image: { ...project.image!, background: "#ffffff" } } : project, options);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, options.type, options.type === "image/png" ? undefined : (options.quality ?? 95) / 100));
  if (!blob) throw new Error("The picture couldn't be made. Try a smaller size.");
  return blob;
}

/** The picture drawn on a canvas (`composeImage` before it's a file; the eyedropper reads it). */
export async function composeCanvas(project: Project, options: Pick<ComposeOptions, "width" | "height" | "transparent">): Promise<HTMLCanvasElement> {
  const { width: W, height: H } = options;
  const [canvas, ctx] = sheet(W, H);
  if (!options.transparent && project.image?.background) {
    ctx.fillStyle = project.image.background;
    ctx.fillRect(0, 0, W, H);
  }
  // Layer styles at this size, on the page while drawing (a canvas filter points at them like CSS does).
  const styles = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  styles.setAttribute("width", "0");
  styles.setAttribute("height", "0");
  styles.style.position = "absolute";
  styles.innerHTML = project.clips
    .filter((c) => hasStyle(c.style))
    // A photo is drawn turned and its filter works in the turned drawing, as CSS does; text arrives already turned.
    .map((c) => styleFilter(`compose-style-${c.id}`, c.style!, H, c.fillOpacity ?? 1, { x: -W, y: -H, width: 3 * W, height: 3 * H }, c.mediaId ? (c.angle ?? 0) : 0))
    .join("");
  document.body.append(styles);
  try {
    await drawLayers(project, ctx, W, H);
  } finally {
    styles.remove();
  }
  return canvas;
}

/** Every layer from the bottom of the Layers list up. */
async function drawLayers(project: Project, ctx: CanvasRenderingContext2D, W: number, H: number) {
  // The Layers order, as the preview stacks them (z-index): bottom track first; on a track, later clips over earlier ones.
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i]));
  const order = (c: Clip) => (project.tracks.length - (trackIndex.get(c.trackId) ?? 0)) * 10_000 + trackOrder(project, c.trackId).indexOf(c);
  const hidden = (c: Clip) => Boolean(project.tracks.find((t) => t.id === c.trackId)?.hidden);
  const shown = project.clips.filter((c) => !hidden(c) && c.start <= 0 && clipEnd(c) > 0);
  const byOrder = (a: Clip, b: Clip) => order(a) - order(b);

  for (const clip of shown.filter((c) => showsPicture(project, c) || isText(c) || isShape(c)).sort(byOrder)) {
    if (showsPicture(project, clip)) {
      const media = project.media.find((m) => m.id === clip.mediaId);
      if (!media?.source.local) throw new Error(`“${media?.name ?? "A photo"}” isn't a file on this PC, so it can't go into the picture.`);
      await drawPicture(ctx, clip, media.source.url, W, H);
      continue;
    }
    if (isShape(clip)) {
      const img = await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(shapeSvg(clip, W, H))}`);
      mixed(ctx, clip, 1, () => ctx.drawImage(img, 0, 0, W, H));
      continue;
    }
    const text = textCanvas({ ...clip, text: textLines(clip.text ?? "", clip.size, { width: W, height: H }, clip.font, clip.spacing), color: clip.color ?? "#ffffff" }, W, H);
    // The whole text fades as one, as CSS opacity does.
    mixed(ctx, clip, clip.opacity ?? 1, () => ctx.drawImage(text.canvas, text.x, text.y));
  }
}
