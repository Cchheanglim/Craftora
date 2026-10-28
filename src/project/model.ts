/**
 * The editing project: imported media, tracks and the clips placed on them.
 * Plain data, so it can be undone, saved, and edited by an AI agent through the
 * same actions the UI uses (see `actions.ts`).
 */
import type { Caption, MediaSource } from "../types";
import type { LibraryEntry } from "../lib/storage";

export type TrackKind = "video" | "audio" | "text";

/**
 * A row on the timeline. Every track of a kind works the same way; higher video tracks are
 * drawn over lower ones. There can be as many tracks as the user wants.
 */
export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  /** Clips stay back to back with no gaps (CapCut's "main track magnet"); allows transitions. */
  magnetic?: boolean;
  /** Silences every clip on this track in both the preview and the export. */
  muted?: boolean;
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
 * Preset places for pictures and text. `x`/`y` are fractions of the free space
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
  /** The captions that came with a fetched video, kept after it's downloaded; with their name. */
  captions?: { label: string; lines: Caption[]; /** Still being made from the sound (redone if Craftora closed meanwhile). */ partial?: boolean };
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

/** How a clip on a magnetic track takes over from the one before it. Both overlap for `duration`. */
export interface Transition {
  kind: "crossfade" | "dip";
  /** Seconds, as set; the real overlap may be shorter for short clips (see `transitionLength`). */
  duration: number;
}

export const TRANSITION_KINDS: { kind: Transition["kind"]; label: string }[] = [
  { kind: "crossfade", label: "Crossfade" },
  { kind: "dip", label: "Dip to black" },
];

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
  /** Magnetic tracks only: the transition from the previous clip into this one. */
  transition?: Transition;
  /**
   * Video: scale of the picture, where 1 fills the frame as far as its shape allows (like
   * "fit"). Text: letter height as a fraction of the frame.
   */
  size: number;
  /** Video: cover the frame (cropping what spills over) instead of fitting inside it. */
  fill?: boolean;
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
/** How long an image is shown when first added. */
export const DEFAULT_IMAGE_LENGTH = 5;
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

/** A track's clips in play order. */
export const trackOrder = (p: Project, trackId: string) => p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);

/** Where a clip's transition into it overlaps: the clip before it on a magnetic track. */
export function previousOnTrack(p: Project, c: Clip): Clip | undefined {
  if (!p.tracks.find((t) => t.id === c.trackId)?.magnetic) return undefined;
  const order = trackOrder(p, c.trackId);
  return order[order.findIndex((o) => o.id === c.id) - 1];
}

/**
 * How long `cur` overlaps `prev`: its transition, but at most half of either clip so
 * neighbouring transitions never collide. 0 without a transition or a previous clip.
 */
export function transitionLength(prev: Clip | undefined, cur: Clip): number {
  if (!prev || !cur.transition) return 0;
  return Math.max(0, Math.min(cur.transition.duration, clipLength(prev) / 2, clipLength(cur) / 2));
}

/**
 * Transitions at time `t` for a clip on a magnetic track (`order` is that track's clips):
 * how visible (`picture`) and how loud (`sound`) the clip is, 0–1. The incoming clip is
 * drawn above the outgoing one.
 */
export function transitionMix(order: Clip[], clip: Clip, t: number): { picture: number; sound: number } {
  const i = order.findIndex((c) => c.id === clip.id);
  if (i === -1) return { picture: 1, sound: 1 };
  let picture = 1;
  let sound = 1;
  const incoming = transitionLength(order[i - 1], clip);
  if (incoming > 0 && t < clip.start + incoming) {
    const p = Math.max(0, (t - clip.start) / incoming);
    picture = clip.transition!.kind === "dip" ? Math.max(0, 2 * p - 1) : p;
    sound = clip.transition!.kind === "dip" ? Math.max(0, 2 * p - 1) : p;
  }
  const next = order[i + 1];
  const outgoing = next ? transitionLength(clip, next) : 0;
  if (next && outgoing > 0 && t >= next.start) {
    const p = Math.min(1, (t - next.start) / outgoing);
    // A crossfade keeps the outgoing picture underneath; a dip fades it to black first.
    if (next.transition!.kind === "dip") picture = Math.min(picture, Math.max(0, 1 - 2 * p));
    sound = Math.min(sound, next.transition!.kind === "dip" ? Math.max(0, 1 - 2 * p) : 1 - p);
  }
  return { picture, sound };
}

