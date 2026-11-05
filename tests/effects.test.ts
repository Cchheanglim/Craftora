import { expect, test } from "bun:test";
import { applyEdit, type EditAction } from "../src/project/actions";
import { blocksStyle, dropEdits, lookFilter, lookSteps } from "../src/project/effects";
import { clipEnd, emptyProject, mediaFromSource, trackLabel, type Project } from "../src/project/model";
import type { MediaSource } from "../src/types";

const video: MediaSource = {
  url: "C:\\\\match.mp4",
  title: "match",
  uploader: "",
  duration: 10,
  local: true,
  previewUrl: "",
  streams: [{ id: "local:video", kind: "video", label: "", detail: "", sizeMb: 1 }],
};

/** A project with one 10 s video clip "c" at the start (on the main track). */
function withClip(): Project {
  const media = mediaFromSource(video);
  const p = applyEdit(emptyProject(), { type: "importMedia", item: media });
  return applyEdit(p, { type: "addClip", clipId: "c", mediaId: media.id, at: 0 });
}

const run = (p: Project, edits: EditAction[]) => edits.reduce(applyEdit, p);
const mainTrack = (p: Project) => p.clips.find((c) => c.id === "c")!.trackId;

test("a filter is the same CSS filter steps the export gets", () => {
  expect(lookFilter("noir")).toBe("grayscale(1) contrast(1.5) brightness(0.9)");
  expect(lookFilter("alien")).toBe("hue-rotate(180deg)");
  expect(lookFilter(undefined)).toBeUndefined();
  expect(lookSteps("not-a-look")).toEqual([]);
});

test("a filter dropped on a clip covers that clip, on a track above it", () => {
  let p = withClip();
  const done = dropEdits(p, { kind: "filter", id: "bw" }, mainTrack(p), 2, ["f", "x"])!;
  p = run(p, done.edits);
  const block = p.clips.find((c) => c.id === "f")!;
  expect(done.select).toBe("f");
  const row = (trackId: string) => p.tracks.findIndex((t) => t.id === trackId);
  expect(row(block.trackId)).toBeLessThan(row(mainTrack(p)));
  expect([block.start, clipEnd(block), block.look]).toEqual([0, 10, "bw"]);
  // The video clip isn't touched.
  expect(p.clips.find((c) => c.id === "c")).toMatchObject({ start: 0, in: 0, out: 10 });
  // Off any clip: a 3 s block where it was dropped; at the same time as another, on another track.
  p = run(p, dropEdits(p, { kind: "effect", id: "blur" }, block.trackId, 3, ["e", "y"])!.edits);
  const blur = p.clips.find((c) => c.id === "e")!;
  expect([blur.start, clipEnd(blur)]).toEqual([3, 6]);
  expect(blur.trackId).not.toBe(block.trackId);
  // On a piece of a split clip: just that piece.
  p = applyEdit(p, { type: "splitClip", clipId: "c", newClipId: "b", at: 6 });
  p = run(p, dropEdits(p, { kind: "filter", id: "sepia" }, mainTrack(p), 7, ["s", "z"])!.edits);
  const sepia = p.clips.find((c) => c.id === "s")!;
  expect([sepia.start, clipEnd(sepia)]).toEqual([6, 10]);
});

test("slow motion dropped on a piece of a split clip slows that piece, and its edges move the cut", () => {
  let p = withClip();
  p = applyEdit(p, { type: "splitClip", clipId: "c", newClipId: "end", at: 5 });
  p = applyEdit(p, { type: "splitClip", clipId: "c", newClipId: "middle", at: 2 });
  const done = dropEdits(p, { kind: "time", id: "slow" }, mainTrack(p), 3, ["x", "y"])!;
  p = run(p, done.edits);
  const pieces = () => [...p.clips].sort((a, b) => a.start - b.start).map((c) => [c.id, c.start, c.in, c.out, c.speed]);
  expect(done.select).toBe("middle");
  expect(pieces()).toEqual([
    ["c", 0, 0, 2, 1],
    ["middle", 2, 2, 5, 0.5],
    ["end", 8, 5, 10, 1],
  ]);
  // Dragging the slow part's end to 10 s takes in media up to 6 s: the rest starts there.
  p = applyEdit(p, { type: "trimClip", clipId: "middle", edge: "end", time: 10 });
  expect(pieces()).toEqual([
    ["c", 0, 0, 2, 1],
    ["middle", 2, 2, 6, 0.5],
    ["end", 10, 6, 10, 1],
  ]);
  // And its start, back to 1 s: the part before gives up media 1–2 s.
  p = applyEdit(p, { type: "trimClip", clipId: "middle", edge: "start", time: 1 });
  expect(pieces()[0]).toEqual(["c", 0, 0, 1, 1]);
  expect(pieces()[1].slice(0, 4)).toEqual(["middle", 1, 1, 6]);
});

