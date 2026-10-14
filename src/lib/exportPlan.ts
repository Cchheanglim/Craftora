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
  const stream = candidates.find((s) => s.id === streamId) ?? candidates[0] ?? source.streams[0];

  const container = isVideo ? settings.videoContainer : settings.audioContainer;
  const cutForced = isVideo && (settings.mirror || settings.reverse);
  const cutMode = cutForced ? "precise" : settings.cutMode;

  const length = Math.max(0, range.end - range.start);
  const sizeMb = source.duration > 0 ? (stream.sizeMb * length) / source.duration : 0;

  const from = formatTimecode(range.start);
  const to = formatTimecode(range.end);
  const fileName = `${slug(source.title)}_${compact(from)}-${compact(to)}.${container}`;

  // Mirrors the arguments src-tauri/src/jobs.rs builds (progress flags omitted).
  const transform = isVideo && (settings.mirror || settings.reverse);
  const whole = range.start <= 0.05 && range.end >= source.duration - 0.05;
  const filters = [settings.mirror && "hflip", settings.reverse && "reverse"].filter(Boolean).join(",");
  const reencode = `${filters ? `-vf ${filters} ` : ""}${settings.reverse ? "-af areverse " : ""}-c:v libx264 -crf 18 -preset medium -c:a aac -b:a 192k`;
  const parts: string[] = [];

  if (source.local) {
    // Files on this PC: one FFmpeg pass, no network.
    const audioCodec = { mp3: "-c:a libmp3lame -b:a 320k", wav: "-c:a pcm_s16le", flac: "-c:a flac" } as Record<string, string>;
    parts.push("ffmpeg");
    if (!whole) parts.push(`-ss ${range.start.toFixed(3)}`);
    parts.push(`-i "${source.url}"`);
    if (!whole) parts.push(`-t ${length.toFixed(3)}`);
    if (!isVideo) parts.push(`-vn ${audioCodec[container]}`);
    else if (cutMode === "fast") parts.push("-c copy");
    else parts.push(reencode);
    parts.push(`"${fileName}"`);
  } else {
    const downloadName = transform ? `clip.${container}` : fileName;
    parts.push("yt-dlp", `-f "${stream.id}"`);
    if (!whole) {
      parts.push(`--download-sections "*${range.start.toFixed(2)}-${range.end.toFixed(2)}"`);
      if (cutMode === "precise") parts.push("--force-keyframes-at-cuts");
    }
    parts.push(isVideo ? `--merge-output-format ${container} --remux-video ${container}` : `-x --audio-format ${container}`);
    parts.push(`-o "${downloadName}"`, `"${source.url}"`);
    if (transform) parts.push(`\nffmpeg -i "${downloadName}" ${reencode} "${fileName}"`);
  }

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
