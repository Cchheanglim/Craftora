import { expect, test } from "bun:test";
import { reducer } from "../src/project/useProject";
import { newImageProject, type MediaItem, type Project } from "../src/project/model";
import { lumaToAlpha } from "../src/lib/mask";

const source = (url: string) => ({ url, local: true, image: true, streams: [] }) as unknown as MediaItem["source"];
const photo: MediaItem = { id: "m1", name: "a.png", source: source("a.png"), hasVideo: true, hasAudio: false, videoFormat: "", audioFormat: "" };
const clip = { id: "c1", trackId: "track-1", mediaId: "m1", start: 0, in: 0, out: 5, speed: 1, volume: 1, mirror: false, reverse: false, fadeIn: 0, fadeOut: 0, crop: { left: 0, top: 0, right: 0, bottom: 0 }, size: 1, x: 0.5, y: 0.5 };
const start = (): Project => ({ ...newImageProject(), media: [photo], clips: [clip] });
const run = (project: Project, ...edits: Parameters<typeof reducer>[1][]) => edits.reduce(reducer, { project, past: [], future: [] });
const layer = (s: { project: Project }) => s.project.clips[0];

test("setMask adds and deletes the mask, each one undo step; deleting clears maskOff", () => {
  const s = run(
    start(),
    { type: "edit", transient: false, edit: { type: "setMask", clipId: "c1", mask: "data:image/png;base64,AA" } },
    { type: "edit", transient: false, edit: { type: "maskOff", clipId: "c1", off: true } },
  );
  expect(layer(s).mask).toBe("data:image/png;base64,AA");
  expect(layer(s).maskOff).toBe(true);
  expect(s.past.length).toBe(2);
  const gone = run(s.project, { type: "edit", transient: false, edit: { type: "setMask", clipId: "c1", mask: null } });
  expect(layer(gone).mask).toBeUndefined();
  expect(layer(gone).maskOff).toBeUndefined();
  expect(gone.past.length).toBe(1);
});

test("maskOff toggles and undoes back", () => {
  const on = run(start(), { type: "edit", transient: false, edit: { type: "setMask", clipId: "c1", mask: "data:x" } });
  const off = reducer(on, { type: "edit", transient: false, edit: { type: "maskOff", clipId: "c1", off: true } });
  expect(layer(off).maskOff).toBe(true);
  const back = reducer(off, { type: "edit", transient: false, edit: { type: "maskOff", clipId: "c1", off: false } });
  expect(layer(back).maskOff).toBeFalsy();
  expect(layer(reducer(off, { type: "undo" })).maskOff).toBeFalsy();
  expect(layer(reducer(off, { type: "undo" })).mask).toBe("data:x");
});

test("applyMask on a photo swaps its picture and removes the mask in one step; without a picture it keeps the mask", () => {
  const masked = run(start(), { type: "edit", transient: false, edit: { type: "setMask", clipId: "c1", mask: "data:x" } });
  const applied = reducer(masked, { type: "edit", transient: false, edit: { type: "applyMask", clipId: "c1", source: source("masked.png"), newMediaId: "m2" } });
  expect(applied.project.media.find((m) => m.id === "m1")?.source.url).toBe("masked.png");
  expect(layer(applied).mask).toBeUndefined();
  expect(applied.past.length).toBe(masked.past.length + 1);
  expect(layer(reducer(applied, { type: "undo" })).mask).toBe("data:x");
  const kept = reducer(masked, { type: "edit", transient: false, edit: { type: "applyMask", clipId: "c1" } });
  expect(kept).toBe(masked);
});

test("applyMask on a shared photo gives the layer its own", () => {
  const shared = { ...start(), clips: [clip, { ...clip, id: "c2", trackId: "track-2" }], tracks: [{ id: "track-2", name: "L" }, { id: "track-1", name: "L" }] };
  const s = run(shared, { type: "edit", transient: false, edit: { type: "applyMask", clipId: "c1", source: source("masked.png"), newMediaId: "m2" } });
  expect(s.project.clips.find((c) => c.id === "c1")?.mediaId).toBe("m2");
  expect(s.project.media.find((m) => m.id === "m1")?.source.url).toBe("a.png");
  expect(s.project.media.find((m) => m.id === "m2")?.source.url).toBe("masked.png");
});

test("a mask's brightness becomes alpha", () => {
  const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 0]);
  lumaToAlpha(px);
  expect([px[3], px[7], px[11], px[15]]).toEqual([255, 0, 128, 0]);
});
