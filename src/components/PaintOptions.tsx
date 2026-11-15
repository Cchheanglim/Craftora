import type { JSX } from "react";
import {
  BRUSH_MAX,
  BRUSH_MIN,
  type BrushSettings,
  type BucketSettings,
  type GradientSettings,
  type PaintSettings,
  type PaintTool,
} from "../lib/paint";
import "./PaintOptions.css";

const LOG_SPAN = Math.log(BRUSH_MAX / BRUSH_MIN);

/** Brush size (BRUSH_MIN..BRUSH_MAX px) ↔ logarithmic slider position (0..1000). */
const posToSize = (p: number) => Math.round(BRUSH_MIN * (BRUSH_MAX / BRUSH_MIN) ** (p / 1000));
const sizeToPos = (size: number) =>
  Math.round((Math.log(Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, size)) / BRUSH_MIN) / LOG_SPAN) * 1000);

const pct = (v: number) => `${Math.round(v * 100)}%`;

function PaintSlider(props: {
  id: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  display: string;
  onChange: (value: number) => void;
}): JSX.Element {
  const { id, label, min, max, step = 1, value, display, onChange } = props;
  return (
    <div className="paint-opts__slider">
      <label className="paint-opts__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="paint-opts__range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="paint-opts__val mono">{display}</span>
    </div>
  );
}

/** Options bar controls for the active painting tool in the Image editor. */
export function PaintOptions(props: {
  tool: PaintTool;
  settings: PaintSettings;
  onChange: (settings: PaintSettings) => void;
}): JSX.Element {
  const { tool, settings, onChange } = props;

  if (tool === "brush" || tool === "eraser") {
    const tip = settings[tool];
    const curPos = sizeToPos(tip.size);
    const patch = (next: Partial<BrushSettings>) => onChange({ ...settings, [tool]: { ...tip, ...next } });

    return (
      <>
        <PaintSlider
          id={`paint-opts-${tool}-size`}
          label="Size"
          min={0}
          max={1000}
          value={curPos}
          display={`${Math.round(tip.size)} px`}
          onChange={(p) => {
            const raw = posToSize(p);
            const size =
              raw === tip.size && p !== curPos
                ? Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, tip.size + (p > curPos ? 1 : -1)))
                : raw;
            patch({ size });
          }}
        />
        <PaintSlider
          id={`paint-opts-${tool}-hardness`}
          label="Hardness"
          min={0}
          max={100}
          value={Math.round(tip.hardness * 100)}
          display={pct(tip.hardness)}
          onChange={(v) => patch({ hardness: v / 100 })}
        />
        <PaintSlider
          id={`paint-opts-${tool}-opacity`}
          label="Opacity"
          min={0}
          max={100}
          value={Math.round(tip.opacity * 100)}
          display={pct(tip.opacity)}
          onChange={(v) => patch({ opacity: v / 100 })}
        />
        <PaintSlider
          id={`paint-opts-${tool}-flow`}
          label="Flow"
          min={0}
          max={100}
          value={Math.round(tip.flow * 100)}
          display={pct(tip.flow)}
          onChange={(v) => patch({ flow: v / 100 })}
        />
      </>
    );
  }

  if (tool === "bucket") {
    const { bucket } = settings;
    const patch = (next: Partial<BucketSettings>) => onChange({ ...settings, bucket: { ...bucket, ...next } });

    return (
      <>
        <PaintSlider
          id="paint-opts-bucket-tolerance"
          label="Tolerance"
          min={0}
          max={255}
          value={Math.round(bucket.tolerance)}
          display={String(Math.round(bucket.tolerance))}
          onChange={(tolerance) => patch({ tolerance })}
        />
        <span className="image-ws__opt-sep" />
        <label className="paint-opts__check">
          <input
            type="checkbox"
            checked={bucket.contiguous}
            onChange={(e) => patch({ contiguous: e.target.checked })}
          />
          <span>Contiguous</span>
        </label>
        <span className="image-ws__opt-sep" />
        <PaintSlider
          id="paint-opts-bucket-opacity"
          label="Opacity"
          min={0}
          max={100}
          value={Math.round(bucket.opacity * 100)}
          display={pct(bucket.opacity)}
          onChange={(v) => patch({ opacity: v / 100 })}
        />
      </>
    );
  }

  if (tool === "gradient") {
    const { gradient } = settings;
    const patch = (next: Partial<GradientSettings>) => onChange({ ...settings, gradient: { ...gradient, ...next } });

    return (
      <>
        <div className="segmented paint-opts__seg" role="group" aria-label="Gradient kind">
          <button
            type="button"
            aria-pressed={gradient.kind === "linear"}
            onClick={() => patch({ kind: "linear" })}
          >
            Linear
          </button>
          <button
            type="button"
            aria-pressed={gradient.kind === "radial"}
            onClick={() => patch({ kind: "radial" })}
          >
            Radial
          </button>
        </div>
        <div className="segmented paint-opts__seg" role="group" aria-label="Gradient target">
          <button
            type="button"
            aria-pressed={gradient.to === "background"}
            onClick={() => patch({ to: "background" })}
          >
            To background
          </button>
          <button
            type="button"
            aria-pressed={gradient.to === "clear"}
            onClick={() => patch({ to: "clear" })}
          >
            To see-through
          </button>
        </div>
        <span className="image-ws__opt-sep" />
        <PaintSlider
          id="paint-opts-gradient-opacity"
          label="Opacity"
          min={0}
          max={100}
          value={Math.round(gradient.opacity * 100)}
          display={pct(gradient.opacity)}
          onChange={(v) => patch({ opacity: v / 100 })}
        />
      </>
    );
  }

  return <span className="paint-opts__hint">Click to pick the foreground colour · Alt+click for the background</span>;
}