test("a transition goes on the join nearest to where it was dropped", () => {
  let p = withClip();
  p = applyEdit(p, { type: "splitClip", clipId: "c", newClipId: "b", at: 6 });
  expect(dropEdits(p, { kind: "transition", id: "dip" }, mainTrack(p), 0.5, ["x", "y"])?.select).toBe("b");
  p = run(p, dropEdits(p, { kind: "transition", id: "dip" }, mainTrack(p), 5, ["x", "y"])!.edits);
  expect(p.clips.find((c) => c.id === "b")?.transition).toEqual({ kind: "dip", duration: 1 });
  // A track with one clip has no join.
  expect(dropEdits(withClip(), { kind: "transition", id: "crossfade" }, undefined, 1, ["x", "y"])).toBeNull();
});

test("the preview draws blocks the way the export does", () => {
  let p = withClip();
  p = run(p, dropEdits(p, { kind: "filter", id: "sepia" }, undefined, 0, ["f", "x"])!.edits);
  p = run(p, dropEdits(p, { kind: "effect", id: "fade-in" }, undefined, 0, ["a", "x"])!.edits);
  p = run(p, dropEdits(p, { kind: "effect", id: "mirror" }, undefined, 0, ["m", "x"])!.edits);
  const blocks = ["f", "a", "m"].map((id) => p.clips.find((c) => c.id === id)!);
  const style = blocksStyle(blocks, 1.5, 1000);
  expect(style.filter).toBe("sepia(1)");
  expect(style.mirror).toBe(true);
  // Halfway through a 3 s fade from black: half black.
  expect(style.layers).toEqual([{ color: "#000", opacity: 0.5 }]);
});

test("tracks are called Track 1, Track 2… from the top", () => {
  const p = withClip();
  expect(p.tracks.map((t) => trackLabel(p, t))).toEqual(p.tracks.map((_, i) => `Track ${i + 1}`));
});

test("a pasted clip lands at the playhead, and a replaced one keeps its place", () => {
  let p = withClip();
  const clip = p.clips.find((c) => c.id === "c")!;
  p = applyEdit(p, { type: "pasteClip", clip, newClipId: "copy", at: 3 });
  const copy = p.clips.find((c) => c.id === "copy")!;
  // Like dropped media, the copy goes in at the playhead; the clip is there, so on a track above.
  expect([copy.start, copy.in, copy.out]).toEqual([3, 0, 10]);
  expect(copy.trackId).not.toBe(clip.trackId);
  expect(p.clips.find((c) => c.id === "c")!.start).toBe(0);
  // A clip whose media was removed can't be pasted.
  expect(applyEdit(p, { type: "pasteClip", clip: { ...clip, mediaId: "gone" }, newClipId: "x", at: 0 })).toBe(p);

  const longer = mediaFromSource({ ...video, url: "C:\\long.mp4", duration: 60 });
  const shorter = mediaFromSource({ ...video, url: "C:\\short.mp4", duration: 4 });
  p = run(p, [
    { type: "importMedia", item: longer },
    { type: "importMedia", item: shorter },
    { type: "replaceClipMedia", clipId: "c", mediaId: longer.id },
  ]);
  expect(p.clips.find((c) => c.id === "c")).toMatchObject({ mediaId: longer.id, start: 0, in: 0, out: 10 });
  // A shorter file gives what it has.
  p = applyEdit(p, { type: "replaceClipMedia", clipId: "c", mediaId: shorter.id });
  expect(p.clips.find((c) => c.id === "c")).toMatchObject({ mediaId: shorter.id, in: 0, out: 4 });
});
