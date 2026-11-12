import { expect, test } from "bun:test";
import { fitTabs } from "../src/lib/fitTabs";

test("all tabs show when they fit", () => {
  expect(fitTabs([40, 60, 50], 154, 50, 2, 0)).toEqual([0, 1, 2]);
});

test("tabs that don't fit go under More, keeping the open one in view", () => {
  const widths = [40, 60, 70, 80, 60];
  // Room 200, More 50: from the start 40 + 60 fit (with gaps), the next doesn't.
  expect(fitTabs(widths, 200, 50, 2, 0)).toEqual([0, 1]);
  // The open tab (4) is kept: only the first (40) still fits beside it and More.
  expect(fitTabs(widths, 200, 50, 2, 4)).toEqual([0, 4]);
  // Nothing open (a settings panel): only from the start.
  expect(fitTabs(widths, 200, 50, 2, -1)).toEqual([0, 1]);
});
