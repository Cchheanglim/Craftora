import { expect, test } from "bun:test";
import { applyEdit } from "../src/project/actions";
import { effectEdits, lookFilter, lookSteps } from "../src/project/effects";
import { clipEnd, emptyProject, mediaFromSource, trackLabel, type Project } from "../src/project/model";
import type { MediaSource } from "../src/types";

const video: MediaSource = {
  url: "C:\\match.mp4",
  title: "match",
  uploader: "",
  duration: 10,
  local: true,
  previewUrl: "",
  streams: [{ id: "local:video", kind: "video", label: "", detail: "", sizeMb: 1 }],
};

/** A project with one 10 s video clip "c" at the start. */
function withClip(): Project {
  const media = mediaFromSource(video);
  const p = applyEdit(emptyProject(), { type: "importMedia", item: media });
  return applyEdit(p, { type: "addClip", clipId: "c", mediaId: media.id, at: 0 });
}

test("a look is the same CSS filter steps the export gets", () => {
  expect(lookFilter("noir")).toBe("grayscale(1) contrast(1.5) brightness(0.9)");
  expect(lookFilter("alien")).toBe("hue-rotate(180deg)");
  expect(lookFilter(undefined)).toBeUndefined();
  expect(lookSteps("not-a-look")).toEqual([]);
});

test("an effect on part of a clip goes on that piece only", () => {
  let p = withClip();
  const clip = p.clips.find((c) => c.id === "c")!;
  const { edits, target } = effectEdits(clip, { speed: 0.5 }, [2, 5], ["end", "middle"]);
  for (const edit of edits) p = applyEdit(p, edit);
  const pieces = [...p.clips].sort((a, b) => a.start - b.start);
  expect(target).toBe("middle");
  expect(pieces.map((c) => [c.id, c.start, c.speed])).toEqual([
    ["c", 0, 1],
    ["middle", 2, 0.5],
    ["end", expect.any(Number), 1],
  ]);
  // The slow piece plays media 2–5 s over 6 s.
  const middle = pieces[1];
  expect([middle.in, middle.out, clipEnd(middle)]).toEqual([2, 5, 8]);
});

test("an effect on the whole clip, or a part reaching its ends, cuts nothing extra", () => {
  let p = withClip();
  const clip = p.clips.find((c) => c.id === "c")!;
  const whole = effectEdits(clip, { patch: { look: "bw" } }, undefined, ["a", "b"]);
  expect(whole.edits).toHaveLength(1);
  const fromStart = effectEdits(clip, { patch: { mirror: true } }, [0, 4], ["a", "b"]);
  for (const edit of fromStart.edits) p = applyEdit(p, edit);
  expect(fromStart.target).toBe("c");
  expect(p.clips.find((c) => c.id === "c")).toMatchObject({ mirror: true, start: 0 });
  expect(p.clips.find((c) => c.id === "a")?.mirror).toBe(false);
});

test("tracks are called Track 1, Track 2… from the top", () => {
  const p = withClip();
  expect(p.tracks.map((t) => trackLabel(p, t))).toEqual(p.tracks.map((_, i) => `Track ${i + 1}`));
});
