import { expect, test } from "bun:test";
import { folded, reducer, resumable, shownAs } from "../src/state/useQueue";
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

test("an export's own video download shows in the export's row, then goes when the export does", () => {
  const video = job("dl", {
    status: "downloading",
    progress: 40,
    downloadedBytes: 40e6,
    totalBytes: 100e6,
    prefetch: { mediaId: "a", url: "https://example.com/a", format: "b", title: "a", audioOnly: false, forExport: true },
  });
  const exported = job("export", { render, after: ["dl"], sizeMb: 700 });
  const jobs = [exported, video];
  expect(folded(video, jobs)).toBe(true);
  expect(folded(exported, jobs)).toBe(false);
  expect(shownAs(exported, jobs)).toMatchObject({ id: "export", status: "downloading", progress: 40, totalBytes: 100e6, sizeMb: 700 });
  // Pause all pauses the export too: still the download's progress, not 0%.
  expect(shownAs({ ...exported, status: "paused" }, [exported, { ...video, status: "paused" }])).toMatchObject({ status: "paused", progress: 40 });
  // Once downloaded, the export shows its own encoding and the finished download stays out of sight.
  const done = { ...video, status: "finished" as const };
  const encoding = { ...exported, status: "encoding" as const, after: [] };
  expect(folded(done, [encoding, done])).toBe(true);
  expect(shownAs(encoding, [encoding, done]).status).toBe("encoding");
  // After a restart (exports aren't kept) the download shows by itself, finished too.
  expect(folded(done, [done])).toBe(false);
  // A download the user asked for (not just for an export) keeps its own row.
  const own = { ...video, prefetch: { ...video.prefetch!, forExport: false } };
  expect(folded(own, [exported, own])).toBe(false);
});

test("retrying an export retries its failed video download too", () => {
  const jobs = [job("export", { status: "failed", render, after: ["dl"], error: "x" }), job("dl", { status: "failed", error: "x" }), job("other", { status: "failed" })];
  const [exported, video, other] = reducer(jobs, { type: "retry", id: "export" });
  expect(exported.status).toBe("waiting");
  expect(video).toMatchObject({ status: "waiting", error: undefined });
  expect(other.status).toBe("failed");
});
