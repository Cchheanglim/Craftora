/**
 * Every edit to a project is one of these named, serializable actions, applied by
 * `applyEdit`. The UI dispatches them; a future AI assistant can dispatch the same ones,
 * and Undo/Redo covers both.
 */
import {
  DEFAULT_TEXT_LENGTH,
  MAX_CROP,
  MIN_CLIP,
  NO_CROP,
  POSITIONS,
  clipEnd,
  clipLength,
  mainTrack,
  type Clip,
  type MediaItem,
  type Project,
  type Track,
  type TrackKind,
} from "./model";

export type ClipPatch = Partial<
  Pick<Clip, "volume" | "mirror" | "reverse" | "size" | "x" | "y" | "text" | "color" | "fadeIn" | "fadeOut" | "crop">
>;

export type EditAction =
  | { type: "importMedia"; item: MediaItem }
  | { type: "removeMedia"; mediaId: string }
  | { type: "setMediaFormat"; mediaId: string; videoFormat?: string; audioFormat?: string }
  /** Without a track: video goes to the end of Video 1, sound to an audio track at `at`. */
  | { type: "addClip"; clipId: string; mediaId: string; trackId?: string; at?: number }
  | { type: "addText"; clipId: string; at: number; text?: string }
  /** On Video 1, `start` picks the slot: the clip goes where its left edge lands. */
  | { type: "moveClip"; clipId: string; start: number; trackId?: string }
  /** Moves one edge of a clip to a timeline time. */
  | { type: "trimClip"; clipId: string; edge: "start" | "end"; time: number }
  | { type: "splitClip"; clipId: string; newClipId: string; at: number }
  | { type: "deleteClip"; clipId: string }
  | { type: "updateClip"; clipId: string; patch: ClipPatch }
  /** 0.25–4; the clip gets shorter or longer on the timeline. */
  | { type: "setSpeed"; clipId: string; speed: number }
  /** Tidies up after a drag: no overlapping clips on a track. */
  | { type: "settle" };

