import { expect, test } from "bun:test";
import { applyEdit } from "../src/project/actions";
import { captionLines, emptyProject, mainTrack, mediaFromSource, sameFormat, soundFadeAt, trackOrder, transitionMix, upgradeProject, type Project, type Transition } from "../src/project/model";
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

/** A project with one clip of `kind` on the track it lands on, then moved to a new track "top". */
function moved(kind: "video" | "audio" | "image"): string | undefined {
  const media = mediaFromSource(source(kind));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c", mediaId: media.id, at: 0 });
  p = applyEdit(p, { type: "addTrack", trackId: "top" });
  p = applyEdit(p, { type: "moveClip", clipId: "c", trackId: "top", start: 0 });
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

test("captions drop the >> that marks a new speaker", () => {
  const line = (text: string) => ({ start: 0, end: 1, text });
  const shown = captionLines([line(">> I don't understand, Mr. Krabs."), line("Me? >> Yes, you!"), line("Hi\n>>Bye"), line(">>")]);
  expect(shown.map((c) => c.text)).toEqual(["I don't understand, Mr. Krabs.", "Me? Yes, you!", "Hi\nBye"]);
  // Arrows inside words stay.
  expect(captionLines([line("a->b, c>>d")])[0].text).toBe("a->b, c>>d");
});

test("a wrong name is fixed in every caption, or in just the line retyped", () => {
  const media = { ...mediaFromSource(source("video")), captions: { label: "English", lines: [
    { start: 0, end: 2, text: ">> Mr. Crabs! Mr. crabs?" },
    { start: 2, end: 4, text: "Me? >> Yes, Mr. Crabs." },
  ] } };
  const p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  const texts = (q: Project) => q.media[0].captions!.lines.map((c) => c.text);
  // Every caption, whatever the case; a "$" in the new name stays as typed.
  expect(texts(applyEdit(p, { type: "editCaptions", find: "mr. crabs", replace: "Mr. Krab$" }))).toEqual([">> Mr. Krab$! Mr. Krab$?", "Me? >> Yes, Mr. Krab$."]);
  // One line, as the Transcript shows it (no speaker marks); the other line is untouched.
  const one = applyEdit(p, { type: "editCaptions", find: "Me? Yes, Mr. Crabs.", replace: "Me? Yes, SpongeBob.", line: { mediaId: media.id, at: 3 } });
  expect(texts(one)).toEqual([">> Mr. Crabs! Mr. crabs?", "Me? Yes, SpongeBob."]);
});

test("a new edit starts with one track, and any clip moves onto any track", () => {
  expect(emptyProject().tracks.length).toBe(1);
  expect(moved("video")).toBe("top");
  expect(moved("audio")).toBe("top");
  expect(moved("image")).toBe("top");
});

test("a video goes on the main track, sound on a track below it, text on one above it", () => {
  const video = mediaFromSource(source("video"));
  const music = mediaFromSource(source("audio"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: video });
  p = applyEdit(p, { type: "importMedia", item: music });
  p = applyEdit(p, { type: "addClip", clipId: "v", mediaId: video.id, at: 0 });
  p = applyEdit(p, { type: "addClip", clipId: "m", mediaId: music.id, at: 0 });
  p = applyEdit(p, { type: "addText", clipId: "t", at: 0 });
  const row = (id: string) => p.tracks.findIndex((t) => t.id === p.clips.find((c) => c.id === id)?.trackId);
  expect(p.tracks[row("v")]).toBe(mainTrack(p));
  expect(row("m")).toBeGreaterThan(row("v"));
  expect(row("t")).toBeLessThan(row("v"));
});

test("tracks start without the magnet: a clip on the main track moves where it's dropped", () => {
  const video = mediaFromSource(source("video"));
  const music = mediaFromSource(source("audio"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: video });
  p = applyEdit(p, { type: "importMedia", item: music });
  // Music first: it goes on a track below, and the empty one above stays the main track.
  p = applyEdit(p, { type: "addClip", clipId: "m", mediaId: music.id, at: 0 });
  p = applyEdit(p, { type: "addClip", clipId: "v", mediaId: video.id });
  const v = () => p.clips.find((c) => c.id === "v")!;
  expect(p.tracks.every((t) => !t.magnetic)).toBe(true);
  expect(v().trackId).toBe(mainTrack(p).id);
  expect(p.tracks.findIndex((t) => t.id === p.clips.find((c) => c.id === "m")?.trackId)).toBeGreaterThan(p.tracks.indexOf(mainTrack(p)));
  p = applyEdit(p, { type: "moveClip", clipId: "v", start: 3 });
  expect(v().start).toBe(3);
  expect(v().trackId).toBe(mainTrack(p).id);
});

test("a muted track is silent in the export; a hidden one keeps its sound", async () => {
  const { planExport } = await import("../src/project/exportPlan");
  const media = mediaFromSource(source("audio"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c", mediaId: media.id, at: 0 });
  const trackId = p.clips[0].trackId;
  const settings = { output: "audio", videoContainer: "mp4", audioContainer: "mp3", cutMode: "fast", frameId: "1080p", quality: "fast" } as const;
  const volumes = (q: Project) => {
    const plan = planExport(q, settings);
    return plan.kind === "render" && plan.spec.clips.map((c) => c.volume);
  };
  expect(volumes(applyEdit(p, { type: "updateTrack", trackId, patch: { hidden: true } }))).toEqual([1]);
  expect(volumes(applyEdit(p, { type: "setTrackMuted", trackId, muted: true }))).toEqual([0]);
  // A project saved when an audio track's eye turned it off: that track is now muted.
  const old = { ...p, tracks: [{ id: trackId, kind: "audio", name: "Audio 1", hidden: true }] } as unknown as Project;
  expect(upgradeProject(old).tracks[0]).toEqual({ id: trackId, name: "Audio 1", muted: true, hidden: undefined });
});

test("a picture that fills the frame is rendered, not copied as it is", async () => {
  const { planExport } = await import("../src/project/exportPlan");
  const media = mediaFromSource(source("video"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c", mediaId: media.id, at: 0 });
  const settings = { output: "video", videoContainer: "mp4", audioContainer: "mp3", cutMode: "fast", frameId: "vertical", quality: "fast" } as const;
  const copy = planExport(p, settings);
  expect(copy.kind).toBe("simple");
  // A file from this PC: the whole 1 MB file is copied.
  expect(copy.kind === "simple" && copy.sizeMb).toBe(1);
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

  p = applyEdit(p, { type: "setTrackMuted", trackId: p.clips[0].trackId, muted: true });
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
  // Starting the clip 1 s in (and moving it back to 0:00) moves every line 1 s earlier on the timeline.
  p = applyEdit(p, { type: "trimClip", clipId: "c", edge: "start", time: 1 });
  p = applyEdit(p, { type: "moveClip", clipId: "c", start: 0 });
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

test("a flash whitens the outgoing clip, then brings the incoming one up from white", () => {
  const media = mediaFromSource(source("video"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "a", mediaId: media.id, at: 0 });
  p = applyEdit(p, { type: "addClip", clipId: "b", mediaId: media.id, at: 10 });
  const track = mainTrack(p)!.id;
  p = applyEdit(p, { type: "setMagnetic", trackId: track, magnetic: true });
  p = applyEdit(p, { type: "setTransition", clipId: "b", transition: { kind: "flash", duration: 1 } });
  const order = trackOrder(p, track);
  const [a, b] = ["a", "b"].map((id) => order.find((c) => c.id === id)!);
  const at = (share: number) => b.start + share;
  // A quarter in: the outgoing clip half white, the incoming one not shown yet.
  expect(transitionMix(order, a, at(0.25))).toMatchObject({ picture: 1, white: 0.5 });
  expect(transitionMix(order, b, at(0.25)).picture).toBe(0);
  // Three quarters in: the incoming clip shown, half white; the sound dips like Dip to black.
  expect(transitionMix(order, b, at(0.75))).toMatchObject({ picture: 1, white: 0.5, sound: 0.5 });
});

test("a slide moves the outgoing clip left while the incoming one comes in from the right", () => {
  const media = mediaFromSource(source("video"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "a", mediaId: media.id, at: 0 });
  p = applyEdit(p, { type: "addClip", clipId: "b", mediaId: media.id, at: 10 });
  const track = mainTrack(p)!.id;
  p = applyEdit(p, { type: "setMagnetic", trackId: track, magnetic: true });
  p = applyEdit(p, { type: "setTransition", clipId: "b", transition: { kind: "slide", duration: 1 } });
  const order = trackOrder(p, track);
  const [a, b] = ["a", "b"].map((id) => order.find((c) => c.id === id)!);
  const at = (share: number) => b.start + share;
  expect(transitionMix(order, a, 0)).toMatchObject({ shift: 0, lift: 0, zoom: 1, turn: 0, reveal: "" });
  const [out, into] = [a, b].map((c) => transitionMix(order, c, at(0.5)));
  expect(out).toMatchObject({ picture: 1, sound: 0.5 });
  expect(out.shift).toBeCloseTo(-0.5);
  expect(into).toMatchObject({ picture: 1, sound: 0.5 });
  expect(into.shift).toBeCloseTo(0.5);
});

test("a zoom scales the outgoing clip up while the incoming one fades in from 1.5× to 1×", () => {
  const media = mediaFromSource(source("video"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "a", mediaId: media.id, at: 0 });
  p = applyEdit(p, { type: "addClip", clipId: "b", mediaId: media.id, at: 10 });
  const track = mainTrack(p)!.id;
  p = applyEdit(p, { type: "setMagnetic", trackId: track, magnetic: true });
  p = applyEdit(p, { type: "setTransition", clipId: "b", transition: { kind: "zoom", duration: 1 } });
  const order = trackOrder(p, track);
  const [a, b] = ["a", "b"].map((id) => order.find((c) => c.id === id)!);
  const at = (share: number) => b.start + share;
  expect(transitionMix(order, a, at(0.5))).toMatchObject({ picture: 1, zoom: 1.25, sound: 0.5 });
  expect(transitionMix(order, b, at(0.5))).toMatchObject({ picture: 0.5, zoom: 1.25, sound: 0.5 });
});

test("a wipe reveals the incoming clip from left to right over the outgoing one", () => {
  const media = mediaFromSource(source("video"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "a", mediaId: media.id, at: 0 });
  p = applyEdit(p, { type: "addClip", clipId: "b", mediaId: media.id, at: 10 });
  const track = mainTrack(p)!.id;
  p = applyEdit(p, { type: "setMagnetic", trackId: track, magnetic: true });
  p = applyEdit(p, { type: "setTransition", clipId: "b", transition: { kind: "wipe", duration: 1 } });
  const order = trackOrder(p, track);
  const [a, b] = ["a", "b"].map((id) => order.find((c) => c.id === id)!);
  const at = (share: number) => b.start + share;
  expect(transitionMix(order, a, at(0.25))).toMatchObject({ picture: 1, reveal: "", sound: 0.75 });
  expect(transitionMix(order, b, at(0.25))).toMatchObject({ picture: 1, reveal: "inset(0 75% 0 0)", sound: 0.25 });
});

test("directional slides and wipes, circle, and spin mix incoming and outgoing clips", () => {
  const media = mediaFromSource(source("video"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "a", mediaId: media.id, at: 0 });
  p = applyEdit(p, { type: "addClip", clipId: "b", mediaId: media.id, at: 10 });
  const track = mainTrack(p)!.id;
  p = applyEdit(p, { type: "setMagnetic", trackId: track, magnetic: true });
  const half = (kind: Transition["kind"]) => {
    const q = applyEdit(p, { type: "setTransition", clipId: "b", transition: { kind, duration: 1 } });
    const order = trackOrder(q, track);
    const [a, b] = ["a", "b"].map((id) => order.find((c) => c.id === id)!);
    return [transitionMix(order, a, b.start + 0.5), transitionMix(order, b, b.start + 0.5)] as const;
  };
  const [srOut, srIn] = half("slide-right");
  expect(srIn.shift).toBeCloseTo(-0.5);
  expect(srOut.shift).toBeCloseTo(0.5);
  const [suOut, suIn] = half("slide-up");
  expect(suIn.lift).toBeCloseTo(0.5);
  expect(suOut.lift).toBeCloseTo(-0.5);
  const [sdOut, sdIn] = half("slide-down");
  expect(sdIn.lift).toBeCloseTo(-0.5);
  expect(sdOut.lift).toBeCloseTo(0.5);
  expect(half("wipe-left")[1].reveal).toBe("inset(0 0 0 50%)");
  expect(half("wipe-up")[1].reveal).toBe("inset(50% 0 0 0)");
  expect(half("wipe-down")[1].reveal).toBe("inset(0 0 50% 0)");
  expect(half("circle")[1].reveal.startsWith("circle(35.35")).toBe(true);
  const [spOut, spIn] = half("spin");
  expect(spIn.picture).toBe(0.5);
  expect(spIn.zoom).toBeCloseTo(1.25);
  expect(spIn.turn).toBeCloseTo(-45);
  expect(spOut.zoom).toBeCloseTo(1.25);
  expect(spOut.turn).toBeCloseTo(45);
});

test("sound fades ramp the sound, stay on the outer pieces when split, and fit when trimmed", () => {
  const media = mediaFromSource(source("video"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "c", mediaId: media.id, at: 0 });
  expect(soundFadeAt(p.clips[0], 5)).toBe(1);

  p = applyEdit(p, { type: "updateClip", clipId: "c", patch: { soundFadeIn: 3, soundFadeOut: 2 } });
  const c = p.clips[0];
  expect([soundFadeAt(c, 1.5), soundFadeAt(c, 7), soundFadeAt(c, 9), soundFadeAt(c, 10)]).toEqual([0.5, 1, 0.5, 0]);

  p = applyEdit(p, { type: "splitClip", clipId: "c", newClipId: "d", at: 5 });
  expect(p.clips.map((x) => [x.soundFadeIn, x.soundFadeOut])).toEqual([
    [3, 0],
    [0, 2],
  ]);

  // Trimming the first piece down to 2 s clamps its 3 s sound fade in to 2 s.
  p = applyEdit(p, { type: "trimClip", clipId: "c", edge: "end", time: 2 });
  expect(p.clips.find((x) => x.id === "c")).toMatchObject({ soundFadeIn: 2, soundFadeOut: 0 });
});


test("a transition works on a track without the magnet: only the clip after the join moves", () => {
  const media = mediaFromSource(source("video"));
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addTrack", trackId: "t2" });
  p = applyEdit(p, { type: "addClip", clipId: "a", mediaId: media.id, at: 20, trackId: "t2" });
  p = applyEdit(p, { type: "splitClip", clipId: "a", newClipId: "b", at: 25 });
  p = applyEdit(p, { type: "addClip", clipId: "far", mediaId: media.id, at: 60, trackId: "t2" });
  p = applyEdit(p, { type: "setTransition", clipId: "b", transition: { kind: "slide", duration: 1 } });
  const at = (id: string) => p.clips.find((c) => c.id === id)!.start;
  // No magnet switched on, nothing packed to 0:00: the clip after the join overlaps the one before by the transition.
  expect(p.tracks.find((t) => t.id === "t2")?.magnetic).toBeFalsy();
  expect([at("a"), at("b"), at("far")]).toEqual([20, 24, 60]);
  const order = trackOrder(p, "t2");
  expect(transitionMix(order, order.find((c) => c.id === "b")!, 24.5).shift).toBeCloseTo(0.5);
  // A clip set apart from the one before has no join, so its transition waits.
  expect(transitionMix(order, order.find((c) => c.id === "far")!, 60.2).shift).toBe(0);
  // Taken off again, the clip goes back to the cut.
  p = applyEdit(p, { type: "setTransition", clipId: "b", transition: null });
  expect(at("b")).toBe(25);
});
