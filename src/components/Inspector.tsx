import type { ClipPatch } from "../project/actions";
import { POSITIONS, clipEnd, clipLength, type Clip, type MediaItem, type Position, type Track } from "../project/model";
import { formatClock } from "../lib/timecode";
import { formatSize } from "../project/exportPlan";
import { Icon } from "./Icon";
import "./Inspector.css";

const OVERLAY_SIZES = [
  { label: "Small", value: 0.25 },
  { label: "Medium", value: 0.4 },
  { label: "Large", value: 0.6 },
  { label: "Full frame", value: 1 },
];
const TEXT_SIZES = [
  { label: "Small", value: 0.05 },
  { label: "Medium", value: 0.08 },
  { label: "Large", value: 0.12 },
  { label: "Huge", value: 0.18 },
];
const TEXT_COLORS = [
  { label: "White", value: "#ffffff" },
  { label: "Yellow", value: "#ffd60a" },
  { label: "Black", value: "#111111" },
  { label: "Blue", value: "#4da3ff" },
  { label: "Green", value: "#30d158" },
  { label: "Pink", value: "#ff6fb1" },
];

interface InspectorProps {
  clip: Clip;
  track: Track;
  media?: MediaItem;
  /** Applies a change; `live` skips the undo step (use after `checkpoint`). */
  onChange: (patch: ClipPatch, live?: boolean) => void;
  onCheckpoint: () => void;
  onFormat: (format: { videoFormat?: string; audioFormat?: string }) => void;
  onSplit: () => void;
  onDelete: () => void;
  canSplit: boolean;
}

/** Settings for the selected clip. */
export function Inspector({ clip, track, media, onChange, onCheckpoint, onFormat, onSplit, onDelete, canSplit }: InspectorProps) {
  const isText = !clip.mediaId;
  const isPicture = track.kind === "video";
  const isOverlay = isPicture && !track.main;
  const hasSound = Boolean(media?.hasAudio);
  const streams = media && !media.source.local ? media.source.streams.filter((s) => s.kind === (isPicture ? "video" : "audio")) : [];

  return (
    <section className="insp" aria-labelledby="insp-title">
      <header className="insp__head">
        <Icon name={isText ? "text" : isPicture ? "film" : "music"} size={14} />
        <h2 id="insp-title" className="truncate">
          {isText ? "Text" : (media?.name ?? "Clip")}
        </h2>
      </header>
      <p className="insp__meta">
        {track.name} · <span className="mono">{formatClock(clip.start)}</span> → <span className="mono">{formatClock(clipEnd(clip))}</span> ·{" "}
        <span className="mono">{formatClock(clipLength(clip))}</span> long
      </p>

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
          <div className="insp__pair">
            <Select id="insp-text-size" label="Size" value={clip.size} options={TEXT_SIZES} onChange={(size) => onChange({ size })} />
            <PositionSelect value={clip.position} onChange={(position) => onChange({ position })} />
          </div>
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

      {isOverlay && (
        <div className="insp__pair">
          <Select id="insp-size" label="Size" value={clip.size} options={OVERLAY_SIZES} onChange={(size) => onChange({ size })} />
          <PositionSelect value={clip.position} onChange={(position) => onChange({ position })} disabled={clip.size >= 1} />
        </div>
      )}

      {isPicture && (
        <div className="insp__pair">
          <label className="option">
            <input type="checkbox" checked={clip.mirror} onChange={(e) => onChange({ mirror: e.target.checked })} />
            <span>Mirror</span>
          </label>
          <label className="option">
            <input type="checkbox" checked={clip.reverse} onChange={(e) => onChange({ reverse: e.target.checked })} />
            <span>Reverse</span>
          </label>
        </div>
      )}

      {!isText &&
        (hasSound ? (
          <div className="insp__volume">
            <label htmlFor="insp-volume">Volume</label>
            <input
              id="insp-volume"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(clip.volume * 100)}
              onPointerDown={onCheckpoint}
              onKeyDown={onCheckpoint}
              onChange={(e) => onChange({ volume: Number(e.target.value) / 100 }, true)}
            />
            <span className="mono">{Math.round(clip.volume * 100)}%</span>
          </div>
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

function Select({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  options: { label: string; value: number }[];
  onChange: (v: number) => void;
}) {
  // Keep a custom value selectable even if it isn't one of the presets.
  const nearest = options.reduce((a, b) => (Math.abs(b.value - value) < Math.abs(a.value - value) ? b : a));
  return (
    <div className="insp__field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="field" value={nearest.value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function PositionSelect({ value, onChange, disabled }: { value: Position; onChange: (p: Position) => void; disabled?: boolean }) {
  return (
    <div className="insp__field">
      <label htmlFor="insp-position">Position</label>
      <select id="insp-position" className="field" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Position)}>
        {Object.entries(POSITIONS).map(([key, p]) => (
          <option key={key} value={key}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
