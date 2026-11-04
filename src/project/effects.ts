/**
 * Filters, effects and transitions (the right panel's tabs), dragged onto the timeline:
 * - Filters (colour looks) and picture effects are blocks on a track: for their time they change
 *   every picture under them (not text). The preview and the export draw the same maths. Dropped
 *   on a clip, a block covers that clip (a piece of a split clip covers just that piece).
 * - Time effects (slow motion, speed up, reverse) change the clip (or piece) they're dropped on.
 * - Transitions go on the join between two clips.
 */
import { MIN_CLIP, TRANSITION_KINDS, clipEnd, clipLength, mainTrack, showsPicture, trackOrder, type Clip, type Project, type Transition } from "./model";
import type { ClipPatch, EditAction } from "./actions";

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

/** A filter's steps, for the export; none for no filter (or one this version doesn't know). */
export const lookSteps = (id?: string): LookStep[] => [...(LOOKS.find((l) => l.id === id)?.steps ?? [])];

/** A filter's CSS, for the preview; undefined for none. */
export function lookFilter(id?: string): string | undefined {
  const steps = lookSteps(id);
  return steps.length ? steps.map(([op, amount]) => `${op}(${op === "hue-rotate" ? `${amount}deg` : amount})`).join(" ") : undefined;
}

/** Picture effects: blocks like filters (project.rs `effect_filter` draws them in the export). */
export const PICTURE_EFFECTS = [
  { id: "fade-in", label: "Fade in" },
  { id: "fade-out", label: "Fade out" },
  { id: "flash", label: "Flash" },
  { id: "blur", label: "Blur" },
  { id: "mirror", label: "Mirror" },
] as const;
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
  | { kind: "time"; id: string }
  | { kind: "transition"; id: Transition["kind"] };

/** A new filter or effect block off any clip lasts this long; drag its edges to change it. */
export const BLOCK_LENGTH = 3;

/** A filter or effect block's name on the timeline and in Edit & export. */
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
    const clip = clipAt(mediaOn(dropped?.id).filter((c) => showsPicture(p, c)));
    const [at, length] = clip ? [clip.start, clipLength(clip)] : [time, BLOCK_LENGTH];
    return { edits: [{ type: "addBlock", clipId: newIds[0], at, length, trackId: dropped?.id, ...block }], select: newIds[0] };
  }
  const track = dropped ?? mainTrack(p);
  if (!track || track.locked) return null;
  const order = mediaOn(track.id);
  if (item.kind === "time") {
    const clip = clipAt(order);
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
 * How the preview draws the blocks showing at `time` (lowest track first): a CSS filter and flip for
 * the pictures, and colour layers over them for fades and flashes. `width`: the preview's width in
 * pixels, so blur matches the export's.
 */
export function blocksStyle(blocks: Clip[], time: number, width: number): { filter?: string; mirror: boolean; layers: { color: string; opacity: number }[] } {
  const filters: string[] = [];
  const layers: { color: string; opacity: number }[] = [];
  let mirror = false;
  for (const b of blocks) {
    const look = lookFilter(b.look);
    if (look) filters.push(look);
    // How far through the block: 0 at its start, 1 at its end.
    const through = Math.min(1, Math.max(0, (time - b.start) / Math.max(0.001, clipEnd(b) - b.start)));
    if (b.effect === "blur") filters.push(`blur(${(BLUR_SHARE * width).toFixed(2)}px)`);
    else if (b.effect === "mirror") mirror = !mirror;
    else if (b.effect === "fade-in") layers.push({ color: "#000", opacity: 1 - through });
    else if (b.effect === "fade-out") layers.push({ color: "#000", opacity: through });
    else if (b.effect === "flash") layers.push({ color: "#fff", opacity: 1 - through });
  }
  return { filter: filters.length ? filters.join(" ") : undefined, mirror, layers };
}
