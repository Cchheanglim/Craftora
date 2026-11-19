import { expect, test } from "bun:test";
import { NO_CROP, emptyProject, mediaFromSource, newImageProject, type Clip, type Project } from "../src/project/model";
import { applyEdit } from "../src/project/actions";
import { planExport } from "../src/project/exportPlan";
import { layerBox, placeAt, stretchSide } from "../src/project/layerBox";
import { reducer } from "../src/project/useProject";
import { clipMaskBox, photoToMask, remapMaskAffine } from "../src/lib/mask";
import { apply } from "../src/lib/paint";
import type { MediaSource } from "../src/types";

const pic = (more: Partial<Clip> = {}) => ({ size: 1, x: 0.5, y: 0.5, crop: NO_CROP, ...more }) as Clip;
const near = (a: Record<string, number>, b: Record<string, number>) => Object.keys(b).forEach((k) => expect(a[k]).toBeCloseTo(b[k], 5));

const videoSource: MediaSource = {
  url: "C:\\clip.mp4",
  title: "clip",
  uploader: "",
  duration: 10,
  local: true,
  previewUrl: "",
  image: false,
  streams: [{ id: "local:video", kind: "video", label: "1080p", detail: "", sizeMb: 5 }],
};

test("absent aspect renders the exact same box as before", () => {
  const box = layerBox(pic({ size: 0.5, x: 0.25, y: 0.75 }), 16 / 9, 1920, 1080);
  near({ ...box }, { left: 240, top: 405, width: 960, height: 540 });
});

test("dragging any side of a photo moves only that side and keeps the opposite side put", () => {
  const W = 1920;
  const H = 1080;
  const base = pic({ size: 0.5, x: 0.5, y: 0.5 });
  const start = layerBox(base, 16 / 9, W, H); // left 480, top 270, width 960, height 540

  const cases: { side: "n" | "s" | "e" | "w"; delta: number; expected: { left: number; top: number; width: number; height: number } }[] = [
    { side: "e", delta: 240, expected: { left: 480, top: 270, width: 1200, height: 540 } },
    { side: "w", delta: -240, expected: { left: 240, top: 270, width: 1200, height: 540 } },
    { side: "s", delta: 135, expected: { left: 480, top: 270, width: 960, height: 675 } },
    { side: "n", delta: -135, expected: { left: 480, top: 135, width: 960, height: 675 } },
  ];

  for (const { side, delta, expected } of cases) {
    const patch = stretchSide(base, start, side, delta, W, H, false);
    const next = { ...base, ...patch };
    const box = layerBox(next, 16 / 9, W, H);
    near({ ...box }, expected);
    // Opposite edges stay fixed.
    if (side === "w") expect(box.left + box.width).toBeCloseTo(start.left + start.width, 5);
    if (side === "e") expect(box.left).toBeCloseTo(start.left, 5);
    if (side === "n") expect(box.top + box.height).toBeCloseTo(start.top + start.height, 5);
    if (side === "s") expect(box.top).toBeCloseTo(start.top, 5);
  }
});

test("stretchSide works with crop, 90° rotation, and Image editor off-canvas layers", () => {
  const c = pic({ size: 0.5, x: 0.5, y: 0.5, rotate: 90, crop: { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 } });
  const start = layerBox(c, 16 / 9, 1000, 1000);
  const patch = stretchSide(c, start, "e", 150, 1000, 1000, true);
  const after = layerBox({ ...c, ...patch }, 16 / 9, 1000, 1000);
  near({ ...after }, { left: start.left, top: start.top, width: start.width + 150, height: start.height });

  // Off-canvas left edge stays put when dragging east in Image editor (freeEdges = true).
  const off = pic({ size: 0.4, x: -0.25, y: 0.5 });
  const offStart = layerBox(off, 1, 1000, 1000); // left -150, width 400
  const offPatch = stretchSide(off, offStart, "e", 100, 1000, 1000, true);
  const offAfter = layerBox({ ...off, ...offPatch }, 1, 1000, 1000);
  near({ ...offAfter }, { left: -150, top: offStart.top, width: 500, height: 400 });
});

test("stretchSide respects stage bounds in Video editor and clamps aspect/size", () => {
  const c = pic({ size: 0.5, x: 0.5, y: 0.5 });
  const start = layerBox(c, 16 / 9, 1920, 1080); // left 480, width 960
  // Dragging east far past the stage edge stops at W - left without shifting the left edge.
  const far = stretchSide(c, start, "e", 2000, 1920, 1080, false);
  const farBox = layerBox({ ...c, ...far }, 16 / 9, 1920, 1080);
  near({ ...farBox }, { left: 480, top: 270, width: 1440, height: 540 });

  // Shrinking height stops at MIN_ASPECT (0.05).
  const thin = stretchSide(c, start, "s", -2000, 1920, 1080, false);
  expect(thin.aspect).toBeCloseTo(0.05, 5);
  expect(thin.size).toBeGreaterThanOrEqual(0.1);
});

