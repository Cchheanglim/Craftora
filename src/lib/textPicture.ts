import { TEXT_FONTS } from "../project/model";
import type { RenderClip } from "../types";

type TextLook = Pick<RenderClip, "text" | "size" | "x" | "y" | "color" | "font" | "edge" | "edgeColor" | "edgeSize" | "opacity" | "edgeBlur" | "glow" | "glowColor" | "spacing"> & { rotate?: number };

/** A shadow in shares of the letter height, as CSS `drop-shadow` takes it. */
export interface TextShadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

/**
 * A text's shadows, each cast by the letters with the ones before it (a CSS `drop-shadow` chain): the Shadow edge
 * (Preview.css draws the plain one) and the Image editor's glow.
 */
export function textShadows(c: Pick<TextLook, "edge" | "edgeColor" | "edgeSize" | "edgeBlur" | "glow" | "glowColor">): TextShadow[] {
  const k = c.edgeSize ?? 1;
  const shadows: TextShadow[] = [];
  if (!c.edge) shadows.push({ x: 0.06 * k, y: 0.06 * k, blur: c.edgeBlur ?? 0, color: c.edgeColor ?? "rgb(0 0 0 / 0.6)" });
  if (c.glow) shadows.push({ x: 0, y: 0, blur: c.glow, color: c.glowColor ?? "#ffffff" });
  return shadows;
}

/**
 * `textShadows` as a CSS filter on the letters, for a text whose shadow Preview.css can't draw (softness or glow), else
 * nothing. Not `text-shadow`: Chromium casts the fill's shadow over the outline, which tinted it.
 */
export const textShadowFilter = (c: Parameters<typeof textShadows>[0]) =>
  c.edgeBlur || c.glow ? textShadows(c).map((s) => `drop-shadow(${s.x}em ${s.y}em ${s.blur}em ${s.color})`).join(" ") : undefined;

/**
 * How a text lies on a `W` × `H` image as the preview lays it out (Preview.css `.preview__text`: its font, 1.15em lines
 * centred in the widest): its lines and their widths, and its box in pixels, placed in shares of the free space as
 * `left: x%` with `translate: -x%` does (before any turn). `ctx` is left set to the text's font.
 */
export function textLayout(c: Pick<TextLook, "text" | "size" | "x" | "y" | "font" | "spacing">, W: number, H: number, ctx = document.createElement("canvas").getContext("2d")!) {
  const font = TEXT_FONTS.find((f) => f.id === c.font);
  const size = c.size * H;
  ctx.font = `${font?.id === "impact" ? 400 : 700} ${size}px ${font ? `${font.css}, "Segoe UI", sans-serif` : '"Segoe UI", "Geist Variable", system-ui, sans-serif'}`;
  ctx.letterSpacing = `${(c.spacing ?? 0) * size}px`;
  const lines = c.text.split("\n");
  const widths = lines.map((line) => ctx.measureText(line).width);
  const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = ctx.measureText(c.text);
  const lineHeight = 1.15 * size;
  const width = Math.max(0, ...widths);
  const height = lines.length * lineHeight;
  return { size, lines, widths, ascent, descent, lineHeight, left: (W - width) * c.x, top: (H - height) * c.y, width, height };
}

/**
 * An Image editor text drawn as the preview draws it (`textLayout`, then its edge, shadows and angle; at full opacity:
 * the caller fades it as a whole, as CSS opacity does) on a see-through canvas covering only the text and what its edge
 * and shadows reach, placed at `x`, `y` on the `W` × `H` image. A library font must be loaded first.
 */
