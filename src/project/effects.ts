/**
 * Filters, effects and transitions (the right panel's tabs), dragged onto the timeline:
 * - Filters (colour looks) and picture effects are blocks on a track: for their time they change
 *   every picture under them (not text). The preview and the export draw the same maths. Dropped
 *   on a clip, a block covers that clip (a piece of a split clip covers just that piece).
 * - Time effects (slow motion, speed up, reverse) change the clip (or piece) they're dropped on.
 * - Transitions go on the join between two clips.
 */
import { MIN_CLIP, TRANSITION_KINDS, clipEnd, meets, clipLength, isStill, mainTrack, showsPicture, trackOrder, type Clip, type Project, type Transition } from "./model";
import type { ClipPatch, EditAction } from "./actions";
import type { ShapeId } from "./shapes";
import type { CSSProperties } from "react";

/**
 * One colour step of a filter: a CSS filter function and its amount (degrees for hue-rotate). The
 * preview applies the steps in order; the export draws the same maths (project.rs `look_filter`).
 */
export type LookStep = readonly ["grayscale" | "sepia" | "saturate" | "hue-rotate" | "brightness" | "contrast" | "invert" | "warmth", number];

export const LOOKS = [
  { id: "bw", label: "Black & white", steps: [["grayscale", 1]] },
  { id: "noir", label: "Noir", steps: [["grayscale", 1], ["contrast", 1.5], ["brightness", 0.9]] },
  { id: "sepia", label: "Sepia", steps: [["sepia", 1]] },
  { id: "vintage", label: "Vintage", steps: [["sepia", 0.5], ["contrast", 0.85], ["brightness", 1.1], ["saturate", 0.8]] },
  { id: "warm", label: "Warm", steps: [["sepia", 0.3], ["saturate", 1.4]] },
  { id: "vivid", label: "Vivid", steps: [["saturate", 1.7], ["contrast", 1.1]] },
  { id: "pop", label: "Pop", steps: [["saturate", 2], ["contrast", 1.25]] },
  { id: "faded", label: "Faded", steps: [["contrast", 0.75], ["brightness", 1.1], ["saturate", 0.7]] },
  { id: "dreamy", label: "Dreamy", steps: [["brightness", 1.15], ["saturate", 1.3], ["contrast", 0.9]] },
  { id: "punchy", label: "High contrast", steps: [["contrast", 1.5]] },
  { id: "bright", label: "Bright", steps: [["brightness", 1.25]] },
  { id: "moody", label: "Moody", steps: [["brightness", 0.8], ["contrast", 1.2], ["saturate", 0.8]] },
  { id: "alien", label: "Alien colours", steps: [["hue-rotate", 180]] },
  { id: "invert", label: "Invert", steps: [["invert", 1]] },
] as const satisfies readonly { id: string; label: string; steps: readonly LookStep[] }[];
export type LookId = (typeof LOOKS)[number]["id"];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round4 = (v: number) => Math.round(v * 10_000) / 10_000;
const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);

/** A filter's steps, scaled by `amount` (0 = no change, 1 = full), for the export; none for no filter. */
export function lookSteps(id?: string, amount = 1): LookStep[] {
  const k = clamp(amount, 0, 1);
  return (LOOKS.find((l) => l.id === id)?.steps ?? []).map(([op, a]) => [
    op,
    round4(op === "saturate" || op === "brightness" || op === "contrast" ? 1 + (a - 1) * k : a * k),
  ]);
}

/** Edit → Adjust: sliders from -100 to 100, 0 = unchanged. */
export const ADJUSTMENTS = [
  { id: "brightness", label: "Brightness" },
  { id: "contrast", label: "Contrast" },
  { id: "saturation", label: "Saturation" },
  { id: "warmth", label: "Warmth" },
] as const;
export type Adjust = Partial<Record<(typeof ADJUSTMENTS)[number]["id"], number>>;

/** A clip's adjustments as colour steps, drawn after its filter; none for all at 0. */
export function adjustSteps(adjust?: Adjust): LookStep[] {
  const v = (id: keyof Adjust) => Math.round(clamp(adjust?.[id] ?? 0, -100, 100)) / 100;
  const steps: LookStep[] = [];
  if (v("brightness")) steps.push(["brightness", round4(1 + v("brightness") / 2)]);
  if (v("contrast")) steps.push(["contrast", round4(1 + v("contrast") / 2)]);
  if (v("saturation")) steps.push(["saturate", round4(1 + v("saturation"))]);
  if (v("warmth")) steps.push(["warmth", v("warmth")]);
  return steps;
}