test("placeAt keeps the stretched shape when resizing uniformly", () => {
  const stretched = pic({ size: 0.5, aspect: 0.5, x: 0.5, y: 0.5 });
  const box = layerBox(stretched, 1, 1000, 1000);
  near({ ...box }, { width: 500, height: 250 });
  const resized = { ...stretched, ...placeAt(stretched, 1, 1000, 1000, { ...box, width: 800 }) };
  near({ ...layerBox(resized, 1, 1000, 1000) }, { width: 800, height: 400 });
});

test("side stretch drag commits as one undo step and clamps aspect in updateClip", () => {
  const media = mediaFromSource(videoSource);
  const p = applyEdit(applyEdit(emptyProject(), { type: "importMedia", item: media }), { type: "addClip", clipId: "c1", mediaId: media.id, at: 0 });
  let state = { project: p, past: [] as Project[], future: [] as Project[] };
  state = reducer(state, { type: "checkpoint" });
  state = reducer(state, { type: "edit", transient: true, edit: { type: "updateClip", clipId: "c1", patch: { size: 0.8, aspect: 0.5, x: 0.5, y: 0.5 } } });
  state = reducer(state, { type: "edit", transient: true, edit: { type: "updateClip", clipId: "c1", patch: { size: 0.8, aspect: 0.4, x: 0.5, y: 0.5 } } });
  expect(state.past.length).toBe(1);
  expect(state.project.clips[0].aspect).toBe(0.4);

  const undone = reducer(state, { type: "undo" });
  expect(undone.project.clips[0].aspect).toBeUndefined();
  expect(applyEdit(p, { type: "updateClip", clipId: "c1", patch: { aspect: 20 } }).clips[0].aspect).toBe(5);
  expect(applyEdit(p, { type: "updateClip", clipId: "c1", patch: { aspect: 0.001 } }).clips[0].aspect).toBe(0.05);
});

test("planExport keeps old simple output when aspect is absent and renders with scale when stretched", () => {
  const media = mediaFromSource(videoSource);
  let p = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c1", mediaId: media.id, at: 0 });
  const settings = { output: "video", videoContainer: "mp4", audioContainer: "mp3", cutMode: "fast", frameId: "1080p", quality: "fast" } as const;

  const plain = planExport(p, settings);
  expect(plain.kind).toBe("simple");
  expect(plain.command).not.toContain("scale");

  const stretched = applyEdit(p, { type: "updateClip", clipId: "c1", patch: { aspect: 0.3 } });
  const plan = planExport(stretched, settings);
  expect(plan.kind).toBe("render");
  expect(plan.command).toContain("scale");
});

test("clipMaskBox and remapMaskAffine follow the stretched box", () => {
  const base = pic({ size: 0.5, aspect: 1.5, x: 0.4, y: 0.6, angle: 15 });
  const clip: Clip = { ...base, id: "c1", trackId: "t1", mediaId: "m1", start: 0, in: 0, out: 5, speed: 1, volume: 1, mirror: false, reverse: false, fadeIn: 0, fadeOut: 0 };
  const box = layerBox(clip, 16 / 9, 1000, 1000);
  expect(clipMaskBox(clip, 1000, 1000, 16 / 9)).toEqual({ ...box, angle: 15 });

  // Mirroring a stretched photo keeps every mask pixel mapped to the same photo pixel.
  const natural = { width: 400, height: 200 };
  const before = { ...clip, angle: 0 };
  const after = { ...before, mirror: true };
  const { size, oldToNew } = remapMaskAffine(before, after, natural, 1000, 1000);
  const oldSize = { width: Math.round(box.width), height: Math.round(box.height) };
  const toOld = photoToMask(before, natural, 1000, 1000, oldSize);
  const toNew = photoToMask(after, natural, 1000, 1000, size);
  const p = [120, 75] as const;
  const mapped = apply(oldToNew, apply(toOld, p));
  const expected = apply(toNew, p);
  expect(mapped[0]).toBeCloseTo(expected[0], 4);
  expect(mapped[1]).toBeCloseTo(expected[1], 4);
  // Sanity: newImageProject still exports cleanly.
  expect(newImageProject().image).toBeDefined();
});
