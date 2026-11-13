import { expect, test } from "bun:test";
import type { Clip } from "../src/project/model";
import { NO_CROP } from "../src/project/model";
import { layerBox, placeAt } from "../src/project/layerBox";

const pic = (more: Partial<Clip> = {}) => ({ size: 1, x: 0.5, y: 0.5, crop: NO_CROP, ...more }) as Clip;
const near = (a: Record<string, number>, b: Record<string, number>) => Object.keys(b).forEach((k) => expect(a[k]).toBeCloseTo(b[k], 6));

test("a size-1 picture fits a 1080×1080 image, centred", () => {
  // 16:9 photo: full width, 607.5 tall, centred.
  near({ ...layerBox(pic(), 16 / 9, 1080, 1080) }, { left: 0, top: 236.25, width: 1080, height: 607.5 });
  // Fill covers instead: full height, spilling sideways.
  near({ ...layerBox(pic({ fill: true }), 16 / 9, 1080, 1080) }, { top: 0, height: 1080, width: 1920, left: -420 });
});

test("a quarter turn and a crop change the shape", () => {
  near({ ...layerBox(pic({ rotate: 90 }), 16 / 9, 1080, 1080) }, { width: 607.5, height: 1080 });
  near({ ...layerBox(pic({ crop: { left: 0.25, right: 0.25, top: 0, bottom: 0 } }), 2, 1000, 1000) }, { width: 1000, height: 1000 });
});

test("placeAt puts a picture back where layerBox says, round trip", () => {
  for (const c of [pic({ size: 0.4, x: 0.2, y: 0.9 }), pic({ size: 0.9, x: 0.3, y: 0.1, fill: true }), pic({ size: 0.7, rotate: 270 })]) {
    const box = layerBox(c, 4 / 3, 1920, 1080);
    near(placeAt(c, 4 / 3, 1920, 1080, box) as Record<string, number>, { size: c.size, x: c.x, y: c.y });
  }
  // Typed pixels: 540 wide at left 100, top 50 on 1080×1080.
  const moved = { ...pic({ size: 0.4 }), ...placeAt(pic({ size: 0.4 }), 1, 1080, 1080, { left: 100, top: 50, width: 540, height: 0 }) } as Clip;
  near({ ...layerBox(moved, 1, 1080, 1080) }, { left: 100, top: 50, width: 540, height: 540 });
});

test("as wide as the image: x has no free space and stays as it was", () => {
  expect(placeAt(pic({ x: 0.3 }), 1, 1080, 1080, { left: 0, top: 0, width: 1080, height: 1080 }).x).toBe(0.3);
});

test("shapes take width and height separately", () => {
  const s = { ...pic({ size: 0.25, aspect: 1 }), shape: "rect" } as Clip;
  const at = placeAt(s, 1, 1000, 500, { left: 10, top: 20, width: 300, height: 150 });
  near({ ...layerBox({ ...s, ...at } as Clip, 1, 1000, 500) }, { left: 10, top: 20, width: 300, height: 150 });
});

test("a typed size past what the export takes is held at the largest it allows", () => {
  expect(placeAt(pic(), 1, 1080, 1080, { left: 0, top: 0, width: 3000, height: 0 }).size).toBe(1);
  const s = { ...pic({ size: 0.25, aspect: 1 }), shape: "rect" } as Clip;
  expect(placeAt(s, 1, 1000, 500, { left: 0, top: 0, width: 5000, height: 50000 })).toMatchObject({ size: 2, aspect: 5 });
});