/** How much Warmth 100 changes red and blue (project.rs `look_filter` uses the same). */
const WARMTH = 0.2;

/** Warmth's colour matrix (red up and blue down, or the other way), as SVG's feColorMatrix takes it. */
export function warmthMatrix(w: number): string {
  return `${round4(1 + WARMTH * w)} 0 0 0 0 0 1 0 0 0 0 0 ${round4(1 - WARMTH * w)} 0 0 0 0 0 1 0`;
}

/**
 * Colour steps as CSS, for the preview; undefined for none. CSS has no warmth function: it points at the SVG filter
 * the preview draws for each Warmth value (Preview.tsx `WARMTH_FILTERS`).
 */
export function stepsFilter(steps: LookStep[]): string | undefined {
  const css = ([op, a]: LookStep) => (op === "warmth" ? `url(#warmth-${Math.round(a * 100)})` : `${op}(${op === "hue-rotate" ? `${a}deg` : a})`);
  return steps.length ? steps.map(css).join(" ") : undefined;
}

/** A filter's CSS, for the preview; undefined for none. */
export function lookFilter(id?: string, amount = 1): string | undefined {
  return stepsFilter(lookSteps(id, amount));
}

/** Picture effects: blocks like filters (project.rs `effect_filter` draws them in the export). */
export const PICTURE_EFFECTS = [
  // "old": kept so old projects' blocks keep their labels and keep working, not shown in the panel.
  { id: "fade-in", label: "Fade in", category: "old" },
  { id: "fade-out", label: "Fade out", category: "old" },
  { id: "flash", label: "Flash", category: "old" },
  { id: "blur", label: "Blur", category: "style" },
  { id: "mirror", label: "Mirror", category: "style" },
  { id: "zoom-in", label: "Zoom in", category: "camera" },
  { id: "zoom-out", label: "Zoom out", category: "camera" },
  { id: "punch", label: "Zoom punch", category: "camera" },
  { id: "shake", label: "Shake", category: "camera" },
  { id: "bars", label: "Cinema bars", category: "style" },
  { id: "vignette", label: "Vignette", category: "style" },
  { id: "strobe", label: "Strobe", category: "style" },
  { id: "rgb-split", label: "RGB split", category: "style" },
  { id: "grain", label: "Film grain", category: "style" },
] as const satisfies readonly { id: string; label: string; category: "camera" | "style" | "old" }[];
export type PictureEffectId = (typeof PICTURE_EFFECTS)[number]["id"];

/** Which effects have Edit's Strength (0–100, 50 as made) and Speed (0.5–3×) sliders. */
export const EFFECT_SETTINGS: Partial<Record<PictureEffectId, readonly ("strength" | "speed")[]>> = {
  blur: ["strength"],
  "zoom-in": ["strength"],
  "zoom-out": ["strength"],
  punch: ["strength", "speed"],
  shake: ["strength", "speed"],
  vignette: ["strength"],
  strobe: ["strength", "speed"],
  "rgb-split": ["strength"],
  grain: ["strength"],
};

/** An effect's strength as a multiple of how it was made (0–2, 1 at the slider's middle) and its speed (0.5–3×). */
export const effectStrength = (c: Pick<Clip, "effectStrength">) => clamp(c.effectStrength ?? 50, 0, 100) / 50;
export const effectSpeed = (c: Pick<Clip, "effectSpeed">) => clamp(c.effectSpeed ?? 1, 0.5, 3);

/** RGB split: red moved left and blue right by this share of the width at strength 1 (project.rs `rgbashift`). */
export const RGB_SHARE = 0.008;

/** Vignette: FFmpeg's lens falloff, cos(angle × distance / half-diagonal)⁴, as a black see-through gradient over the picture. */
export function vignetteGradient(s: number): string {
  const angle = Math.min(Math.PI / 2, (Math.PI / 5) * s);
  const stops = Array.from({ length: 11 }, (_, i) => `rgba(0,0,0,${round4(1 - Math.cos((angle * i) / 10) ** 4)}) ${i * 10}%`);
  return `radial-gradient(circle farthest-corner at 50% 50%, ${stops.join(", ")})`;
}

