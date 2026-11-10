/**
 * Filters, effects and transitions (the right panel's tabs), dragged onto the timeline:
 * - Filters (colour looks) and picture effects are blocks on a track: for their time they change
 *   every picture under them (not text). The preview and the export draw the same maths. Dropped
 *   on a clip, a block covers that clip (a piece of a split clip covers just that piece).
 * - Time effects (slow motion, speed up, reverse) change the clip (or piece) they're dropped on.
 * - Transitions go on the join between two clips.
 */
import { MIN_CLIP, TRANSITION_KINDS, clipEnd, clipLength, isStill, mainTrack, showsPicture, trackOrder, type Clip, type Project, type Transition } from "./model";
import type { ClipPatch, EditAction } from "./actions";
import type { ShapeId } from "./shapes";

/**
 * One colour step of a filter: a CSS filter function and its amount (degrees for hue-rotate). The
 * preview applies the steps in order; the export draws the same maths (project.rs `look_filter`).
 */
export type LookStep = readonly ["grayscale" | "sepia" | "saturate" | "hue-rotate" | "brightness" | "contrast" | "invert", number];

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

/** A filter's CSS, for the preview; undefined for none. */
export function lookFilter(id?: string, amount = 1): string | undefined {
  const steps = lookSteps(id, amount);
  return steps.length ? steps.map(([op, a]) => `${op}(${op === "hue-rotate" ? `${a}deg` : a})`).join(" ") : undefined;
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
] as const satisfies readonly { id: string; label: string; category: "camera" | "style" | "old" }[];
export type PictureEffectId = (typeof PICTURE_EFFECTS)[number]["id"];

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
  | { kind: "effect"; id: PictureEffectId }
  | { kind: "fade"; id: "in" | "out" }
  | { kind: "time"; id: string }
  | { kind: "transition"; id: Transition["kind"] }
  | { kind: "shape"; id: ShapeId };

/** A new filter or effect block off any clip lasts this long; drag its edges to change it. */
export const BLOCK_LENGTH = 3;

/** A filter or effect block's name on the timeline and in Edit. */
export function blockLabel(c: Clip): string {
  return LOOKS.find((l) => l.id === c.look)?.label ?? PICTURE_EFFECTS.find((e) => e.id === c.effect)?.label ?? "Effect";
}

/**
 * The edits a dragged (or clicked) item makes when it lands at `time` on track `trackId`, and the
 * clip to select afterwards. On a clip there, a filter or effect covers that clip and a time effect
 * changes it; off any clip, a filter or effect is a short block at `time`. With no track (clicked
 * with nothing selected), time effects and transitions use the main track. Null when there's
 * nothing there for it to go on. `newIds`: ids for any clips it makes.
 */
export function dropEdits(
  p: Project,
  item: FxItem,
  trackId: string | undefined,
  time: number,
  newIds: [string, string],
): { edits: EditAction[]; select?: string } | null {
  const dropped = p.tracks.find((t) => t.id === trackId);
  const mediaOn = (id?: string) => (id ? trackOrder(p, id).filter((c) => c.mediaId) : []);
  const clipAt = (clips: Clip[]) => clips.find((c) => time >= c.start && time < clipEnd(c));
  if (item.kind === "filter" || item.kind === "effect") {
    const block = item.kind === "filter" ? { look: item.id } : { effect: item.id };
    // Dropped on a video or picture: it goes inside that clip (one filter and one effect each; a new one replaces it).
    const clip = clipAt(mediaOn(dropped?.id).filter((c) => showsPicture(p, c)));
    if (clip) {
      const patch = item.kind === "filter" ? { look: item.id, lookAmount: 1 } : { effect: item.id };
      return { edits: [{ type: "updateClip", clipId: clip.id, patch }], select: clip.id };
    }
    // On an empty spot: a block of its own, to stretch over several clips.
    const length = item.id === "punch" ? 0.6 : item.id === "shake" ? 1 : BLOCK_LENGTH;
    return { edits: [{ type: "addBlock", clipId: newIds[0], at: time, length, trackId: dropped?.id, ...block }], select: newIds[0] };
  }
  if (item.kind === "shape") {
    return { edits: [{ type: "addShape", clipId: newIds[0], shape: item.id, at: time, length: BLOCK_LENGTH, trackId: dropped?.id }], select: newIds[0] };
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
  // A transition: on the join nearest to where it was dropped.
  const joins = order.slice(1);
  if (joins.length === 0) return null;
  const clip = joins.reduce((best, c) => (Math.abs(c.start - time) < Math.abs(best.start - time) ? c : best));
  const kind = TRANSITION_KINDS.find((t) => t.kind === item.id)?.kind ?? "crossfade";
  const edits: EditAction[] = [];
  // Transitions need clips back to back: the magnet does that.
  if (!track.magnetic) edits.push({ type: "setMagnetic", trackId: track.id, magnetic: true });
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
): { filter?: string; mirror: boolean; transform?: string; bars: number; layers: { color: string; opacity: number }[] } {
  const filters: string[] = [];
  const transforms: string[] = [];
  const layers: { color: string; opacity: number }[] = [];
  let mirror = false;
  let bars = 0;
  for (const b of blocks) {
    const look = lookFilter(b.look, b.lookAmount);
    if (look) filters.push(look);
    const u = Math.max(0, time - b.start);
    const d = Math.max(0.001, clipEnd(b) - b.start);
    // How far through the block: 0 at its start, 1 at its end.
    const through = clamp(u / d, 0, 1);
    if (b.effect === "blur") filters.push(`blur(${(BLUR_SHARE * width).toFixed(2)}px)`);
    else if (b.effect === "mirror") mirror = !mirror;
    else if (b.effect === "fade-in") layers.push({ color: "#000", opacity: 1 - through });
    else if (b.effect === "fade-out") layers.push({ color: "#000", opacity: through });
    else if (b.effect === "flash") layers.push({ color: "#fff", opacity: 1 - through });
    else if (b.effect === "zoom-in") transforms.unshift(`translate(0%, 0%) scale(${round4(1 + 0.3 * ease(through))})`);
    else if (b.effect === "zoom-out") transforms.unshift(`translate(0%, 0%) scale(${round4(1.3 - 0.3 * ease(through))})`);
    else if (b.effect === "punch") {
      const k = u < 0.1 ? ease(clamp(u / 0.1, 0, 1)) : 1 - ease(clamp((u - 0.1) / 0.4, 0, 1));
      transforms.unshift(`translate(0%, 0%) scale(${round4(1 + 0.2 * k)})`);
    } else if (b.effect === "shake") {
      const a = (1 - through) * (1 - through);
      const x = (2 * a * (Math.sin(2 * Math.PI * 7.3 * u) + 0.5 * Math.sin(2 * Math.PI * 13.1 * u))) / 1.5;
      const y = (2 * a * (Math.sin(2 * Math.PI * 9.1 * u + 1) + 0.5 * Math.sin(2 * Math.PI * 5.7 * u + 2))) / 1.5;
      // The zoom that hides the edges dies away with the shake, so it ends without a jump.
      transforms.unshift(`translate(${round4(x)}%, ${round4(y)}%) scale(${round4(1 + 0.06 * a)})`);
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
