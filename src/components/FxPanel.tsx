import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { inDesktopApp } from "../lib/engine";
import { captureThumbnail, draw } from "../lib/thumbnail";
import { LOOKS, PICTURE_EFFECTS, TIME_EFFECTS, lookFilter, type FxItem } from "../project/effects";
import { TRANSITION_KINDS, clipEnd, mediaTimeAt, showsPicture, type Project } from "../project/model";
import { beginFxDrag } from "./TimelineEditor";
import "./FxPanel.css";

export type FxTab = "filters" | "effects" | "transitions";

const TILE_WIDTH = 160;
// Short: the frame usually comes straight from the preview's player, which is cheap.
const SETTLE_MS = 150;

/** The frame the preview's player shows right now, if it's that picture and can be read: instant, unlike opening the video again. */
function shownFrame(url: string, mediaTime: number): string | undefined {
  const video = [...document.querySelectorAll<HTMLVideoElement>(".preview__pictures video")].find(
    (v) => v.getAttribute("src") === url && v.readyState >= 2 && Math.abs(v.currentTime - mediaTime) < 0.25,
  );
  return video?.videoWidth ? draw(video, video.videoWidth, video.videoHeight, TILE_WIDTH) : undefined;
}

/** The top visible picture under the playhead, if it can be read here. */
function pictureAt(project: Project | undefined, time: number): { url: string; image?: boolean; hls?: boolean; mediaTime: number } | null {
  if (!inDesktopApp || !project) return null;
  const order = project.tracks.filter((t) => !t.hidden).map((t) => t.id);
  const clip = project.clips
    .filter((c) => order.includes(c.trackId) && showsPicture(project, c) && time >= c.start && time < clipEnd(c))
    .sort((a, b) => order.indexOf(a.trackId) - order.indexOf(b.trackId) || b.start - a.start)[0];
  const media = clip ? project.media.find((m) => m.id === clip.mediaId) : undefined;
  if (!clip || !media?.source.previewUrl || media.source.live) return null;
  return {
    url: media.source.previewUrl,
    image: media.source.image,
    hls: media.source.previewHls,
    mediaTime: media.source.image ? 0 : mediaTimeAt(clip, time),
  };
}

/**
 * A tab of tiles to drag onto the timeline; clicking a tile (or Enter) puts it at the playhead instead.
 * Filters show the current frame at the playhead with each filter's CSS; effects and transitions loop on Craftora's cat.
 */
export function FxPanel({
  tab,
  project,
  time = 0,
  playing = false,
  onPick,
}: {
  tab: FxTab;
  project?: Project;
  time?: number;
  playing?: boolean;
  onPick: (item: FxItem) => void;
}) {
  const [frame, setFrame] = useState<string>();
  const shownRef = useRef(false);
  const capturedKey = useRef("");

  // Grab one small frame when Filters is opened and when the playhead settles; never while playing.
  useEffect(() => {
    if (tab !== "filters") {
      shownRef.current = false;
      return;
    }
    if (playing) return;
    let cancelled = false;
    const delay = shownRef.current ? SETTLE_MS : 0;
    const timer = window.setTimeout(() => {
      shownRef.current = true;
      const pic = pictureAt(project, time);
      if (!pic) {
        capturedKey.current = "";
        setFrame(undefined);
        return;
      }
      const key = `${pic.url}|${pic.image ? "img" : pic.mediaTime.toFixed(2)}`;
      if (key === capturedKey.current) return;
      const shown = pic.image ? undefined : shownFrame(pic.url, pic.mediaTime);
      if (shown) {
        capturedKey.current = key;
        setFrame(shown);
        return;
      }
      void captureThumbnail(pic.url, pic.image, pic.hls, pic.mediaTime, TILE_WIDTH).then((url) => {
        if (cancelled) return;
        capturedKey.current = url ? key : "";
        setFrame(url);
      });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tab, playing, time, project]);

  const tile = (item: FxItem, label: string, look?: string) => (
    <button
      key={`${item.kind}-${item.id}`}
      type="button"
      className={`fx-tile is-${item.kind === "filter" ? "filter" : item.id}`}
      title={`Drag onto the timeline, or click to add at the playhead`}
      onPointerDown={(e: ReactPointerEvent) => {
        if (e.button === 0) beginFxDrag(item, e);
      }}
      onClick={() => onPick(item)}
    >
      <span className="fx-tile__stage">
        <img
          // Craftora's cat until a frame of the video is ready (or when nothing is under the playhead).
          src={(item.kind === "filter" && frame) || "/craftora.svg"}
          className={item.kind === "filter" && frame ? "is-frame" : undefined}
          alt=""
          draggable={false}
          style={look ? { filter: look } : undefined}
        />
        {item.kind === "transition" && <img className="is-next" src="/craftora.svg" alt="" draggable={false} />}
      </span>
      <span className="fx-tile__name">{label}</span>
    </button>
  );

  return (
    <section className="fx-panel" aria-label={tab === "filters" ? "Filters" : tab === "effects" ? "Effects" : "Transitions"}>
      {tab === "filters" && (
        <>
          <p className="fx-panel__hint">Drag a filter onto a clip to colour all of it (split the clip first for just a part), or onto an empty spot and stretch it. It colours every picture under it, not text.</p>
          <div className="fx__grid">{LOOKS.map((look) => tile({ kind: "filter", id: look.id }, look.label, lookFilter(look.id)))}</div>
        </>
      )}
      {tab === "effects" && (
        <>
          <p className="fx-panel__hint">Drag an effect onto a clip to cover all of it, or onto an empty spot and stretch it. It changes every picture under it.</p>
          <div className="fx__grid">{PICTURE_EFFECTS.map((effect) => tile({ kind: "effect", id: effect.id }, effect.label))}</div>
          <h3 className="section-label">Speed and direction</h3>
          <p className="fx-panel__hint">
            Drop one on a clip: it plays slower, faster or backwards. Split the clip first to change just a part. Smooth slow-mo makes in-between
            frames in the export, so it takes longer to export.
          </p>
          <div className="fx__grid">{TIME_EFFECTS.map((effect) => tile({ kind: "time", id: effect.id }, effect.label))}</div>
        </>
      )}
      {tab === "transitions" && (
        <>
          <p className="fx-panel__hint">Click the + where two clips meet, then pick a transition here; or drag one onto that join.</p>
          <div className="fx__grid">{TRANSITION_KINDS.map((t) => tile({ kind: "transition", id: t.kind }, t.label))}</div>
        </>
      )}
    </section>
  );
}
