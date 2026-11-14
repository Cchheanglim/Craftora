import { TEXT_FONTS } from "../project/model";
import type { RenderClip } from "../types";

type TextLook = Pick<RenderClip, "text" | "size" | "x" | "y" | "color" | "font" | "edge" | "edgeColor" | "edgeSize" | "opacity" | "rotate" | "edgeBlur" | "glow" | "glowColor" | "spacing">;

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
 * An Image editor text drawn as the preview draws it (Preview.css `.preview__text`: its font, 1.15 line height, centred
 * lines, edge, shadows, letter spacing, angle and opacity) onto a see-through `W` × `H` PNG, laid over the picture like a
 * shape. drawtext places and outlines letters its own way, so the saved picture didn't match the screen. A library font
 * must be loaded first.
 */
export function textPng(c: TextLook, W: number, H: number): string | undefined {
  if (typeof document === "undefined") return undefined;
  const sheet = () => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    return [canvas, canvas.getContext("2d")!] as const;
  };
  try {
    const [letters, ctx] = sheet();
    const font = TEXT_FONTS.find((f) => f.id === c.font);
    const size = c.size * H;
    ctx.font = `${font?.id === "impact" ? 400 : 700} ${size}px ${font ? `${font.css}, "Segoe UI", sans-serif` : '"Segoe UI", "Geist Variable", system-ui, sans-serif'}`;
    if (c.spacing) ctx.letterSpacing = `${c.spacing * size}px`;
    const lines = c.text.split("\n");
    const widths = lines.map((line) => ctx.measureText(line).width);
    const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = ctx.measureText(c.text);
    const lineHeight = 1.15 * size;
    const width = Math.max(0, ...widths);
    const height = lines.length * lineHeight;
    // Placed in shares of the free space, as `left: x%` with `translate: -x%` does, then turned about its middle.
    const left = (W - width) * c.x;
    const top = (H - height) * c.y;
    const angle = ((c.rotate ?? 0) * Math.PI) / 180;
    const turn = (g: CanvasRenderingContext2D) => {
      g.translate(left + width / 2, top + height / 2);
      g.rotate(angle);
      g.translate(-(left + width / 2), -(top + height / 2));
    };
    turn(ctx);
    if (c.edge === "outline") {
      // -webkit-text-stroke 0.1em with the fill over it: 0.05em shows outside the letters.
      ctx.lineWidth = 0.1 * size * (c.edgeSize ?? 1);
      ctx.lineJoin = "miter";
      ctx.miterLimit = 4;
      ctx.strokeStyle = c.edgeColor ?? "#000";
    }
    ctx.fillStyle = c.color;
    lines.forEach((line, i) => {
      const x = left + (width - widths[i]) / 2;
      // Each line box is 1.15em tall with the letters' own height centred in it (CSS half-leading, floored as Chromium does).
      const y = top + i * lineHeight + Math.floor((lineHeight - ascent - descent) / 2) + ascent;
      if (c.edge === "outline") ctx.strokeText(line, x, y);
      ctx.fillText(line, x, y);
    });

    // Each shadow under what's drawn so far, as a drop-shadow chain: the shadow alone (drawn a frame-width away, its
    // offset moving it back), then the letters over it. A canvas shadow's offset isn't turned with the drawing, so it's
    // turned here, as the text's own is.
    let ink = letters;
    for (const s of textShadows(c)) {
      const [next, nctx] = sheet();
      nctx.shadowColor = s.color;
      // drop-shadow takes the blur as its spread (standard deviation); a canvas shadow takes twice that.
      nctx.shadowBlur = 2 * s.blur * size;
      nctx.shadowOffsetX = W + (s.x * Math.cos(angle) - s.y * Math.sin(angle)) * size;
      nctx.shadowOffsetY = (s.x * Math.sin(angle) + s.y * Math.cos(angle)) * size;
      nctx.drawImage(ink, -W, 0);
      nctx.shadowColor = "transparent";
      nctx.drawImage(ink, 0, 0);
      ink = next;
    }
    const [out, octx] = sheet();
    if (c.edge === "box") {
      // Its background plus a 0.2em spread box-shadow: one rectangle, 0.2em bigger all round, under the letters' glow.
      octx.save();
      turn(octx);
      octx.fillStyle = c.edgeColor ?? "rgb(0 0 0 / 0.6)";
      octx.fillRect(left - 0.2 * size, top - 0.2 * size, width + 0.4 * size, height + 0.4 * size);
      octx.restore();
    }
    octx.drawImage(ink, 0, 0);

    const opacity = Math.min(1, Math.max(0, c.opacity ?? 1));
    if (opacity >= 1) return out.toDataURL("image/png");
    // The whole text fades as one, as CSS opacity does (an outline doesn't show through its letters).
    const [faded, fctx] = sheet();
    fctx.globalAlpha = opacity;
    fctx.drawImage(out, 0, 0);
    return faded.toDataURL("image/png");
  } catch {
    return undefined;
  }
}