export function textCanvas(c: TextLook, W: number, H: number): { canvas: HTMLCanvasElement; x: number; y: number } {
  const { size, lines, widths, ascent, descent, lineHeight, left, top, width, height } = textLayout(c, W, H);
  const angle = ((c.rotate ?? 0) * Math.PI) / 180;
  const shadows = textShadows(c);
  // How far the edge and shadows reach past the letters' box (a drop-shadow's blur: 3 standard deviations), then the
  // turned box's bounds.
  const reach = size * (0.25 + 0.1 * (c.edgeSize ?? 1) + Math.max(0, ...shadows.map((s) => Math.abs(s.x) + Math.abs(s.y) + 3 * s.blur))) + 2;
  const [cx, cy] = [left + width / 2, top + height / 2];
  const halfW = (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / 2 + reach;
  const halfH = (Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height) / 2 + reach;
  const x = Math.floor(cx - halfW);
  const y = Math.floor(cy - halfH);
  const [w, h] = [Math.ceil(cx + halfW) - x, Math.ceil(cy + halfH) - y];
  const sheet = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return [canvas, canvas.getContext("2d")!] as const;
  };
  // Drawn in image pixels, the sheet's corner at (x, y), turned about the text's middle.
  const place = (g: CanvasRenderingContext2D) => {
    g.translate(cx - x, cy - y);
    g.rotate(angle);
    g.translate(-cx, -cy);
  };

  const [letters, ctx] = sheet();
  textLayout(c, W, H, ctx);
  place(ctx);
  if (c.edge === "outline") {
    // -webkit-text-stroke 0.1em with the fill over it: 0.05em shows outside the letters.
    ctx.lineWidth = 0.1 * size * (c.edgeSize ?? 1);
    ctx.lineJoin = "miter";
    ctx.miterLimit = 4;
    ctx.strokeStyle = c.edgeColor ?? "#000";
  }
  ctx.fillStyle = c.color;
  lines.forEach((line, i) => {
    const lx = left + (width - widths[i]) / 2;
    // Each line box is 1.15em tall with the letters' own height centred in it (CSS half-leading, floored as Chromium does).
    const ly = top + i * lineHeight + Math.floor((lineHeight - ascent - descent) / 2) + ascent;
    if (c.edge === "outline") ctx.strokeText(line, lx, ly);
    ctx.fillText(line, lx, ly);
  });

  // Each shadow under what's drawn so far, as a drop-shadow chain: the shadow alone (drawn a sheet-width away, its
  // offset moving it back), then the letters over it. A canvas shadow's offset isn't turned with the drawing, so it's
  // turned here, as the text's own is.
  let ink = letters;
  for (const s of shadows) {
    const [next, nctx] = sheet();
    nctx.shadowColor = s.color;
    // drop-shadow takes the blur as its spread (standard deviation); a canvas shadow takes twice that.
    nctx.shadowBlur = 2 * s.blur * size;
    nctx.shadowOffsetX = w + (s.x * Math.cos(angle) - s.y * Math.sin(angle)) * size;
    nctx.shadowOffsetY = (s.x * Math.sin(angle) + s.y * Math.cos(angle)) * size;
    nctx.drawImage(ink, -w, 0);
    nctx.shadowColor = "transparent";
    nctx.drawImage(ink, 0, 0);
    ink = next;
  }
  if (c.edge !== "box") return { canvas: ink, x, y };
  // Its background plus a 0.2em spread box-shadow: one rectangle, 0.2em bigger all round, under the letters' glow.
  const [out, octx] = sheet();
  octx.save();
  place(octx);
  octx.fillStyle = c.edgeColor ?? "rgb(0 0 0 / 0.6)";
  octx.fillRect(left - 0.2 * size, top - 0.2 * size, width + 0.4 * size, height + 0.4 * size);
  octx.restore();
  octx.drawImage(ink, 0, 0);
  return { canvas: out, x, y };
}

/** `textCanvas` on a whole see-through `W` × `H` PNG at the text's opacity (the export of text on its own). */
export function textPng(c: TextLook, W: number, H: number): string | undefined {
  if (typeof document === "undefined") return undefined;
  try {
    const text = textCanvas(c, W, H);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    // The whole text fades as one, as CSS opacity does (an outline doesn't show through its letters).
    ctx.globalAlpha = Math.min(1, Math.max(0, c.opacity ?? 1));
    ctx.drawImage(text.canvas, text.x, text.y);
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  }
}
