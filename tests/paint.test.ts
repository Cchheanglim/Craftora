import { expect, test } from "bun:test";
import { apply, dabsAlong, floodMask, invert, multiply, photoToImage, scaleOf, tipStops } from "../src/lib/paint";

const NO_CROP = { left: 0, top: 0, right: 0, bottom: 0 };
const layer = (patch: object = {}) => ({ size: 1, x: 0.5, y: 0.5, crop: NO_CROP, mirror: false, ...patch });
const near = ([x, y]: number[], [ex, ey]: number[]) => {
  expect(x).toBeCloseTo(ex, 6);
  expect(y).toBeCloseTo(ey, 6);
};
// A 200 × 100 photo filling a 400 × 200 picture.
const photo = { width: 200, height: 100 };
const [W, H] = [400, 200];

test("an untouched photo the picture's shape fills it", () => {
  const m = photoToImage(layer(), photo, W, H);
  near(apply(m, [0, 0]), [0, 0]);
  near(apply(m, [200, 100]), [400, 200]);
  expect(scaleOf(m)).toBeCloseTo(2, 6);
});

test("mirror, quarter turn and angle move the photo's corner where the preview draws it", () => {
  near(apply(photoToImage(layer({ mirror: true }), photo, W, H), [0, 0]), [400, 0]);
  // A square photo in a square picture: its top left goes to the top right when turned a quarter, either way.
  const sq = { width: 100, height: 100 };
  near(apply(photoToImage(layer({ rotate: 90 }), sq, 300, 300), [0, 0]), [300, 0]);
  near(apply(photoToImage(layer({ angle: 90 }), sq, 300, 300), [0, 0]), [300, 0]);
  near(apply(photoToImage(layer({ angle: 180 }), sq, 300, 300), [0, 0]), [300, 300]);
  // The Mirror effect flips the crop window too.
  near(apply(photoToImage(layer(), photo, W, H, true), [0, 0]), [400, 0]);
});

test("a crop keeps the window's part of the photo in the box", () => {
  // The right half of the photo, a 100 × 100 square, fits the 400 × 200 picture as 200 × 200 in the middle.
  const m = photoToImage(layer({ crop: { ...NO_CROP, left: 0.5 } }), photo, W, H);
  near(apply(m, [100, 0]), [100, 0]);
  near(apply(m, [200, 100]), [300, 200]);
});

test("picture pixel → photo pixel undoes every step", () => {
  for (const rotate of [0, 90, 180, 270])
    for (const mirror of [false, true]) {
      const m = photoToImage(layer({ rotate, mirror, angle: 33, size: 0.6, x: 0.2, y: 0.9, crop: { left: 0.1, top: 0.2, right: 0, bottom: 0.15 } }), photo, W, H, true);
      const back = invert(m);
      for (const p of [[0, 0], [37, 81], [200, 100]]) near(apply(back, apply(m, p)), p);
      near(apply(multiply(m, back), [5, 7]), [5, 7]);
    }
});

test("dabs fall every spacing along the stroke, the rest carried to the next piece", () => {
  const a = dabsAlong([0, 0], [25, 0], 10, 0);
  expect(a.dabs).toEqual([[10, 0], [20, 0]]);
  expect(a.carry).toBeCloseTo(5, 9);
  const b = dabsAlong([25, 0], [35, 0], 10, a.carry);
  expect(b.dabs).toEqual([[30, 0]]);
  expect(b.carry).toBeCloseTo(5, 9);
  // A short move adds no dab and keeps counting.
  expect(dabsAlong([0, 0], [3, 0], 10, 2)).toEqual({ dabs: [], carry: 5 });
});

test("a tip fades from its hardness to nothing at its edge", () => {
  const stops = tipStops(0.8);
  expect(stops[0]).toEqual([0.8, 1]);
  expect(stops[stops.length - 1]).toEqual([1, 0]);
  expect(tipStops(1)[0][0]).toBeLessThan(1);
});

test("the paint bucket fills the joined area within the tolerance, or every match", () => {
  // 5 × 3: a white field split by a black wall at x = 2, one grey (near white) pixel at the right.
  const [w, h] = [5, 3];
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const set = (x: number, y: number, v: number) => data.set([v, v, v, 255], (y * w + x) * 4);
  for (let y = 0; y < h; y++) set(2, y, 0);
  set(4, 1, 240);
  const filled = (m: Uint8Array) => Array.from(m).join("");
  expect(filled(floodMask(data, w, h, 0, 0, 0, true))).toBe("110001100011000");
  expect(filled(floodMask(data, w, h, 0, 0, 0, false))).toBe("110111101011011");
  expect(filled(floodMask(data, w, h, 0, 0, 20, false))).toBe("110111101111011");
  // Outside the layer: nothing.
  expect(floodMask(data, w, h, -1, 0, 0, true).some(Boolean)).toBe(false);
  // See-through pixels all match each other whatever colour they hold.
  const clear = new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 0]);
  expect(filled(floodMask(clear, 2, 1, 0, 0, 0, true))).toBe("11");
});
