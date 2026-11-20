import { expect, test } from "bun:test";
import { emptyProject, mediaFromSource } from "../src/project/model";
import { applyEdit } from "../src/project/actions";
import { planExport } from "../src/project/exportPlan";
import type { ExportSettings, MediaSource } from "../src/types";

const source: MediaSource = {
  url: "C:\clip.mp4",
  title: "clip",
  uploader: "",
  duration: 10,
  local: true,
  previewUrl: "",
  image: false,
  streams: [{ id: "local:video", kind: "video", label: "1080p", detail: "", sizeMb: 5 }],
};

test("a GIF always renders, with its size and frame rate, and no cover", () => {
  const media = mediaFromSource(source);
  let p = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c1", mediaId: media.id, at: 0 });
  p = { ...p, cover: "data:image/jpeg;base64,AA" };
  const base: ExportSettings = { output: "video", videoContainer: "gif", audioContainer: "mp3", cutMode: "fast", frameId: "1080p", quality: "fast" };

  // One untouched clip would be a lossless cut as MP4; a GIF can't be.
  const plan = planExport(p, base);
  if (plan.kind !== "render") throw new Error(plan.kind);
  expect(plan.fileName.endsWith(".gif")).toBe(true);
  expect(plan.spec).toMatchObject({ gifWidth: 720, gifFps: 15, cover: undefined });

  const small = planExport(p, { ...base, gifWidth: 480, gifFps: 10 });
  if (small.kind !== "render") throw new Error(small.kind);
  expect(small.spec).toMatchObject({ gifWidth: 480, gifFps: 10 });
  expect(small.sizeMb).toBeLessThan(plan.sizeMb);
  expect(small.quality).toContain("480 px wide");

  // MP4 keeps its cover and sends no GIF settings.
  const mp4 = planExport(p, { ...base, videoContainer: "mp4", gifWidth: 480 });
  if (mp4.kind !== "render") throw new Error(mp4.kind);
  expect(mp4.spec).toMatchObject({ cover: p.cover, gifWidth: undefined, gifFps: undefined });
});
