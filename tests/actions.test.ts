import { expect, test } from "bun:test";
import { applyEdit } from "../src/project/actions";
import { emptyProject, mediaFromSource, sameFormat, type Project } from "../src/project/model";
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

test("the export quality survives a site listing it under another format", () => {
  const read = (ids: string[]): MediaSource => ({
    ...source("video"),
    streams: ids.map((id, i) => ({ id, kind: "video", label: ["1080p · 24 fps", "720p · 24 fps"][i], detail: "", sizeMb: 1 })),
  });
  const first = read(["137+bestaudio/137", "136+bestaudio/136"]);
  expect(sameFormat("137+bestaudio/137", first, read(["270+bestaudio/270", "232+bestaudio/232"]))).toBe("270+bestaudio/270");
  expect(sameFormat("136+bestaudio/136", first, read(["137+bestaudio/137", "136+bestaudio/136"]))).toBe("136+bestaudio/136");
  // That quality is gone, or the old id is known nowhere (saved before the fix): the usual 1080p.
  expect(sameFormat("136+bestaudio/136", first, read(["270+bestaudio/270"]))).toBe("270+bestaudio/270");
  expect(sameFormat("999+bestaudio/999", first, read(["270+bestaudio/270", "232+bestaudio/232"]))).toBe("270+bestaudio/270");
  // A sound-only link has no video format to keep.
  expect(sameFormat("", first, { ...first, streams: [] })).toBe("");
});

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

test("shown captions go into the export, at the chosen place, until they're on the timeline", async () => {
  const { withShownCaptions } = await import("../src/project/actions");
  const media = { ...mediaFromSource(source("video")), captions: { label: "English", lines: [{ start: 1, end: 3, text: "hello" }] } };
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c", mediaId: media.id, at: 0 });
  const shown = withShownCaptions(p);
  expect(shown.clips.filter((c) => c.text === "hello").map((c) => c.y)).toEqual([0.9]);
  p = applyEdit(p, { type: "layoutCaptions", patch: { y: 0.08 } });
  p = applyEdit(p, { type: "layoutCaptions", patch: { x: 0.2, size: 0.1 } });
  expect(withShownCaptions(p).clips.find((c) => c.text === "hello")).toMatchObject({ x: 0.2, y: 0.08, size: 0.1 });
  // On the timeline: they move with the choice, and nothing is added twice.
  p = applyEdit(p, { type: "addCaptions", mediaId: media.id, trackId: "cap" });
  p = applyEdit(p, { type: "layoutCaptions", patch: { y: 0.5 } });
  expect(p.clips.find((c) => c.trackId === "cap")).toMatchObject({ x: 0.2, y: 0.5, size: 0.1 });
  expect(withShownCaptions(p)).toBe(p);
});

test("exported text wraps at whole words to fit the frame", async () => {
  const { wrapText } = await import("../src/project/model");
  expect(wrapText("Welcome to the shop. Today we are looking at a new camera.", 30)).toBe("Welcome to the shop. Today we\nare looking at a new camera.");
  expect(wrapText("short", 30)).toBe("short");
  expect(wrapText("one\ntwo", 30)).toBe("one\ntwo");
});

test("long caption lines become two-line pieces at whole words, timed by length", async () => {
  const { readableCaptions, CAPTION_CHARS } = await import("../src/project/model");
  const english = "After the war the gods came down to the mountain and asked who would guard the gate, and the monkey king answered that he would do it alone if they let him keep his staff.";
  const khmer = "បន្ទាប់ពីវគ្គមុនមកទេវតាថៃដីងស៊ីហ្គឹងគឺបានចុះទៅកាន់ភ្នំហួរគហៅសូន្ធខុងឡើងមកកាន់ឋានសួរនិងទទួលតំណែងទេវតារួចគ្រាន់តែទៅដល់ភ្លាមអ៊ូខុងនឹងគឺបីសនឹងវ៉ៃគ្នាជាមួយនឹងសេនាការពារ";
  for (const text of [english, khmer]) {
    const pieces = readableCaptions([{ start: 10, end: 30, text }]);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.text.length).toBeLessThanOrEqual(CAPTION_CHARS);
    // Nothing lost, and the pieces fill the line's time without gaps.
    expect(pieces.map((p) => p.text).join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
    expect(pieces[0].start).toBe(10);
    expect(pieces[pieces.length - 1].end).toBe(30);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].start).toBe(pieces[i - 1].end);
  }
  // Whole English words: no piece starts or ends inside one.
  for (const p of readableCaptions([{ start: 0, end: 9, text: english }])) expect(english.split(" ")).toEqual(expect.arrayContaining(p.text.split(" ")));
  // Short lines stay as they are.
  expect(readableCaptions([{ start: 1, end: 2, text: "Hello there" }])).toEqual([{ start: 1, end: 2, text: "Hello there" }]);
});

test("each wave bar shows the loudest moment in the stretch it stands for", async () => {
  const { peakBetween, clipPeaks } = await import("../src/project/model");
  // 10 bars a second over 2 seconds: quiet, with one loud moment at 1.5 s.
  const full = Array.from({ length: 20 }, (_, i) => (i === 15 ? 90 : 10));
  expect(peakBetween(full, 2, 0, 1)).toBe(10);
  expect(peakBetween(full, 2, 1, 2)).toBe(90);
  expect(peakBetween(full, 2, 2, 1)).toBe(90);
  const media = { ...mediaFromSource({ ...source("video"), duration: 2, peaks: full, peaksRate: 10 }) };
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c", mediaId: media.id, at: 0 });
  // Two bars for the whole clip: the second holds the loud moment (one sample per bar would miss it).
  expect(clipPeaks(p.clips[0], p.media[0], 2)).toEqual([10, 90]);
});

test("the transcript follows the timeline, words are timed in their line, and picked words cut exactly", async () => {
  const { transcript, wordsOf, cutRanges, isFiller } = await import("../src/project/model");
  const lines = [
    { start: 0, end: 2, text: "Hello there" },
    { start: 4, end: 6, text: "Um the battery lasts" },
  ];
  const media = { ...mediaFromSource(source("video")), captions: { label: "English", lines } };
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c", mediaId: media.id, at: 0 });
  // Starting the clip 1 s in moves every line 1 s earlier on the timeline.
  p = applyEdit(p, { type: "trimClip", clipId: "c", edge: "start", time: 1 });
  const said = transcript(p);
  expect(said.map((l) => [l.text, l.start])).toEqual([
    ["Hello there", 0],
    ["Um the battery lasts", 3],
  ]);
  const words = wordsOf(said[1]);
  expect(words.filter((w) => w.word).map((w) => w.text)).toEqual(["Um", "the", "battery", "lasts"]);
  const um = words[0];
  expect([um.start, um.end]).toEqual([4, 4.2]);
  expect(isFiller(um.text) && isFiller("uhh") && !isFiller("umbrella")).toBe(true);
  // "Um" and the space after it join into one cut, which removes exactly that stretch.
  const ranges = cutRanges([
    { clipId: p.clips[0].id, start: um.start, end: um.end },
    { clipId: p.clips[0].id, start: words[1].start, end: words[2].start },
  ]).get(p.clips[0].id)!;
  expect(ranges).toEqual([[4, 4.3]]);
  p = applyEdit(p, { type: "cutSilences", clipId: p.clips[0].id, ranges, exact: true });
  const kept = p.clips.filter((c) => c.mediaId === media.id).map((c) => [c.in, c.out]);
  expect(kept).toEqual([
    [1, 4],
    [4.3, 10],
  ]);
});
