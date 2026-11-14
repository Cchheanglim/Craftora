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
  MAX_IMAGE_SIDE,
  NO_CROP,
  POSITIONS,
  mainTrack,
  showsPicture,
  clipEnd,
  clipLength,
  isStill,
  captionLines,
  unmarked,
  transitionLength,
  CAPTIONS,
  type CaptionLayout,
  type Clip,
  type MediaItem,
  type Project,
  type Track,
  type Transition,
} from "./model";
import { boxOf, cropOf } from "./crop";
import { newShapeClip, type ShapeId } from "./shapes";

export type ClipPatch = Partial<
  Pick<
    Clip,
    | "volume"
    | "mirror"
    | "reverse"
    | "rotate"
    | "smooth"
    | "look"
    | "lookAmount"
    | "adjust"
    | "chroma"
    | "effectStrength"
    | "effectSpeed"
    | "effect"
    | "shape"
    | "opacity"
    | "name"
    | "outline"
    | "aspect"
    | "size"
    | "fill"
    | "x"
    | "y"
    | "text"
    | "color"
    | "font"
    | "edge"
    | "edgeColor"
    | "edgeSize"
    | "anim"
    | "fadeIn"
    | "fadeOut"
    | "soundFadeIn"
    | "soundFadeOut"
    | "crop"
  >
>;

export type EditAction =
  | { type: "importMedia"; item: MediaItem }
  | { type: "removeMedia"; mediaId: string }
  | { type: "setMediaFormat"; mediaId: string; videoFormat?: string; audioFormat?: string }
  /** Remove background: a photo shows its cut-out (`source`), or its original again (no `source`). */
  | { type: "cutOut"; mediaId: string; source?: MediaItem["source"]; /** Only this layer changes: when others share its photo, it gets a photo entry of its own (`mediaId`). */ own?: { clipId: string; mediaId: string } }
  /**
   * Without a track: videos and pictures go to the main track, sound to a free track below it. On
   * a magnetic track `at` picks the slot; elsewhere it's the start time (playhead).
   */
  | { type: "addClip"; clipId: string; mediaId: string; trackId?: string; at?: number; /** A picture's length (seconds); 5 s when missing. */ length?: number }
  | { type: "addText"; clipId: string; at: number; text?: string }
  /** The project's cover picture (a JPEG data URL), or none. */
  | { type: "setCover"; cover: string | null }
  /** A copied clip, pasted at `at` on its own track (or a free one there). */
  | { type: "pasteClip"; clip: Clip; newClipId: string; at: number }
  /** Another file in a clip's place, from that file's start, as long as the clip was (or the file is). */
  | { type: "replaceClipMedia"; clipId: string; mediaId: string }
  /** A filter (`look`) or effect block on track `trackId` (or another one free at `at`). */
  | { type: "addBlock"; clipId: string; at: number; length: number; trackId?: string; look?: Clip["look"]; effect?: Clip["effect"]; adjust?: Clip["adjust"] }
  /** A shape clip (`shapes.ts`) on track `trackId` (or another one free at `at`). */
  | { type: "addShape"; clipId: string; shape: ShapeId; at: number; length?: number; trackId?: string }
  /** The media's captions as text clips on a new "Captions" track, lined up with each of its clips. */
  | { type: "addCaptions"; mediaId: string; trackId: string }
  /** Moves or resizes every caption at once: the ones shown from the media and every clip on a "Captions" track. */
  | { type: "layoutCaptions"; patch: Partial<CaptionLayout> }
  /**
   * Changes caption text, `find` → `replace`: in every caption of every media, whatever the case
   * (and on "Captions" tracks); with `line`, only in that media's caption playing at `line.at`.
   */
  | { type: "editCaptions"; find: string; replace: string; line?: { mediaId: string; at: number } }
  /** On a magnetic track, `start` picks the slot: the clip goes where its left edge lands. */
  | { type: "moveClip"; clipId: string; start: number; trackId?: string }
  /** Moves one edge of a clip to a timeline time. */
  | { type: "trimClip"; clipId: string; edge: "start" | "end"; time: number }
  | { type: "splitClip"; clipId: string; newClipId: string; at: number }
  | { type: "duplicateClip"; clipId: string; newClipId: string }
  /** Removes these media-time ranges from a clip. `exact`: just these (words from the transcript), not padded silences of 0.25 s or more. */
  | { type: "cutSilences"; clipId: string; ranges: [number, number][]; exact?: boolean }
  | { type: "splitByChapters"; clipId: string }
  | { type: "deleteClip"; clipId: string; /** What comes after it on its track moves back by its length (magnetic tracks always close up). */ closeGap?: boolean }
  | { type: "updateClip"; clipId: string; patch: ClipPatch }
  /** 0.25–4; the clip gets shorter or longer on the timeline. */
  | { type: "setSpeed"; clipId: string; speed: number }
  /** Magnetic tracks: how the clip takes over from the one before it; null for a straight cut. */
  | { type: "setTransition"; clipId: string; transition: Transition | null }
  /** A new empty track at the top. */
  | { type: "addTrack"; trackId: string; /** Under every other track instead of on top. */ below?: boolean }
  /** Removes a track and every clip on it. */
  | { type: "removeTrack"; trackId: string }
  /** Image editor: a layer up or down (a track to its new place, counted from the top). */
  | { type: "moveTrack"; trackId: string; to: number }
  /** Image editor: the picture's size (pixels) or background colour (#rrggbb). */
  | { type: "setImage"; patch: Partial<NonNullable<Project["image"]>> }
  /** Magnet on: the track's clips close up and stay back to back. */
  | { type: "setMagnetic"; trackId: string; magnetic: boolean }
  /** Silences or restores a track's clips in both the preview and the export. */
  | { type: "setTrackMuted"; trackId: string; muted: boolean }
  /** Locks, hides or resizes a track (the header's buttons and its … menu). */
  | { type: "updateTrack"; trackId: string; patch: Partial<Pick<Track, "locked" | "hidden" | "height" | "wave">> }
  /** Tidies up after a drag: no overlapping clips on a track, magnetic tracks packed. */
  | { type: "settle" };

