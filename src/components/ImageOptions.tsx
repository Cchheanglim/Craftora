import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import type { ClipPatch } from "../project/actions";
import { TEXT_FONTS, type Clip, type TextFont } from "../project/model";
import { loadFont } from "../lib/fonts";
import { Icon } from "./Icon";
import { Select } from "./Select";
import "./ImageOptions.css";

const TEXT_COLORS = [
  { label: "White", value: "#ffffff" },
  { label: "Yellow", value: "#ffd60a" },
  { label: "Black", value: "#111111" },
  { label: "Blue", value: "#4da3ff" },
  { label: "Green", value: "#30d158" },
  { label: "Pink", value: "#ff6fb1" },
] as const;

const FONT_OPTIONS = [
  { value: "", label: "Segoe UI" },
  ...TEXT_FONTS.map((f) => ({ value: f.id as string, label: f.label })),
];

const ALIGN_ITEMS: { label: string; patch: ClipPatch; path: ReactNode }[] = [
  {
    label: "Align left",
    patch: { x: 0 },
    path: <path d="M2.5 2.5v11M5.5 5h8M5.5 11h5" />,
  },
  {
    label: "Align centre",
    patch: { x: 0.5 },
    path: <path d="M8 2.5v11M3 5h10M4.5 11h7" />,
  },
  {
    label: "Align right",
    patch: { x: 1 },
    path: <path d="M13.5 2.5v11M2.5 5h8M5.5 11h5" />,
  },
  {
    label: "Align top",
    patch: { y: 0 },
    path: <path d="M2.5 2.5h11M5 5.5v8M11 5.5v5" />,
  },
  {
    label: "Align middle",
    patch: { y: 0.5 },
    path: <path d="M2.5 8h11M5 3v10M11 4.5v7" />,
  },
  {
    label: "Align bottom",
    patch: { y: 1 },
    path: <path d="M2.5 13.5h11M5 2.5v8M11 5.5v5" />,
  },
];

