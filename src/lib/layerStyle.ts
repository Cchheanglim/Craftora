import type { LayerStyle } from "../project/model";

const colour = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#000000");
const num = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(3)) : 0);

/**
 * A layer's style as one SVG filter, drawn the same by the preview (CSS `filter: url(#id)` on the layer) and by
 * lib/compose.ts (canvas `filter`). From the bottom: drop shadow, outer glow, stroke, then the layer at its Fill (`fill`,
 * which fades the layer's own pixels but not its effects). `px` = pixels per share of the image height where it's
 * drawn; `region` is the filter's area in that drawing's own pixels (the canvas), or the layer's box when absent.
 */
export function styleFilter(id: string, style: LayerStyle, px: number, fill = 1, region?: { x: number; y: number; width: number; height: number }): string {
  const area = region
    ? `filterUnits="userSpaceOnUse" x="${num(region.x)}" y="${num(region.y)}" width="${num(region.width)}" height="${num(region.height)}"`
    : `x="-100%" y="-100%" width="300%" height="300%"`;
  const parts: string[] = [];
  const merge: string[] = [];
  // The stroke grows the shape the shadow and glow are cast from.
  let shape = "SourceAlpha";
  if (style.stroke && style.stroke.size > 0) {
    parts.push(`<feMorphology in="SourceAlpha" operator="dilate" radius="${num(style.stroke.size * px)}" result="grown"/>`);
    parts.push(`<feFlood flood-color="${colour(style.stroke.color)}"/><feComposite in2="grown" operator="in" result="stroke"/>`);
    shape = "grown";
  }
  if (style.shadow) {
    // Lit from `angle` (0 = right, 90 = above), so the shadow falls the other way; Size blurs it as far as it says.
    const a = (style.shadow.angle * Math.PI) / 180;
    const d = style.shadow.distance * px;
    parts.push(`<feOffset in="${shape}" dx="${num(-Math.cos(a) * d)}" dy="${num(Math.sin(a) * d)}"/>`);
    parts.push(`<feGaussianBlur stdDeviation="${num((style.shadow.size * px) / 2)}" result="shadowShape"/>`);
    parts.push(`<feFlood flood-color="${colour(style.shadow.color)}" flood-opacity="${num(style.shadow.opacity)}"/><feComposite in2="shadowShape" operator="in"/>`);
    // Cut out under the layer, as photo editors do: a see-through layer (low Fill) doesn't show its shadow through itself.
    parts.push(`<feComposite in2="SourceAlpha" operator="out" result="shadow"/>`);
    merge.push("shadow");
  }
  if (style.glow) {
    parts.push(`<feGaussianBlur in="${shape}" stdDeviation="${num((style.glow.size * px) / 2)}" result="glowShape"/>`);
    parts.push(`<feFlood flood-color="${colour(style.glow.color)}" flood-opacity="${num(style.glow.opacity)}"/><feComposite in2="glowShape" operator="in"/><feComposite in2="SourceAlpha" operator="out" result="glow"/>`);
    merge.push("glow");
  }
  if (style.stroke && style.stroke.size > 0) merge.push("stroke");
  parts.push(`<feComponentTransfer in="SourceGraphic" result="own"><feFuncA type="linear" slope="${num(fill)}"/></feComponentTransfer>`);
  merge.push("own");
  return `<filter id="${id}" ${area} color-interpolation-filters="sRGB">${parts.join("")}<feMerge>${merge.map((m) => `<feMergeNode in="${m}"/>`).join("")}</feMerge></filter>`;
}

/** Whether a style draws anything. */
export const hasStyle = (style?: LayerStyle) => Boolean(style && (style.shadow || style.glow || (style.stroke && style.stroke.size > 0)));