/** Film grain's texture for the preview (the export draws FFmpeg's own noise): grey fractal noise, tiled. */
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="160" height="160" filter="url(#n)"/></svg>`,
)}")`;

/** Blur's strength: its standard deviation as a share of the frame width (CSS blur and FFmpeg gblur both use one). */
export const BLUR_SHARE = 0.006;

/** A time effect's change: a new speed, other settings, or both. */
export type TimeChange = { speed?: number; patch?: ClipPatch };

/** Time effects: they change the clip they're dropped on. */
export const TIME_EFFECTS: { id: string; label: string; change: TimeChange }[] = [
  { id: "slow", label: "Slow motion", change: { speed: 0.5, patch: { smooth: false } } },
  // Half speed with in-between frames made by FFmpeg's motion interpolation in the export.
  { id: "smooth", label: "Smooth slow-mo", change: { speed: 0.5, patch: { smooth: true } } },
  { id: "fast", label: "Speed up", change: { speed: 2 } },
  { id: "reverse", label: "Reverse", change: { patch: { reverse: true } } },
];

/** What the panels offer, as dragged or clicked. */
export type FxItem =
  | { kind: "filter"; id: LookId }
  | { kind: "adjust"; id: "layer" }
  | { kind: "effect"; id: PictureEffectId }
  | { kind: "fade"; id: "in" | "out" }
  | { kind: "time"; id: string }
  | { kind: "transition"; id: Transition["kind"] }
  | { kind: "shape"; id: ShapeId };

/** A new filter, effect, Adjust layer or shape block lasts this long (Zoom punch hits in its first half second); drag its edges to change it. */
export const BLOCK_LENGTH = 5;

/** A transition this close to a join (seconds) goes on that join; further into a clip, it cuts the clip there. */
const JOIN_REACH = 0.5;

/** A filter or effect block's name on the timeline and in Edit. */
export function blockLabel(c: Clip): string {
  return LOOKS.find((l) => l.id === c.look)?.label ?? PICTURE_EFFECTS.find((e) => e.id === c.effect)?.label ?? (c.adjust ? "Adjust layer" : "Effect");
}

/**
 * The edits a dragged (or clicked) item makes when it lands at `time` on track `trackId`, and the
 * clip to select afterwards. On a clip there, a filter or effect covers that clip and a time effect
 * changes it; off any clip, a filter or effect is a short block at `time`. With no track (clicked
 * with nothing selected), time effects and transitions use the main track; with `null` (dropped in the empty space
 * around the tracks), a filter, effect or shape gets a new track of its own at the top. Null when there's nothing there
 * for it to go on. `newIds`: ids for any clips it makes.
 */