export function ImageOptions(props: {
  tool: string;
  clip: Clip | null;
  kind: "photo" | "text" | "shape" | null;
  name: string;
  onChange: (patch: ClipPatch, live?: boolean) => void;
  onCheckpoint: () => void;
  onCommand: (id: string) => void;
}): JSX.Element {
  const { tool, clip, kind, name, onChange, onCommand } = props;
  const [typedSize, setTypedSize] = useState<string | null>(null);
  const skipBlurRef = useRef(false);

  useEffect(() => {
    setTypedSize(null);
  }, [clip?.id, clip?.size]);

  if (tool === "text" && (!clip || kind !== "text")) {
    return (
      <div className="image-options">
        <span className="image-options__hint">Click the picture to add text</span>
      </div>
    );
  }

  if (!clip) {
    return (
      <div className="image-options">
        <span className="image-options__hint">Click a layer on the picture to pick it</span>
      </div>
    );
  }

  if (tool === "text" || kind === "text") {
    const sizePct = Math.round(clip.size * 100);
    const commitSize = (raw: string | null) => {
      const trimmed = raw?.replace(/%$/, "").trim();
      setTypedSize(null);
      if (!trimmed) return;
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0) return;
      const frac = n < 1 ? n : n / 100;
      const clamped = Math.min(0.3, Math.max(0.02, Math.round(frac * 1000) / 1000));
      if (clamped !== clip.size) onChange({ size: clamped });
    };

    return (
      <div className="image-options">
        <label className="image-options__label" htmlFor="image-opt-font">
          Font
        </label>
        <Select<string>
          id="image-opt-font"
          className="image-options__font"
          value={clip.font ?? ""}
          options={FONT_OPTIONS}
          onChange={(font) => {
            const next = (font || undefined) as TextFont | undefined;
            void loadFont(next).catch(() => {});
            onChange({ font: next });
          }}
        />
        <label className="image-options__label" htmlFor="image-opt-size">
          Size
        </label>
        <input
          id="image-opt-size"
          type="text"
          inputMode="numeric"
          aria-label="Size"
          className="field mono image-options__size"
          value={typedSize ?? String(sizePct)}
          onChange={(e) => setTypedSize(e.target.value)}
          onBlur={() => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false;
              return;
            }
            commitSize(typedSize);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const parsed = typedSize !== null ? Number(typedSize.replace(/%$/, "").trim()) : NaN;
              const base = Number.isFinite(parsed) && parsed > 0 ? (parsed < 1 ? Math.round(parsed * 100) : Math.round(parsed)) : sizePct;
              const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
              const nextPct = Math.min(30, Math.max(2, base + step));
              setTypedSize(null);
              const nextSize = nextPct / 100;
              if (nextSize !== clip.size) onChange({ size: nextSize });
            } else if (e.key === "Enter") {
              e.preventDefault();
              commitSize(typedSize);
              skipBlurRef.current = true;
              e.currentTarget.blur();
              skipBlurRef.current = false;
            } else if (e.key === "Escape") {
              e.preventDefault();
              setTypedSize(null);
              skipBlurRef.current = true;
              e.currentTarget.blur();
              skipBlurRef.current = false;
            }
          }}
        />
        <span className="image-ws__opt-sep" />
        <span className="image-options__label">Colour</span>
        <div className="image-options__swatches" role="group" aria-label="Colour">
          {TEXT_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              className="image-options__swatch"
              style={{ background: c.value }}
              aria-label={c.label}
              title={c.label}
              aria-pressed={(clip.color ?? "#ffffff") === c.value}
              onClick={() => onChange({ color: c.value })}
            />
          ))}
        </div>
        <span className="image-ws__opt-sep" />
        <span className="image-options__label">Edge</span>
        <div className="segmented image-options__seg" role="group" aria-label="Edge">
          {([[undefined, "Shadow"], ["outline", "Outline"], ["box", "Box"]] as const).map(([edge, label]) => (
            <button key={label} type="button" aria-pressed={clip.edge === edge} onClick={() => onChange({ edge })}>
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="image-options">
      <span className="image-options__name" title={name}>
        {name}
      </span>
      <span className="image-ws__opt-sep" />
      <span className="image-options__label">Align</span>
      <div className="image-options__group" role="group" aria-label="Align">
        {ALIGN_ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            className="btn btn--icon"
            aria-label={item.label}
            title={item.label}
            onClick={() => onChange(item.patch)}
          >
            <svg
              aria-hidden="true"
              width={14}
              height={14}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {item.path}
            </svg>
          </button>
        ))}
      </div>
      <span className="image-ws__opt-sep" />
      <button type="button" className="btn btn--ghost" onClick={() => onCommand("turn")}>
        <Icon name="rotate" size={13} />
        Turn 90°
      </button>
      <button type="button" className="btn btn--ghost" onClick={() => onCommand("mirror")}>
        <Icon name="flip" size={13} />
        Flip ↔
      </button>
      <button type="button" className="btn btn--ghost" onClick={() => onCommand("flipv")}>
        <Icon name="flip" size={13} />
        Flip ↕
      </button>
      {kind === "photo" && (
        <>
          <button type="button" className="btn btn--ghost" onClick={() => onCommand("crop")}>
            <Icon name="crop" size={13} />
            Crop…
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => onCommand("cut")}>
            <Icon name="scissors" size={13} />
            Remove background
          </button>
        </>
      )}
      <span className="image-ws__opt-sep" />
      <button type="button" className="btn btn--ghost" onClick={() => onCommand("dup")}>
        <Icon name="copy" size={13} />
        Duplicate
      </button>
      <button type="button" className="btn btn--ghost" onClick={() => onCommand("delete")}>
        <Icon name="trash" size={13} />
        Delete
      </button>
    </div>
  );
}
