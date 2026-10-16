import type { ClipPatch } from "../project/actions";
import {
  MAX_CROP,
  NO_CROP,
  POSITIONS,
  SPEEDS,
  TRANSITION_KINDS,
  clipEnd,
  clipLength,
  isCropped,
  presetAt,
  type Clip,
  type Crop,
  type MediaItem,
  type Position,
  type Track,
  type Transition,
} from "../project/model";
import { formatClock } from "../lib/timecode";
import { formatSize } from "../project/exportPlan";
import { Icon } from "./Icon";
import "./Inspector.css";

const TEXT_COLORS = [
  { label: "White", value: "#ffffff" },
  { label: "Yellow", value: "#ffd60a" },
  { label: "Black", value: "#111111" },
  { label: "Blue", value: "#4da3ff" },
  { label: "Green", value: "#30d158" },
  { label: "Pink", value: "#ff6fb1" },
];
const CROP_SIDES: { side: keyof Crop; label: string }[] = [
  { side: "left", label: "Left" },
  { side: "right", label: "Right" },
  { side: "top", label: "Top" },
  { side: "bottom", label: "Bottom" },
];
/** Longest fade offered, in seconds. */
const MAX_FADE = 5;

interface InspectorProps {
  clip: Clip;
  track: Track;
  media?: MediaItem;
  /** Applies a change; `live` skips the undo step (use after `checkpoint`). */
  onChange: (patch: ClipPatch, live?: boolean) => void;
  onSpeed: (speed: number) => void;
  /** Video 1 clips after the first: set the transition into this clip (`live` as in onChange). */
  onTransition?: (transition: Transition | null, live?: boolean) => void;
  onCheckpoint: () => void;
  onFormat: (format: { videoFormat?: string; audioFormat?: string }) => void;
  onSplit: () => void;
  onDelete: () => void;
  canSplit: boolean;
}

