/**
 * Text animations as numbers: the preview (Preview.tsx) and the export (project.rs `Motion`) draw the same points, joined
 * by straight lines, so both show the same thing at every moment.
 */
import { clipLength, type Clip, type TextIn, type TextLoop, type TextOut } from "./model";

/** The Text tab's choices, with the length (seconds) or loop time a new pick starts with. */
export const TEXT_IN: { kind: TextIn; label: string; length: number }[] = [
  { kind: "fade", label: "Fade", length: 0.5 },
  { kind: "pop", label: "Pop", length: 0.5 },
  { kind: "slide-up", label: "Slide up", length: 0.5 },
  { kind: "typewriter", label: "Typewriter", length: 1.5 },
];
export const TEXT_OUT: { kind: TextOut; label: string; length: number }[] = [
  { kind: "fade", label: "Fade", length: 0.5 },
  { kind: "shrink", label: "Shrink", length: 0.5 },
];
export const TEXT_LOOP: { kind: TextLoop; label: string; period: number }[] = [
  { kind: "bounce", label: "Bounce", period: 1 },
  { kind: "pulse", label: "Pulse", period: 1 },
];

/** [seconds, value] points: straight lines between them, the first and last values held outside them. */
export type Points = [number, number][];

/** Seconds are from the clip's start. */
export interface TextMotion {
  /** Opacity 0–1 (times the clip's fades). */
  alpha?: Points;
  /** Size × this, about the text's middle. */
  scale?: Points;
  /** Moved down by this share of the frame's height (up when negative). */
  dy?: Points;
  /** One cycle over `period` seconds, repeated from the clip's start: `scale` multiplies, `dy` adds. */
  loop?: { period: number; scale?: Points; dy?: Points };
  /** Typewriter: the text shown until each `until`; the whole text after the last. */
  typing?: { text: string; until: number }[];
}

const SAMPLES = 12;
/** Typewriter steps at most: a long text shows a few letters a step instead of one export layer per letter. */
const MAX_STEPS = 40;
const LETTERS = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const round4 = (v: number) => Math.round(v * 10_000) / 10_000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeOut = (p: number) => 1 - (1 - p) ** 3;
/** Grows past its size a little and settles back: 0 at the start, 1 at the end. */
const overshoot = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;

/** `f` of 0–1 as points over `from`..`from + length`. */
const curve = (from: number, length: number, f: (p: number) => number): Points =>
  Array.from({ length: SAMPLES + 1 }, (_, i): [number, number] => [round4(from + (length * i) / SAMPLES), round4(f(i / SAMPLES))]);

/** In's points then out's, each time later than the one before (project.rs checks that). */
function join(...parts: (Points | undefined)[]): Points | undefined {
  const points = parts.flatMap((p) => p ?? []).filter((p, i, all) => i === 0 || p[0] > all[i - 1][0]);
  return points.length ? points : undefined;
}

/** A text clip's animation; `shown` is its text as drawn (model.ts `textLines`). Undefined when it has none. */
export function textMotion(clip: Clip, shown: string): TextMotion | undefined {
  const { in: enter, out: leave, loop } = clip.anim ?? {};
  if (!enter && !leave && !loop) return undefined;
  const length = clipLength(clip);
  // In and out share the clip when they'd overlap.
  const fit = Math.min(1, length / ((enter?.length ?? 0) + (leave?.length ?? 0) || 1));
  const a = enter ? Math.max(0.05, enter.length * fit) : 0;
  const b = leave ? Math.max(0.05, leave.length * fit) : 0;
  const from = length - b;
  const inAlpha = enter && { fade: curve(0, a, (p) => p), pop: curve(0, a, (p) => clamp(p / 0.4, 0, 1)), "slide-up": curve(0, a, (p) => clamp(p * 2, 0, 1)), typewriter: undefined }[enter.kind];
  // The export can't shrink the outline with the letters: they fade while small.
  const outAlpha = leave && (leave.kind === "fade" ? curve(from, b, (q) => 1 - q) : curve(from, b, (q) => clamp((1 - q) / 0.4, 0, 1)));
  const motion: TextMotion = {
    alpha: join(inAlpha, outAlpha),
    scale: join(enter?.kind === "pop" ? curve(0, a, overshoot) : undefined, leave?.kind === "shrink" ? curve(from, b, (q) => 1 - q * q) : undefined),
    dy: enter?.kind === "slide-up" ? curve(0, a, (p) => 0.1 * (1 - easeOut(p))) : undefined,
  };
  if (loop) {
    const period = clamp(loop.period, 0.1, 10);
    motion.loop =
      loop.kind === "pulse" ? { period, scale: curve(0, period, (p) => 1 + 0.08 * Math.sin(2 * Math.PI * p)) } : { period, dy: curve(0, period, (p) => -0.04 * Math.sin(Math.PI * p)) };
  }
  if (enter?.kind === "typewriter") {
    const letters = [...LETTERS.segment(shown)].map((s) => s.segment);
    const steps = Math.min(MAX_STEPS, letters.length);
    const breaks = (text: string) => text.split("\n").length - 1;
    motion.typing = Array.from({ length: steps }, (_, k) => {
      const typed = letters.slice(0, Math.round((k * letters.length) / steps)).join("");
      // Lines still to come stay as empty lines, so the typed ones already sit where the whole text will.
      const text = typed + "\n".repeat(breaks(shown) - breaks(typed));
      return { text: text.endsWith("\n") ? `${text} ` : text, until: round4(((k + 1) * a) / steps) };
    });
  }
  return motion;
}

/** `points`' value at `u` seconds, as project.rs `lerp` draws it; `rest` without points. */
export function pointsAt(points: Points | undefined, u: number, rest: number): number {
  if (!points?.length) return rest;
  const next = points.findIndex(([t]) => u < t);
  if (next === 0) return points[0][1];
  if (next < 0) return points[points.length - 1][1];
  const [[t0, v0], [t1, v1]] = [points[next - 1], points[next]];
  return v0 + ((v1 - v0) * (u - t0)) / (t1 - t0);
}

/** How a text clip looks `u` seconds after its start: opacity, size ×, move down (share of the frame) and its text. */
export function motionAt(motion: TextMotion | undefined, u: number, shown: string) {
  const cycle = motion?.loop && ((u % motion.loop.period) + motion.loop.period) % motion.loop.period;
  return {
    alpha: pointsAt(motion?.alpha, u, 1),
    scale: pointsAt(motion?.scale, u, 1) * (cycle === undefined ? 1 : pointsAt(motion?.loop?.scale, cycle, 1)),
    dy: pointsAt(motion?.dy, u, 0) + (cycle === undefined ? 0 : pointsAt(motion?.loop?.dy, cycle, 0)),
    text: motion?.typing?.find((s) => u < s.until)?.text ?? shown,
  };
}
