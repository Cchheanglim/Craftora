import { expect, test } from "bun:test";
import { isShape, isText } from "../src/project/model";
import { SHAPES, newShapeClip, shapeBox, shapeSvg } from "../src/project/shapes";

test("every shape has a unique id and a non-empty SVG path", () => {
  expect(SHAPES.length).toBeGreaterThan(0);
  const ids = SHAPES.map((s) => s.id);
  expect(new Set(ids).size).toBe(SHAPES.length);
  for (const shape of SHAPES) {
    expect(shape.path.trim().length).toBeGreaterThan(0);
  }
});

test("shapeBox places and sizes a shape on a 1920×1080 frame", () => {
  expect(shapeBox({ size: 0.25, aspect: 1, x: 0.5, y: 0.5 }, 1920, 1080)).toEqual({
    left: 720,
    top: 300,
    width: 480,
    height: 480,
  });
});

test("shapeSvg draws filled and outlined shapes and rejects bad colours", () => {
  const filled = shapeSvg({ shape: "star", color: "#ff6fb1", rotate: 35, outline: 0 }, 1920, 1080);
  expect(filled).toContain("#ff6fb1");
  expect(filled).toContain("rotate(35)");
  expect(filled).not.toContain('fill="none"');

  const outlined = shapeSvg({ shape: "rect", color: "#4da3ff", outline: 0.01 }, 1920, 1080);
  expect(outlined).toContain('fill="none"');
  expect(outlined).toContain('stroke="#4da3ff"');

  const badColor = shapeSvg({ shape: "circle", color: "red;x" }, 1920, 1080);
  expect(badColor).toContain('fill="#ffffff"');
  expect(badColor).not.toContain("red;x");
});

test("newShapeClip creates a shape clip without text", () => {
  const clip = newShapeClip("s1", "heart", 2, 4, "track-1");
  expect(clip.shape).toBe("heart");
  expect(clip.text).toBeUndefined();
  expect(isShape(clip)).toBe(true);
  expect(isText(clip)).toBe(false);
});
