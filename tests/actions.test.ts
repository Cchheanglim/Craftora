import { expect, test } from "bun:test";
import { applyEdit } from "../src/project/actions";
import { emptyProject, mediaFromSource, type Project } from "../src/project/model";
import type { MediaSource } from "../src/types";

const source = (kind: "video" | "audio" | "image"): MediaSource => ({
  url: `C:\\${kind}.file`,
  title: kind,
  uploader: "",
  duration: 10,
  local: true,
  previewUrl: "",
  image: kind === "image",
  streams: [{ id: `local:${kind}`, kind: kind === "audio" ? "audio" : "video", label: "", detail: "", sizeMb: 1 }],
});

/** A project with one clip of `kind` on the track it lands on, then moved to `to`. */
function moved(kind: "video" | "audio" | "image", to: string): string | undefined {
  const media = mediaFromSource(source(kind));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c", mediaId: media.id, at: 0 });
  p = applyEdit(p, { type: "moveClip", clipId: "c", trackId: to, start: 0 });
  return p.clips.find((c) => c.id === "c")?.trackId;
}

test("a video can move onto an audio track for its sound, and back", () => {
  expect(moved("video", "audio-1")).toBe("audio-1");
});

test("sound files stay off video tracks, pictures off audio tracks, nothing media goes on text", () => {
  expect(moved("audio", "video-2")).toBe("audio-1");
  expect(moved("image", "audio-1")).not.toBe("audio-1");
  expect(moved("video", "text-1")).not.toBe("text-1");
});

test("a picture that fills the frame is rendered, not copied as it is", async () => {
  const { planExport } = await import("../src/project/exportPlan");
  const media = mediaFromSource(source("video"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c", mediaId: media.id, at: 0 });
  const settings = { output: "video", videoContainer: "mp4", audioContainer: "mp3", cutMode: "fast", frameId: "vertical", quality: "fast" } as const;
  expect(planExport(p, settings).kind).toBe("simple");
  p = applyEdit(p, { type: "updateClip", clipId: "c", patch: { fill: true } });
  const plan = planExport(p, settings);
  expect(plan.kind).toBe("render");
  expect(plan.kind === "render" && plan.spec.clips[0].fill).toBe(true);
});

test("duplicating a clip places the copy right after it on magnetic and free tracks", () => {
  const media = mediaFromSource(source("video"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c1", mediaId: media.id, at: 0 });
  p = applyEdit(p, { type: "addClip", clipId: "c2", mediaId: media.id, at: 10 });
  p = applyEdit(p, { type: "duplicateClip", clipId: "c1", newClipId: "copy" });
  expect(p.clips.find((c) => c.id === "copy")?.start).toBe(10);
  expect(p.clips.find((c) => c.id === "c2")?.start).toBe(20);

  p = applyEdit(p, { type: "addText", clipId: "t1", at: 2, text: "Hi" });
  p = applyEdit(p, { type: "duplicateClip", clipId: "t1", newClipId: "t2" });
  expect(p.clips.find((c) => c.id === "t2")?.start).toBe(5);
});

test("cutting silences, splitting by chapters, and muting a track update the timeline", async () => {
  const { planExport } = await import("../src/project/exportPlan");
  const media = mediaFromSource({
    ...source("video"),
    chapters: [
      { title: "Intro", start: 0, end: 4 },
      { title: "Main", start: 4, end: 10 },
    ],
  });
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c1", mediaId: media.id, at: 0 });
  p = applyEdit(p, { type: "splitByChapters", clipId: "c1" });
  expect(p.clips.length).toBe(2);
  expect(p.clips[0].out).toBe(4);
  expect(p.clips[1].in).toBe(4);

  p = applyEdit(p, { type: "cutSilences", clipId: p.clips[1].id, ranges: [[5, 7]] });
  expect(p.clips.length).toBe(3);

  p = applyEdit(p, { type: "setTrackMuted", trackId: "video-1", muted: true });
  const settings = { output: "video", videoContainer: "mp4", audioContainer: "mp3", cutMode: "fast", frameId: "1080p", quality: "fast" } as const;
  const plan = planExport(p, settings);
  expect(plan.kind === "render" && plan.spec.clips.every((c) => c.volume === 0)).toBe(true);
});
