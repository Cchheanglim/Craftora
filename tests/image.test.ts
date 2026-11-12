import { expect, test } from "bun:test";
import { applyEdit } from "../src/project/actions";
import { emptyProject, mediaFromSource, upgradeProject, type Project } from "../src/project/model";
import { planExport } from "../src/project/exportPlan";
import type { ExportSettings, MediaSource } from "../src/types";

const picture: MediaSource = {
  url: "C:\\photo.png",
  title: "photo",
  uploader: "",
  duration: 10,
  local: true,
  previewUrl: "",
  image: true,
  streams: [{ id: "local:image", kind: "video", label: "", detail: "", sizeMb: 1 }],
};
const settings: ExportSettings = { output: "video", videoContainer: "mp4", audioContainer: "mp3", cutMode: "fast", frameId: "1080p", quality: "fast" };

function imageProject(): Project {
  const media = mediaFromSource(picture);
  let p: Project = { ...emptyProject(), image: { width: 1080, height: 1350, background: "#ffffff" } };
  p = applyEdit(p, { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "photo", mediaId: media.id, at: 4 });
  p = applyEdit(p, { type: "addText", clipId: "title", at: 7, text: "Sale" });
  return applyEdit(p, { type: "addText", clipId: "note", at: 0, text: "Today" });
}

test("every layer of an image sits alone on its track, from the start", () => {
  const p = imageProject();
  expect(p.clips.every((c) => c.start === 0)).toBe(true);
  expect(new Set(p.clips.map((c) => c.trackId)).size).toBe(3);
  // Moved onto another layer's track, it gets a track of its own again.
  const title = p.clips.find((c) => c.id === "title")!;
  const moved = applyEdit(p, { type: "moveClip", clipId: "note", trackId: title.trackId, start: 2 });
  expect(new Set(moved.clips.map((c) => c.trackId)).size).toBe(3);
  expect(moved.clips.every((c) => c.start === 0)).toBe(true);
});

test("a layer moves up and down", () => {
  const p = imageProject();
  const bottom = p.tracks.at(-1)!.id;
  expect(applyEdit(p, { type: "moveTrack", trackId: bottom, to: 0 }).tracks[0].id).toBe(bottom);
  expect(applyEdit(p, { type: "moveTrack", trackId: bottom, to: 99 }).tracks.at(-1)!.id).toBe(bottom);
});

test("an image exports as one still picture at its own size, without anything timed", () => {
  let p = imageProject();
  p = applyEdit(p, { type: "updateClip", clipId: "title", patch: { fadeIn: 1, anim: { in: { kind: "pop", length: 0.5 } } } });
  const plan = planExport(p, settings);
  if (plan.kind !== "render") throw new Error(plan.kind);
  expect([plan.spec.output, plan.spec.container, plan.spec.width, plan.spec.height, plan.spec.background]).toEqual(["image", "png", 1080, 1350, "#ffffff"]);
  expect(plan.spec.fileName.endsWith(".png")).toBe(true);
  expect(plan.spec.clips.every((c) => c.start === 0 && c.fadeIn === 0 && !c.motion)).toBe(true);
  expect(planExport(p, { ...settings, imageContainer: "jpg" }).kind === "render" && (planExport(p, { ...settings, imageContainer: "jpg" }) as { spec: { container: string } }).spec.container).toBe("jpg");
});

test("an image exports at 2×, see-through as a PNG only, with its JPG quality and layer opacity", () => {
  let p = applyEdit(imageProject(), { type: "updateClip", clipId: "photo", patch: { opacity: 0.5 } });
  p = applyEdit(p, { type: "updateClip", clipId: "title", patch: { name: "Headline" } });
  const spec = (s: Partial<ExportSettings>) => {
    const plan = planExport(p, { ...settings, ...s });
    if (plan.kind !== "render") throw new Error(plan.kind);
    return plan.spec;
  };
  const png = spec({ imageScale: 2, transparent: true });
  expect([png.width, png.height, png.transparent]).toEqual([2160, 2700, true]);
  expect(png.clips.find((c) => c.mediaId)?.opacity).toBe(0.5);
  expect(p.clips.find((c) => c.id === "title")?.name).toBe("Headline");
  const jpg = spec({ imageContainer: "jpg", transparent: true, imageQuality: 80 });
  expect([jpg.transparent, jpg.imageQuality]).toEqual([undefined, 80]);
  // Never past the export's largest side.
  expect(Math.max(spec({ imageScale: 99 }).width, spec({ imageScale: 99 }).height)).toBe(8192);
});

test("a video project is untouched by the image rules", () => {
  let p: Project = emptyProject();
  p = applyEdit(p, { type: "addText", clipId: "a", at: 5, text: "Hi" });
  expect(p.clips[0].start).toBe(5);
  expect(upgradeProject(JSON.parse(JSON.stringify(p))).image).toBeUndefined();
});
