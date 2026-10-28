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

test("an image clip can be extended to any duration on the timeline", () => {
  const media = mediaFromSource(source("image"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "img", mediaId: media.id, at: 0 });
  expect(p.clips[0].out).toBe(5);
  p = applyEdit(p, { type: "trimClip", clipId: "img", edge: "end", time: 25 });
  expect(p.clips[0].out).toBe(25);
});

test("a link that must download first can't export until it's on this PC", async () => {
  const { planExport } = await import("../src/project/exportPlan");
  const media = mediaFromSource({ ...source("video"), url: "https://shop.example/v.m3u8", local: false, downloadFirst: true });
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c", mediaId: media.id, at: 0 });
  const settings = { output: "video", videoContainer: "mp4", audioContainer: "mp3", cutMode: "fast", frameId: "landscape", quality: "fast" } as const;
  expect(planExport(p, settings).kind).toBe("empty");
  p = { ...p, media: p.media.map((m) => ({ ...m, source: { ...source("video"), duration: m.source.duration } })) };
  expect(planExport(p, settings).kind).not.toBe("empty");
});

test("the media library remembers files on this PC, newest first, and keeps starred ones", async () => {
  const { withImported } = await import("../src/project/model");
  const LIBRARY_LIMIT = 5;
  const video = mediaFromSource({ ...source("video"), url: String.raw`C:\clips\beach.mp4` });
  const link = mediaFromSource({ ...source("video"), url: "https://example.com/v", local: false });
  const once = withImported([], [video, link], LIBRARY_LIMIT, 1);
  expect(once.map((e) => [e.name, e.kind])).toEqual([["beach.mp4", "video"]]);
  expect(withImported(once, [video], LIBRARY_LIMIT, 2)).toBe(once); // nothing new: the same list
  const full = Array.from({ length: LIBRARY_LIMIT }, (_, i) => ({ path: `C:/old${i}.mp4`, name: `old${i}.mp4`, kind: "video" as const, duration: 1, addedAt: 0, saved: i === LIBRARY_LIMIT - 1 }));
  const after = withImported(full, [video], LIBRARY_LIMIT, 3);
  expect(after.length).toBe(LIBRARY_LIMIT);
  expect(after[0].name).toBe("beach.mp4");
  expect(after.some((e) => e.saved)).toBe(true); // the starred oldest one stays
});

test("captions go on a new Captions track, lined up with each clip after cuts and speed changes", () => {
  const lines = [
    { start: 1, end: 3, text: "hello" },
    { start: 6, end: 8, text: "goodbye" },
  ];
  const media = { ...mediaFromSource(source("video")), captions: { label: "English", lines } };
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c", mediaId: media.id, at: 0 });
  p = applyEdit(p, { type: "splitClip", clipId: "c", newClipId: "d", at: 5 });
  p = applyEdit(p, { type: "setSpeed", clipId: "d", speed: 2 });
  p = applyEdit(p, { type: "addCaptions", mediaId: media.id, trackId: "cap" });
  expect(p.tracks.find((t) => t.id === "cap")?.name).toBe("Captions");
  const added = p.clips.filter((c) => c.trackId === "cap").map((c) => [c.text, c.start, c.out]);
  // "goodbye" (media 6-8) sits in clip d (media 5-10 from timeline 5, twice as fast): 5.5 for 1 s.
  expect(added).toEqual([
    ["hello", 1, 2],
    ["goodbye", 5.5, 1],
  ]);
});
