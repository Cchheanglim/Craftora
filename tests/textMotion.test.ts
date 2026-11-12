import { expect, test } from "bun:test";
import type { Clip, TextAnim } from "../src/project/model";
import { motionAt, pointsAt, textMotion } from "../src/project/textMotion";

const text = (anim: TextAnim | undefined, length = 4): Clip =>
  ({ id: "t", trackId: "x", start: 10, in: 0, out: length, speed: 1, volume: 1, mirror: false, reverse: false, fadeIn: 0, fadeOut: 0, crop: { left: 0, top: 0, right: 0, bottom: 0 }, size: 0.1, x: 0.5, y: 0.5, text: "Hi", anim }) as Clip;
const increasing = (points?: [number, number][]) => (points ?? []).every((p, i, all) => i === 0 || p[0] > all[i - 1][0]);

test("no animation draws the text as it is", () => {
  expect(textMotion(text(undefined), "Hi")).toBeUndefined();
  expect(motionAt(undefined, 1, "Hi")).toEqual({ alpha: 1, scale: 1, dy: 0, text: "Hi" });
});

test("points hold outside and join with straight lines", () => {
  const p: [number, number][] = [[1, 0], [2, 1]];
  expect([pointsAt(p, 0, 9), pointsAt(p, 1.5, 9), pointsAt(p, 3, 9), pointsAt(undefined, 1, 9)]).toEqual([0, 0.5, 1, 9]);
});

test("pop grows from nothing past its size and settles; shrink ends at nothing", () => {
  const m = textMotion(text({ in: { kind: "pop", length: 0.5 }, out: { kind: "shrink", length: 0.5 } }), "Hi")!;
  expect(pointsAt(m.scale, 0, 1)).toBe(0);
  expect(Math.max(...m.scale!.map(([, v]) => v))).toBeGreaterThan(1.05);
  expect(pointsAt(m.scale, 2, 1)).toBe(1);
  expect(pointsAt(m.scale, 4, 1)).toBe(0);
  expect(pointsAt(m.alpha, 2, 1)).toBe(1);
  expect(increasing(m.scale) && increasing(m.alpha)).toBe(true);
});

test("in and out share a short clip without overlapping", () => {
  const m = textMotion(text({ in: { kind: "fade", length: 2 }, out: { kind: "fade", length: 2 } }, 1), "Hi")!;
  expect(increasing(m.alpha)).toBe(true);
  expect(m.alpha!.at(-1)![0]).toBeLessThanOrEqual(1);
  expect(pointsAt(m.alpha, 0.5, 1)).toBeCloseTo(1);
});

test("slide up starts lower and lands; the loop repeats", () => {
  const m = textMotion(text({ in: { kind: "slide-up", length: 0.5 }, loop: { kind: "pulse", period: 1 } }), "Hi")!;
  expect(pointsAt(m.dy, 0, 0)).toBeCloseTo(0.1);
  expect(pointsAt(m.dy, 0.5, 0)).toBe(0);
  expect(motionAt(m, 1.25, "Hi").scale).toBeCloseTo(motionAt(m, 3.25, "Hi").scale);
  expect(motionAt(m, 1.25, "Hi").scale).toBeGreaterThan(1.05);
});

test("typewriter types the drawn lines in place, then shows the whole text", () => {
  const shown = "Hello there\nWorld";
  const m = textMotion(text({ in: { kind: "typewriter", length: 1 } }), shown)!;
  expect(m.typing!.length).toBe(17);
  // Lines still to come keep their place, so nothing jumps when they start.
  for (const { text: typed } of m.typing!) expect(typed.split("\n").length).toBe(2);
  expect(motionAt(m, 0.5, shown).text).toMatch(/^Hello th/);
  expect(motionAt(m, 1, shown).text).toBe(shown);
  // A long text takes a few letters a step.
  expect(textMotion(text({ in: { kind: "typewriter", length: 1 } }), "x".repeat(500))!.typing!.length).toBe(40);
});
