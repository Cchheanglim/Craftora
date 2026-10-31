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
  /** Links: the preview quality picked by the preview (e.g. 720); none plays the best there is. */
  previewHeight?: number;
  /** Set when a saved project is reopened and the file can't be found any more. */
  missing?: boolean;
  /** The captions that came with a fetched video, kept after it's downloaded; with their name. */
  captions?: {
    label: string;
    lines: Caption[];
    /** Still being made from the sound (redone if Craftora closed meanwhile). */
    partial?: boolean;
    /** Made from the sound with each line fitted to its words; older ones are made again. */
    fitted?: boolean;
  };
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
  /** Where every caption sits on the picture and how big it is; `CAPTIONS` when absent. */
  captionLayout?: CaptionLayout;
}

/** `x`/`y` as for text clips; `size`: letter height as a fraction of the frame. */
export interface CaptionLayout {
  x: number;
  y: number;
  size: number;
}

export const CAPTIONS: CaptionLayout = { x: 0.5, y: 0.9, size: 0.055 };

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
    videoFormat: usualFormat(source) ?? "",
    audioFormat: audio[0]?.id ?? "",
  };
}

/** 1080p is a sensible default when offered; otherwise the best available. */
const usualFormat = (source: MediaSource) => {
  const video = source.streams.filter((s) => s.kind === "video");
  return (video.find((s) => s.label.startsWith("1080p")) ?? video[0])?.id;
};

/**
 * The export quality picked before, in a fresh read of the same link. YouTube can list the same
 * quality under another format next time (1080p as 270 instead of 137); the old id then matched
 * nothing, the size read 0 MB and the download could ask for a format that's gone. A quality
 * that's gone (or an id saved before this was fixed) gets the usual default, as a new fetch does.
 */
export function sameFormat(format: string, before: MediaSource, after: MediaSource): string {
  if (after.streams.some((s) => s.id === format)) return format;
  const label = before.streams.find((s) => s.id === format)?.label;
  return after.streams.find((s) => s.label === label)?.id ?? usualFormat(after) ?? format;
}

/** About two lines of captions on screen. */
export const CAPTION_CHARS = 80;

/**
 * Captions cut into pieces of at most `max` characters, at whole words (Khmer and Thai too, which
 * don't put spaces between words), each piece shown for its share of its line's time. Some sites'
 * captions hold a whole paragraph per line, which covered the picture.
 */
export function readableCaptions(lines: Caption[], max = CAPTION_CHARS): Caption[] {
  const words = new Intl.Segmenter(undefined, { granularity: "word" });
  const letters = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return lines.flatMap((line) => {
    if (line.text.length <= max) return [line];
    const pieces: string[] = [];
    let current = "";
    const add = (part: string) => {
      if (current.trim() && (current + part).trim().length > max) {
        pieces.push(current.trim());
        current = "";
      }
      current += part;
    };
    for (const { segment } of words.segment(line.text)) {
      // A "word" longer than a piece (no word breaks found): cut it between letters instead.
      if (segment.length > max) for (const { segment: letter } of letters.segment(segment)) add(letter);
      else add(segment);
    }
    if (current.trim()) pieces.push(current.trim());
    const total = pieces.reduce((n, p) => n + p.length, 0);
    let start = line.start;
    return pieces.map((text) => {
      const end = start + ((line.end - line.start) * text.length) / total;
      const piece = { start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, text };
      start = end;
      return piece;
    });
  });
}

/**
 * Text broken into lines of at most `max` characters at whole words, as the preview wraps it:
 * FFmpeg draws each line as given, so a long caption ran off the picture's edges.
 */
export function wrapText(text: string, max: number): string {
  return text
    .split("\n")
    .map((line) => readableCaptions([{ start: 0, end: 1, text: line }], max).map((piece) => piece.text).join("\n"))
    .join("\n");
}

/** A text clip's lines in a frame, the same in the preview and the export. */
export function textLines(text: string, size: number, frame: { width: number; height: number }): string {
  // Letters of bold text are about 0.6 of their height wide; lines fill up to 92% of the width.
  return wrapText(text, Math.max(8, Math.floor((0.92 * frame.width) / (0.6 * size * frame.height))));
}

/** A spoken line on the timeline: a caption piece of a clip that plays it. */
export interface TranscriptLine {
  id: string;
  clipId: string;
  /** Timeline seconds of the part that plays. */
  start: number;
  end: number;
  /** Media seconds of the whole caption piece (its words are timed across these). */
  mediaStart: number;
  mediaEnd: number;
  text: string;
}

