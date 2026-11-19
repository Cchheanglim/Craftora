import type { CSSProperties, JSX } from "react";
import type { SelectMode, SelectSettings, SelectTool } from "../lib/selection";
import "./PaintOptions.css";
import "./SelectOptions.css";

const MODES: { mode: SelectMode; label: string; title?: string }[] = [
  { mode: "new", label: "New" },
  { mode: "add", label: "Add", title: "Shift" },
  { mode: "subtract", label: "Subtract", title: "Alt" },
  { mode: "intersect", label: "Intersect", title: "Shift+Alt" },
];

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

/** Options bar controls for the active selection tool in the Image editor. */
export function SelectOptions(props: {
  tool: SelectTool;
  settings: SelectSettings;
  onChange: (settings: SelectSettings) => void;
  /** Select subject (desktop app, a photo layer picked); undefined = the button is greyed. */
  onSubject?: () => void;
  /** Shown instead of the Select subject button while it runs, e.g. "Finding the subject…". */
  busy?: string;
  /** Deselect (Ctrl+D); undefined = nothing is selected (greyed). */
  onDeselect?: () => void;
}): JSX.Element {
  const { tool, settings, onChange, onSubject, busy, onDeselect } = props;
  const patch = (next: Partial<SelectSettings>) => onChange({ ...settings, ...next });

  return (
    <>
      <div
        className="segmented paint-opts__seg"
        role="group"
        aria-label="Selection mode"
        style={{ "--count": 4 } as CSSProperties}
      >
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            title={m.title}
            aria-pressed={settings.mode === m.mode}
            onClick={() => patch({ mode: m.mode })}
          >
            {m.label}
          </button>
        ))}
      </div>
      <span className="image-ws__opt-sep" />
      {tool === "wand" ? (
        <>
          <PaintSlider
            id="select-opts-tolerance"
            label="Tolerance"
            min={0}
            max={255}
            value={Math.round(settings.tolerance)}
            display={String(Math.round(settings.tolerance))}
            onChange={(tolerance) => patch({ tolerance })}
          />
          <span className="image-ws__opt-sep" />
          <label className="paint-opts__check">
            <input
              type="checkbox"
              checked={settings.contiguous}
              onChange={(e) => patch({ contiguous: e.target.checked })}
            />
            <span>Contiguous</span>
          </label>
        </>
      ) : (
        <PaintSlider
          id="select-opts-feather"
          label="Feather"
          min={0}
          max={250}
          value={Math.round(settings.feather)}
          display={`${Math.round(settings.feather)} px`}
          onChange={(feather) => patch({ feather })}
        />
      )}
      <span className="image-ws__opt-sep" />
      {busy ? (
        <span className="paint-opts__hint" role="status">
          {busy}
        </span>
      ) : (
        <button type="button" className="btn btn--secondary select-opts__btn" disabled={!onSubject} onClick={onSubject}>
          Select subject
        </button>
      )}
      <button type="button" className="btn btn--secondary select-opts__btn" disabled={!onDeselect} onClick={onDeselect}>
        Deselect
      </button>
    </>
  );
}
