import type { ExportSettings, MediaSource, Range, StreamOption } from "../types";
import { formatClock, formatTimecode } from "./timecode";

/** What the export panel shows and what "Add to queue" hands to the queue. */
export interface ExportPlan {
  stream: StreamOption;
  container: string;
  /** Mirror or reverse force a re-encode, whatever the user picked. */
  cutForced: boolean;
  cutMode: ExportSettings["cutMode"];
  sizeMb: number;
  fileName: string;
  command: string;
  summary: string;
}

const compact = (t: string) => t.slice(0, 8).replace(/:/g, "").replace(/^00/, "");

function slug(title: string): string {
  const words = title.replace(/\(.*?\)/g, "").match(/[A-Za-z0-9]+/g) ?? ["clip"];
  return words.slice(0, 4).join("");
}

export function planExport(source: MediaSource, range: Range, settings: ExportSettings): ExportPlan {
  const isVideo = settings.output === "video";
  const streamId = isVideo ? settings.videoStreamId : settings.audioStreamId;
  const candidates = source.streams.filter((s) => s.kind === settings.output);
  const stream = candidates.find((s) => s.id === streamId) ?? candidates[0];

  const container = isVideo ? settings.videoContainer : settings.audioContainer;
  const cutForced = isVideo && (settings.mirror || settings.reverse);
  const cutMode = cutForced ? "precise" : settings.cutMode;

  const length = Math.max(0, range.end - range.start);
  const sizeMb = source.duration > 0 ? (stream.sizeMb * length) / source.duration : 0;

  const from = formatTimecode(range.start);
  const to = formatTimecode(range.end);
  const fileName = `${slug(source.title)}_${compact(from)}-${compact(to)}.${container}`;

  const parts = ["yt-dlp"];
  if (isVideo) {
    parts.push(`-f "${stream.id}+bestaudio"`);
  } else {
    parts.push(`-f "${stream.id}"`, `-x --audio-format ${container}`);
  }
  parts.push(`--download-sections "*${from}-${to}"`);
  if (cutMode === "precise") parts.push("--force-keyframes-at-cuts");
  if (isVideo) {
    const filters = [settings.mirror && "hflip", settings.reverse && "reverse"].filter(Boolean);
    if (filters.length > 0) {
      const audio = settings.reverse ? " -af areverse" : "";
      parts.push(`--postprocessor-args "ffmpeg:-vf ${filters.join(",")}${audio}"`);
    }
    parts.push(`--merge-output-format ${container}`);
  }
  parts.push(`-o "${fileName}"`, `"${source.url}"`);

  const transforms = isVideo
    ? [settings.mirror && "Mirror", settings.reverse && "Reverse"].filter(Boolean)
    : ["Audio only"];
  const summary = [
    `${formatClock(range.start)} → ${formatClock(range.end)}`,
    container.toUpperCase(),
    cutMode === "fast" ? "Fast cut" : "Precise cut",
    ...transforms,
  ].join(" · ");

  return { stream, container, cutForced, cutMode, sizeMb, fileName, command: parts.join(" "), summary };
}

export function formatSize(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}