export function projectDuration(p: Project): number {
  return p.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

export function emptyProject(): Project {
  return {
    media: [],
    tracks: [
      { id: "text-1", kind: "text", name: "Text 1" },
      { id: "video-2", kind: "video", name: "Video 2" },
      { id: "video-1", kind: "video", name: "Video 1", magnetic: true },
      { id: "audio-1", kind: "audio", name: "Audio 1" },
    ],
    clips: [],
  };
}

/** Fills in fields added after a project was saved, so old project files keep opening. */
export function upgradeProject(p: Project): Project {
  // Before all tracks were equal, "Video 1" was the main track and its clips always filled
  // the frame; it becomes a magnetic track and its clips get the full size.
  const legacyMain = new Set(p.tracks.filter((t) => (t as Track & { main?: boolean }).main).map((t) => t.id));
  return {
    ...p,
    tracks: p.tracks.map((t) => {
      const { main, ...rest } = t as Track & { main?: boolean };
      return main ? { ...rest, magnetic: true } : rest;
    }),
    clips: p.clips.map((c) => {
      const legacy = c as Clip & { position?: Position };
      const place = legacy.position ? POSITIONS[legacy.position] : undefined;
      const wasMain = legacyMain.has(c.trackId);
      return {
        ...c,
        speed: c.speed ?? 1,
        fadeIn: c.fadeIn ?? 0,
        fadeOut: c.fadeOut ?? 0,
        crop: c.crop ?? NO_CROP,
        size: wasMain ? 1 : c.size,
        x: wasMain ? 0.5 : (c.x ?? place?.x ?? 0.5),
        y: wasMain ? 0.5 : (c.y ?? place?.y ?? 0.5),
      };
    }),
  };
}

/** The bottom video track: where new videos go by default. */
export const baseVideoTrack = (p: Project) => [...p.tracks].reverse().find((t) => t.kind === "video");
export const trackOf = (p: Project, c: Clip) => p.tracks.find((t) => t.id === c.trackId);
export const mediaOf = (p: Project, c: Clip) => p.media.find((m) => m.id === c.mediaId);

/** A clip with no media time of its own (text, or a still image): it can be any length. */
export const isStill = (p: Project, c: Clip) => !c.mediaId || Boolean(mediaOf(p, c)?.source.image);

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

/**
 * Loudness bars (0–100) across a media item: real FFmpeg peaks, measured once it's a file on this
 * PC. None for a link until then (a made-up wave didn't match the sound, and fooled Cut silences).
 */
export function peaksFor(media: MediaItem | undefined): number[] {
  if (!media || !media.hasAudio || media.source.image) return [];
  return media.source.peaks ?? [];
}

/** `bars` loudness values (0–100) for the part of `media` that `clip` plays, with volume and fades. */
export function clipPeaks(clip: Clip, media: MediaItem | undefined, bars: number, muted = false): number[] {
  const full = peaksFor(media);
  if (!full.length || bars <= 0 || muted || clip.volume <= 0) return Array.from({ length: Math.max(0, bars) }, () => 4);
  const total = Math.max(0.1, media?.source.duration || clip.out);
  const len = clipLength(clip);
  return Array.from({ length: bars }, (_, i) => {
    const u = (i + 0.5) / bars;
    const mediaT = clip.reverse ? clip.out - u * (clip.out - clip.in) : clip.in + u * (clip.out - clip.in);
    const idx = Math.min(full.length - 1, Math.max(0, Math.floor((mediaT / total) * full.length)));
    const fade = fadeAt(clip, clip.start + u * len);
    return Math.max(4, Math.min(100, Math.round(full[idx] * clip.volume * fade)));
  });
}

/** Finds quiet stretches `[start, end]` (in media seconds) from a media item's loudness bars. */
export function silencesFromPeaks(media: MediaItem, start: number, end: number): [number, number][] {
  const full = peaksFor(media);
  const total = media.source.duration;
  if (!full.length || total <= 0 || end <= start) return [];
  const step = total / full.length;
  const out: [number, number][] = [];
  let quietStart: number | null = null;
  for (let i = 0; i < full.length; i++) {
    const t0 = i * step;
    const t1 = (i + 1) * step;
    if (t1 <= start || t0 >= end) continue;
    if (full[i] <= 12) {
      quietStart ??= Math.max(start, t0);
    } else if (quietStart !== null) {
      const qEnd = Math.min(end, t0);
      if (qEnd - quietStart >= 0.35) out.push([quietStart, qEnd]);
      quietStart = null;
    }
  }
  if (quietStart !== null && end - quietStart >= 0.35) out.push([quietStart, end]);
  return out;
}


/**
 * `entries` with every file on this PC in `media` added (newest first) or its picture filled in;
 * past `limit` the oldest unstarred ones drop off. The same array when nothing changed.
 */
export function withImported(entries: LibraryEntry[], media: MediaItem[], limit: number, now = Date.now()): LibraryEntry[] {
  const next = [...entries];
  let changed = false;
  for (const m of media) {
    if (!m.source.local || m.source.live || m.missing) continue;
    const path = m.source.url;
    const thumbnail = m.source.thumbnail?.startsWith("data:") ? m.source.thumbnail : undefined;
    const at = next.findIndex((e) => e.path === path);
    if (at >= 0) {
      if (thumbnail && next[at].thumbnail !== thumbnail) [next[at], changed] = [{ ...next[at], thumbnail }, true];
      continue;
    }
    const kind = m.source.image ? "image" : m.hasVideo ? "video" : "audio";
    next.unshift({ path, name: path.split(/[\\/]/).pop() ?? m.name, kind, duration: m.source.image ? 0 : m.source.duration, thumbnail, addedAt: now });
    changed = true;
  }
  for (let i = next.length - 1; next.length > limit && i >= 0; i--) if (!next[i].saved) next.splice(i, 1);
  return changed ? next : entries;
}