const round = (t: number) => Math.round(t * 1000) / 1000;
/** Rounded down, so something placed at the playhead is already showing there. */
const floorMs = (t: number) => Math.floor(t * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function newClip(fields: Pick<Clip, "id" | "trackId" | "start" | "in" | "out"> & Partial<Clip>): Clip {
  const corner = POSITIONS["bottom-right"];
  return {
    speed: 1,
    volume: 1,
    mirror: false,
    reverse: false,
    fadeIn: 0,
    fadeOut: 0,
    crop: NO_CROP,
    size: 0.4,
    x: corner.x,
    y: corner.y,
    ...fields,
  };
}

/** Fades can't be longer than the clip. */
function fitFades(c: Clip): Clip {
  const length = clipLength(c);
  const fadeIn = Math.min(c.fadeIn, length);
  return { ...c, fadeIn, fadeOut: Math.min(c.fadeOut, length - fadeIn) };
}

/** Video 1's clips other than `except`, in order, laid back to back from 0. */
export function packedMain(p: Project, except?: string): { clip: Clip; start: number }[] {
  const main = mainTrack(p).id;
  let t = 0;
  return p.clips
    .filter((c) => c.trackId === main && c.id !== except)
    .sort((a, b) => a.start - b.start)
    .map((clip) => {
      const start = t;
      t += clipLength(clip);
      return { clip, start };
    });
}

/**
 * The order index a clip dropped on Video 1 at `start` takes: it goes before the first
 * other clip whose middle is to the right of its left edge.
 */
export function mainSlot(p: Project, clipId: string, start: number): number {
  const others = packedMain(p, clipId);
  const index = others.findIndex(({ clip, start: s }) => start < s + clipLength(clip) / 2);
  return index === -1 ? others.length : index;
}

/** Video 1 has no gaps: its clips play back to back in their current order. */
function packMain(p: Project): Project {
  const starts = new Map(packedMain(p).map(({ clip, start }) => [clip.id, round(start)]));
  return { ...p, clips: p.clips.map((c) => (starts.has(c.id) ? { ...c, start: starts.get(c.id)! } : c)) };
}

/** Puts `clip` into Video 1 at `slot` and packs the track. */
function insertMain(p: Project, clip: Clip, slot: number): Project {
  const main = mainTrack(p).id;
  const order = packedMain(p, clip.id).map(({ clip: c }) => c);
  order.splice(slot, 0, { ...clip, trackId: main });
  let t = 0;
  const placed = new Map<string, Clip>();
  for (const c of order) {
    placed.set(c.id, { ...c, start: round(t) });
    t += clipLength(c);
  }
  const rest = p.clips.filter((c) => !placed.has(c.id) && c.id !== clip.id);
  return { ...p, clips: [...rest, ...placed.values()] };
}

const overlaps = (a: Clip, b: Clip) => a.id !== b.id && a.start < clipEnd(b) - 1e-6 && b.start < clipEnd(a) - 1e-6;

/** A track of `kind` where [start, start+length) is free, adding "Video 3", "Audio 2"… if needed. */
function freeTrack(p: Project, kind: TrackKind, probe: Clip, preferred?: string): { project: Project; trackId: string } {
  const candidates = p.tracks.filter((t) => t.kind === kind && !t.main);
  const ordered = preferred ? [...candidates.filter((t) => t.id === preferred), ...candidates.filter((t) => t.id !== preferred)] : candidates;
  for (const track of ordered) {
    const busy = p.clips.some((c) => c.trackId === track.id && overlaps({ ...probe, trackId: track.id }, c));
    if (!busy) return { project: p, trackId: track.id };
  }
  const count = p.tracks.filter((t) => t.kind === kind).length + 1;
  const label = kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Text";
  const track: Track = { id: `${kind}-${crypto.randomUUID().slice(0, 8)}`, kind, name: `${label} ${count}` };
  // New picture tracks go on top of the other picture tracks; new sound tracks at the bottom.
  const tracks = [...p.tracks];
  if (kind === "audio") tracks.push(track);
  else tracks.splice(tracks.findIndex((t) => t.kind === kind), 0, track);
  return { project: { ...p, tracks }, trackId: track.id };
}

/** After a clip changed length: no overlaps on its track, and Video 1 stays packed. */
function settle(p: Project): Project {
  let clips = [...p.clips];
  for (const track of p.tracks.filter((t) => !t.main)) {
    const onTrack = clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
    let end = 0;
    for (const c of onTrack) {
      const start = round(Math.max(c.start, end));
      if (start !== c.start) clips = clips.map((x) => (x.id === c.id ? { ...x, start } : x));
      end = start + clipLength(c);
    }
  }
  return packMain({ ...p, clips });
}

function trim(clip: Clip, edge: "start" | "end", time: number, sourceLength: number | null): Clip {
  const { speed } = clip;
  if (sourceLength === null) {
    // Text: no media behind it, so only the minimum length limits it.
    if (edge === "start") {
      const t = clamp(time, 0, clipEnd(clip) - MIN_CLIP);
      return { ...clip, start: round(t), out: round(clip.out - (t - clip.start)) };
    }
    return { ...clip, out: round(Math.max(MIN_CLIP, time - clip.start)) };
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
      return packMain({
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
      const length = media.source.duration;
      const requested = action.trackId ? p.tracks.find((t) => t.id === action.trackId) : undefined;
      // A file without picture always lands on a sound track; text tracks take no media.
      const kind: TrackKind = !media.hasVideo || requested?.kind === "audio" ? "audio" : "video";
      if (requested && requested.kind === "text") return p;

      if (kind === "video" && (!requested || requested.main)) {
        // Video 1: insert where it was dropped (or at the end).
        const clip = newClip({ id: action.clipId, trackId: mainTrack(p).id, mediaId: media.id, start: 0, in: 0, out: length });
        const slot = action.at === undefined ? Infinity : mainSlot(p, clip.id, action.at);
        return insertMain(p, clip, Math.min(slot, packedMain(p).length));
      }

      const probe = newClip({ id: action.clipId, trackId: "", mediaId: media.id, start: floorMs(Math.max(0, action.at ?? 0)), in: 0, out: length });
      const placed = freeTrack(p, kind, probe, requested?.id);
      return { ...placed.project, clips: [...placed.project.clips, { ...probe, trackId: placed.trackId }] };
    }

    case "addText": {
      const bottom = POSITIONS.bottom;
      const probe = newClip({
        id: action.clipId,
        trackId: "",
        start: floorMs(Math.max(0, action.at)),
        in: 0,
        out: DEFAULT_TEXT_LENGTH,
        text: action.text ?? "Your text",
        color: "#ffffff",
        size: 0.08,
        x: bottom.x,
        y: bottom.y,
      });
      const placed = freeTrack(p, "text", probe);
      return { ...placed.project, clips: [...placed.project.clips, { ...probe, trackId: placed.trackId }] };
    }

    case "moveClip": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      if (!clip) return p;
      const target = p.tracks.find((t) => t.id === (action.trackId ?? clip.trackId));
      const current = p.tracks.find((t) => t.id === clip.trackId);
      // Clips only move between tracks of the same kind.
      const track = target && current && target.kind === current.kind ? target : current;
      if (!track) return p;
      if (track.main) return insertMain(p, clip, mainSlot(p, clip.id, action.start));
      const moved = { ...clip, trackId: track.id, start: round(Math.max(0, action.start)) };
      // Repack Video 1 in case the clip came off it.
      return packMain({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? moved : c)) });
    }

    case "trimClip": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      if (!clip) return p;
      const media = p.media.find((m) => m.id === clip.mediaId);
      const trimmed = fitFades(trim(clip, action.edge, action.time, media ? media.source.duration : null));
      const next = { ...p, clips: p.clips.map((c) => (c.id === clip.id ? trimmed : c)) };
      return clip.trackId === mainTrack(p).id ? packMain(next) : next;
    }

    case "splitClip": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      if (!clip || action.at <= clip.start + MIN_CLIP || action.at >= clipEnd(clip) - MIN_CLIP) return p;
      const firstLength = action.at - clip.start;
      const used = firstLength * clip.speed;
      let first: Clip;
      let second: Clip;
      if (!clip.mediaId) {
        // Text keeps 0-based in/out.
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
      second = fitFades({ ...second, fadeIn: 0 });
      return { ...p, clips: p.clips.flatMap((c) => (c.id === clip.id ? [first, second] : [c])) };
    }

    case "deleteClip":
      return packMain({ ...p, clips: p.clips.filter((c) => c.id !== action.clipId) });

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
      if (!clip || !clip.mediaId) return p;
      const speed = clamp(action.speed, 0.25, 4);
      return settle({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? fitFades({ ...c, speed }) : c)) });
    }

    case "settle":
      return settle(p);
  }
}
