import { expect, test } from "bun:test";
import { reducer } from "../src/state/useQueue";
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