/** Settings for the selected clip. */
export function Inspector({ clip, track, media, onChange, onSpeed, onTransition, onCheckpoint, onFormat, onSplit, onDelete, canSplit }: InspectorProps) {
  const isText = !clip.mediaId;
  const isImage = Boolean(media?.source.image);
  const isPicture = track.kind === "video";
  const hasSound = Boolean(media?.hasAudio);
  const streams = media && !media.source.local ? media.source.streams.filter((s) => s.kind === (isPicture ? "video" : "audio")) : [];
  const length = clipLength(clip);
  const maxFade = Math.min(MAX_FADE, Math.floor(length * 10) / 10);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const sec = (v: number) => `${v.toFixed(1)} s`;

  return (
    <section className="insp" aria-labelledby="insp-title">
      <header className="insp__head">
        <Icon name={isText ? "text" : isImage ? "image" : isPicture ? "film" : "music"} size={14} />
        <h2 id="insp-title" className="truncate">
          {isText ? "Text" : (media?.name ?? "Clip")}
        </h2>
      </header>
      <p className="insp__meta">
        {track.name} · <span className="mono">{formatClock(clip.start)}</span> → <span className="mono">{formatClock(clipEnd(clip))}</span> ·{" "}
        <span className="mono">{formatClock(length)}</span> long
      </p>
      {media?.missing && (
        <p className="insp__warn">
          <Icon name="alert" size={13} />
          This file can't be found. Put it back where it was, or remove the clip.
        </p>
      )}

      {isText && (
        <>
          <div className="insp__field">
            <label htmlFor="insp-text">Text</label>
            <textarea
              id="insp-text"
              className="field insp__textarea"
              value={clip.text ?? ""}
              rows={3}
              maxLength={500}
              onFocus={onCheckpoint}
              onChange={(e) => onChange({ text: e.target.value }, true)}
            />
          </div>
          <Slider id="insp-text-size" label="Size" min={0.02} max={0.3} step={0.005} value={clip.size} format={pct} onCheckpoint={onCheckpoint} onChange={(size) => onChange({ size }, true)} />
          <PositionSelect clip={clip} onChange={onChange} />
          <fieldset className="insp__field">
            <legend>Color</legend>
            <div className="insp__swatches">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className="insp__swatch"
                  style={{ background: c.value }}
                  aria-label={c.label}
                  aria-pressed={clip.color === c.value}
                  onClick={() => onChange({ color: c.value })}
                />
              ))}
            </div>
          </fieldset>
        </>
      )}

      {isPicture && (
        <>
          <p className="insp__hint">Drag the picture on the preview to move it; drag a corner to resize.</p>
          <Slider id="insp-size" label="Size" min={0.1} max={1} step={0.01} value={clip.size} format={pct} onCheckpoint={onCheckpoint} onChange={(size) => onChange({ size }, true)} />
          <PositionSelect clip={clip} onChange={onChange} />
        </>
      )}

      {isPicture && (
        <fieldset className="insp__group">
          <legend>
            Crop
            {isCropped(clip.crop) && (
              <button type="button" className="insp__reset" onClick={() => onChange({ crop: NO_CROP })}>
                Reset
              </button>
            )}
          </legend>
          {CROP_SIDES.map(({ side, label }) => (
            <Slider
              key={side}
              id={`insp-crop-${side}`}
              label={label}
              min={0}
              max={MAX_CROP}
              step={0.005}
              value={clip.crop[side]}
              format={pct}
              onCheckpoint={onCheckpoint}
              onChange={(v) => onChange({ crop: { ...clip.crop, [side]: v } }, true)}
            />
          ))}
        </fieldset>
      )}

      {isPicture && (
        <div className="insp__pair">
          <label className="option">
            <input type="checkbox" checked={clip.mirror} onChange={(e) => onChange({ mirror: e.target.checked })} />
            <span>Mirror</span>
          </label>
          {!isImage && (
            <label className="option">
              <input type="checkbox" checked={clip.reverse} onChange={(e) => onChange({ reverse: e.target.checked })} />
              <span>Reverse</span>
            </label>
          )}
        </div>
      )}

      {!isText && !isImage && (
        <div className="insp__field">
          <label htmlFor="insp-speed">Speed</label>
          <select id="insp-speed" className="field mono" value={clip.speed} onChange={(e) => onSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×{s === 1 ? " (normal)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {!isText && !track.magnetic && (
        <p className="insp__hint">To add a transition, turn on the magnet on this track (in the track's header), so clips sit back to back.</p>
      )}

      {onTransition && (
        <fieldset className="insp__group">
          <legend>Transition from the clip before</legend>
          <label htmlFor="insp-transition" className="sr-only">
            Transition
          </label>
          <select
            id="insp-transition"
            className="field"
            value={clip.transition?.kind ?? "none"}
            onChange={(e) => {
              const kind = e.target.value;
              onTransition(kind === "none" ? null : { kind: kind as Transition["kind"], duration: clip.transition?.duration ?? 1 });
            }}
          >
            <option value="none">None (straight cut)</option>
            {TRANSITION_KINDS.map((t) => (
              <option key={t.kind} value={t.kind}>
                {t.label}
              </option>
            ))}
          </select>
          {clip.transition && (
            <Slider
              id="insp-transition-length"
              label="Length"
              min={0.1}
              max={3}
              step={0.1}
              value={clip.transition.duration}
              format={sec}
              onCheckpoint={onCheckpoint}
              onChange={(duration) => onTransition({ ...clip.transition!, duration }, true)}
            />
          )}
        </fieldset>
      )}

      <fieldset className="insp__group">
        <legend>Fade</legend>
        <Slider id="insp-fade-in" label="In" min={0} max={maxFade} step={0.1} value={clip.fadeIn} format={sec} onCheckpoint={onCheckpoint} onChange={(fadeIn) => onChange({ fadeIn }, true)} />
        <Slider id="insp-fade-out" label="Out" min={0} max={maxFade} step={0.1} value={clip.fadeOut} format={sec} onCheckpoint={onCheckpoint} onChange={(fadeOut) => onChange({ fadeOut }, true)} />
      </fieldset>

      {!isText &&
        !isImage &&
        (hasSound ? (
          <Slider
            id="insp-volume"
            label="Volume"
            min={0}
            max={1}
            step={0.05}
            value={clip.volume}
            format={pct}
            onCheckpoint={onCheckpoint}
            onChange={(volume) => onChange({ volume }, true)}
          />
        ) : (
          <p className="insp__note">This file has no sound.</p>
        ))}

      {streams.length > 0 && media && (
        <div className="insp__field">
          <label htmlFor="insp-quality">Source quality</label>
          <select
            id="insp-quality"
            className="field"
            value={isPicture ? media.videoFormat : media.audioFormat}
            onChange={(e) => onFormat(isPicture ? { videoFormat: e.target.value } : { audioFormat: e.target.value })}
          >
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} · {s.detail} · ~{formatSize(s.sizeMb)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="insp__actions">
        <button type="button" className="btn btn--secondary" onClick={onSplit} disabled={!canSplit} title="Split at the playhead (S)">
          <Icon name="scissors" size={14} />
          Split
        </button>
        <button type="button" className="btn btn--secondary" onClick={onDelete} title="Delete (Delete)">
          <Icon name="trash" size={14} />
          Delete
        </button>
      </div>
    </section>
  );
}

/** A labelled range with its value; one undo step per drag. */
function Slider({
  id,
  label,
  min,
  max,
  step,
  value,
  format,
  onCheckpoint,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onCheckpoint: () => void;
  onChange: (v: number) => void;
}) {
  return (
    <div className="insp__slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, value)}
        disabled={max <= min}
        onPointerDown={onCheckpoint}
        onKeyDown={onCheckpoint}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="mono">{format(value)}</span>
    </div>
  );
}

function PositionSelect({ clip, onChange, disabled }: { clip: Clip; onChange: (patch: ClipPatch) => void; disabled?: boolean }) {
  const preset = presetAt(clip.x, clip.y);
  return (
    <div className="insp__field">
      <label htmlFor="insp-position">Place</label>
      <select
        id="insp-position"
        className="field"
        value={preset ?? "custom"}
        disabled={disabled}
        onChange={(e) => {
          const p = POSITIONS[e.target.value as Position];
          if (p) onChange({ x: p.x, y: p.y });
        }}
      >
        {!preset && <option value="custom">Where you dragged it</option>}
        {Object.entries(POSITIONS).map(([key, p]) => (
          <option key={key} value={key}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
