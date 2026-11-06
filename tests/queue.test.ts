import { expect, test } from "bun:test";
import { reducer, resumable } from "../src/state/useQueue";
import type { Job, RenderSpec } from "../src/types";

const job = (id: string, extra: Partial<Job>): Job => ({
  id,
  title: id,
  summary: "",
  kind: "video",
  status: "waiting",
  progress: 0,
  needsEncode: true,
  sizeMb: 0,
  fileName: `${id}.mp4`,
  command: "",
  ...extra,
});

const render = {
  id: "export",
  media: [
    { id: "a", local: false, image: false, src: "https://example.com/a", format: "137+140" },
    { id: "b", local: false, image: false, src: "https://example.com/b", format: "137+140" },
  ],
} as RenderSpec;

test("an export renders a finished download's file and waits for the rest", () => {
  const jobs = [job("export", { render, after: ["dl-a", "dl-b"] }), job("other", {})];
  const [exported, other] = reducer(jobs, { type: "downloaded", id: "dl-a", mediaId: "a", path: "D:\\Downloads\\a.mp4" });
  expect(exported.after).toEqual(["dl-b"]);
  expect(exported.render!.media[0]).toMatchObject({ src: "D:\\Downloads\\a.mp4", local: true });
  expect(exported.render!.media[1]).toMatchObject({ src: "https://example.com/b", local: false });
  expect(other).toBe(jobs[1]);
});

test("downloads of a whole link go on where they stopped; cuts, files and exports start again", () => {
  const spec = { id: "s", url: "https://example.com/v", format: "b", output: "video", container: "mp4", start: 0, end: 60, duration: 60, cutMode: "fast", fileName: "v", local: false } as Job["spec"];
  expect(resumable(job("dl", { prefetch: { mediaId: "a", url: "https://example.com/a", format: "b", title: "a", audioOnly: false } }))).toBe(true);
  expect(resumable(job("whole", { spec }))).toBe(true);
  expect(resumable(job("cut", { spec: { ...spec!, start: 10 } }))).toBe(false);
  expect(resumable(job("file", { spec: { ...spec!, local: true } }))).toBe(false);
  expect(resumable(job("export", { render }))).toBe(false);
});
