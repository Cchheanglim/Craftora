import { expect, test } from "bun:test";
import { MIN_KEEP, boxOf, boxRatio, cropOf, fitRatio, moveBox, resizeBox } from "../src/project/crop";

const near = (a: object, b: object) => {
  for (const [k, v] of Object.entries(b)) expect((a as Record<string, number>)[k]).toBeCloseTo(v as number, 6);
};

test("a crop and its box are the same thing", () => {
  const crop = { left: 0.1, top: 0.2, right: 0.3, bottom: 0 };
  near(boxOf(crop), { x: 0.1, y: 0.2, w: 0.6, h: 0.8 });
  expect(cropOf(boxOf(crop))).toEqual(crop);
  // A corner is fine now (more than 45% off a side).
  expect(cropOf({ x: 0, y: 0, w: 0.5, h: 0.5 })).toEqual({ left: 0, top: 0, right: 0.5, bottom: 0.5 });
  // Never smaller than MIN_KEEP, never outside.
  near(boxOf(cropOf({ x: 0.99, y: -1, w: 0, h: 3 })), { x: 1 - MIN_KEEP, y: 0, w: MIN_KEEP, h: 1 });
});

test("moving stops at the picture's edges", () => {
  const b = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
  near(moveBox(b, 0.1, -0.05), { x: 0.3, y: 0.15, w: 0.5, h: 0.5 });
  near(moveBox(b, 1, -1), { x: 0.5, y: 0, w: 0.5, h: 0.5 });
});

test("a free resize keeps the opposite side or corner", () => {
  const b = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
  near(resizeBox(b, "e", 0.1, 0.3), { x: 0.2, y: 0.2, w: 0.6, h: 0.5 });
  near(resizeBox(b, "nw", -0.1, 0.1), { x: 0.1, y: 0.3, w: 0.6, h: 0.4 });
  // Past the edge or past the other side: stops there.
  near(resizeBox(b, "w", -1, 0), { x: 0, y: 0.2, w: 0.7, h: 0.5 });
  near(resizeBox(b, "s", 0, -1), { x: 0.2, y: 0.2, w: 0.5, h: MIN_KEEP });
});

test("with a shape, resizing keeps it and still fits", () => {
  const b = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  // Square box (ratio 1): the corner follows the larger pull, the top-left stays.
  near(resizeBox(b, "se", 0.2, 0.05, 1), { x: 0.25, y: 0.25, w: 0.7, h: 0.7 });
  // Too big for the room below and right: as large as fits.
  near(resizeBox(b, "se", 0.9, 0.9, 1), { x: 0.25, y: 0.25, w: 0.75, h: 0.75 });
  // A side grows the other way about the middle.
  near(resizeBox(b, "e", 0.1, 0, 1), { x: 0.25, y: 0.2, w: 0.6, h: 0.6 });
  // Top-left corner pulled out: the bottom-right stays.
  const r = resizeBox(b, "nw", -0.1, -0.1, 2);
  expect(r.x + r.w).toBeCloseTo(0.75);
  expect(r.y + r.h).toBeCloseTo(0.75);
  expect(r.w / r.h).toBeCloseTo(2);
});

test("a shape button picks the largest box of that shape, centred", () => {
  // 9:16 on a 16:9 video: a tall box the full height.
  const ratio = boxRatio(9 / 16, 16 / 9)!;
  const b = fitRatio({ x: 0, y: 0, w: 1, h: 1 }, ratio);
  near(b, { y: 0, h: 1, w: ratio, x: (1 - ratio) / 2 });
  // "Original": the picture's own shape, the whole picture.
  near(fitRatio({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, boxRatio("picture", 16 / 9)!), { x: 0, y: 0, w: 1, h: 1 });
  expect(boxRatio(null, 1)).toBeNull();
});
