import { expect, test } from "bun:test";
import { ENHANCE, stepDefs, stepsFilter } from "../src/project/effects";
import { emptyProject, mediaFromSource } from "../src/project/model";
import { applyEdit } from "../src/project/actions";
import { planExport } from "../src/project/exportPlan";
import type { ExportSettings, MediaSource } from "../src/types";

test("Enhance colours' filter has every SVG filter it points at", () => {
  const filter = stepsFilter(ENHANCE)!;
  const defs = stepDefs(ENHANCE);
  for (const [, id] of filter.matchAll(/url\(#([^)]+)\)/g)) expect(defs).toContain(`id="${id}"`);
  expect(defs).toContain("feConvolveMatrix");
  // The same step twice is one filter.
  expect(stepDefs([...ENHANCE, ...ENHANCE]).match(/<filter /g)?.length).toBe(defs.match(/<filter /g)?.length);
  expect(stepDefs([])).toBe("");
});

test("4× only with AI sharpen, and the plan says what's on", () => {
  const photo = mediaFromSource({ url: "C:\\photo.png", title: "photo", uploader: "", duration: 86400, local: true, previewUrl: "", image: true, streams: [{ id: "local:image", kind: "video", label: "", detail: "", sizeMb: 1 }] } as MediaSource);
  let p = applyEdit({ ...emptyProject(), image: { width: 1000, height: 500, background: "#ffffff" } }, { type: "importMedia", item: photo });
  p = applyEdit(p, { type: "addClip", clipId: "c1", mediaId: photo.id });
  const base: ExportSettings = { output: "video", videoContainer: "mp4", audioContainer: "mp3", cutMode: "fast", frameId: "1080p", quality: "fast", imageScale: 4 };
  const plain = planExport(p, base);
  if (plain.kind !== "render") throw new Error(plain.kind);
  expect(plain.spec.width).toBe(2000);
  const ai = planExport(p, { ...base, imageAi: true, imageEnhance: true });
  if (ai.kind !== "render") throw new Error(ai.kind);
  expect([ai.spec.width, ai.spec.height]).toEqual([4000, 2000]);
  expect(ai.quality).toBe("PNG · Enhanced colours · AI sharpen");
});