export function dropEdits(
  p: Project,
  item: FxItem,
  trackId: string | undefined | null,
  time: number,
  newIds: [string, string],
): { edits: EditAction[]; select?: string } | null {
  if (trackId === null && item.kind !== "filter" && item.kind !== "effect" && item.kind !== "adjust" && item.kind !== "shape") trackId = undefined;
  // Its own track: made first, then the block goes on it.
  const ownTrack: EditAction[] = trackId === null ? [{ type: "addTrack", trackId: newIds[1] }] : [];
  if (trackId === null) trackId = newIds[1];
  const dropped = p.tracks.find((t) => t.id === trackId);
  const mediaOn = (id?: string) => (id ? trackOrder(p, id).filter((c) => c.mediaId) : []);
  const clipAt = (clips: Clip[]) => clips.find((c) => time >= c.start && time < clipEnd(c));
  if (item.kind === "adjust") {
    // Always a layer of its own (its sliders are in Edit): on a clip's spot it goes on a free track above (actions.ts `place`).
    return { edits: [...ownTrack, { type: "addBlock", clipId: newIds[0], at: time, length: BLOCK_LENGTH, trackId: ownTrack.length ? trackId : dropped?.id, adjust: {} }], select: newIds[0] };
  }
  if (item.kind === "filter" || item.kind === "effect") {
    const block = item.kind === "filter" ? { look: item.id } : { effect: item.id };
    // Dropped on a video or picture: it goes inside that clip (one filter and one effect each; a new one replaces it).
    const clip = clipAt(mediaOn(dropped?.id).filter((c) => showsPicture(p, c)));
    if (clip) {
      const patch = item.kind === "filter" ? { look: item.id, lookAmount: 1 } : { effect: item.id };
      return { edits: [{ type: "updateClip", clipId: clip.id, patch }], select: clip.id };
    }
    // On an empty spot: a block of its own, to stretch over several clips.
    return { edits: [...ownTrack, { type: "addBlock", clipId: newIds[0], at: time, length: BLOCK_LENGTH, trackId: ownTrack.length ? trackId : dropped?.id, ...block }], select: newIds[0] };
  }
  if (item.kind === "shape") {
    return { edits: [...ownTrack, { type: "addShape", clipId: newIds[0], shape: item.id, at: time, length: BLOCK_LENGTH, trackId: ownTrack.length ? trackId : dropped?.id }], select: newIds[0] };
  }
  const track = dropped ?? mainTrack(p);
  if (!track || track.locked) return null;
  const order = mediaOn(track.id);
  if (item.kind === "fade") {
    const clip = clipAt(order.filter((c) => showsPicture(p, c)));
    if (!clip) return null;
    const fade = Math.min(1, clipLength(clip) / 2);
    return { edits: [{ type: "updateClip", clipId: clip.id, patch: item.id === "in" ? { fadeIn: fade } : { fadeOut: fade } }], select: clip.id };
  }
  if (item.kind === "time") {
    // A still picture has no speed or direction.
    const clip = clipAt(order.filter((c) => !isStill(p, c)));
    const effect = TIME_EFFECTS.find((e) => e.id === item.id);
    if (!clip || !effect) return null;
    const { edits, target } = effectEdits(clip, effect.change, undefined, newIds);
    return { edits, select: target };
  }
  const kind = TRANSITION_KINDS.find((t) => t.kind === item.id)?.kind ?? "crossfade";
  const edits: EditAction[] = [];
  // Over the middle of a clip: cut it there and put the transition on the cut (no splitting by hand first).
  const under = order.filter((c) => time >= c.start && time < clipEnd(c));
  const nearJoin = order.some((c) => Math.abs(time - c.start) <= JOIN_REACH || Math.abs(time - clipEnd(c)) <= JOIN_REACH);
  // One clip only: inside a transition two clips overlap, and that one is changed on its join instead.
  const inside = under.length === 1 && !nearJoin ? under[0] : undefined;
  if (inside) {
    edits.push({ type: "splitClip", clipId: inside.id, newClipId: newIds[0], at: time });
    edits.push({ type: "setTransition", clipId: newIds[0], transition: { kind, duration: 1 } });
    return { edits, select: newIds[0] };
  }
  // Near a join (or between clips): on the join nearest to where it was dropped (clips set apart have none).
  const joins = order.filter((c, i) => i > 0 && meets(order[i - 1], c));
  if (joins.length === 0) return null;
  const clip = joins.reduce((best, c) => (Math.abs(c.start - time) < Math.abs(best.start - time) ? c : best));
  edits.push({ type: "setTransition", clipId: clip.id, transition: { kind, duration: 1 } });
  return { edits, select: clip.id };
}

/**
 * The edits that put a time effect on `clip`, or only on its part from `part[0]` to `part[1]`
 * (timeline seconds): the clip is cut there and the effect goes on the middle piece, `target`.
 * `newIds`: ids for the pieces cut off.
 */
export function effectEdits(
  clip: Clip,
  change: TimeChange,
  part: [number, number] | undefined,
  newIds: [string, string],
): { edits: EditAction[]; target: string } {
  const edits: EditAction[] = [];
  let target = clip.id;
  if (part) {
    const [from, to] = part;
    // The end first, so the clip's own id keeps the start and the middle piece gets a new one.
    if (to < clipEnd(clip) - MIN_CLIP) edits.push({ type: "splitClip", clipId: clip.id, newClipId: newIds[0], at: to });
    if (from > clip.start + MIN_CLIP) {
      target = newIds[1];
      edits.push({ type: "splitClip", clipId: clip.id, newClipId: target, at: from });
    }
  }
  if (change.speed !== undefined) edits.push({ type: "setSpeed", clipId: target, speed: change.speed });
  if (change.patch) edits.push({ type: "updateClip", clipId: target, patch: change.patch });
  return { edits, target };
}

/**
 * How the preview draws the blocks showing at `time` (lowest track first): a CSS filter, transform
 * and flip for the pictures, cinema bars, and colour layers over them for fades and flashes.
 * `width`, `height`: the preview's size in pixels, so blur and cinema bars match the export's.
 */
