import { useEffect, useRef, useState } from "react";
import { STYLE_START, type LayerStyle } from "../project/model";
import { Icon } from "./Icon";
import { ColorField, Slider } from "./Inspector";
import "./LayerStyleDialog.css";

type EffectKey = keyof LayerStyle;

const EFFECTS: { key: EffectKey; label: string }[] = [
  { key: "shadow", label: "Drop shadow" },
  { key: "glow", label: "Outer glow" },
  { key: "stroke", label: "Stroke" },
];

const pctWhole = (v: number) => `${Math.round(v * 100)}%`;
const pctOne = (v: number) => `${(v * 100).toFixed(1)}%`;
const deg = (v: number) => `${Math.round(v)}°`;

function cleanStyle(next: LayerStyle): LayerStyle | undefined {
  const out: LayerStyle = {};
  if (next.shadow) out.shadow = next.shadow;
  if (next.glow) out.glow = next.glow;
  if (next.stroke) out.stroke = next.stroke;
  return out.shadow || out.glow || out.stroke ? out : undefined;
}

export function LayerStyleDialog(props: {
  style?: LayerStyle;
  onChange: (style: LayerStyle | undefined, live?: boolean) => void;
  onCheckpoint: () => void;
  onClose: () => void;
}) {
  const { style, onChange, onCheckpoint, onClose } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<EffectKey>(
    () => EFFECTS.find((e) => style?.[e.key])?.key ?? "shadow",
  );

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    el?.focus();
  }, []);

  const toggleEffect = (key: EffectKey, on: boolean) => {
    const next: LayerStyle = { ...style };
    if (on) {
      if (key === "shadow") next.shadow = { ...STYLE_START.shadow };
      else if (key === "glow") next.glow = { ...STYLE_START.glow };
      else next.stroke = { ...STYLE_START.stroke };
    } else {
      delete next[key];
    }
    onChange(cleanStyle(next));
  };

  const isOn = Boolean(style?.[picked]);
  const shadow = style?.shadow ?? STYLE_START.shadow;
  const glow = style?.glow ?? STYLE_START.glow;
  const stroke = style?.stroke ?? STYLE_START.stroke;

  return (
    <dialog
      ref={ref}
      className="layer-style-dialog"
      aria-labelledby="layer-style-title"
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header className="layer-style-dialog__head">
        <h2 id="layer-style-title" className="layer-style-dialog__title">
          Layer style
        </h2>
        <button
          type="button"
          className="btn btn--icon"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <Icon name="x" size={14} />
        </button>
      </header>

      <div className="layer-style-dialog__body">
        <div className="layer-style-dialog__list" role="list">
          {EFFECTS.map(({ key, label }) => {
            const active = picked === key;
            const checked = Boolean(style?.[key]);
            return (
              <div
                key={key}
                role="listitem"
                className={`layer-style-dialog__row${active ? " is-picked" : ""}`}
              >
                <input
                  type="checkbox"
                  className="layer-style-dialog__check"
                  checked={checked}
                  aria-label={label}
                  onChange={(e) => toggleEffect(key, e.target.checked)}
                />
                <button
                  type="button"
                  className="layer-style-dialog__name"
                  aria-pressed={active}
                  onClick={() => setPicked(key)}
                >
                  {label}
                </button>
              </div>
            );
          })}
        </div>

        <div className="layer-style-dialog__pane">
          {!isOn && <p className="layer-style-dialog__hint">Tick it to switch it on.</p>}
          <div
            key={picked}
            className={`layer-style-dialog__settings${isOn ? "" : " is-off"}`}
            aria-disabled={!isOn}
          >
            {picked === "shadow" && (
              <>
                <ColorField
                  label="Color"
                  color={shadow.color}
                  onCheckpoint={onCheckpoint}
                  onChange={(color, live) =>
                    onChange({ ...style, shadow: { ...shadow, color } }, live)
                  }
                />
                <Slider
                  id="ls-shadow-opacity"
                  label="Opacity"
                  min={0}
                  max={1}
                  step={0.01}
                  value={shadow.opacity}
                  format={pctWhole}
                  onCheckpoint={onCheckpoint}
                  onChange={(opacity) =>
                    onChange({ ...style, shadow: { ...shadow, opacity } }, true)
                  }
                />
                <Slider
                  id="ls-shadow-angle"
                  label="Angle"
                  min={-180}
                  max={180}
                  step={1}
                  value={shadow.angle}
                  format={deg}
                  onCheckpoint={onCheckpoint}
                  onChange={(angle) =>
                    onChange({ ...style, shadow: { ...shadow, angle } }, true)
                  }
                />
                <Slider
                  id="ls-shadow-distance"
                  label="Distance"
                  min={0}
                  max={0.05}
                  step={0.001}
                  value={shadow.distance}
                  format={pctOne}
                  onCheckpoint={onCheckpoint}
                  onChange={(distance) =>
                    onChange({ ...style, shadow: { ...shadow, distance } }, true)
                  }
                />
                <Slider
                  id="ls-shadow-size"
                  label="Size"
                  min={0}
                  max={0.05}
                  step={0.001}
                  value={shadow.size}
                  format={pctOne}
                  onCheckpoint={onCheckpoint}
                  onChange={(size) =>
                    onChange({ ...style, shadow: { ...shadow, size } }, true)
                  }
                />
              </>
            )}

            {picked === "glow" && (
              <>
                <ColorField
                  label="Color"
                  color={glow.color}
                  onCheckpoint={onCheckpoint}
                  onChange={(color, live) =>
                    onChange({ ...style, glow: { ...glow, color } }, live)
                  }
                />
                <Slider
                  id="ls-glow-opacity"
                  label="Opacity"
                  min={0}
                  max={1}
                  step={0.01}
                  value={glow.opacity}
                  format={pctWhole}
                  onCheckpoint={onCheckpoint}
                  onChange={(opacity) =>
                    onChange({ ...style, glow: { ...glow, opacity } }, true)
                  }
                />
                <Slider
                  id="ls-glow-size"
                  label="Size"
                  min={0}
                  max={0.05}
                  step={0.001}
                  value={glow.size}
                  format={pctOne}
                  onCheckpoint={onCheckpoint}
                  onChange={(size) =>
                    onChange({ ...style, glow: { ...glow, size } }, true)
                  }
                />
              </>
            )}

            {picked === "stroke" && (
              <>
                <ColorField
                  label="Color"
                  color={stroke.color}
                  onCheckpoint={onCheckpoint}
                  onChange={(color, live) =>
                    onChange({ ...style, stroke: { ...stroke, color } }, live)
                  }
                />
                <Slider
                  id="ls-stroke-size"
                  label="Size"
                  min={0}
                  max={0.02}
                  step={0.001}
                  value={stroke.size}
                  format={pctOne}
                  onCheckpoint={onCheckpoint}
                  onChange={(size) =>
                    onChange({ ...style, stroke: { ...stroke, size } }, true)
                  }
                />
              </>
            )}
          </div>
        </div>
      </div>

      <footer className="layer-style-dialog__foot">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => onChange(undefined)}
        >
          Reset
        </button>
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </dialog>
  );
}
