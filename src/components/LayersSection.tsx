import type { Layer, LayerKind, LayerPosition } from "../types";
import { POSITIONS, SIZES } from "../lib/layers";
import { formatClock } from "../lib/timecode";
import { Icon } from "./Icon";
import { TimeField } from "./TimeField";
import "./LayersSection.css";

export interface LayersControl {
  items: Layer[];
  add: (kind: LayerKind) => void;
  update: (id: string, patch: Partial<Layer>) => void;
  remove: (id: string) => void;
  /** 0–1: loudness of the clip's own sound. */
  mainVolume: number;
  setMainVolume: (volume: number) => void;
  /** Length of the clip between In and Out, in seconds. */
  clipLength: number;
  /** Whether the output is video; video layers are skipped for audio-only output. */
  videoOutput: boolean;
  adding: boolean;
}

const MAX_LAYERS = 8;

/** Extra videos and sounds stacked on the clip, CapCut-style. */
export function LayersSection({ layers }: { layers: LayersControl }) {
  const { items, clipLength } = layers;
  const full = items.length >= MAX_LAYERS;
  const anySound = items.some((l) => l.hasAudio);

  return (
    <fieldset className="layers">
      <legend className="section-label">Layers</legend>
      <div className="layers__add">
        <button type="button" className="btn btn--secondary" onClick={() => layers.add("video")} disabled={full || layers.adding}>
          <Icon name="film" size={14} />
          Add video
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => layers.add("audio")} disabled={full || layers.adding}>
          <Icon name="music" size={14} />
          Add audio
        </button>
      </div>

      {items.length === 0 ? (
        <p className="layers__hint">Put another video on top (picture-in-picture) or add music or a voice-over. Files come from this PC.</p>
      ) : (
        <ul className="layers__list">
          {items.map((layer, i) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              index={i}
              clipLength={clipLength}
              videoOutput={layers.videoOutput}
              onChange={(patch) => layers.update(layer.id, patch)}
              onRemove={() => layers.remove(layer.id)}
            />
          ))}
        </ul>
      )}

      {anySound && (
        <Volume id="main-volume" label="Clip's own sound" value={layers.mainVolume} onChange={layers.setMainVolume} />
      )}
    </fieldset>
  );
}

interface LayerRowProps {
  layer: Layer;
  index: number;
  clipLength: number;
  videoOutput: boolean;
  onChange: (patch: Partial<Layer>) => void;
  onRemove: () => void;
}

function LayerRow({ layer, index, clipLength, videoOutput, onChange, onRemove }: LayerRowProps) {
  const isVideo = layer.kind === "video";
  const id = `layer-${index}`;
  const skipped = isVideo && !videoOutput;

  return (
    <li className="layer">
      <div className="layer__head">
        <Icon name={isVideo ? "film" : "music"} size={14} />
        <span className="layer__name truncate" title={layer.path}>
          {layer.name}
        </span>
        <span className="layer__length mono">{formatClock(layer.duration)}</span>
        <button type="button" className="btn btn--icon" aria-label={`Remove layer ${layer.name}`} title="Remove" onClick={onRemove}>
          <Icon name="x" size={14} />
        </button>
      </div>

      {skipped && <p className="layer__note">Audio-only output: only this layer's sound is used.</p>}

      <div className="layer__fields">
        <TimeField
          id={`${id}-start`}
          label="Starts at"
          value={layer.start}
          onCommit={(t) => {
            if (t >= clipLength) return `The clip is only ${formatClock(clipLength)} long`;
            onChange({ start: t });
            return null;
          }}
        />
        {isVideo && (
          <>
            <div className="layer__field">
              <label htmlFor={`${id}-size`}>Size</label>
              <select
                id={`${id}-size`}
                className="field"
                value={layer.size}
                onChange={(e) => onChange({ size: Number(e.target.value) })}
              >
                {SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="layer__field">
              <label htmlFor={`${id}-position`}>Position</label>
              <select
                id={`${id}-position`}
                className="field"
                value={layer.position}
                disabled={layer.size >= 1}
                onChange={(e) => onChange({ position: e.target.value as LayerPosition })}
              >
                {Object.entries(POSITIONS).map(([value, p]) => (
                  <option key={value} value={value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {layer.hasAudio ? (
        <Volume id={`${id}-volume`} label="Volume" value={layer.volume} onChange={(volume) => onChange({ volume })} />
      ) : (
        <p className="layer__note">No sound in this file.</p>
      )}
    </li>
  );
}

function Volume({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="layer__volume">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <span className="mono">{Math.round(value * 100)}%</span>
    </div>
  );
}
