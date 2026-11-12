import { expect, test } from "bun:test";
import { hexToHsv, hsvToHex } from "../src/components/ColorWheel";

test("the colour wheel's colours go to codes and back", () => {
  expect(hexToHsv("#ff0000")).toEqual([0, 1, 1]);
  expect(hsvToHex([120, 1, 1])).toBe("#00ff00");
  expect(hsvToHex([240, 1, 0.5])).toBe("#000080");
  expect(hsvToHex([0, 0, 1])).toBe("#ffffff");
  for (const hex of ["#ffd60a", "#4da3ff", "#30d158", "#ff6fb1", "#111111", "#7a3e9d"]) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
});
