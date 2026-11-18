import { expect, test } from "bun:test";
import { isShape, isText } from "../src/project/model";
import { SHAPES, colourName, newShapeClip, shapeBox, shapeSvg, starPath } from "../src/project/shapes";

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

test("a star draws as many points as asked; 5 keeps the original star", () => {
  const corners = (svg: string) => (svg.match(/ d="([^"]*)"/)![1].match(/[ML]/g) ?? []).length;
  expect(corners(shapeSvg({ shape: "star", points: 8 }, 100, 100))).toBe(16);
  expect(corners(shapeSvg({ shape: "star", points: 3 }, 100, 100))).toBe(6);
  expect(shapeSvg({ shape: "star", points: 5 }, 100, 100)).toBe(shapeSvg({ shape: "star" }, 100, 100));
  expect(starPath(4).startsWith("M 50.00 0.00")).toBe(true);
});

test("colourName gives an everyday word for a shape's colour", () => {
  expect(colourName("#ff0000")).toBe("red");
  expect(colourName("#fa2d48")).toBe("red");
  expect(colourName("#3d7cf0")).toBe("blue");
  expect(colourName("#f39a1e")).toBe("orange");
  expect(colourName("#ffd400")).toBe("yellow");
  expect(colourName("#22c55e")).toBe("green");
  expect(colourName("#ffffff")).toBe("white");
  expect(colourName("#111111")).toBe("black");
  expect(colourName("#808080")).toBe("grey");
  expect(colourName("#ec4899")).toBe("pink");
  expect(colourName(undefined)).toBe("");
});
