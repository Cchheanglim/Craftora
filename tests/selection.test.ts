import { expect, test } from "bun:test";
import {
  combine,
  ellipsePoints,
  emptySelection,
  expandSelection,
  featherSelection,
  invertSelection,
  isEmpty,
  moveSelection,
  outlinePath,
  polygonSelection,
  rectPoints,
  selectAll,
  selectionBounds,
  wandSelection,
} from "../src/lib/selection";

const sum = (d: Uint8Array) => d.reduce((s, v) => s + v, 0) / 255;

test("a rectangle covers exactly its area, with partial edges", () => {
  const sel = polygonSelection(100, 50, rectPoints([10, 10], [30, 20]));
  expect(sel.width).toBe(100);
  expect(sum(sel.data)).toBeCloseTo(200, 0);
  expect(sel.data[15 * 100 + 15]).toBe(255);
  expect(sel.data[5 * 100 + 5]).toBe(0);
  // Half a pixel at a .5 edge.
  const half = polygonSelection(10, 10, rectPoints([2.5, 0], [5, 10]));
  expect(half.data[2]).toBe(128);
  expect(selectionBounds(sel, 100, 50)).toEqual({ left: 10, top: 10, width: 20, height: 10 });
});

test("an ellipse covers about pi·a·b; big pictures use the capped grid", () => {
  const sel = polygonSelection(200, 200, ellipsePoints([0, 0], [200, 100]));
  expect(sum(sel.data)).toBeCloseTo(Math.PI * 100 * 50, -1);
  const big = emptySelection(8192, 4096);
  expect([big.width, big.height]).toEqual([4096, 2048]);
  const quarter = polygonSelection(8192, 4096, rectPoints([0, 0], [4096, 2048]));
  expect(sum(quarter.data)).toBeCloseTo(2048 * 1024, -1);
});

test("add, subtract, intersect and invert", () => {
  const a = polygonSelection(20, 20, rectPoints([0, 0], [10, 20]));
  const b = polygonSelection(20, 20, rectPoints([5, 0], [15, 20]));
  expect(sum(combine(a, b, "add")!.data)).toBe(300);
  expect(sum(combine(a, b, "subtract")!.data)).toBe(100);
  expect(sum(combine(a, b, "intersect")!.data)).toBe(100);
  expect(combine(a, a, "subtract")).toBeNull();
  expect(combine(null, b, "add")).toBe(b);
  expect(combine(null, b, "subtract")).toBeNull();
  expect(sum(invertSelection(a).data)).toBe(200);
  expect(isEmpty(emptySelection(20, 20))).toBe(true);
  expect(isEmpty(selectAll(20, 20))).toBe(false);
});

test("feather keeps the total and softens the edge; select all stays whole", () => {
  const a = polygonSelection(60, 60, rectPoints([20, 20], [40, 40]));
  const soft = featherSelection(a, 3, 60);
  expect(sum(soft.data)).toBeCloseTo(400, -1);
  expect(soft.data[30 * 60 + 30]).toBe(255);
  const edge = soft.data[30 * 60 + 20];
  expect(edge).toBeGreaterThan(90);
  expect(edge).toBeLessThan(165);
  expect(sum(featherSelection(selectAll(60, 60), 5, 60).data)).toBe(3600);
});

test("expand and contract by a distance", () => {
  const a = polygonSelection(60, 60, rectPoints([20, 20], [40, 40]));
  const grown = expandSelection(a, 5, 60);
  expect(grown.data[30 * 60 + 16]).toBe(255);
  expect(grown.data[30 * 60 + 14]).toBe(0);
  const shrunk = expandSelection(a, -5, 60);
  expect(shrunk.data[30 * 60 + 23]).toBe(0);
  expect(shrunk.data[30 * 60 + 26]).toBe(255);
});

test("move shifts and drops what goes off the picture", () => {
  const a = polygonSelection(20, 20, rectPoints([0, 0], [4, 4]));
  const moved = moveSelection(a, 3, 2, 20, 20);
  expect(selectionBounds(moved, 20, 20)).toEqual({ left: 3, top: 2, width: 4, height: 4 });
  expect(sum(moveSelection(a, -2, 0, 20, 20).data)).toBe(8);
});

test("outline: a square is four lines; the wand picks the joined colour", () => {
  const a = polygonSelection(10, 10, rectPoints([2, 2], [6, 6]));
  expect(outlinePath(a).d).toBe("M2 2L6 2L6 6L2 6Z");
  // A hole is its own loop.
  expect(outlinePath(combine(a, polygonSelection(10, 10, rectPoints([3, 3], [5, 5])), "subtract")!).d.split("Z").length - 1).toBe(2);
  const rgba = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) rgba.set(i % 4 < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
  const wand = wandSelection(rgba, 4, 4, 0.5, 0.5, 8, 8, 10, true);
  expect(sum(wand.data)).toBe(8);
});
