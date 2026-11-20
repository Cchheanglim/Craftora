import { expect, test } from "bun:test";
import { waveBars } from "../src/project/model";

test("waveBars keeps the loudest of each stretch and scales the loudest bar to 1", () => {
  expect(waveBars([10, 20, 5, 40, 0, 0], 3)).toEqual([0.5, 1, 0]);
  // Fewer peaks than bars: each peak fills the bars over it.
  expect(waveBars([0, 100], 4)).toEqual([0, 0, 1, 1]);
  // All silent stays flat (no division by zero), nothing in gives nothing out.
  expect(waveBars([0, 0, 0], 2)).toEqual([0, 0]);
  expect(waveBars([], 5)).toEqual([]);
});
