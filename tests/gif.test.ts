import { describe, expect, it } from "vitest";
import { gifFrameAt } from "../src/lib/gif";

describe("gifFrameAt", () => {
  const times = [0, 0.1, 0.25];
  const length = 0.4;

  it("returns 0 at t = 0", () => {
    expect(gifFrameAt(times, length, 0)).toBe(0);
  });

  it("returns the active frame index mid-frame", () => {
    expect(gifFrameAt(times, length, 0.05)).toBe(0);
    expect(gifFrameAt(times, length, 0.18)).toBe(1);
    expect(gifFrameAt(times, length, 0.35)).toBe(2);
  });

  it("returns the new frame index exactly on a frame start", () => {
    expect(gifFrameAt(times, length, 0.1)).toBe(1);
    expect(gifFrameAt(times, length, 0.25)).toBe(2);
  });

  it("loops past the end of the GIF", () => {
    expect(gifFrameAt(times, length, 0.4)).toBe(0);
    expect(gifFrameAt(times, length, 0.45)).toBe(0);
    expect(gifFrameAt(times, length, 0.55)).toBe(1);
    expect(gifFrameAt(times, length, 1.05)).toBe(2);
  });

  it("returns 0 for negative times", () => {
    expect(gifFrameAt(times, length, -0.1)).toBe(0);
    expect(gifFrameAt(times, length, -5)).toBe(0);
  });
});
