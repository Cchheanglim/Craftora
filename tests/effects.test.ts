import { expect, test } from "bun:test";
import { applyEdit, type EditAction } from "../src/project/actions";
import { adjustSteps, blockLabel, blocksStyle, dropEdits, lookFilter, lookSteps, stepsFilter, toneCurve, warmthMatrix } from "../src/project/effects";
import { clipEnd, emptyProject, isBlock, mediaFromSource, trackLabel, type Clip, type Project } from "../src/project/model";
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
  // Strength scales each step between no change (0) and the full look (1).
  expect(lookSteps("noir", 0)).toEqual([
    ["grayscale", 0],
    ["contrast", 1],
    ["brightness", 1],
  ]);
  expect(lookSteps("warm", 0)).toEqual([
    ["sepia", 0],
    ["saturate", 1],
  ]);
  expect(lookSteps("noir", 0.5)).toEqual([
    ["grayscale", 0.5],
    ["contrast", 1.25],
    ["brightness", 0.95],
  ]);
  expect(lookSteps("noir", 1)).toEqual([
    ["grayscale", 1],
    ["contrast", 1.5],
    ["brightness", 0.9],
  ]);
});

test("Adjust adds colour steps after the filter, Warmth through its SVG filter, and clamps its sliders", () => {
  expect(adjustSteps(undefined)).toEqual([]);
  expect(adjustSteps({ brightness: 0, warmth: 0 })).toEqual([]);
  expect(adjustSteps({ brightness: 40, contrast: -50, saturation: 100, warmth: -30 })).toEqual([
    ["brightness", 1.2],
    ["contrast", 0.75],
    ["saturate", 2],
    ["warmth", -0.3],
  ]);
  expect(stepsFilter([...lookSteps("bw"), ...adjustSteps({ warmth: 25 })])).toBe("grayscale(1) url(#warmth-25)");
  expect(warmthMatrix(0.5)).toBe("1.1 0 0 0 0 0 1 0 0 0 0 0 0.9 0 0 0 0 0 1 0");
  // On a picture clip it reaches the export; the slider can't go past ±100.
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: mediaFromSource(video) });
  p = applyEdit(p, { type: "addClip", clipId: "c", mediaId: p.media[0].id, at: 0 });
  p = applyEdit(p, { type: "updateClip", clipId: "c", patch: { adjust: { warmth: 250.4 } } });
  expect(p.clips[0].adjust).toEqual({ warmth: 100 });
  expect(blocksStyle(p.clips, 0, 1280).filter).toBe("url(#warmth-100)");
});

test("Exposure, Highlights, Shadows and Sharpen are SVG steps in a set order; Sharpen only sharpens", () => {
  expect(adjustSteps({ sharpen: 40, shadows: 20, contrast: 10, exposure: -50, highlights: -100, warmth: 5 })).toEqual([
    ["exposure", -0.5],
    ["contrast", 1.05],
    ["highlights", -1],
    ["shadows", 0.2],
    ["warmth", 0.05],
    ["sharpen", 0.4],
  ]);
  expect(adjustSteps({ sharpen: -30 })).toEqual([]);
  expect(stepsFilter(adjustSteps({ exposure: 50, sharpen: 100 }))).toBe("url(#exposure-50) url(#sharpen-100)");
});

test("the tone curves keep black and white, never fold back, and Exposure down undoes Exposure up", () => {
  for (const op of ["exposure", "highlights", "shadows"] as const) {
    for (const v of [-1, -0.5, 0.5, 1]) {
      expect(toneCurve(op, v, 0)).toBe(0);
      expect(toneCurve(op, v, 1)).toBeCloseTo(1, 12);
      for (let i = 1; i <= 100; i++) expect(toneCurve(op, v, i / 100)).toBeGreaterThanOrEqual(toneCurve(op, v, (i - 1) / 100));
    }
  }
  expect(toneCurve("exposure", 1, 0.5)).toBeGreaterThan(0.7);
  expect(toneCurve("exposure", -0.6, toneCurve("exposure", 0.6, 0.3))).toBeCloseTo(0.3, 12);
  // Shadows move the dark tones most, Highlights the bright ones.
  expect(toneCurve("shadows", 1, 0.25) - 0.25).toBeGreaterThan(toneCurve("shadows", 1, 0.75) - 0.75);
  expect(toneCurve("highlights", 1, 0.75) - 0.75).toBeGreaterThan(toneCurve("highlights", 1, 0.25) - 0.25);
});