const round = (t: number) => Math.round(t * 1000) / 1000;
/** Rounded down, so something placed at the playhead is already showing there. */
const floorMs = (t: number) => Math.floor(t * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
  const soundFadeIn = c.soundFadeIn !== undefined ? Math.min(c.soundFadeIn, length) : undefined;
  const soundFadeOut = c.soundFadeOut !== undefined ? Math.min(c.soundFadeOut, length - (soundFadeIn ?? 0)) : undefined;
  return { ...c, fadeIn, fadeOut: Math.min(c.fadeOut, length - fadeIn), soundFadeIn, soundFadeOut };
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

/** Adds an empty track, at the top or (`below`) at the bottom. */
function withTrack(p: Project, below = false, id = `track-${crypto.randomUUID().slice(0, 8)}`): { project: Project; trackId: string } {
  const used = new Set(p.tracks.map((t) => t.name));
  let n = p.tracks.length + 1;
  while (used.has(`Track ${n}`)) n++;
  const track: Track = { id, name: `Track ${n}` };
  return { project: { ...p, tracks: below ? [...p.tracks, track] : [track, ...p.tracks] }, trackId: id };
}

/** A sound file's clip: no picture, so its tracks go below the main track rather than over it. */
const soundOnly = (p: Project, c: Clip) => Boolean(c.mediaId) && !showsPicture(p, c);

/**
 * A track without the magnet where `probe` fits without overlapping: `preferred` if it's free
 * there, else the nearest one above the main track (below it for sound), else a new one.
 */
function freeTrack(p: Project, probe: Clip, preferred?: string, sound = soundOnly(p, probe)): { project: Project; trackId: string } {
  const main = mainTrack(p);
  const at = main ? p.tracks.indexOf(main) : p.tracks.length;
  const side = sound ? p.tracks.slice(at + 1) : p.tracks.slice(0, at).reverse();
  const candidates = [...p.tracks.filter((t) => t.id === preferred), ...side].filter((t) => !t.magnetic && !t.locked);
  for (const track of candidates) {
    const busy = p.clips.some((c) => c.trackId === track.id && overlaps({ ...probe, trackId: track.id }, c));
    if (!busy) return { project: p, trackId: track.id };
  }
  return withTrack(p, sound);
}

/** The track a sound take from `start` to `end` lands on (as `addClip` places it); null: a new track below the others. */
export function voiceTrack(p: Project, start: number, end: number): string | null {
  const probe = newClip({ id: "", trackId: "", start: floorMs(Math.max(0, start)), in: 0, out: Math.max(MIN_CLIP, end - start) });
  const placed = freeTrack(p, probe, undefined, true);
  return placed.project === p ? placed.trackId : null;
}

/** Places a new clip on `track` (or a free track). Only videos, pictures and sound join a magnetic track's row. */
function place(p: Project, track: Track | undefined, clip: Clip, at: number | undefined): Project {
  if (track?.magnetic && clip.mediaId) {
    const slot = at === undefined ? Infinity : slotOn(p, track.id, clip.id, at);
    return insertAt(p, track.id, clip, slot);
  }
  // Without a time, after the last clip on the track; on a busy spot, another track.
  const end = track ? Math.max(0, ...p.clips.filter((c) => c.trackId === track.id).map(clipEnd)) : 0;
  const probe = { ...clip, start: floorMs(Math.max(0, at ?? end)) };
  const placed = freeTrack(p, probe, track?.id);
  return { ...placed.project, clips: [...placed.project.clips, { ...probe, trackId: placed.trackId }] };
}

/** After a clip changed length or moved: no overlaps on free tracks, magnetic tracks packed. */
function settle(p: Project): Project {
  let clips = [...p.clips];
  for (const track of p.tracks.filter((t) => !t.magnetic)) {
    const onTrack = clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
    let end = 0;
    // Where the clip before ended before it moved here.
    let wasEnd = 0;
    let prev: Clip | undefined;
    for (const c of onTrack) {
      // A clip that touched the one before still does when that one moved for a transition: the row after a cut moves
      // along with it, as on a magnetic track. Clips set apart, or left apart by a trim, stay where they are.
      const at = prev && Math.abs(c.start - wasEnd) <= 0.05 ? end : c.start;
      // A transition overlaps the clip before when the two meet; set apart, it waits.
      const overlap = prev && at <= end + 0.05 ? transitionLength(prev, c) : 0;
      const start = round(overlap > 0 ? end - overlap : Math.max(at, end));
      if (start !== c.start) clips = clips.map((x) => (x.id === c.id ? { ...x, start } : x));
      wasEnd = c.start + clipLength(c);
      end = start + clipLength(c);
      prev = { ...c, start };
    }
  }
  return packMagnetic({ ...p, clips });
}

/**
 * The clip on the same track that carries on `clip`'s media right at its `edge` at another speed: a
 * piece a time effect cut out, or the rest of the clip next to one. Their edges move together.
 */
function continuation(p: Project, clip: Clip, edge: "start" | "end"): Clip | undefined {
  if (!clip.mediaId || clip.reverse) return undefined;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  return p.clips.find(
    (c) =>
      c.trackId === clip.trackId &&
      c.mediaId === clip.mediaId &&
      !c.reverse &&
      c.speed !== clip.speed &&
      (edge === "end" ? near(c.start, clipEnd(clip)) && near(c.in, clip.out) : near(clipEnd(c), clip.start) && near(c.out, clip.in)),
  );
}

/** Moves the cut between two pieces of one media (`left` then `right`) to timeline time `time`; each keeps its other edge in the media. */
function rollCut(p: Project, left: Clip, right: Clip, time: number): Project {
  const cut = round(clamp(left.in + (time - left.start) * left.speed, left.in + MIN_CLIP * left.speed, right.out - MIN_CLIP * right.speed));
  const l = fitFades({ ...left, out: cut });
  const r = fitFades({ ...right, in: cut, start: round(clipEnd(l)) });
  return { ...p, clips: p.clips.map((c) => (c.id === l.id ? l : c.id === r.id ? r : c)) };
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
  const next = edit(p, action);
  return next.image ? asLayers(next) : next;
}

/**
 * An image's rule (Image editor): every picture, text or shape is a layer, i.e. alone on its track, from the start. A
 * second clip on a track gets a track of its own just above it.
 */
export function asLayers(p: Project): Project {
  if (p.clips.every((c) => c.start === 0 && p.clips.filter((o) => o.trackId === c.trackId).length === 1)) return p;
  const tracks: Track[] = [];
  const clips: Clip[] = [];
  for (const track of p.tracks) {
    const [first, ...extra] = p.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
    for (const c of extra.reverse()) {
      const id = `track-${crypto.randomUUID().slice(0, 8)}`;
      tracks.push({ id, name: "Layer" });
      clips.push({ ...c, trackId: id, start: 0 });
    }
    tracks.push(track);
    if (first) clips.push({ ...first, start: 0 });
  }
  return { ...p, tracks, clips };
}

function edit(p: Project, action: EditAction): Project {
  switch (action.type) {
    case "importMedia":
      return { ...p, media: [...p.media, action.item] };

    case "cutOut": {
      const change = (m: MediaItem): MediaItem =>
        action.source ? { ...m, source: action.source, original: m.original ?? m.source } : m.original ? { ...m, source: m.original, original: undefined } : m;
      const own = action.own;
      const photo = p.media.find((m) => m.id === action.mediaId);
      if (own && photo && p.clips.some((c) => c.mediaId === action.mediaId && c.id !== own.clipId)) {
        return {
          ...p,
          media: [...p.media, { ...change(photo), id: own.mediaId }],
          clips: p.clips.map((c) => (c.id === own.clipId ? { ...c, mediaId: own.mediaId } : c)),
        };
      }
      return { ...p, media: p.media.map((m) => (m.id !== action.mediaId ? m : change(m))) };
    }

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
      const track = p.tracks.find((t) => t.id === action.trackId) ?? (media.hasVideo ? mainTrack(p) : undefined);
      const length = media.source.image ? (action.length ?? DEFAULT_IMAGE_LENGTH) : media.source.duration;
      const clip = newClip({ id: action.clipId, trackId: track?.id ?? "", mediaId: media.id, start: 0, in: 0, out: length });
      return place(p, track, clip, action.at);
    }

    case "setCover":
      return { ...p, cover: action.cover ?? undefined };

    case "pasteClip": {
      // Its media must still be in this project.
      if (action.clip.mediaId && !p.media.some((m) => m.id === action.clip.mediaId)) return p;
      const copy: Clip = { ...action.clip, id: action.newClipId, transition: undefined };
      const own = p.tracks.find((t) => t.id === action.clip.trackId && !t.locked);
      return place(p, own, copy, action.at);
    }

    case "replaceClipMedia": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      const media = p.media.find((m) => m.id === action.mediaId);
      if (!clip?.mediaId || !media) return p;
      // The same stretch of the new file: as much media as the clip used (a still used its length).
      const used = isStill(p, clip) ? clipLength(clip) : clip.out - clip.in;
      const replaced: Clip = media.source.image
        ? { ...clip, mediaId: media.id, in: 0, out: round(clipLength(clip)), speed: 1, reverse: false }
        : { ...clip, mediaId: media.id, in: 0, out: round(Math.min(media.source.duration, used)) };
      const next = { ...p, clips: p.clips.map((c) => (c.id === clip.id ? fitFades(replaced) : c)) };
      return isMagnetic(p, clip.trackId) ? packMagnetic(next) : next;
    }

    case "addBlock": {
      // A filter, an effect or an Adjust layer: exactly one.
      if ([action.look, action.effect, action.adjust].filter(Boolean).length !== 1) return p;
      const clip = newClip({ id: action.clipId, trackId: "", start: 0, in: 0, out: round(Math.max(MIN_CLIP, action.length)), look: action.look, effect: action.effect, adjust: action.adjust });
      return place(p, p.tracks.find((t) => t.id === action.trackId), clip, action.at);
    }

    case "addShape": {
      const length = round(Math.max(MIN_CLIP, action.length ?? DEFAULT_TEXT_LENGTH));
      const clip = newShapeClip(action.clipId, action.shape, 0, length);
      return place(p, p.tracks.find((t) => t.id === action.trackId), clip, action.at);
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
      return place(p, undefined, clip, action.at);
    }

    case "addCaptions": {
      const lines = captionLines(p.media.find((m) => m.id === action.mediaId)?.captions?.lines ?? []);
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
              color: layout.color ?? "#ffffff",
              font: layout.font,
              edge: layout.edge,
              size: layout.size,
              x: layout.x,
              y: layout.y,
            }),
          );
        }
      }
      if (added.length === 0) return p;
      const { project } = withTrack(p, false, action.trackId);
      const tracks = project.tracks.map((t) => (t.id === action.trackId ? { ...t, name: "Captions" } : t));
      return { ...project, tracks, clips: [...project.clips, ...added] };
    }

    case "moveClip": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      if (!clip) return p;
      const track = p.tracks.find((t) => t.id === (action.trackId ?? clip.trackId)) ?? p.tracks.find((t) => t.id === clip.trackId);
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
      // Next to a piece a time effect cut out, the edge moves the cut (the piece takes in more or
      // less of the clip) instead of leaving a gap or showing a part twice.
      const after = action.edge === "end" ? continuation(p, clip, "end") : undefined;
      const before = action.edge === "start" ? continuation(p, clip, "start") : undefined;
      // Text and images have no media length to respect: any length goes.
      const next = after
        ? rollCut(p, clip, after, action.time)
        : before
          ? rollCut(p, before, clip, action.time)
          : {
              ...p,
              clips: p.clips.map((c) => (c.id === clip.id ? fitFades(trim(clip, action.edge, action.time, isStill(p, clip) ? null : (media?.source.duration ?? null))) : c)),
            };
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
      // The fade in (and a text's in-animation) stays with the first part, the fade out with the second.
      first = fitFades({ ...first, fadeOut: 0, soundFadeOut: 0, anim: clip.anim && { ...clip.anim, out: undefined } });
      second = fitFades({ ...second, fadeIn: 0, soundFadeIn: 0, transition: undefined, anim: clip.anim && { ...clip.anim, in: undefined } });
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
          soundFadeIn: i === 0 ? clip.soundFadeIn : 0,
          soundFadeOut: i === ordered.length - 1 ? clip.soundFadeOut : 0,
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
          soundFadeIn: i === 0 ? clip.soundFadeIn : 0,
          soundFadeOut: i === ordered.length - 1 ? clip.soundFadeOut : 0,
          transition: i === 0 ? clip.transition : undefined,
        });
        t += clipLength(piece);
        return piece;
      });
      return settle({ ...p, clips: p.clips.flatMap((c) => (c.id === clip.id ? pieces : [c])) });
    }

    case "deleteClip": {
      const gone = p.clips.find((c) => c.id === action.clipId);
      const clips = p.clips.filter((c) => c.id !== action.clipId);
      if (!gone || !action.closeGap || isMagnetic(p, gone.trackId)) return packMagnetic({ ...p, clips });
      const back = clipLength(gone);
      // Settled, so a clip that ran into the deleted one by a transition now runs into the one before it.
      return settle({ ...p, clips: clips.map((c) => (c.trackId === gone.trackId && c.start > gone.start ? { ...c, start: round(Math.max(0, c.start - back)) } : c)) });
    }

    case "updateClip": {
      const patch = { ...action.patch };
      if (patch.crop) {
        const c = patch.crop;
        // Inside the picture, keeping at least 5% of it each way (a side pushed past the other gives way).
        patch.crop = cropOf(boxOf({ left: clamp(c.left, 0, MAX_CROP), top: clamp(c.top, 0, MAX_CROP), right: clamp(c.right, 0, MAX_CROP), bottom: clamp(c.bottom, 0, MAX_CROP) }));
      }
      if (patch.x !== undefined) patch.x = clamp(patch.x, 0, 1);
      if (patch.y !== undefined) patch.y = clamp(patch.y, 0, 1);
      if (patch.lookAmount !== undefined) patch.lookAmount = clamp(patch.lookAmount, 0, 1);
      if (patch.effectStrength !== undefined) patch.effectStrength = clamp(patch.effectStrength, 0, 100);
      if (patch.effectSpeed !== undefined) patch.effectSpeed = clamp(patch.effectSpeed, 0.5, 3);
      if (patch.adjust) patch.adjust = Object.fromEntries(Object.entries(patch.adjust).map(([k, v]) => [k, Math.round(clamp(v ?? 0, -100, 100))]));
      if (patch.opacity !== undefined) patch.opacity = clamp(patch.opacity, 0, 1);
      if (patch.outline !== undefined) patch.outline = Math.max(0, patch.outline);
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
      if (!clip) return p;
      const t = action.transition;
      const transition = t ? { kind: t.kind, duration: clamp(t.duration, 0.1, 5), ...(t.volume !== undefined && { volume: clamp(t.volume, 0, 1) }) } : undefined;
      // On any track: a magnetic one packs, a free one moves only this clip to overlap the one it meets.
      return settle({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? { ...c, transition } : c)) });
    }

    case "addTrack":
      if (p.tracks.some((t) => t.id === action.trackId)) return p;
      return withTrack(p, Boolean(action.below), action.trackId).project;

    case "setImage": {
      if (!p.image) return p;
      const { width, height, background } = { ...p.image, ...action.patch };
      const side = (v: number) => clamp(Math.round(v) || 16, 16, MAX_IMAGE_SIDE);
      return { ...p, image: { width: side(width), height: side(height), background: /^#[0-9a-f]{6}$/i.test(background) ? background : p.image.background } };
    }

    case "moveTrack": {
      const track = p.tracks.find((t) => t.id === action.trackId);
      if (!track) return p;
      const tracks = p.tracks.filter((t) => t !== track);
      tracks.splice(clamp(Math.round(action.to), 0, tracks.length), 0, track);
      return { ...p, tracks };
    }

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
      // Off a magnet, clips keep their places, transitions too (free tracks have them as well).
      return packMagnetic({ ...p, tracks });
    }

    case "updateTrack":
      return { ...p, tracks: p.tracks.map((t) => (t.id === action.trackId ? { ...t, ...action.patch } : t)) };

    case "setTrackMuted":
      if (!p.tracks.some((t) => t.id === action.trackId)) return p;
      return { ...p, tracks: p.tracks.map((t) => (t.id === action.trackId ? { ...t, muted: action.muted || undefined } : t)) };

    case "layoutCaptions": {
      const layout = { ...(p.captionLayout ?? CAPTIONS), ...action.patch };
      const captions = new Set(p.tracks.filter((t) => t.name === "Captions").map((t) => t.id));
      return { ...p, captionLayout: layout, clips: p.clips.map((c) => (captions.has(c.trackId) && !c.shape ? { ...c, ...layout } : c)) };
    }

    case "editCaptions": {
      const { find, replace, line } = action;
      if (!find) return p;
      const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), line ? "" : "gi");
      // A function, so a "$" typed in the new text stays as typed.
      const change = (text: string) => text.replace(pattern, () => replace);
      const media = p.media.map((m) => {
        if (!m.captions || (line && m.id !== line.mediaId)) return m;
        // One line is edited as shown: without speaker marks, which the shown text doesn't have.
        const lines = m.captions.lines.map((c) => (!line ? { ...c, text: change(c.text) } : line.at >= c.start && line.at < c.end ? { ...c, text: change(unmarked(c.text)) } : c));
        return { ...m, captions: { ...m.captions, lines } };
      });
      if (line) return { ...p, media };
      const captions = new Set(p.tracks.filter((t) => t.name === "Captions").map((t) => t.id));
      return { ...p, media, clips: p.clips.map((c) => (captions.has(c.trackId) && c.text ? { ...c, text: change(c.text) } : c)) };
    }

    case "settle":
      return settle(p);
  }
}

/** Every caption as the export draws it, in timeline seconds and order: what an .srt file holds. */
export function timelineCaptions(p: Project): { start: number; end: number; text: string }[] {
  const shown = withShownCaptions(p);
  const tracks = new Set(shown.tracks.filter((t) => t.name === "Captions").map((t) => t.id));
  return shown.clips
    .filter((c) => tracks.has(c.trackId) && c.text?.trim())
    .map((c) => ({ start: c.start, end: clipEnd(c), text: c.text ?? "" }))
    .sort((a, b) => a.start - b.start);
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
