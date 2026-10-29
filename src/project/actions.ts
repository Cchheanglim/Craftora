/**
 * Every edit to a project is one of these named, serializable actions, applied by
 * `applyEdit`. The UI dispatches them; the AI assistant dispatches the same ones, and
 * Undo/Redo covers both.
 */
import {
  DEFAULT_IMAGE_LENGTH,
  DEFAULT_TEXT_LENGTH,
  MAX_CROP,
  MIN_CLIP,
  NO_CROP,
  POSITIONS,
  baseVideoTrack,
  clipEnd,
  clipLength,
  isStill,
  readableCaptions,
  transitionLength,
  CAPTIONS,
  type CaptionLayout,
  type Clip,
  type MediaItem,
  type Project,
  type Track,
  type TrackKind,
  type Transition,
} from "./model";

export type ClipPatch = Partial<
  Pick<Clip, "volume" | "mirror" | "reverse" | "size" | "fill" | "x" | "y" | "text" | "color" | "fadeIn" | "fadeOut" | "crop">
>;

export type EditAction =
  | { type: "importMedia"; item: MediaItem }
  | { type: "removeMedia"; mediaId: string }
  | { type: "setMediaFormat"; mediaId: string; videoFormat?: string; audioFormat?: string }
  /**
   * Without a track: video goes to the bottom video track, sound to an audio track. On a
   * magnetic track `at` picks the slot; elsewhere it's the start time (playhead).
   */
  | { type: "addClip"; clipId: string; mediaId: string; trackId?: string; at?: number }
  | { type: "addText"; clipId: string; at: number; text?: string }
  /** The media's captions as text clips on a new "Captions" track, lined up with each of its clips. */
  | { type: "addCaptions"; mediaId: string; trackId: string }
  /** Moves or resizes every caption at once: the ones shown from the media and every clip on a "Captions" track. */
  | { type: "layoutCaptions"; patch: Partial<CaptionLayout> }
  /** On a magnetic track, `start` picks the slot: the clip goes where its left edge lands. */
  | { type: "moveClip"; clipId: string; start: number; trackId?: string }
  /** Moves one edge of a clip to a timeline time. */
  | { type: "trimClip"; clipId: string; edge: "start" | "end"; time: number }
  | { type: "splitClip"; clipId: string; newClipId: string; at: number }
  | { type: "duplicateClip"; clipId: string; newClipId: string }
  /** Removes these media-time ranges from a clip. `exact`: just these (words from the transcript), not padded silences of 0.25 s or more. */
  | { type: "cutSilences"; clipId: string; ranges: [number, number][]; exact?: boolean }
  | { type: "splitByChapters"; clipId: string }
  | { type: "deleteClip"; clipId: string }
  | { type: "updateClip"; clipId: string; patch: ClipPatch }
  /** 0.25–4; the clip gets shorter or longer on the timeline. */
  | { type: "setSpeed"; clipId: string; speed: number }
  /** Magnetic tracks: how the clip takes over from the one before it; null for a straight cut. */
  | { type: "setTransition"; clipId: string; transition: Transition | null }
  /** A new empty track: video above the other video tracks, text at the top, audio at the bottom. */
  | { type: "addTrack"; trackId: string; kind: TrackKind }
  /** Removes a track and every clip on it. */
  | { type: "removeTrack"; trackId: string }
  /** Magnet on: the track's clips close up and stay back to back. */
  | { type: "setMagnetic"; trackId: string; magnetic: boolean }
  /** Silences or restores a track's clips in both the preview and the export. */
  | { type: "setTrackMuted"; trackId: string; muted: boolean }
  /** Tidies up after a drag: no overlapping clips on a track, magnetic tracks packed. */
  | { type: "settle" };

