/**
 * Turns the project and export settings into either a fast single cut (`JobSpec`) or a
 * full timeline render (`RenderSpec`), with the size estimate, summary and the command
 * preview the Export panel shows.
 */
import type { ExportSettings, Frame, JobSpec, RenderClip, RenderSpec } from "../types";
import { formatClock, formatTimecode } from "../lib/timecode";
import { POSITIONS, clipLength, mainTrack, projectDuration, type Clip, type MediaItem, type Project } from "./model";

export const FRAMES: Frame[] = [
  { id: "1080p", label: "16:9 · 1920 × 1080", width: 1920, height: 1080 },
  { id: "720p", label: "16:9 · 1280 × 720", width: 1280, height: 720 },
  { id: "vertical", label: "9:16 · 1080 × 1920 (Shorts, Reels)", width: 1080, height: 1920 },
  { id: "square", label: "1:1 · 1080 × 1080", width: 1080, height: 1080 },
  { id: "4x3", label: "4:3 · 1440 × 1080", width: 1440, height: 1080 },
];
export const FPS = 30;

export const frameOf = (settings: ExportSettings) => FRAMES.find((f) => f.id === settings.frameId) ?? FRAMES[0];

export type ExportPlan =
  | {
      kind: "simple";
      /** Spec without its job id; the queue adds it. */
      spec: Omit<JobSpec, "id">;
      sizeMb: number;
      fileName: string;
      summary: string;
      command: string;
      title: string;
    }
  | {
      kind: "render";
      spec: Omit<RenderSpec, "id">;
      sizeMb: number;
      fileName: string;
      summary: string;
      command: string;
      title: string;
    }
  | { kind: "empty"; reason: string };

function slug(title: string): string {
  const words = title.replace(/\(.*?\)|\.[a-z0-9]{2,4}$/gi, "").match(/[A-Za-z0-9]+/g) ?? ["clip"];
  return words.slice(0, 4).join("");
}

const compact = (seconds: number) => formatTimecode(seconds).slice(0, 8).replace(/:/g, "").replace(/^00/, "");

/** One clip on Video 1 with nothing changed: eligible for the fast, lossless path. */
function singleUntouched(project: Project): { clip: Clip; media: MediaItem } | null {
  if (project.clips.length !== 1) return null;
  const [clip] = project.clips;
  const media = project.media.find((m) => m.id === clip.mediaId);
  const untouched = clip.volume === 1 && !clip.mirror && !clip.reverse;
  return media && untouched && clip.trackId === mainTrack(project).id ? { clip, media } : null;
}

/** Whether the Fast/Precise choice applies (only the single-cut path can skip re-encoding). */
export function cutModeApplies(project: Project, settings: ExportSettings): boolean {
  const single = singleUntouched(project);
  if (!single) return false;
  return single.media.source.local ? settings.output === "video" : true;
}

