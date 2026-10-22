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