export function blocksStyle(
  blocks: Clip[],
  time: number,
  width: number,
  height = (width * 9) / 16,
): { filter?: string; mirror: boolean; transform?: string; bars: number; layers: { color: string; opacity: number; blend?: CSSProperties["mixBlendMode"] }[] } {
  const filters: string[] = [];
  const transforms: string[] = [];
  const layers: { color: string; opacity: number; blend?: CSSProperties["mixBlendMode"] }[] = [];
  let mirror = false;
  let bars = 0;
  for (const b of blocks) {
    const look = stepsFilter([...lookSteps(b.look, b.lookAmount), ...adjustSteps(b.adjust)]);
    if (look) filters.push(look);
    const u = Math.max(0, time - b.start);
    const d = Math.max(0.001, clipEnd(b) - b.start);
    // How far through the block: 0 at its start, 1 at its end.
    const through = clamp(u / d, 0, 1);
    const s = effectStrength(b);
    const v = effectSpeed(b);
    if (b.effect === "blur") filters.push(`blur(${(BLUR_SHARE * width * s).toFixed(2)}px)`);
    else if (b.effect === "mirror") mirror = !mirror;
    else if (b.effect === "fade-in") layers.push({ color: "#000", opacity: 1 - through });
    else if (b.effect === "fade-out") layers.push({ color: "#000", opacity: through });
    else if (b.effect === "flash") layers.push({ color: "#fff", opacity: 1 - through });
    else if (b.effect === "zoom-in") transforms.unshift(`translate(0%, 0%) scale(${round4(1 + 0.3 * s * ease(through))})`);
    else if (b.effect === "zoom-out") transforms.unshift(`translate(0%, 0%) scale(${round4(1 + 0.3 * s - 0.3 * s * ease(through))})`);
    else if (b.effect === "punch") {
      // A hit every 1/speed seconds for the whole block (quicker hits when they come faster than 0.5 s apart).
      const period = 1 / v;
      const f = Math.min(1, period / 0.5);
      const w = u % period;
      const k = w < 0.1 * f ? ease(clamp(w / (0.1 * f), 0, 1)) : 1 - ease(clamp((w - 0.1 * f) / (0.4 * f), 0, 1));
      transforms.unshift(`translate(0%, 0%) scale(${round4(1 + 0.2 * s * k)})`);
    } else if (b.effect === "shake") {
      // Steady for the whole block; Speed makes it faster, Strength wider (with the zoom that hides the edges).
      const x = (2 * s * (Math.sin(2 * Math.PI * 7.3 * v * u) + 0.5 * Math.sin(2 * Math.PI * 13.1 * v * u))) / 1.5;
      const y = (2 * s * (Math.sin(2 * Math.PI * 9.1 * v * u + 1) + 0.5 * Math.sin(2 * Math.PI * 5.7 * v * u + 2))) / 1.5;
      transforms.unshift(`translate(${round4(x)}%, ${round4(y)}%) scale(${round4(1 + 0.06 * s)})`);
    } else if (b.effect === "vignette") layers.push({ color: vignetteGradient(s), opacity: 1 });
    else if (b.effect === "strobe") {
      // A white flash every 0.5/speed seconds, gone by 60% of the way to the next.
      const period = 0.5 / v;
      layers.push({ color: "#fff", opacity: round4(Math.min(1, 0.6 * s) * Math.max(0, 1 - (u % period) / (0.6 * period)) ** 2) });
    } else if (b.effect === "rgb-split") filters.push(`url(#rgb-${Math.round(s * 50)})`);
    else if (b.effect === "grain") {
      // A new spot in the texture every frame, so it crawls like film.
      const n = Math.floor(u * 30);
      layers.push({ color: `${GRAIN} ${(n * 73) % 160}px ${(n * 151) % 160}px / 160px 160px`, opacity: round4(Math.min(1, 0.35 * s)), blend: "overlay" });
    } else if (b.effect === "bars") {
      // On for the whole block, no slide: the export's drawbox has no clock to animate them with.
      bars = Math.max(bars, width > height ? Math.max(0, (1 - width / height / 2.39) / 2) : 0.1);
    }
  }
  return {
    filter: filters.length ? filters.join(" ") : undefined,
    mirror,
    transform: transforms.length ? transforms.join(" ") : undefined,
    bars,
    layers,
  };
}
