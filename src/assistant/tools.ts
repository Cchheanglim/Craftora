/**
 * What the AI assistant can see and do. It reads a compact description of the timeline
 * and edits it only through the editor's own named actions (`project/actions.ts`), so its
 * edits behave exactly like the user's and can be undone the same way.
 */
import { applyEdit, type ClipPatch, type EditAction } from "../project/actions";
import {
  POSITIONS,
  SPEEDS,
  clipEnd,
  projectDuration,
  type Position,
  type Project,
} from "../project/model";

/**
 * Short ids for the model ("c3", "m1", "t2") instead of long UUIDs: fewer tokens and fewer
 * copying mistakes. Kept for a whole conversation so ids stay stable.
 */
export class ShortIds {
  private toShort = new Map<string, string>();
  private toLong = new Map<string, string>();
  private counts: Record<string, number> = {};

  short(id: string, prefix: "c" | "m" | "t"): string {
    let s = this.toShort.get(id);
    if (!s) {
      this.counts[prefix] = (this.counts[prefix] ?? 0) + 1;
      s = `${prefix}${this.counts[prefix]}`;
      this.toShort.set(id, s);
      this.toLong.set(s, id);
    }
    return s;
  }

  long(short: unknown): string | undefined {
    return typeof short === "string" ? this.toLong.get(short.trim()) : undefined;
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The timeline as the model sees it: ids, times in seconds, and settings that differ from the defaults. */
export function describe(p: Project, playhead: number, ids: ShortIds): string {
  const clips = [...p.clips]
    .sort((a, b) => a.start - b.start)
    .map((c) => {
      const out: Record<string, unknown> = {
        id: ids.short(c.id, "c"),
        track: ids.short(c.trackId, "t"),
        start: r2(c.start),
        end: r2(clipEnd(c)),
      };
      if (c.mediaId) {
        out.media = ids.short(c.mediaId, "m");
        out.uses = [r2(c.in), r2(c.out)];
      } else {
        out.text = c.text;
        out.color = c.color;
      }
      if (c.speed !== 1) out.speed = c.speed;
      if (c.volume !== 1) out.volume = r2(c.volume);
      if (c.mirror) out.mirror = true;
      if (c.reverse) out.reverse = true;
      if (c.fadeIn) out.fadeIn = c.fadeIn;
      if (c.fadeOut) out.fadeOut = c.fadeOut;
      if (c.transition) out.transition = c.transition;
      if (c.mediaId ? p.tracks.find((t) => t.id === c.trackId)?.kind === "video" : true) {
        out.size = r2(c.size);
        out.x = r2(c.x);
        out.y = r2(c.y);
      }
      if (c.crop.left || c.crop.top || c.crop.right || c.crop.bottom) out.crop = c.crop;
      return out;
    });
  return JSON.stringify({
    duration: r2(projectDuration(p)),
    playhead: r2(playhead),
    media: p.media.map((m) => ({
      id: ids.short(m.id, "m"),
      name: m.name,
      length: r2(m.source.duration),
      video: m.hasVideo,
      sound: m.hasAudio,
    })),
    // Listed top to bottom: higher video tracks are drawn over lower ones.
    tracks: p.tracks.map((t) => ({ id: ids.short(t.id, "t"), name: t.name, kind: t.kind, ...(t.magnetic ? { magnetic: true } : {}) })),
    clips,
  });
}

const PLACES = Object.keys(POSITIONS) as Position[];
const num = { type: "number" };

/** Function declarations in the Interactions API format. */
export const TOOLS = [
  {
    type: "function",
    name: "add_clip",
    description:
      "Put imported media on the timeline. Without a track: video goes to the bottom video track, sound-only media to an audio track. Give a higher video track for a picture over another, or an audio track id to use only the sound.",
    parameters: {
      type: "object",
      properties: {
        media_id: { type: "string", description: "Media id, e.g. m1." },
        track_id: { type: "string", description: "Optional track id." },
        at: { ...num, description: "Optional timeline time in seconds. On a magnetic track, the clip is inserted at the nearest join; elsewhere it starts there (default: after the track's last clip)." },
      },
      required: ["media_id"],
    },
  },
  {
    type: "function",
    name: "add_text",
    description: "Add a title or caption on the text track.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        at: { ...num, description: "Start time in seconds." },
        duration: { ...num, description: "Seconds on screen (default 3)." },
        place: { type: "string", enum: PLACES },
        size: { ...num, description: "Text height as a fraction of the frame, 0.02–0.3 (default 0.08)." },
        color: { type: "string", description: "#rrggbb (default white)." },
      },
      required: ["text", "at"],
    },
  },
  {
    type: "function",
    name: "move_clip",
    description: "Move a clip to another time and/or another track of the same kind. On a magnetic track, clips stay back to back: the clip goes to the slot where its new start lands.",
    parameters: {
      type: "object",
      properties: { clip_id: { type: "string" }, start: num, track_id: { type: "string" } },
      required: ["clip_id", "start"],
    },
  },
  {
    type: "function",
    name: "trim_clip",
    description: "Move the start or end edge of a clip to a timeline time in seconds (keeps the rest in place).",
    parameters: {
      type: "object",
      properties: { clip_id: { type: "string" }, edge: { type: "string", enum: ["start", "end"] }, time: num },
      required: ["clip_id", "edge", "time"],
    },
  },
  {
    type: "function",
    name: "split_clip",
    description: "Cut a clip in two at a timeline time. Returns the new clip's id.",
    parameters: { type: "object", properties: { clip_id: { type: "string" }, at: num }, required: ["clip_id", "at"] },
  },
  {
    type: "function",
    name: "delete_clip",
    description: "Remove a clip. Main-track clips after it move up to close the gap.",
    parameters: { type: "object", properties: { clip_id: { type: "string" } }, required: ["clip_id"] },
  },
  {
    type: "function",
    name: "update_clip",
    description: "Change a clip's settings. Only pass what changes.",
    parameters: {
      type: "object",
      properties: {
        clip_id: { type: "string" },
        volume: { ...num, description: "0–1." },
        mirror: { type: "boolean" },
        reverse: { type: "boolean" },
        fade_in: { ...num, description: "Seconds." },
        fade_out: { ...num, description: "Seconds." },
        size: { ...num, description: "Video: scale, where 1 fills the frame as far as its shape allows (0.1–1). Text: height as a fraction of the frame (0.02–0.3)." },
        place: { type: "string", enum: PLACES, description: "Preset place for a video picture or text." },
        x: { ...num, description: "0 = left, 1 = right (fraction of the free space)." },
        y: { ...num, description: "0 = top, 1 = bottom." },
        text: { type: "string" },
        color: { type: "string", description: "#rrggbb" },
        crop_left: { ...num, description: "Fraction 0–0.45." },
        crop_right: num,
        crop_top: num,
        crop_bottom: num,
      },
      required: ["clip_id"],
    },
  },
  {
    type: "function",
    name: "set_speed",
    description: `Playback speed of a video or audio clip; changes its length on the timeline. One of ${SPEEDS.join(", ")}.`,
    parameters: { type: "object", properties: { clip_id: { type: "string" }, speed: num }, required: ["clip_id", "speed"] },
  },
  {
    type: "function",
    name: "set_transition",
    description: "Transition from the previous clip on the same magnetic track into this one. The clips overlap by the duration. Turn the track's magnet on first if needed.",
    parameters: {
      type: "object",
      properties: {
        clip_id: { type: "string" },
        kind: { type: "string", enum: ["none", "crossfade", "dip"], description: "dip = through black." },
        duration: { ...num, description: "Seconds (default 1)." },
      },
      required: ["clip_id", "kind"],
    },
  },
  {
    type: "function",
    name: "add_track",
    description: "Add an empty track. Video tracks go above the other video tracks (drawn on top), text tracks at the top, audio tracks at the bottom.",
    parameters: { type: "object", properties: { kind: { type: "string", enum: ["video", "audio", "text"] } }, required: ["kind"] },
  },
  {
    type: "function",
    name: "remove_track",
    description: "Remove a track and every clip on it.",
    parameters: { type: "object", properties: { track_id: { type: "string" } }, required: ["track_id"] },
  },
  {
    type: "function",
    name: "set_magnetic",
    description: "Turn a track's magnet on (its clips close up and stay back to back, transitions allowed) or off (clips can sit anywhere).",
    parameters: { type: "object", properties: { track_id: { type: "string" }, magnetic: { type: "boolean" } }, required: ["track_id", "magnetic"] },
  },
  {
    type: "function",
    name: "seek",
    description: "Move the playhead to a time in seconds, e.g. to show the user a spot.",
    parameters: { type: "object", properties: { time: num }, required: ["time"] },
  },
];

