/**
 * Every edit to a project is one of these named, serializable actions, applied by
 * `applyEdit`. The UI dispatches them; a future AI assistant can dispatch the same ones,
 * and Undo/Redo covers both.
 */
import {
  DEFAULT_TEXT_LENGTH,
  MIN_CLIP,
  clipEnd,
  clipLength,
  mainTrack,
  type Clip,
  type MediaItem,
  type Position,
  type Project,
  type Track,
  type TrackKind,
} from "./model";

export type ClipPatch = Partial<Pick<Clip, "volume" | "mirror" | "reverse" | "size" | "position" | "text" | "color">>;

export type EditAction =
  | { type: "importMedia"; item: MediaItem }
  | { type: "removeMedia"; mediaId: string }
  | { type: "setMediaFormat"; mediaId: string; videoFormat?: string; audioFormat?: string }
  /** Without a track: video goes to the end of Video 1, sound to an audio track at `at`. */
  | { type: "addClip"; clipId: string; mediaId: string; trackId?: string; at?: number }
  | { type: "addText"; clipId: string; at: number; text?: string }
  | { type: "moveClip"; clipId: string; start: number; trackId?: string }
  /** Moves one edge of a clip to a timeline time. */
  | { type: "trimClip"; clipId: string; edge: "start" | "end"; time: number }
  | { type: "splitClip"; clipId: string; newClipId: string; at: number }
  | { type: "deleteClip"; clipId: string }
  | { type: "updateClip"; clipId: string; patch: ClipPatch }
  /** Tidies up after a drag: no overlapping clips on a track. */
  | { type: "settle" };

const round = (t: number) => Math.round(t * 1000) / 1000;

function newClip(fields: Pick<Clip, "id" | "trackId" | "start" | "in" | "out"> & Partial<Clip>): Clip {
  return { volume: 1, mirror: false, reverse: false, size: 0.4, position: "bottom-right", ...fields };
}

/** Video 1 has no gaps: its clips play back to back in their current order. */
function packMain(p: Project): Project {
  const main = mainTrack(p).id;
  const ordered = p.clips.filter((c) => c.trackId === main).sort((a, b) => a.start - b.start);
  let t = 0;
  const starts = new Map<string, number>();
  for (const c of ordered) {
    starts.set(c.id, round(t));
    t += clipLength(c);
  }
  return { ...p, clips: p.clips.map((c) => (starts.has(c.id) ? { ...c, start: starts.get(c.id)! } : c)) };
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
      const main = mainTrack(p);

      if (kind === "video" && (!requested || requested.main)) {
        // Video 1: insert where it was dropped (or at the end), then close the gaps.
        const mainClips = p.clips.filter((c) => c.trackId === main.id).sort((a, b) => a.start - b.start);
        const at = action.at ?? Infinity;
        const before = mainClips.filter((c) => c.start + clipLength(c) / 2 < at);
        const start = before.length ? clipEnd(before[before.length - 1]) - 0.0005 : -0.0005;
        const clip = newClip({ id: action.clipId, trackId: main.id, mediaId: media.id, start, in: 0, out: length });
        return packMain({ ...p, clips: [...p.clips, clip] });
      }

      const probe = newClip({ id: action.clipId, trackId: "", mediaId: media.id, start: round(Math.max(0, action.at ?? 0)), in: 0, out: length });
      const placed = freeTrack(p, kind, probe, requested?.id);
      return { ...placed.project, clips: [...placed.project.clips, { ...probe, trackId: placed.trackId }] };
    }

    case "addText": {
      const probe = newClip({
        id: action.clipId,
        trackId: "",
        start: round(Math.max(0, action.at)),
        in: 0,
        out: DEFAULT_TEXT_LENGTH,
        text: action.text ?? "Your text",
        color: "#ffffff",
        size: 0.08,
        position: "bottom" as Position,
      });
      const placed = freeTrack(p, "text", probe);
      return { ...placed.project, clips: [...placed.project.clips, { ...probe, trackId: placed.trackId }] };
    }

    case "moveClip": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      if (!clip) return p;
      const target = p.tracks.find((t) => t.id === (action.trackId ?? clip.trackId));
      const current = p.tracks.find((t) => t.id === clip.trackId);
      // Clips only move between tracks of the same kind, and in/out of Video 1 stays explicit.
      const trackId = target && current && target.kind === current.kind ? target.id : clip.trackId;
      const moved = { ...clip, trackId, start: round(Math.max(0, action.start)) };
      // Repack Video 1 whether the clip moved within it, onto it or off it.
      return packMain({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? moved : c)) });
    }

    case "trimClip": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      if (!clip) return p;
      const media = p.media.find((m) => m.id === clip.mediaId);
      const sourceLength = media ? media.source.duration : Infinity;
      let trimmed: Clip;
      if (action.edge === "start") {
        // Can't start before the media does (text has no such limit), or leave less than MIN_CLIP.
        const earliest = media ? clip.start - clip.in : 0;
        const time = Math.min(Math.max(action.time, earliest), clipEnd(clip) - MIN_CLIP);
        const shift = time - clip.start;
        trimmed = media
          ? { ...clip, start: round(time), in: round(clip.in + shift) }
          : { ...clip, start: round(time), out: round(clip.out - shift) };
      } else {
        const out = Math.min(Math.max(clip.in + (action.time - clip.start), clip.in + MIN_CLIP), sourceLength);
        trimmed = { ...clip, out: round(out) };
      }
      const next = { ...p, clips: p.clips.map((c) => (c.id === clip.id ? trimmed : c)) };
      return clip.trackId === mainTrack(p).id ? packMain(next) : next;
    }

    case "splitClip": {
      const clip = p.clips.find((c) => c.id === action.clipId);
      if (!clip || action.at <= clip.start + MIN_CLIP || action.at >= clipEnd(clip) - MIN_CLIP) return p;
      const cut = round(clip.in + (action.at - clip.start));
      const first = { ...clip, out: cut };
      const second = { ...clip, id: action.newClipId, start: round(action.at), in: cut };
      if (!clip.mediaId) {
        // Text keeps 0-based in/out.
        first.out = round(action.at - clip.start);
        second.in = 0;
        second.out = round(clipEnd(clip) - action.at);
      }
      return { ...p, clips: p.clips.flatMap((c) => (c.id === clip.id ? [first, second] : [c])) };
    }

    case "deleteClip":
      return packMain({ ...p, clips: p.clips.filter((c) => c.id !== action.clipId) });

    case "updateClip":
      return { ...p, clips: p.clips.map((c) => (c.id === action.clipId ? { ...c, ...action.patch } : c)) };

    case "settle": {
      // After a drag, a clip that landed on another one moves to just after it.
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
  }
}
