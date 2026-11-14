import { expect, test } from "bun:test";
import { hasStyle, styleFilter } from "../src/lib/layerStyle";

const offset = (svg: string) => svg.match(/feOffset[^>]*dx="([-\d.]+)" dy="([-\d.]+)"/)!.slice(1).map(Number);

test("a layer style is one filter: shadow, glow and stroke under the layer at its Fill", () => {
  const svg = styleFilter("s", { shadow: { color: "#000000", opacity: 0.5, angle: 90, distance: 0.01, size: 0.01 }, glow: { color: "#ffffff", opacity: 1, size: 0.02 }, stroke: { color: "#ff0000", size: 0.005 } }, 1000, 0.4);
  // Lit from above: the shadow falls straight down, 10 px at 1000 px per share.
  expect(offset(svg)).toEqual([0, 10]);
  expect(svg).toContain('operator="dilate" radius="5"');
  expect(svg).toContain('slope="0.4"');
  expect(svg.match(/<feMergeNode in="(\w+)"/g)?.map((m) => m.split('"')[1])).toEqual(["shadow", "glow", "stroke", "own"]);
  // Bad colours never reach the markup.
  expect(styleFilter("s", { stroke: { color: '"/><script>', size: 0.01 } }, 100)).toContain('flood-color="#000000"');
});

test("a turned layer's shadow still falls the way the light says", () => {
  const shadow = { color: "#000000", opacity: 1, angle: 90, distance: 0.01, size: 0 };
  // Turned 90° clockwise by CSS after the filter: inside it, "down" must point left so it ends up down.
  const [dx, dy] = offset(styleFilter("s", { shadow }, 1000, 1, undefined, 90));
  expect(Math.round(dx)).toBe(10);
  expect(Math.round(dy)).toBe(0);
  expect(hasStyle({})).toBe(false);
  expect(hasStyle({ stroke: { color: "#000000", size: 0 } })).toBe(false);
});
