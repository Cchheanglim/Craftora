import { expect, test } from "bun:test";
import { fitTabs } from "../src/lib/fitTabs";

test("all tabs show when they fit", () => {
  expect(fitTabs([40, 60, 50], 154, 50, 2)).toEqual([0, 1, 2]);
});

test("tabs that don't fit go under More, and the row never rearranges", () => {
  const widths = [40, 60, 70, 80, 60];
  // Room 200, More 50: from the start 40 + 60 fit (with gaps), the next doesn't, whichever tab is open.
  expect(fitTabs(widths, 200, 50, 2)).toEqual([0, 1]);
});
