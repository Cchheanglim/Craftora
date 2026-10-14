/**
 * The editing project: imported media, tracks and the clips placed on them.
 * Plain data, so it can be undone, saved, and edited by an AI agent through the
 * same actions the UI uses (see `actions.ts`).
 */
import type { MediaSource } from "../types";

export type TrackKind = "video" | "audio" | "text";

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  /** Video 1: clips play back to back and make the base picture. */
  main?: boolean;
}

export type Position =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

/**
 * Preset places for picture-in-picture and text. `x`/`y` are fractions of the free space
 * (0 = left/top, 1 = right/bottom). The preview and FFmpeg use the same numbers, so what
 * you see is what gets saved.
 */
export const POSITIONS: Record<Position, { label: string; x: number; y: number }> = {
  "top-left": { label: "Top left", x: 0.04, y: 0.06 },
  top: { label: "Top", x: 0.5, y: 0.08 },
  "top-right": { label: "Top right", x: 0.96, y: 0.06 },
  left: { label: "Left", x: 0.04, y: 0.5 },
  center: { label: "Center", x: 0.5, y: 0.5 },
  right: { label: "Right", x: 0.96, y: 0.5 },
  "bottom-left": { label: "Bottom left", x: 0.04, y: 0.94 },
  bottom: { label: "Bottom", x: 0.5, y: 0.9 },
  "bottom-right": { label: "Bottom right", x: 0.96, y: 0.94 },
};

/** The preset at `x`/`y`, if the clip sits exactly on one. */
export function presetAt(x: number, y: number): Position | undefined {
  return (Object.keys(POSITIONS) as Position[]).find((p) => Math.abs(POSITIONS[p].x - x) < 0.005 && Math.abs(POSITIONS[p].y - y) < 0.005);
}

/** Something imported into the project: a file from this PC or a fetched link. */
export interface MediaItem {
  id: string;
  name: string;
  source: MediaSource;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Links: the yt-dlp format used when the picture is needed. */
  videoFormat: string;
  /** Links: the yt-dlp format used when only the sound is needed. */
  audioFormat: string;
  /** Set when a saved project is reopened and the file can't be found any more. */
  missing?: boolean;
}

/** Fractions of the picture cut off each side. */
export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
/** The most a crop may take from one side, so something always remains. */
export const MAX_CROP = 0.45;

export const isCropped = (c: Crop) => c.left > 0 || c.top > 0 || c.right > 0 || c.bottom > 0;

export interface Clip {
  id: string;
  trackId: string;
  /** Absent for text clips. */
  mediaId?: string;
  /** Timeline position, seconds. */
  start: number;
  /** Part of the media used, in media seconds. Text clips: 0..length. */
  in: number;
  out: number;
  /** Playback speed: 2 plays twice as fast and takes half as long on the timeline. Text: always 1. */
  speed: number;
  /** 0–1. */
  volume: number;
  mirror: boolean;
  reverse: boolean;
  /** Seconds of fade from black/silence at the start and to black/silence at the end. */
  fadeIn: number;
  fadeOut: number;
  crop: Crop;
  /** Picture-in-picture: width as a fraction of the frame. Text: height as a fraction of the frame. */
  size: number;
  /** Fractions of the free space, like `POSITIONS`. */
  x: number;
  y: number;
  text?: string;
  /** Text color, #rrggbb. */
  color?: string;
}

export interface Project {
  media: MediaItem[];
  tracks: Track[];
  clips: Clip[];
}

/** Shortest clip a trim or split may leave, in seconds. */
export const MIN_CLIP = 0.2;
export const DEFAULT_TEXT_LENGTH = 3;
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** How long the clip lasts on the timeline. */
export const clipLength = (c: Clip) => (c.out - c.in) / c.speed;
export const clipEnd = (c: Clip) => c.start + clipLength(c);

/** Where in its media a clip is at timeline time `t` (reversed clips run from `out` back to `in`). */
export function mediaTimeAt(c: Clip, t: number): number {
  const into = (t - c.start) * c.speed;
  return c.reverse ? c.out - into : c.in + into;
}

/** 0–1: how far faded in/out the clip is at timeline time `t`. */
export function fadeAt(c: Clip, t: number): number {
  const into = t - c.start;
  const left = clipEnd(c) - t;
  let f = 1;
  if (c.fadeIn > 0) f = Math.min(f, into / c.fadeIn);
  if (c.fadeOut > 0) f = Math.min(f, left / c.fadeOut);
  return Math.min(1, Math.max(0, f));
}

export function projectDuration(p: Project): number {
  return p.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

export function emptyProject(): Project {
  return {
    media: [],
    tracks: [
      { id: "text-1", kind: "text", name: "Text" },
      { id: "video-2", kind: "video", name: "Video 2" },
      { id: "video-1", kind: "video", name: "Video 1", main: true },
      { id: "audio-1", kind: "audio", name: "Audio 1" },
    ],
    clips: [],
  };
}

/** Fills in fields added after a project was saved, so old project files keep opening. */
export function upgradeProject(p: Project): Project {
  return {
    ...p,
    clips: p.clips.map((c) => {
      const legacy = c as Clip & { position?: Position };
      const place = legacy.position ? POSITIONS[legacy.position] : undefined;
      return {
        ...c,
        speed: c.speed ?? 1,
        fadeIn: c.fadeIn ?? 0,
        fadeOut: c.fadeOut ?? 0,
        crop: c.crop ?? NO_CROP,
        x: c.x ?? place?.x ?? 0.5,
        y: c.y ?? place?.y ?? 0.5,
      };
    }),
  };
}

export const mainTrack = (p: Project) => p.tracks.find((t) => t.main)!;
export const trackOf = (p: Project, c: Clip) => p.tracks.find((t) => t.id === c.trackId);
export const mediaOf = (p: Project, c: Clip) => p.media.find((m) => m.id === c.mediaId);

/** A name for the project list: the first thing imported. */
export const projectName = (p: Project) => p.media[0]?.name.replace(/\.[a-z0-9]{2,4}$/i, "") ?? "Untitled project";

/** A media item for something just fetched or opened. */
export function mediaFromSource(source: MediaSource): MediaItem {
  const video = source.streams.filter((s) => s.kind === "video");
  const audio = source.streams.filter((s) => s.kind === "audio");
  return {
    id: crypto.randomUUID(),
    name: source.local ? (source.url.split(/[\\/]/).pop() ?? source.title) : source.title,
    source,
    hasVideo: video.length > 0,
    hasAudio: audio.length > 0 || source.previewHasAudio !== false,
    // 1080p is a sensible default when offered; otherwise the best available.
    videoFormat: (video.find((s) => s.label.startsWith("1080p")) ?? video[0])?.id ?? "",
    audioFormat: audio[0]?.id ?? "",
  };
}
