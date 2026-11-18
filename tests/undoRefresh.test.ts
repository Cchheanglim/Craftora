import { expect, test } from "bun:test";
import { applyEdit } from "../src/project/actions";
import { emptyProject, mediaFromSource, type Project } from "../src/project/model";
import { reducer } from "../src/project/useProject";
import type { MediaSource } from "../src/types";

const photo: MediaSource = {
  url: "C:\\photo.png",
  title: "photo",
  uploader: "",
  duration: 10,
  local: true,
  previewUrl: "",
  image: true,
  streams: [{ id: "local:image", kind: "video", label: "", detail: "", sizeMb: 1 }],
};

test("a list picture made after Remove background leaves Undo's photo alone", () => {
  const media = mediaFromSource(photo);
  let p: Project = { ...emptyProject(), image: { width: 1080, height: 1080, background: "#ffffff" } };
  p = applyEdit(p, { type: "importMedia", item: media });
  p = applyEdit(p, { type: "addClip", clipId: "photo", mediaId: media.id, at: 0 });
  let state = { project: p, past: [] as Project[], future: [] as Project[] };
  // Remove background: one undo step that swaps the photo and clears the canvas.
  state = reducer(state, { type: "checkpoint" });
  state = reducer(state, { type: "edit", transient: true, edit: { type: "cutOut", mediaId: media.id, source: { ...photo, url: "C:\\cut.png" } } });
  state = reducer(state, { type: "edit", transient: true, edit: { type: "setImage", patch: { background: "" } } });
  // The list picture lands afterwards, built from the current (cut-out) source.
  const now = state.project.media[0].source;
  state = reducer(state, { type: "refreshMedia", mediaId: media.id, patch: { source: { ...now, thumbnail: "data:x" } } });
  expect(state.project.media[0].source.thumbnail).toBe("data:x");

  state = reducer(state, { type: "undo" });
  expect(state.project.media[0].source.url).toBe("C:\\photo.png");
  expect(state.project.image?.background).toBe("#ffffff");
});

test("a refresh of the same file still reaches every step", () => {
  const media = mediaFromSource(photo);
  let p: Project = applyEdit(emptyProject(), { type: "importMedia", item: media });
  let state = { project: p, past: [] as Project[], future: [] as Project[] };
  state = reducer(state, { type: "edit", transient: false, edit: { type: "addClip", clipId: "a", mediaId: media.id, at: 0 } });
  state = reducer(state, { type: "refreshMedia", mediaId: media.id, patch: { source: { ...photo, previewUrl: "http://new" } } });
  expect(state.past[0].media[0].source.previewUrl).toBe("http://new");
});