test("a filter or effect dropped on a video goes inside it; off any clip it's a 5 s block of its own", () => {
  let p = withClip();
  const done = dropEdits(p, { kind: "filter", id: "bw" }, mainTrack(p), 2, ["f", "x"])!;
  p = run(p, done.edits);
  // Inside the clip, for its whole length: no block, the clip selected.
  const video = () => p.clips.find((c) => c.id === "c")!;
  expect(done.select).toBe("c");
  expect(p.clips.length).toBe(1);
  expect([video().start, video().out, video().look, video().lookAmount]).toEqual([0, 10, "bw", 1]);
  // An effect on it too; a second effect replaces the first, its Strength and Speed back to their defaults.
  p = run(p, dropEdits(p, { kind: "effect", id: "shake" }, mainTrack(p), 3, ["e", "y"])!.edits);
  p = applyEdit(p, { type: "updateClip", clipId: "c", patch: { effectStrength: 90, effectSpeed: 2 } });
  p = run(p, dropEdits(p, { kind: "effect", id: "punch" }, mainTrack(p), 3, ["e", "y"])!.edits);
  expect([video().look, video().effect, video().effectStrength, video().effectSpeed, p.clips.length]).toEqual(["bw", "punch", undefined, undefined, 1]);
  // Off any clip: a block of its own.
  const done2 = dropEdits(p, { kind: "effect", id: "blur" }, undefined, 20, ["k", "v"])!;
  p = run(p, done2.edits);
  const blur = p.clips.find((c) => c.id === "k")!;
  expect([blur.start, clipEnd(blur), isBlock(blur)]).toEqual([20, 25, true]);
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

test("an Adjust layer is a 5 s block of its own, even dropped on a clip, and only reaches the export once it changes something", async () => {
  const { planExport } = await import("../src/project/exportPlan");
  let p = withClip();
  p = run(p, dropEdits(p, { kind: "adjust", id: "layer" }, mainTrack(p), 2, ["L", "x"])!.edits);
  const layer = () => p.clips.find((c) => c.id === "L")!;
  expect([layer().start, clipEnd(layer()), isBlock(layer()), blockLabel(layer())]).toEqual([2, 7, true, "Adjust layer"]);
  // Not inside the clip: on a free track of its own.
  expect(layer().trackId).not.toBe(mainTrack(p));
  expect(p.clips.find((c) => c.id === "c")!.adjust).toBeUndefined();
  const settings = { output: "video", videoContainer: "mp4", audioContainer: "mp3", cutMode: "fast", frameId: "1080p", quality: "fast" } as const;
  const roles = () => {
    const plan = planExport(p, settings);
    return plan.kind === "render" ? plan.spec.clips.map((c) => [c.role, c.look]) : plan.kind;
  };
  expect(roles()).toEqual([["video", []]]);
  p = applyEdit(p, { type: "updateClip", clipId: "L", patch: { adjust: { warmth: 50 } } });
  expect(roles()).toEqual([["video", []], ["effect", [["warmth", 0.5]]]]);
  expect(blocksStyle([layer()], 3, 1000).filter).toBe("url(#warmth-50)");
  // Reset keeps it a layer.
  p = applyEdit(p, { type: "updateClip", clipId: "L", patch: { adjust: {} } });
  expect(isBlock(layer())).toBe(true);
});

test("effects keep going for the whole block, follow Strength and Speed, and the new ones draw what the export does", () => {
  const block = (effect: Clip["effect"], patch: Partial<Clip> = {}) => ({ ...withClip().clips[0], mediaId: undefined, start: 0, in: 0, out: 5, effect, ...patch }) as Clip;
  const scale = (b: Clip, t: number) => Number(/scale\(([\d.]+)\)/.exec(blocksStyle([b], t, 1000).transform ?? "")?.[1] ?? 1);
  // Shake no longer dies away: as strong near the end as at the start.
  expect(scale(block("shake"), 4.9)).toBe(1.06);
  expect(scale(block("shake", { effectStrength: 100 }), 4.9)).toBe(1.12);
  // Zoom punch hits again every second (every half second at speed 2).
  expect(scale(block("punch"), 3.1)).toBe(1.2);
  expect(scale(block("punch", { effectSpeed: 2 }), 3.6)).toBe(1.2);
  expect(scale(block("zoom-in", { effectStrength: 100 }), 5)).toBe(1.6);
  // Strobe: a full flash at each beat, gone soon after.
  expect(blocksStyle([block("strobe")], 1, 1000).layers).toEqual([{ color: "#fff", opacity: 0.6 }]);
  expect(blocksStyle([block("strobe")], 1.4, 1000).layers[0].opacity).toBe(0);
  // Vignette: FFmpeg's cos⁴ falloff at its default angle (π/5): clear in the middle, 57% black at the corners (1 - cos(π/5)⁴).
  const vignette = blocksStyle([block("vignette")], 1, 1000).layers[0].color;
  expect(vignette.startsWith("radial-gradient(circle farthest-corner at 50% 50%, rgba(0,0,0,0) 0%")).toBe(true);
  expect(vignette.endsWith("rgba(0,0,0,0.5716) 100%)")).toBe(true);
  expect(blocksStyle([block("rgb-split", { effectStrength: 80 })], 1, 1000).filter).toBe("url(#rgb-80)");
  expect(blocksStyle([block("grain")], 1, 1000).layers[0]).toMatchObject({ opacity: 0.35, blend: "overlay" });
});

test("a transition goes on the join nearest to where it was dropped", () => {
  let p = withClip();
  p = applyEdit(p, { type: "splitClip", clipId: "c", newClipId: "b", at: 6 });
  expect(dropEdits(p, { kind: "transition", id: "dip" }, mainTrack(p), 0.5, ["x", "y"])?.select).toBe("b");
  p = run(p, dropEdits(p, { kind: "transition", id: "dip" }, mainTrack(p), 5.6, ["x", "y"])!.edits);
  expect(p.clips.find((c) => c.id === "b")?.transition).toEqual({ kind: "dip", duration: 1 });
  // Nothing under it and no join: nowhere to go.
  expect(dropEdits(withClip(), { kind: "transition", id: "crossfade" }, undefined, 12, ["x", "y"])).toBeNull();
});

test("an effect dropped in the empty space around the tracks gets a track of its own at the top", () => {
  let p = withClip();
  const done = dropEdits(p, { kind: "effect", id: "shake" }, null, 2, ["x", "y"])!;
  p = run(p, done.edits);
  expect(p.tracks.map((t) => t.id)[0]).toBe("y");
  expect(p.clips.find((c) => c.id === "x")).toMatchObject({ trackId: "y", effect: "shake", start: 2 });
  // Every dragged effect lasts 5 s, Shake too (it used to be 1 s).
  expect(clipEnd(p.clips.find((c) => c.id === "x")!)).toBe(7);
  // The video keeps its own picture: nothing went inside it.
  expect(p.clips.find((c) => c.id === "c")?.effect).toBeUndefined();
});

test("a transition in the middle of a clip goes on that clip's own cut and never cuts it", () => {
  let p = withClip();
  // One clip alone has no cut: nowhere to go (it used to cut the clip there).
  expect(dropEdits(p, { kind: "transition", id: "dip" }, undefined, 4, ["x", "y"])).toBeNull();
  p = applyEdit(p, { type: "splitClip", clipId: "c", newClipId: "b", at: 4 });
  p = applyEdit(p, { type: "splitClip", clipId: "b", newClipId: "d", at: 7 });
  // In the middle of the first clip: into the clip after it.
  expect(dropEdits(p, { kind: "transition", id: "dip" }, mainTrack(p), 1.5, ["x", "y"])?.select).toBe("b");
  // In the middle of the last one: from the clip before it, not the nearer edge of anything else.
  const done = dropEdits(p, { kind: "transition", id: "dip" }, mainTrack(p), 9, ["x", "y"])!;
  expect(done.edits.some((e) => e.type === "splitClip")).toBe(false);
  p = run(p, done.edits);
  expect(p.clips.find((c) => c.id === "d")?.transition).toEqual({ kind: "dip", duration: 1 });
  expect(p.clips.length).toBe(3);
});

test("a transition goes between a video and a shape right after it (no split needed)", () => {
  let p = withClip();
  p = applyEdit(p, { type: "addShape", clipId: "s", shape: "rect", at: 10, length: 5, trackId: mainTrack(p) });
  expect(p.clips.find((c) => c.id === "s")).toMatchObject({ trackId: mainTrack(p), start: 10 });
  // Over the middle of the shape: on its cut with the video.
  const done = dropEdits(p, { kind: "transition", id: "crossfade" }, mainTrack(p), 12.5, ["x", "y"])!;
  expect(done.select).toBe("s");
  p = run(p, done.edits);
  expect(p.clips.find((c) => c.id === "s")?.transition).toEqual({ kind: "crossfade", duration: 1 });
});

test("a fade dropped on a clip fades its start or end; off any clip it does nothing", () => {
  let p = withClip();
  const doneIn = dropEdits(p, { kind: "fade", id: "in" }, mainTrack(p), 2, ["x", "y"])!;
  p = run(p, doneIn.edits);
  expect(doneIn.select).toBe("c");
  expect(p.clips.length).toBe(1);
  expect(p.clips[0]).toMatchObject({ id: "c", fadeIn: 1, fadeOut: 0 });
  p = run(p, dropEdits(p, { kind: "fade", id: "out" }, mainTrack(p), 2, ["x", "y"])!.edits);
  expect(p.clips.length).toBe(1);
  expect(p.clips[0]).toMatchObject({ id: "c", fadeIn: 1, fadeOut: 1 });
  expect(dropEdits(p, { kind: "fade", id: "in" }, mainTrack(p), 20, ["x", "y"])).toBeNull();
});

test("the preview draws blocks the way the export does", () => {
  let p = withClip();
  p = run(p, dropEdits(p, { kind: "filter", id: "sepia" }, undefined, 0, ["f", "x"])!.edits);
  p = run(p, dropEdits(p, { kind: "effect", id: "fade-in" }, undefined, 0, ["a", "x"])!.edits);
  p = run(p, dropEdits(p, { kind: "effect", id: "mirror" }, undefined, 0, ["m", "x"])!.edits);
  const blocks = ["f", "a", "m"].map((id) => p.clips.find((c) => c.id === id)!);
  const style = blocksStyle(blocks, 2.5, 1000);
  expect(style.filter).toBe("sepia(1)");
  expect(style.mirror).toBe(true);
  // Halfway through a 5 s fade from black: half black.
  expect(style.layers).toEqual([{ color: "#000", opacity: 0.5 }]);

  // Zoom punch peaks at u = 0.1 s (scale 1.2); cinema bars on 16:9 cover ~12.8% top and bottom mid-block.
  p = run(p, dropEdits(p, { kind: "effect", id: "punch" }, undefined, 0, ["p", "x"])!.edits);
  p = run(p, dropEdits(p, { kind: "effect", id: "bars" }, undefined, 0, ["b", "x"])!.edits);
  const punch = p.clips.find((c) => c.id === "p")!;
  const bars = p.clips.find((c) => c.id === "b")!;
  expect(blocksStyle([punch], 0.1, 1920, 1080).transform).toBe("translate(0%, 0%) scale(1.2)");
  expect(blocksStyle([bars], 1.5, 1920, 1080).bars).toBeCloseTo(0.128, 3);
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
