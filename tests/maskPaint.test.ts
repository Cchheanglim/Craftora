import { expect, test } from "bun:test";
import { alphaToGrey, clipMaskBox, greyHex, greysOf, lumaOf, lumaToAlpha, maskAffine } from "../src/lib/mask";
import { apply, scaleOf } from "../src/lib/paint";
import { NO_CROP, newImageProject, type Clip, type Project } from "../src/project/model";
import { reducer } from "../src/project/useProject";

const near = ([x, y]: number[], [ex, ey]: number[]) => {
  expect(x).toBeCloseTo(ex, 6);
  expect(y).toBeCloseTo(ey, 6);
};

test("maskAffine maps an unturned box's corners to the mask's corners", () => {
  const box = { left: 100, top: 50, width: 200, height: 100 };
  const mask = { width: 400, height: 150 };
  const m = maskAffine(box, mask);
  near(apply(m, [100, 50]), [0, 0]);
  near(apply(m, [300, 50]), [400, 0]);
  near(apply(m, [300, 150]), [400, 150]);
  near(apply(m, [100, 150]), [0, 150]);
  near(apply(m, [200, 100]), [200, 75]);
});

test("maskAffine maps a 90-degree turned box's corners to the mask's corners", () => {
  // Box centred at (200, 100), width 200, height 100, turned 90 deg clockwise:
  // top-left (-100, -50) -> (+50, -100) + (200, 100) = (250, 0)
  // top-right (+100, -50) -> (+50, +100) + (200, 100) = (250, 200)
  // bottom-right (+100, +50) -> (-50, +100) + (200, 100) = (150, 200)
  // bottom-left (-100, +50) -> (-50, -100) + (200, 100) = (150, 0)
  const box = { left: 100, top: 50, width: 200, height: 100, angle: 90 };
  const mask = { width: 400, height: 200 };
  const m = maskAffine(box, mask);
  near(apply(m, [250, 0]), [0, 0]);
  near(apply(m, [250, 200]), [400, 0]);
  near(apply(m, [150, 200]), [400, 200]);
  near(apply(m, [150, 0]), [0, 200]);
  near(apply(m, [200, 100]), [200, 100]);
  expect(scaleOf(m)).toBeCloseTo(2, 6);
});

test("maskAffine handles arbitrary angles and zero-size boxes safely", () => {
  const m180 = maskAffine({ left: 0, top: 0, width: 100, height: 50, angle: 180 }, { width: 100, height: 50 });
  near(apply(m180, [100, 50]), [0, 0]);
  near(apply(m180, [0, 0]), [100, 50]);

  const mZero = maskAffine({ left: 10, top: 20, width: 0, height: 0, angle: 45 }, { width: 10, height: 10 });
  const mapped = apply(mZero, [10, 20]);
  expect(Number.isFinite(mapped[0])).toBe(true);
  expect(Number.isFinite(mapped[1])).toBe(true);
});

test("clipMaskBox matches shape and photo layer geometry and turns", () => {
  const shape: Clip = {
    id: "s1",
    trackId: "t1",
    shape: "rect",
    start: 0,
    in: 0,
    out: 5,
    speed: 1,
    volume: 1,
    mirror: false,
    reverse: false,
    rotate: 90,
    fadeIn: 0,
    fadeOut: 0,
    crop: NO_CROP,
    size: 0.5,
    aspect: 0.5,
    x: 0.5,
    y: 0.5,
  };
  expect(clipMaskBox(shape, 400, 200)).toEqual({ left: 100, top: 50, width: 200, height: 100, angle: 90 });

  const photo: Clip = {
    id: "p1",
    trackId: "t2",
    mediaId: "m1",
    start: 0,
    in: 0,
    out: 5,
    speed: 1,
    volume: 1,
    mirror: true,
    reverse: false,
    rotate: 90,
    angle: 35,
    fadeIn: 0,
    fadeOut: 0,
    crop: NO_CROP,
    size: 1,
    x: 0.5,
    y: 0.5,
  };
  // 2:1 photo turned 90 deg becomes 1:2 upright; in a 400x200 frame it fits 100x200 centred, turned by angle 35.
  expect(clipMaskBox(photo, 400, 200, 2)).toEqual({ left: 150, top: 0, width: 100, height: 200, angle: 35 });
});

test("greyHex and greysOf use Rec. 709 luminance matching lumaToAlpha", () => {
  expect(greysOf({ fg: "#000000", bg: "#ffffff" })).toEqual({ fg: "#000000", bg: "#ffffff" });
  expect(greyHex("#7f7f7f")).toBe("#7f7f7f");

  for (const [hex, rgb] of [
    ["#ff0000", [255, 0, 0]],
    ["#00ff00", [0, 255, 0]],
    ["#0000ff", [0, 0, 255]],
    ["#33aa77", [0x33, 0xaa, 0x77]],
  ] as const) {
    const px = new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 255]);
    lumaToAlpha(px);
    const v = lumaOf(rgb[0], rgb[1], rgb[2]);
    expect(v).toBe(px[3]);
    expect(greyHex(hex)).toBe(`#${v.toString(16).padStart(2, "0").repeat(3)}`);
  }
});

test("painting a mask commits one undo step via setMask even while maskOff is true", () => {
  const clip: Clip = {
    id: "c1",
    trackId: "track-1",
    shape: "rect",
    start: 0,
    in: 0,
    out: 5,
    speed: 1,
    volume: 1,
    mirror: false,
    reverse: false,
    fadeIn: 0,
    fadeOut: 0,
    crop: NO_CROP,
    size: 0.5,
    aspect: 1,
    x: 0.5,
    y: 0.5,
    mask: "data:image/png;base64,OLD",
    maskOff: true,
  };
  const project: Project = { ...newImageProject(400, 200), clips: [clip] };
  const s1 = reducer({ project, past: [], future: [] }, { type: "edit", transient: false, edit: { type: "setMask", clipId: "c1", mask: "data:image/png;base64,PAINTED" } });
  expect(s1.project.clips[0].mask).toBe("data:image/png;base64,PAINTED");
  expect(s1.project.clips[0].maskOff).toBe(true);
  expect(s1.past.length).toBe(1);

  const undone = reducer(s1, { type: "undo" });
  expect(undone.project.clips[0].mask).toBe("data:image/png;base64,OLD");
  expect(undone.project.clips[0].maskOff).toBe(true);

  const redone = reducer(undone, { type: "redo" });
  expect(redone.project.clips[0].mask).toBe("data:image/png;base64,PAINTED");
});

test("alphaToGrey turns the alpha channel into opaque greys (255 = white, 0 = black)", () => {
  const px = new Uint8ClampedArray([
    10, 20, 30, 0,
    40, 50, 60, 128,
    70, 80, 90, 255,
  ]);
  alphaToGrey(px);
  expect(Array.from(px)).toEqual([
    0, 0, 0, 255,
    128, 128, 128, 255,
    255, 255, 255, 255,
  ]);
  // Round-trips back to the same alpha under lumaToAlpha.
  lumaToAlpha(px);
  expect([px[3], px[7], px[11]]).toEqual([0, 128, 255]);
});