export interface ToolContext {
  project: Project;
  ids: ShortIds;
  seek: (t: number) => void;
}

export interface ToolOutcome {
  project: Project;
  /** Sent back to the model. */
  result: Record<string, unknown>;
  /** One line for the chat, e.g. "Split clip c2 at 12.5 s"; absent for failures. */
  summary?: string;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fail = (project: Project, error: string): ToolOutcome => ({ project, result: { ok: false, error } });

/** Runs one tool call against a copy of the project. */
export function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  const { project: p, ids } = ctx;
  const clipId = ids.long(args.clip_id);
  const clip = clipId ? p.clips.find((c) => c.id === clipId) : undefined;
  const needClip = () => (clip ? null : fail(p, `Unknown clip id ${String(args.clip_id)}.`));

  /** Applies edits in order; fails if the first one changes nothing. */
  const edits = (actions: EditAction[], summary: string, extra: Record<string, unknown> = {}): ToolOutcome => {
    let next = p;
    for (const a of actions) next = applyEdit(next, a);
    if (next === p) return fail(p, "That changed nothing; check the ids and values against the timeline.");
    return { project: next, result: { ok: true, ...extra }, summary };
  };

  switch (name) {
    case "add_clip": {
      const mediaId = ids.long(args.media_id);
      if (!mediaId || !p.media.some((m) => m.id === mediaId)) return fail(p, `Unknown media id ${String(args.media_id)}.`);
      const id = crypto.randomUUID();
      const trackId = ids.long(args.track_id);
      const outcome = edits([{ type: "addClip", clipId: id, mediaId, trackId, at: isNum(args.at) ? args.at : undefined }], `Added ${String(args.media_id)} to the timeline`);
      return outcome.result.ok ? { ...outcome, result: { ok: true, clip_id: ids.short(id, "c") } } : outcome;
    }
    case "add_text": {
      if (typeof args.text !== "string" || !args.text.trim() || !isNum(args.at)) return fail(p, "add_text needs text and at.");
      const id = crypto.randomUUID();
      const actions: EditAction[] = [{ type: "addText", clipId: id, at: args.at, text: args.text.slice(0, 500) }];
      const patch: ClipPatch = {};
      if (typeof args.place === "string" && args.place in POSITIONS) Object.assign(patch, { x: POSITIONS[args.place as Position].x, y: POSITIONS[args.place as Position].y });
      if (isNum(args.size)) patch.size = Math.min(0.3, Math.max(0.02, args.size));
      if (typeof args.color === "string" && /^#[0-9a-f]{6}$/i.test(args.color)) patch.color = args.color.toLowerCase();
      if (Object.keys(patch).length) actions.push({ type: "updateClip", clipId: id, patch });
      if (isNum(args.duration) && args.duration > 0) actions.push({ type: "trimClip", clipId: id, edge: "end", time: Math.max(0, args.at) + args.duration });
      const outcome = edits(actions, `Added the text “${args.text.slice(0, 40)}”`);
      return outcome.result.ok ? { ...outcome, result: { ok: true, clip_id: ids.short(id, "c") } } : outcome;
    }
    case "move_clip":
      if (!isNum(args.start)) return fail(p, "move_clip needs start.");
      return needClip() ?? edits([{ type: "moveClip", clipId: clip!.id, start: args.start, trackId: ids.long(args.track_id) }], `Moved ${String(args.clip_id)}`);
    case "trim_clip":
      if ((args.edge !== "start" && args.edge !== "end") || !isNum(args.time)) return fail(p, "trim_clip needs edge and time.");
      return needClip() ?? edits([{ type: "trimClip", clipId: clip!.id, edge: args.edge, time: args.time }], `Trimmed the ${args.edge} of ${String(args.clip_id)}`);
    case "split_clip": {
      if (!isNum(args.at)) return fail(p, "split_clip needs at.");
      const missing = needClip();
      if (missing) return missing;
      const id = crypto.randomUUID();
      const outcome = edits([{ type: "splitClip", clipId: clip!.id, newClipId: id, at: args.at }], `Split ${String(args.clip_id)} at ${args.at.toFixed(1)} s`);
      return outcome.result.ok ? { ...outcome, result: { ok: true, new_clip_id: ids.short(id, "c") } } : outcome;
    }
    case "delete_clip":
      return needClip() ?? edits([{ type: "deleteClip", clipId: clip!.id }], `Deleted ${String(args.clip_id)}`);
    case "update_clip": {
      const missing = needClip();
      if (missing) return missing;
      const patch: ClipPatch = {};
      if (isNum(args.volume)) patch.volume = Math.min(1, Math.max(0, args.volume));
      if (typeof args.mirror === "boolean") patch.mirror = args.mirror;
      if (typeof args.reverse === "boolean") patch.reverse = args.reverse;
      if (isNum(args.fade_in)) patch.fadeIn = Math.max(0, args.fade_in);
      if (isNum(args.fade_out)) patch.fadeOut = Math.max(0, args.fade_out);
      if (isNum(args.size)) patch.size = clip!.mediaId ? Math.min(1, Math.max(0.1, args.size)) : Math.min(0.3, Math.max(0.02, args.size));
      if (typeof args.place === "string" && args.place in POSITIONS) Object.assign(patch, { x: POSITIONS[args.place as Position].x, y: POSITIONS[args.place as Position].y });
      if (isNum(args.x)) patch.x = args.x;
      if (isNum(args.y)) patch.y = args.y;
      if (typeof args.text === "string" && !clip!.mediaId) patch.text = args.text.slice(0, 500);
      if (typeof args.color === "string" && /^#[0-9a-f]{6}$/i.test(args.color)) patch.color = args.color.toLowerCase();
      const sides = { left: args.crop_left, right: args.crop_right, top: args.crop_top, bottom: args.crop_bottom };
      if (Object.values(sides).some(isNum)) {
        patch.crop = { ...clip!.crop };
        for (const [side, v] of Object.entries(sides)) if (isNum(v)) patch.crop[side as keyof typeof sides] = v;
      }
      if (Object.keys(patch).length === 0) return fail(p, "update_clip got no settings to change.");
      return edits([{ type: "updateClip", clipId: clip!.id, patch }], `Changed ${Object.keys(patch).join(", ")} of ${String(args.clip_id)}`);
    }
    case "set_speed":
      if (!isNum(args.speed)) return fail(p, "set_speed needs speed.");
      return needClip() ?? edits([{ type: "setSpeed", clipId: clip!.id, speed: args.speed }], `Set ${String(args.clip_id)} to ${args.speed}×`);
    case "set_transition": {
      const missing = needClip();
      if (missing) return missing;
      const kind = args.kind;
      if (kind !== "none" && kind !== "crossfade" && kind !== "dip") return fail(p, "kind must be none, crossfade or dip.");
      const transition = kind === "none" ? null : { kind: kind as "crossfade" | "dip", duration: isNum(args.duration) ? args.duration : 1 };
      return edits([{ type: "setTransition", clipId: clip!.id, transition }], kind === "none" ? `Removed the transition into ${String(args.clip_id)}` : `Added a ${kind === "dip" ? "dip to black" : "crossfade"} into ${String(args.clip_id)}`);
    }
    case "add_track": {
      const kind = args.kind;
      if (kind !== "video" && kind !== "audio" && kind !== "text") return fail(p, "kind must be video, audio or text.");
      const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
      const outcome = edits([{ type: "addTrack", trackId: id, kind }], `Added a ${kind} track`);
      return outcome.result.ok ? { ...outcome, result: { ok: true, track_id: ids.short(id, "t") } } : outcome;
    }
    case "remove_track": {
      const trackId = ids.long(args.track_id);
      if (!trackId || !p.tracks.some((t) => t.id === trackId)) return fail(p, `Unknown track id ${String(args.track_id)}.`);
      return edits([{ type: "removeTrack", trackId }], `Removed ${p.tracks.find((t) => t.id === trackId)!.name}`);
    }
    case "set_magnetic": {
      const trackId = ids.long(args.track_id);
      if (!trackId || !p.tracks.some((t) => t.id === trackId)) return fail(p, `Unknown track id ${String(args.track_id)}.`);
      if (typeof args.magnetic !== "boolean") return fail(p, "set_magnetic needs magnetic: true or false.");
      const name = p.tracks.find((t) => t.id === trackId)!.name;
      const changed = edits([{ type: "setMagnetic", trackId, magnetic: args.magnetic }], `Turned the magnet ${args.magnetic ? "on" : "off"} for ${name}`);
      // Already as asked is fine, not a failure.
      return changed.result.ok ? changed : { project: p, result: { ok: true } };
    }
    case "seek":
      if (!isNum(args.time)) return fail(p, "seek needs time.");
      ctx.seek(args.time);
      return { project: p, result: { ok: true }, summary: `Moved the playhead to ${args.time.toFixed(1)} s` };
    default:
      return fail(p, `There is no tool called ${name}.`);
  }
}

/** Shared ground rules for the model. */
export const SYSTEM_INSTRUCTION = `You are the editing assistant inside Craftora, a desktop video editor like a simple CapCut.
The user describes edits in plain words; you make them with the tools, then reply in one or two short sentences, in the user's language.

How the timeline works:
- Times are in seconds. Each message ends with the current timeline as JSON (ids like c1 = clip, m1 = media, t1 = track).
- Tracks are listed top to bottom. All video tracks work the same way; higher ones are drawn over lower ones. A video's size 1 fills the frame; smaller sizes with x/y make picture-in-picture.
- A magnetic track (magnetic: true) keeps its clips back to back with no gaps; moving or deleting a clip there shifts the others, and only magnetic tracks can have transitions.
- Audio tracks hold music and voice-overs, text tracks hold titles. Any number of tracks can be added.
- A clip's "uses" is the part of its media it plays, in media seconds; start/end are timeline seconds.
- After every round of tool calls you get the updated timeline back; use its ids, not guesses.

Rules:
- Use only ids that appear in the timeline or in tool results.
- Make the fewest edits that do what was asked. Don't change things the user didn't mention.
- You can't see or hear the media, only its names and lengths. If a request needs that (for example "cut the silences" or "find the funny part"), say so and suggest what the user can tell you instead (times, or which clip).
- If the request is unclear or would delete a lot, ask first instead of editing.
- Every change can be undone with Ctrl+Z; mention that only if the user seems worried.`;