const round = (t: number) => Math.round(t * 1000) / 1000;
/** Rounded down, so something placed at the playhead is already showing there. */
const floorMs = (t: number) => Math.floor(t * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const LABELS: Record<TrackKind, string> = { video: "Video", audio: "Audio", text: "Text" };

function newClip(fields: Pick<Clip, "id" | "trackId" | "start" | "in" | "out"> & Partial<Clip>): Clip {
  return {
    speed: 1,
    volume: 1,
    mirror: false,
    reverse: false,
    fadeIn: 0,
    fadeOut: 0,
    crop: NO_CROP,
    // Videos fill the frame (as far as their shape allows) until resized.
    size: 1,
    x: 0.5,
    y: 0.5,
    ...fields,
  };
}

/** Fades can't be longer than the clip. */
function fitFades(c: Clip): Clip {
  const length = clipLength(c);
  const fadeIn = Math.min(c.fadeIn, length);
  return { ...c, fadeIn, fadeOut: Math.min(c.fadeOut, length - fadeIn) };
}

const isMagnetic = (p: Project, trackId: string) => Boolean(p.tracks.find((t) => t.id === trackId)?.magnetic);

/** Lays `order` back to back from 0, each clip overlapping the previous by its transition. */
function pack(order: Clip[]): { clip: Clip; start: number }[] {
  let end = 0;
  return order.map((clip, i) => {
    const start = Math.max(0, end - transitionLength(order[i - 1], clip));
    end = start + clipLength(clip);
    return { clip, start };
  });
}

/** A track's clips other than `except`, in order, laid back to back from 0. */
export function packedTrack(p: Project, trackId: string, except?: string): { clip: Clip; start: number }[] {
  return pack(p.clips.filter((c) => c.trackId === trackId && c.id !== except).sort((a, b) => a.start - b.start));
}

/**
 * The order index a clip dropped on a magnetic track at `start` takes: it goes before the
 * first other clip whose middle is to the right of its left edge.
 */
/**
 * Whether `clip` can sit on `track`: text on text tracks; a video on a video track or, for just
 * its sound, on an audio track; a sound file only on audio tracks; a picture only on video tracks.
 */
export function fitsTrack(p: Project, clip: Clip, track: Track): boolean {
  if (!clip.mediaId) return track.kind === "text";
  const media = p.media.find((m) => m.id === clip.mediaId);
  if (!media || track.kind === "text") return false;
  return track.kind === "video" ? media.hasVideo : !media.source.image;
}

export function slotOn(p: Project, trackId: string, clipId: string, start: number): number {
  const others = packedTrack(p, trackId, clipId);
  const index = others.findIndex(({ clip, start: s }) => start < s + clipLength(clip) / 2);
  return index === -1 ? others.length : index;
}

/** Magnetic tracks have no gaps: their clips play back to back in their current order. */
function packMagnetic(p: Project): Project {
  const starts = new Map<string, number>();
  for (const track of p.tracks.filter((t) => t.magnetic)) {
    for (const { clip, start } of packedTrack(p, track.id)) starts.set(clip.id, round(start));
  }
  return { ...p, clips: p.clips.map((c) => (starts.has(c.id) ? { ...c, start: starts.get(c.id)! } : c)) };
}

/** Puts `clip` into a magnetic track at `slot` and packs that track. */
function insertAt(p: Project, trackId: string, clip: Clip, slot: number): Project {
  const order = packedTrack(p, trackId, clip.id).map(({ clip: c }) => c);
  order.splice(Math.min(slot, order.length), 0, { ...clip, trackId });
  const placed = new Map<string, Clip>();
  for (const { clip: c, start } of pack(order)) placed.set(c.id, { ...c, start: round(start) });
  const rest = p.clips.filter((c) => !placed.has(c.id) && c.id !== clip.id);
  return packMagnetic({ ...p, clips: [...rest, ...placed.values()] });
}

const overlaps = (a: Clip, b: Clip) => a.id !== b.id && a.start < clipEnd(b) - 1e-6 && b.start < clipEnd(a) - 1e-6;

/** Adds an empty track of `kind`: video above the other video tracks, text on top, audio at the bottom. */
function withTrack(p: Project, kind: TrackKind, id = `${kind}-${crypto.randomUUID().slice(0, 8)}`): { project: Project; trackId: string } {
  const used = new Set(p.tracks.map((t) => t.name));
  let n = p.tracks.filter((t) => t.kind === kind).length + 1;
  while (used.has(`${LABELS[kind]} ${n}`)) n++;
  const track: Track = { id, kind, name: `${LABELS[kind]} ${n}` };
  const tracks = [...p.tracks];
  if (kind === "audio") tracks.push(track);
  else if (kind === "text") tracks.unshift(track);
  else {
    // Above the other video tracks; with none, above the audio tracks; with neither, last.
    const above = tracks.findIndex((t) => t.kind === "video");
    const beforeAudio = tracks.findIndex((t) => t.kind === "audio");
    const at = above !== -1 ? above : beforeAudio !== -1 ? beforeAudio : tracks.length;
    tracks.splice(at, 0, track);
  }
  return { project: { ...p, tracks }, trackId: id };
}

/** A track of `kind` where `probe` fits without overlapping, adding one if needed. */
function freeTrack(p: Project, kind: TrackKind, probe: Clip, preferred?: string): { project: Project; trackId: string } {
  const candidates = p.tracks.filter((t) => t.kind === kind && !t.magnetic);
  const ordered = preferred ? [...candidates.filter((t) => t.id === preferred), ...candidates.filter((t) => t.id !== preferred)] : candidates;
  for (const track of ordered) {
    const busy = p.clips.some((c) => c.trackId === track.id && overlaps({ ...probe, trackId: track.id }, c));
    if (!busy) return { project: p, trackId: track.id };
  }
  return withTrack(p, kind);
}

/** Places a new clip on `track` (or a free track of its kind). */
function place(p: Project, track: Track | undefined, kind: TrackKind, clip: Clip, at: number | undefined): Project {
  if (track?.magnetic) {
    const slot = at === undefined ? Infinity : slotOn(p, track.id, clip.id, at);
    return insertAt(p, track.id, clip, slot);
  }
  // Without a time, after the last clip on the track; on a busy spot, another track.
  const end = track ? Math.max(0, ...p.clips.filter((c) => c.trackId === track.id).map(clipEnd)) : 0;
  const probe = { ...clip, start: floorMs(Math.max(0, at ?? end)) };
  const placed = freeTrack(p, kind, probe, track?.id);
  return { ...placed.project, clips: [...placed.project.clips, { ...probe, trackId: placed.trackId }] };
}

/** After a clip changed length or moved: no overlaps on free tracks, magnetic tracks packed. */
function settle(p: Project): Project {
  let clips = [...p.clips];
  for (const track of p.tracks.filter((t) => !t.magnetic)) {
    const onTrack = clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
    let end = 0;
    for (const c of onTrack) {
      const start = round(Math.max(c.start, end));
      if (start !== c.start) clips = clips.map((x) => (x.id === c.id ? { ...x, start } : x));
      end = start + clipLength(c);
    }
  }
  return packMagnetic({ ...p, clips });
}

function trim(clip: Clip, edge: "start" | "end", time: number, sourceLength: number | null): Clip {
  const { speed } = clip;
  if (sourceLength === null) {
    // Text and still images: no media length behind them, so only the minimum length limits them.
    if (edge === "start") {
      const t = clamp(time, 0, clipEnd(clip) - MIN_CLIP);
      return { ...clip, start: round(t), in: 0, out: round(clipEnd(clip) - t) };
    }
    return { ...clip, in: 0, out: round(Math.max(MIN_CLIP, time - clip.start)) };
  }
  // Forward clips use the media from `in` to `out`; reversed ones from `out` back to `in`,
  // so the timeline's left edge is `in` for one and `out` for the other.
  if (edge === "start") {
    const room = clip.reverse ? sourceLength - clip.out : clip.in;
    const t = clamp(time, clip.start - room / speed, clipEnd(clip) - MIN_CLIP);
    const shift = (t - clip.start) * speed;
    return clip.reverse
      ? { ...clip, start: round(t), out: round(clip.out - shift) }
      : { ...clip, start: round(t), in: round(clip.in + shift) };
  }
  const used = Math.max(MIN_CLIP, time - clip.start) * speed;
  return clip.reverse
    ? { ...clip, in: round(Math.max(0, clip.out - used)) }
    : { ...clip, out: round(Math.min(sourceLength, clip.in + used)) };
}

export function applyEdit(p: Project, action: EditAction): Project {
  switch (action.type) {
    case "importMedia":
      return { ...p, media: [...p.media, action.item] };

    case "removeMedia":
      return packMagnetic({
        ...p,
        media: p.media.filter((m) => m.id !== action.mediaId),
        clips: p.clips.filter((c) => c.mediaId !== action.mediaId),
      });

    case "setMediaFormat":
      return {
        ...p,
        media: p.media.map((m) =>
          m.id === action.mediaId
            ? { ...m, videoFormat: action.videoFormat ?? m.videoFormat, audioFormat: action.audioFormat ?? m.audioFormat }
            : m,
        ),
      };

    case "addClip": {
      const media = p.media.find((m) => m.id === action.mediaId);
      if (!media) return p;
      const requested = action.trackId ? p.tracks.find((t) => t.id === action.trackId) : undefined;
      if (requested?.kind === "text") return p;
      // A file without picture always lands on a sound track.
      const kind: TrackKind = !media.hasVideo || requested?.kind === "audio" ? "audio" : "video";
      const track = requested?.kind === kind ? requested : kind === "video" ? baseVideoTrack(p) : p.tracks.find((t) => t.kind === "audio");
      const length = media.source.image ? DEFAULT_IMAGE_LENGTH : media.source.duration;
      const clip = newClip({ id: action.clipId, trackId: track?.id ?? "", mediaId: media.id, start: 0, in: 0, out: length });
      return place(p, track, kind, clip, action.at);
    }

    case "addText": {
      const bottom = POSITIONS.bottom;
      const clip = newClip({
        id: action.clipId,
        trackId: "",
        start: 0,
        in: 0,
        out: DEFAULT_TEXT_LENGTH,
        text: action.text ?? "Your text",
        color: "#ffffff",
        size: 0.08,
        x: bottom.x,
        y: bottom.y,
      });
      return place(p, p.tracks.find((t) => t.kind === "text" && !t.magnetic), "text", clip, action.at);
    }

    case "addCaptions": {
      const lines = readableCaptions(p.media.find((m) => m.id === action.mediaId)?.captions?.lines ?? []);
      // shortcut: reversed clips get no captions; map them backwards if anyone reverses captioned clips.
      const clips = p.clips.filter((c) => c.mediaId === action.mediaId && !c.reverse);
      if (lines.length === 0 || clips.length === 0 || p.tracks.some((t) => t.id === action.trackId)) return p;
      const layout = p.captionLayout ?? CAPTIONS;
      const added: Clip[] = [];
      for (const clip of clips) {
        for (const line of lines) {
          const from = Math.max(line.start, clip.in);
          const to = Math.min(line.end, clip.out);
          if (to - from < 0.05) continue;
          added.push(
            newClip({
              id: `${action.trackId}-${added.length}`,
              trackId: action.trackId,
              start: round(clip.start + (from - clip.in) / clip.speed),
              in: 0,
              out: round((to - from) / clip.speed),
              text: line.text,
              color: "#ffffff",
              size: layout.size,
              x: layout.x,
              y: layout.y,
            }),
          );
        }
      }
      if (added.length === 0) return p;
      const { project } = withTrack(p, "text", action.trackId);
      const tracks = project.tracks.map((t) => (t.id === action.trackId ? { ...t, name: "Captions" } : t));
      return { ...project, tracks, clips: [...project.clips, ...added] };
    }

    case "moveClip": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      if (!clip) return p;
      const target = p.tracks.find((t) => t.id === (action.trackId ?? clip.trackId));
      const current = p.tracks.find((t) => t.id === clip.trackId);
      const track = target && fitsTrack(p, clip, target) ? target : current;
      if (!track) return p;
      // A transition belongs to the clip's place on its track; a new place starts without one.
      const moved = track.id === clip.trackId ? clip : { ...clip, transition: undefined };
      if (track.magnetic) return insertAt(p, track.id, moved, slotOn(p, track.id, clip.id, action.start));
      const free = { ...moved, trackId: track.id, start: round(Math.max(0, action.start)), transition: undefined };
      // Repack in case the clip came off a magnetic track.
      return packMagnetic({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? free : c)) });
    }

    case "trimClip": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      if (!clip) return p;
      const media = p.media.find((m) => m.id === clip.mediaId);
      // Text and images have no media length to respect: any length goes.
      const trimmed = fitFades(trim(clip, action.edge, action.time, isStill(p, clip) ? null : (media?.source.duration ?? null)));
      const next = { ...p, clips: p.clips.map((c) => (c.id === clip.id ? trimmed : c)) };
      return isMagnetic(p, clip.trackId) ? packMagnetic(next) : next;
    }

    case "splitClip": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      if (!clip || action.at <= clip.start + MIN_CLIP || action.at >= clipEnd(clip) - MIN_CLIP) return p;
      const firstLength = action.at - clip.start;
      const used = firstLength * clip.speed;
      let first: Clip;
      let second: Clip;
      if (isStill(p, clip)) {
        // Text and images keep 0-based in/out.
        first = { ...clip, out: round(firstLength) };
        second = { ...clip, id: action.newClipId, start: round(action.at), in: 0, out: round(clipEnd(clip) - action.at) };
      } else if (clip.reverse) {
        const cut = round(clip.out - used);
        first = { ...clip, in: cut };
        second = { ...clip, id: action.newClipId, start: round(action.at), out: cut };
      } else {
        const cut = round(clip.in + used);
        first = { ...clip, out: cut };
        second = { ...clip, id: action.newClipId, start: round(action.at), in: cut };
      }
      // The fade in stays with the first part, the fade out with the second.
      first = fitFades({ ...first, fadeOut: 0 });
      second = fitFades({ ...second, fadeIn: 0, transition: undefined });
      return { ...p, clips: p.clips.flatMap((c) => (c.id === clip.id ? [first, second] : [c])) };
    }

    case "duplicateClip": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      const track = clip ? p.tracks.find((t) => t.id === clip.trackId) : undefined;
      if (!clip || !track) return p;
      const copy: Clip = { ...clip, id: action.newClipId, transition: undefined };
      if (track.magnetic) {
        const index = packedTrack(p, track.id).findIndex(({ clip: c }) => c.id === clip.id);
        return insertAt(p, track.id, copy, index === -1 ? Infinity : index + 1);
      }
      const next = { ...copy, start: round(clipEnd(clip)) };
      return settle({ ...p, clips: p.clips.flatMap((c) => (c.id === clip.id ? [c, next] : [c])) });
    }

    case "cutSilences": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      if (!clip || isStill(p, clip) || action.ranges.length === 0) return p;
      const minMedia = MIN_CLIP * clip.speed;
      const [pad, shortest] = action.exact ? [0, 0.03] : [0.04, 0.25];
      const sorted = action.ranges
        .map(([s, e]): [number, number] => [Math.max(clip.in, s + pad), Math.min(clip.out, e - pad)])
        .filter(([s, e]) => e - s >= shortest)
        .sort((a, b) => a[0] - b[0]);
      if (sorted.length === 0) return p;
      const kept: [number, number][] = [];
      let cursor = clip.in;
      for (const [s, e] of sorted) {
        if (s > cursor && s - cursor >= minMedia) kept.push([round(cursor), round(s)]);
        cursor = Math.max(cursor, e);
      }
      if (clip.out - cursor >= minMedia) kept.push([round(cursor), round(clip.out)]);
      if (kept.length === 0 || (kept.length === 1 && kept[0][0] === clip.in && kept[0][1] === clip.out)) return p;
      const ordered = clip.reverse ? [...kept].reverse() : kept;
      let t = clip.start;
      const pieces: Clip[] = ordered.map(([segIn, segOut], i) => {
        const piece = fitFades({
          ...clip,
          id: i === 0 ? clip.id : `${clip.id}-cut-${i}-${Math.round(segIn * 100)}`,
          start: round(t),
          in: segIn,
          out: segOut,
          fadeIn: i === 0 ? clip.fadeIn : 0,
          fadeOut: i === ordered.length - 1 ? clip.fadeOut : 0,
          transition: i === 0 ? clip.transition : undefined,
        });
        t += clipLength(piece);
        return piece;
      });
      return settle({ ...p, clips: p.clips.flatMap((c) => (c.id === clip.id ? pieces : [c])) });
    }

    case "splitByChapters": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      const media = clip ? p.media.find((m) => m.id === clip.mediaId) : undefined;
      if (!clip || !media?.source.chapters?.length || isStill(p, clip)) return p;
      const minMedia = MIN_CLIP * clip.speed;
      const cuts = [...new Set(media.source.chapters.map((ch) => round(ch.start)))]
        .filter((t) => t > clip.in + minMedia && t < clip.out - minMedia)
        .sort((a, b) => a - b);
      if (cuts.length === 0) return p;
      const points = [clip.in, ...cuts, clip.out];
      const ranges = points.slice(0, -1).map((s, i): [number, number] => [s, points[i + 1]]);
      const ordered = clip.reverse ? [...ranges].reverse() : ranges;
      let t = clip.start;
      const pieces: Clip[] = ordered.map(([segIn, segOut], i) => {
        const piece = fitFades({
          ...clip,
          id: i === 0 ? clip.id : `${clip.id}-ch-${i}`,
          start: round(t),
          in: segIn,
          out: segOut,
          fadeIn: i === 0 ? clip.fadeIn : 0,
          fadeOut: i === ordered.length - 1 ? clip.fadeOut : 0,
          transition: i === 0 ? clip.transition : undefined,
        });
        t += clipLength(piece);
        return piece;
      });
      return settle({ ...p, clips: p.clips.flatMap((c) => (c.id === clip.id ? pieces : [c])) });
    }

    case "deleteClip":
      return packMagnetic({ ...p, clips: p.clips.filter((c) => c.id !== action.clipId) });

    case "updateClip": {
      const patch = { ...action.patch };
      if (patch.crop) {
        const c = patch.crop;
        patch.crop = { left: clamp(c.left, 0, MAX_CROP), top: clamp(c.top, 0, MAX_CROP), right: clamp(c.right, 0, MAX_CROP), bottom: clamp(c.bottom, 0, MAX_CROP) };
      }
      if (patch.x !== undefined) patch.x = clamp(patch.x, 0, 1);
      if (patch.y !== undefined) patch.y = clamp(patch.y, 0, 1);
      return { ...p, clips: p.clips.map((c) => (c.id === action.clipId ? fitFades({ ...c, ...patch }) : c)) };
    }

    case "setSpeed": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      if (!clip || isStill(p, clip)) return p;
      const speed = clamp(action.speed, 0.25, 4);
      return settle({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? fitFades({ ...c, speed }) : c)) });
    }

    case "setTransition": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      if (!clip || !isMagnetic(p, clip.trackId)) return p;
      const transition = action.transition ? { kind: action.transition.kind, duration: clamp(action.transition.duration, 0.1, 5) } : undefined;
      return packMagnetic({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? { ...c, transition } : c)) });
    }

    case "addTrack":
      if (p.tracks.some((t) => t.id === action.trackId)) return p;
      return withTrack(p, action.kind, action.trackId).project;

    case "removeTrack":
      if (!p.tracks.some((t) => t.id === action.trackId)) return p;
      return {
        ...p,
        tracks: p.tracks.filter((t) => t.id !== action.trackId),
        clips: p.clips.filter((c) => c.trackId !== action.trackId),
      };

    case "setMagnetic": {
      const track = p.tracks.find((t) => t.id === action.trackId);
      if (!track || Boolean(track.magnetic) === action.magnetic) return p;
      const tracks = p.tracks.map((t) => (t.id === track.id ? { ...t, magnetic: action.magnetic } : t));
      // Off a magnet, clips keep their places but transitions (which need it) go.
      const clips = action.magnetic ? p.clips : p.clips.map((c) => (c.trackId === track.id ? { ...c, transition: undefined } : c));
      return packMagnetic({ ...p, tracks, clips });
    }

    case "setTrackMuted":
      if (!p.tracks.some((t) => t.id === action.trackId && t.kind !== "text")) return p;
      return { ...p, tracks: p.tracks.map((t) => (t.id === action.trackId ? { ...t, muted: action.muted || undefined } : t)) };

    case "layoutCaptions": {
      const layout = { ...(p.captionLayout ?? CAPTIONS), ...action.patch };
      const captions = new Set(p.tracks.filter((t) => t.name === "Captions").map((t) => t.id));
      return { ...p, captionLayout: layout, clips: p.clips.map((c) => (captions.has(c.trackId) ? { ...c, ...layout } : c)) };
    }

    case "settle":
      return settle(p);
  }
}

/** Track ids of captions that are shown but not on the timeline (see `withShownCaptions`). */
export const SHOWN_CAPTIONS = "shown-captions-";

/**
 * The project with the captions of its media added as text, as the preview shows them with
 * captions on, so the export has them too. Nothing changes once captions are on the timeline
 * ("Add captions"): those are edited there instead.
 */
export function withShownCaptions(p: Project): Project {
  if (p.tracks.some((t) => t.name === "Captions")) return p;
  return p.media
    .filter((m) => m.captions)
    .reduce((project, m) => applyEdit(project, { type: "addCaptions", mediaId: m.id, trackId: `${SHOWN_CAPTIONS}${m.id}` }), p);
}
