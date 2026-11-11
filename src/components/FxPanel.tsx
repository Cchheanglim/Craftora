import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { inDesktopApp } from "../lib/engine";
import { captureThumbnail, draw } from "../lib/thumbnail";
import type { ClipPatch } from "../project/actions";
import { ADJUSTMENTS, EFFECT_SETTINGS, adjustMin, LOOKS, PICTURE_EFFECTS, TIME_EFFECTS, blockLabel, lookFilter, type FxItem } from "../project/effects";
import { TRANSITION_KINDS, clipEnd, clipLength, mediaTimeAt, showsPicture, type Clip, type Project, type Transition } from "../project/model";
import { SHAPES } from "../project/shapes";
import { Icon } from "./Icon";
import { Slider } from "./Inspector";
import { PanelHead } from "./SoundPanel";
import { beginFxDrag } from "./TimelineEditor";
import "./FxPanel.css";

export type FxTab = "filters" | "effects" | "transitions" | "shapes";

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
  block,
  transition,
  onBlockChange,
  onBlockDuration,
  onTransitionChange,
  onApplyToAll,
  onRemoveBlock,
  onCheckpoint,
  detail,
  onBack,
  onClose,
}: {
  tab: FxTab;
  project?: Project;
  time?: number;
  playing?: boolean;
  onPick: (item: FxItem) => void;
  /** The selected filter, effect or Adjust-layer block (a clip with no media and `look`, `effect` or `adjust`). */
  block?: Clip;
  /** The clip whose transition (from the clip before it) is selected, and the longest it may be (seconds). */
  transition?: { clip: Clip; max: number };
  onBlockChange?: (patch: ClipPatch, live?: boolean) => void;
  onBlockDuration?: (seconds: number, live?: boolean) => void;
  onTransitionChange?: (transition: Transition | null, live?: boolean) => void;
  onApplyToAll?: () => void;
  onRemoveBlock?: () => void;
  onCheckpoint?: () => void;
  /** Show the selected item's settings as their own panel (tiles hidden). Claude sets it when the item is clicked on the timeline. */
  detail?: boolean;
  /** Back: from the settings to this tab's tiles. */
  onBack?: () => void;
  /** X: close the right panel. */
  onClose?: () => void;
}) {
  const [frame, setFrame] = useState<string>();
  const [shapeQuery, setShapeQuery] = useState("");
  const query = shapeQuery.trim().toLowerCase();
  const shapes = SHAPES.filter((s) => !query || s.label.toLowerCase().includes(query) || s.id.includes(query));
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

  const tile = (item: FxItem, label: string, look?: string, shape?: (typeof SHAPES)[number]) => (
    <button
      key={`${item.kind}-${item.id}`}
      type="button"
      className={`fx-tile is-${item.kind === "filter" || item.kind === "adjust" ? "filter" : item.kind === "shape" ? "shape" : item.kind === "fade" ? `fade-${item.id}` : item.id}`}
      title={`Drag onto the timeline, or click to add at the playhead`}
      onPointerDown={(e: ReactPointerEvent) => {
        if (e.button === 0) beginFxDrag(item, e);
      }}
      onClick={() => onPick(item)}
    >
      <span className="fx-tile__stage">
        {shape ? (
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <path
              d={shape.path}
              fill={shape.line ? "none" : "currentColor"}
              fillRule="evenodd"
              stroke={shape.line ? "currentColor" : undefined}
              strokeWidth={shape.line ? 8 : undefined}
              strokeLinecap={shape.line ? "round" : undefined}
              strokeLinejoin={shape.line ? "round" : undefined}
            />
          </svg>
        ) : (
          <>
            <img
              // Craftora's cat until a frame of the video is ready (or when nothing is under the playhead).
              src={((item.kind === "filter" || item.kind === "adjust") && frame) || "/craftora.svg"}
              className={(item.kind === "filter" || item.kind === "adjust") && frame ? "is-frame" : undefined}
              alt=""
              draggable={false}
              style={look ? { filter: look } : undefined}
            />
            {item.kind === "transition" && <img className="is-next" src="/craftora.svg" alt="" draggable={false} />}
          </>
        )}
      </span>
      <span className="fx-tile__name">{label}</span>
      <span className="fx-tile__add" aria-hidden="true">
        <Icon name="plus" size={14} />
      </span>
    </button>
  );

  const checkpoint = onCheckpoint ?? (() => {});
  const sec = (v: number) => `${v.toFixed(1)} s`;
  const activeTransition = tab === "transitions" ? transition?.clip.transition : undefined;
  // A video's own Adjust is in Edit: on a clip, Filters only has its filter.
  const selectedBlock =
    (tab === "effects" && block?.effect) || (tab === "filters" && (block?.look || (block && !block.mediaId && !block.effect && block.adjust))) ? block : undefined;
  // Inside a video or picture (not a block of its own): it lasts the whole clip, and Remove takes off only the filter or effect.
  const inClip = Boolean(selectedBlock?.mediaId);

  if (detail && ((transition && activeTransition) || selectedBlock)) {
    const title =
      transition && activeTransition
        ? "Transition"
        : selectedBlock?.effect
          ? "Effect"
          : selectedBlock?.look
            ? "Filter"
            : "Adjust layer";
    const sub =
      transition && activeTransition
        ? (TRANSITION_KINDS.find((t) => t.kind === activeTransition.kind)?.label ?? activeTransition.kind)
        : selectedBlock
          ? `${tab === "effects" ? PICTURE_EFFECTS.find((e) => e.id === selectedBlock.effect)?.label : blockLabel(selectedBlock)}${inClip ? " · in this clip" : ""}`
          : "";
    return (
      <section className="fx-panel" aria-labelledby="fx-detail-title">
        <PanelHead id="fx-detail-title" title={title} sub={sub} onBack={onBack ?? (() => {})} onClose={onClose ?? (() => {})} />
        {transition && activeTransition && (
          <>
            <div className="insp__field">
              <label htmlFor="fx-trans-kind">Type</label>
              <select
                id="fx-trans-kind"
                className="field"
                value={activeTransition.kind}
                onChange={(e) => onTransitionChange?.({ ...activeTransition, kind: e.target.value as Transition["kind"] })}
              >
                {TRANSITION_KINDS.map((t) => (
                  <option key={t.kind} value={t.kind}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <Slider
              id="fx-trans-duration"
              label="Duration"
              min={0.1}
              max={Math.max(0.1, transition.max)}
              step={0.1}
              value={Math.min(transition.max, activeTransition.duration)}
              format={sec}
              onCheckpoint={checkpoint}
              onChange={(duration) => onTransitionChange?.({ ...activeTransition, duration }, true)}
            />
            {/* How loud the sound stays in the middle of the transition (model.ts `transitionGain`). */}
            <Slider
              id="fx-trans-volume"
              label="Volume"
              min={0}
              max={1}
              step={0.01}
              value={activeTransition.volume ?? 1}
              format={(v) => `${Math.round(v * 100)}%`}
              onCheckpoint={checkpoint}
              onChange={(volume) => onTransitionChange?.({ ...activeTransition, volume }, true)}
            />
            <button type="button" className="btn btn--secondary" onClick={onApplyToAll}>
              Apply to all cuts
            </button>
            <button type="button" className="btn btn--ghost fx-detail__remove" onClick={() => onTransitionChange?.(null)}>
              Remove transition
            </button>
          </>
        )}
        {selectedBlock && (
          <>
            {!inClip && (
            <Slider
              id="fx-block-duration"
              label="Duration"
              min={0.5}
              max={Math.max(30, Math.ceil(clipLength(selectedBlock)))}
              step={0.5}
              value={clipLength(selectedBlock)}
              format={sec}
              onCheckpoint={checkpoint}
              onChange={(s) => onBlockDuration?.(s, true)}
            />
            )}
            {tab === "effects" && selectedBlock.effect && EFFECT_SETTINGS[selectedBlock.effect]?.includes("strength") && (
              <Slider
                id="fx-effect-strength"
                label="Strength"
                min={0}
                max={100}
                step={1}
                value={selectedBlock.effectStrength ?? 50}
                format={(v) => String(Math.round(v))}
                onCheckpoint={checkpoint}
                onChange={(effectStrength) => onBlockChange?.({ effectStrength }, true)}
              />
            )}
            {tab === "effects" && selectedBlock.effect && EFFECT_SETTINGS[selectedBlock.effect]?.includes("speed") && (
              <Slider
                id="fx-effect-speed"
                label="Speed"
                min={0.5}
                max={3}
                step={0.1}
                value={selectedBlock.effectSpeed ?? 1}
                format={(v) => `${v.toFixed(1)}×`}
                onCheckpoint={checkpoint}
                onChange={(effectSpeed) => onBlockChange?.({ effectSpeed }, true)}
              />
            )}
            {tab === "filters" && selectedBlock.look && (
              <Slider
                id="fx-look-strength"
                label="Strength"
                min={0}
                max={1}
                step={0.05}
                value={selectedBlock.lookAmount ?? 1}
                format={(v) => `${Math.round(v * 100)}%`}
                onCheckpoint={checkpoint}
                onChange={(lookAmount) => onBlockChange?.({ lookAmount }, true)}
              />
            )}
            {!inClip &&
              selectedBlock.adjust &&
              !selectedBlock.look &&
              ADJUSTMENTS.map(({ id, label }) => (
                <Slider
                  key={id}
                  id={`fx-adjust-${id}`}
                  label={label}
                  min={adjustMin(id)}
                  max={100}
                  step={1}
                  value={selectedBlock.adjust?.[id] ?? 0}
                  format={(v) => (v > 0 ? `+${v}` : String(v))}
                  onCheckpoint={checkpoint}
                  onChange={(v) => onBlockChange?.({ adjust: { ...selectedBlock.adjust, [id]: v } }, true)}
                />
              ))}
            <button
              type="button"
              className="btn btn--ghost fx-detail__remove"
              onClick={() =>
                !inClip
                  ? onRemoveBlock?.()
                  : onBlockChange?.(tab === "effects" ? { effect: undefined, effectStrength: undefined, effectSpeed: undefined } : { look: undefined, lookAmount: undefined })
              }
            >
              Remove
            </button>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="fx-panel" aria-label={tab === "filters" ? "Filters" : tab === "effects" ? "Effects" : tab === "transitions" ? "Transitions" : "Shapes"}>
      {tab === "filters" && (
        <>
          <p className="fx-panel__hint">Drag a filter onto a video: it goes inside that clip. Drop it on empty track space for a block of its own that colours every picture under it (not text). Click it on the timeline for its settings.</p>
          <div className="fx__grid">
            {/* Its own Adjust sliders (its settings panel) for every picture under it; the tile hints at a change. */}
            {tile({ kind: "adjust", id: "layer" }, "Adjust layer", "brightness(1.1) contrast(1.1) saturate(1.3)")}
            {LOOKS.map((look) => tile({ kind: "filter", id: look.id }, look.label, lookFilter(look.id)))}
          </div>
        </>
      )}
      {tab === "effects" && (
        <>
          <p className="fx-panel__hint">Drag an effect onto a video: it goes inside that clip. Drop it on empty track space for a block of its own that you can stretch over several clips. Click it on the timeline for its settings.</p>
          <h3 className="section-label">Camera</h3>
          <div className="fx__grid">
            {PICTURE_EFFECTS.filter((e) => e.category === "camera").map((effect) => tile({ kind: "effect", id: effect.id }, effect.label))}
          </div>
          <h3 className="section-label">Style</h3>
          <div className="fx__grid">
            {PICTURE_EFFECTS.filter((e) => e.category === "style").map((effect) => tile({ kind: "effect", id: effect.id }, effect.label))}
          </div>
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
          <h3 className="section-label">Between clips</h3>
          <p className="fx-panel__hint">Drag one onto a clip or a cut, or click one to add it at the playhead. Click a transition on the timeline for its settings.</p>
          <div className="fx__grid">{TRANSITION_KINDS.map((t) => tile({ kind: "transition", id: t.kind }, t.label))}</div>
          <h3 className="section-label">In & out</h3>
          <p className="fx-panel__hint">Drop on a clip: it fades in from black at its start, or out at its end.</p>
          <div className="fx__grid">
            {tile({ kind: "fade", id: "in" }, "Fade in")}
            {tile({ kind: "fade", id: "out" }, "Fade out")}
          </div>
        </>
      )}
      {tab === "shapes" && (
        <>
          <p className="fx-panel__hint">
            Drag a shape onto the timeline; select it to change its colour, outline, see-through and angle; drag it in the preview to move or resize it.
          </p>
          <input
            type="search"
            className="field fx-panel__search"
            placeholder="Search shapes"
            aria-label="Search shapes"
            value={shapeQuery}
            onChange={(e) => setShapeQuery(e.target.value)}
          />
          {shapes.length ? (
            <div className="fx__grid is-shapes">{shapes.map((shape) => tile({ kind: "shape", id: shape.id }, shape.label, undefined, shape))}</div>
          ) : (
            <p className="fx-panel__hint">No shape called “{shapeQuery.trim()}”.</p>
          )}
        </>
      )}
    </section>
  );
}
