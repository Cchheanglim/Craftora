import type { ExportSettings, Layer, MediaSource, Range, StreamOption } from "../types";
import { formatClock, formatTimecode } from "./timecode";

/** What the export panel shows and what "Add to queue" hands to the queue. */
export interface ExportPlan {
  stream: StreamOption;
  container: string;
  /** Why a re-encode is forced (and Precise used) whatever the user picked; null when it isn't. */
  forcedReason: string | null;
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

const AUDIO_CODEC: Record<string, string> = {
  mp3: "-c:a libmp3lame -b:a 320k",
  wav: "-c:a pcm_s16le",
  flac: "-c:a flac",
};

export function planExport(
  source: MediaSource,
  range: Range,
  settings: ExportSettings,
  layers: Layer[] = [],
  mainVolume = 1,
): ExportPlan {
  const isVideo = settings.output === "video";
  const streamId = isVideo ? settings.videoStreamId : settings.audioStreamId;
  const candidates = source.streams.filter((s) => s.kind === settings.output);
  const stream = candidates.find((s) => s.id === streamId) ?? candidates[0] ?? source.streams[0];

  const container = isVideo ? settings.videoContainer : settings.audioContainer;
  const transform = isVideo && (settings.mirror || settings.reverse);
  const mixing = layers.length > 0 || Math.abs(mainVolume - 1) > 0.01;
  const forcedReason = transform
    ? "Mirror and reverse need re-encoding, so Precise is used: frame-accurate, slower."
    : mixing
      ? "Layers and volume changes need re-encoding, so Precise is used: frame-accurate, slower."
      : null;
  const cutForced = forcedReason !== null;
  const cutMode = cutForced ? "precise" : settings.cutMode;

  const length = Math.max(0, range.end - range.start);
  const sizeMb = source.duration > 0 ? (stream.sizeMb * length) / source.duration : 0;

  const from = formatTimecode(range.start);
  const to = formatTimecode(range.end);
  const fileName = `${slug(source.title)}_${compact(from)}-${compact(to)}.${container}`;

  // Mirrors the arguments src-tauri/src/jobs.rs builds (progress flags omitted).
  const whole = range.start <= 0.05 && range.end >= source.duration - 0.05;
  const render = transform || mixing;
  const parts: string[] = [];

  /** The FFmpeg pass that applies transforms, layers and the sound mix. */
  const ffmpegRender = (input: string, seek: boolean) => {
    const cmd = ["ffmpeg"];
    if (seek && !whole) cmd.push(`-ss ${range.start.toFixed(3)} -t ${length.toFixed(3)}`);
    cmd.push(`-i "${input}"`);
    for (const layer of layers) cmd.push(`-i "${layer.name}"`);
    const graph = [
      settings.mirror && isVideo && "hflip",
      settings.reverse && isVideo && "reverse",
      isVideo && layers.some((l) => l.kind === "video") && "overlay",
      mixing && "amix",
    ].filter(Boolean);
    if (graph.length) cmd.push(`-filter_complex "${graph.join(", ")}…"`);
    cmd.push(isVideo ? "-c:v libx264 -crf 18 -c:a aac -b:a 192k" : `-vn ${AUDIO_CODEC[container]}`);
    cmd.push(`"${fileName}"`);
    return cmd.join(" ");
  };

  if (source.local) {
    // Files on this PC: one FFmpeg pass, no network.
    if (isVideo && cutMode === "fast") {
      parts.push("ffmpeg");
      if (!whole) parts.push(`-ss ${range.start.toFixed(3)} -t ${length.toFixed(3)}`);
      parts.push(`-i "${source.url}"`, "-c copy", `"${fileName}"`);
    } else {
      parts.push(ffmpegRender(source.url, true));
    }
  } else {
    const downloadName = render ? `clip.${container}` : fileName;
    parts.push("yt-dlp", `-f "${stream.id}"`);
    if (!whole) {
      parts.push(`--download-sections "*${range.start.toFixed(2)}-${range.end.toFixed(2)}"`);
      if (cutMode === "precise") parts.push("--force-keyframes-at-cuts");
    }
    parts.push(isVideo ? `--merge-output-format ${container} --remux-video ${container}` : `-x --audio-format ${container}`);
    parts.push(`-o "${downloadName}"`, `"${source.url}"`);
    if (render) parts.push(`\n${ffmpegRender(downloadName, false)}`);
  }

  const extras = isVideo
    ? [settings.mirror && "Mirror", settings.reverse && "Reverse"].filter(Boolean)
    : ["Audio only"];
  if (layers.length) extras.push(`${layers.length} layer${layers.length > 1 ? "s" : ""}`);
  const summary = [
    `${formatClock(range.start)} → ${formatClock(range.end)}`,
    container.toUpperCase(),
    cutMode === "fast" ? "Fast cut" : "Precise cut",
    ...extras,
  ].join(" · ");

  return { stream, container, forcedReason, cutForced, cutMode, sizeMb, fileName, command: parts.join(" "), summary };
}

export function formatSize(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}