/** What's said on the timeline, in order, from the captions of every clip that has them. */
export function transcript(p: Project): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const seen = new Set<string>();
  for (const clip of p.clips) {
    const captions = p.media.find((m) => m.id === clip.mediaId)?.captions?.lines;
    // shortcut: reversed clips play their words backwards; left out until someone edits one by text.
    if (!captions?.length || clip.reverse) continue;
    for (const piece of readableCaptions(captions)) {
      const from = Math.max(piece.start, clip.in);
      const to = Math.min(piece.end, clip.out);
      if (to - from < 0.05) continue;
      const start = Math.round((clip.start + (from - clip.in) / clip.speed) * 1000) / 1000;
      // The same video on a picture track and a sound track says it once.
      const key = `${start}|${piece.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const end = Math.round((clip.start + (to - clip.in) / clip.speed) * 1000) / 1000;
      lines.push({ id: `${clip.id}@${from}`, clipId: clip.id, start, end, mediaStart: piece.start, mediaEnd: piece.end, text: piece.text });
    }
  }
  return lines.sort((a, b) => a.start - b.start);
}

/** A word (or the space or mark between words) of a transcript line, timed in media seconds. */
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  /** False for spaces and punctuation. */
  word: boolean;
}

/**
 * A line's words, each timed by where it sits in the line.
 * shortcut: captions are timed per line, so word times are estimates; use word-level timing from whisper if cuts land off.
 */
export function wordsOf(line: TranscriptLine): TranscriptWord[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  const length = Math.max(1, line.text.length);
  const span = line.mediaEnd - line.mediaStart;
  return [...segmenter.segment(line.text)].map(({ segment, index, isWordLike }) => ({
    text: segment,
    start: line.mediaStart + (span * index) / length,
    end: line.mediaStart + (span * (index + segment.length)) / length,
    word: Boolean(isWordLike),
  }));
}

/** Words picked to cut, as media-time ranges per clip, touching ones joined. */
export function cutRanges(picked: { clipId: string; start: number; end: number }[]): Map<string, [number, number][]> {
  const byClip = new Map<string, [number, number][]>();
  for (const p of [...picked].sort((a, b) => a.start - b.start)) {
    const ranges = byClip.get(p.clipId) ?? [];
    const last = ranges[ranges.length - 1];
    if (last && p.start - last[1] < 0.05) last[1] = Math.max(last[1], p.end);
    else ranges.push([p.start, p.end]);
    byClip.set(p.clipId, ranges);
  }
  return byClip;
}

/** "um", "uh", "erm", "hmm", "ah" and their stretched forms. */
export const isFiller = (word: string) => /^(u+m+|u+h+m*|e+r+m+|h+m+|a+h+)$/i.test(word);

/**
 * Loudness bars (0–100) across a media item: real FFmpeg peaks, measured once it's a file on this
 * PC. None for a link until then (a made-up wave didn't match the sound, and fooled Cut silences).
 */
export function peaksFor(media: MediaItem | undefined): number[] {
  if (!media || !media.hasAudio || media.source.image) return [];
  return media.source.peaks ?? [];
}

/** `bars` loudness values (0–100) for the part of `media` that `clip` plays, with volume and fades. */
/** The loudest of a wave's bars between media times `a` and `b` (seconds, either order). */
export function peakBetween(full: number[], total: number, a: number, b: number): number {
  if (!full.length) return 0;
  const lo = Math.min(full.length - 1, Math.max(0, Math.floor((Math.min(a, b) / total) * full.length)));
  const hi = Math.min(full.length, Math.max(lo + 1, Math.ceil((Math.max(a, b) / total) * full.length)));
  let loudest = 0;
  for (let i = lo; i < hi; i++) loudest = Math.max(loudest, full[i]);
  return loudest;
}

export function clipPeaks(clip: Clip, media: MediaItem | undefined, bars: number, muted = false): number[] {
  const full = peaksFor(media);
  if (!full.length || bars <= 0 || muted || clip.volume <= 0) return Array.from({ length: Math.max(0, bars) }, () => 4);
  const total = Math.max(0.1, media?.source.duration || clip.out);
  const len = clipLength(clip);
  const at = (u: number) => (clip.reverse ? clip.out - u * (clip.out - clip.in) : clip.in + u * (clip.out - clip.in));
  return Array.from({ length: bars }, (_, i) => {
    // Each bar: the loudest moment in the stretch of sound it stands for.
    const loud = peakBetween(full, total, at(i / bars), at((i + 1) / bars));
    const fade = fadeAt(clip, clip.start + ((i + 0.5) / bars) * len);
    return Math.max(4, Math.min(100, Math.round(loud * clip.volume * fade)));
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
