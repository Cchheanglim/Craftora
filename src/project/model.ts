/**
 * The editing project: imported media, tracks and the clips placed on them.
 * Plain data, so it can be undone, saved later, and edited by an AI agent through the
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
 * Fractions of the free space (0 = left/top, 1 = right/bottom). The preview and FFmpeg
 * use the same numbers, so what you see is what gets saved.
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
}

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
  /** 0–1. */
  volume: number;
  mirror: boolean;
  reverse: boolean;
  /** Picture-in-picture: width as a fraction of the frame. Text: height as a fraction of the frame. */
  size: number;
  position: Position;
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

export const clipLength = (c: Clip) => c.out - c.in;
export const clipEnd = (c: Clip) => c.start + clipLength(c);

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

export const mainTrack = (p: Project) => p.tracks.find((t) => t.main)!;
export const trackOf = (p: Project, c: Clip) => p.tracks.find((t) => t.id === c.trackId);
export const mediaOf = (p: Project, c: Clip) => p.media.find((m) => m.id === c.mediaId);

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