export function planExport(project: Project, settings: ExportSettings): ExportPlan {
  const isVideo = settings.output === "video";
  const container = isVideo ? settings.videoContainer : settings.audioContainer;
  const duration = projectDuration(project);
  if (project.clips.length === 0) return { kind: "empty", reason: "Add something to the timeline first." };

  const single = singleUntouched(project);
  if (single && cutModeApplies(project, settings)) {
    const { clip, media } = single;
    const src = media.source;
    const length = clipLength(clip);
    const fileName = `${slug(media.name)}_${compact(clip.in)}-${compact(clip.out)}.${container}`;
    const format = src.local ? "local" : isVideo ? media.videoFormat : media.audioFormat;
    const stream = src.streams.find((s) => s.id === format);
    const whole = clip.in <= 0.05 && clip.out >= src.duration - 0.05;
    const command = src.local
      ? `ffmpeg${whole ? "" : ` -ss ${clip.in.toFixed(3)} -t ${length.toFixed(3)}`} -i "${src.url}" -c copy "${fileName}"`
      : [
          "yt-dlp",
          `-f "${format}"`,
          whole ? "" : `--download-sections "*${clip.in.toFixed(2)}-${clip.out.toFixed(2)}"`,
          !whole && settings.cutMode === "precise" ? "--force-keyframes-at-cuts" : "",
          isVideo ? `--merge-output-format ${container} --remux-video ${container}` : `-x --audio-format ${container}`,
          `-o "${fileName}"`,
          `"${src.url}"`,
        ]
          .filter(Boolean)
          .join(" ");
    return {
      kind: "simple",
      spec: {
        url: src.url,
        format,
        output: settings.output,
        container,
        start: clip.in,
        end: clip.out,
        duration: src.duration,
        cutMode: settings.cutMode,
        fileName,
        local: Boolean(src.local),
      },
      sizeMb: stream && src.duration > 0 ? (stream.sizeMb * length) / src.duration : 0,
      fileName,
      title: media.name,
      summary: [
        `${formatClock(clip.in)} → ${formatClock(clip.out)}`,
        container.toUpperCase(),
        settings.cutMode === "fast" ? "Fast cut" : "Precise cut",
        isVideo ? "" : "Audio only",
      ]
        .filter(Boolean)
        .join(" · "),
      command,
    };
  }

  // Everything else: one render of the whole timeline.
  const frame = frameOf(settings);
  const main = mainTrack(project).id;
  const used = project.media.filter((m) => project.clips.some((c) => c.mediaId === m.id));
  const clips: RenderClip[] = project.clips.map((c) => {
    const track = project.tracks.find((t) => t.id === c.trackId);
    const role: RenderClip["role"] = !c.mediaId
      ? "text"
      : c.trackId === main
        ? "main"
        : track?.kind === "audio"
          ? "audio"
          : "overlay";
    const { x, y } = POSITIONS[c.position];
    return {
      role,
      mediaId: c.mediaId,
      start: c.start,
      in: c.in,
      out: c.out,
      volume: c.volume,
      mirror: c.mirror,
      reverse: c.reverse,
      size: c.size,
      x,
      y,
      text: c.text ?? "",
      color: c.color ?? "#ffffff",
    };
  });
  const media = used.map((m) => {
    // Sound-only use of a link downloads just the audio stream.
    const pictureNeeded = project.clips.some((c) => c.mediaId === m.id && project.tracks.find((t) => t.id === c.trackId)?.kind === "video");
    return {
      id: m.id,
      local: Boolean(m.source.local),
      src: m.source.url,
      format: m.source.local ? "" : pictureNeeded ? m.videoFormat : m.audioFormat,
    };
  });

  const title = used[0]?.name ?? "Project";
  const fileName = `${slug(title)}_edit.${container}`;
  // Rough: ~8 Mbit/s for 1080p video plus 192 kbit/s sound.
  const pixels = (frame.width * frame.height) / (1920 * 1080);
  const sizeMb = isVideo ? duration * (1 + 0.024) * Math.max(0.4, pixels) : duration * (container === "wav" ? 0.18 : container === "flac" ? 0.1 : 0.04);

  const counts = {
    clips: project.clips.filter((c) => c.mediaId).length,
    texts: project.clips.filter((c) => !c.mediaId).length,
  };
  const summary = [
    formatClock(duration),
    container.toUpperCase(),
    isVideo ? `${frame.width}×${frame.height}` : "Audio only",
    `${counts.clips} clip${counts.clips === 1 ? "" : "s"}`,
    counts.texts ? `${counts.texts} text` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const downloads = media
    .filter((m) => !m.local)
    .map((m) => `yt-dlp -f "${m.format}" --download-sections "*…" --force-keyframes-at-cuts "${m.src}"`);
  const graph = [
    "concat",
    project.clips.some((c) => c.mirror) && "hflip",
    project.clips.some((c) => c.reverse) && "reverse",
    clips.some((c) => c.role === "overlay") && "overlay",
    counts.texts && "drawtext",
    "amix",
  ].filter(Boolean);
  const command = [
    ...downloads,
    `ffmpeg ${media.map((m) => `-i "${m.local ? m.src : "<downloaded>"}"`).join(" ")} -filter_complex "${graph.join(", ")}…"${
      isVideo ? ` -c:v libx264 -crf 18 -r ${FPS}` : ""
    } "${fileName}"`,
  ].join("\n");

  return {
    kind: "render",
    spec: { media, clips, width: frame.width, height: frame.height, fps: FPS, output: settings.output, container, fileName },
    sizeMb,
    fileName,
    title,
    summary,
    command,
  };
}

export function formatSize(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}
