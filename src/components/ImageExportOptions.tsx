import type { ExportSettings } from "../types";
import { MAX_IMAGE_SIDE } from "../project/model";
import { Slider } from "./Inspector";
import "./ImageExportOptions.css";

const SCALES = [0.5, 1, 2] as const;

export function ImageExportOptions({
  settings,
  onChange,
  image,
}: {
  settings: ExportSettings;
  onChange: (patch: Partial<ExportSettings>) => void;
  image: { width: number; height: number };
}) {
  const format = settings.imageContainer ?? "png";
  const png = format === "png";
  // PNG and WebP keep see-through areas; JPG and WebP have a quality.
  const clear = format !== "jpg";
  const scale = settings.imageScale ?? 1;
  const maxSide = Math.max(image.width, image.height) || 1;
  const k = Math.min(scale, MAX_IMAGE_SIDE / maxSide);
  const w = Math.round(image.width * k);
  const h = Math.round(image.height * k);
  const capped = scale === 2 && k < scale;

  return (
    <div className="image-export">
      <fieldset>
        <legend className="section-label">Format</legend>
        <div className="segmented" role="group" aria-label="Format">
          {(["png", "jpg", "webp"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={format === f} onClick={() => onChange({ imageContainer: f })}>
              {f === "webp" ? "WebP" : f.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="image-export__hint">
          {png ? "Sharpest, keeps see-through areas." : format === "jpg" ? "Smaller file, for photos." : "Smallest file, keeps see-through areas; for the web."}
        </p>
      </fieldset>

      <fieldset>
        <legend className="section-label">Transparent background</legend>
        <label className="option">
          <input
            type="checkbox"
            checked={clear && Boolean(settings.transparent)}
            disabled={!clear}
            onChange={(e) => onChange({ transparent: e.target.checked })}
          />
          <span>Transparent background</span>
        </label>
        <p className="image-export__hint">
          {clear
            ? "Saves without the background colour: only the layers."
            : "PNG or WebP only: JPG can't keep see-through areas."}
        </p>
      </fieldset>

      <fieldset>
        <legend className="section-label">Quality</legend>
        {!png ? (
          <Slider
            id="image-quality"
            label="Quality"
            min={1}
            max={100}
            step={1}
            value={settings.imageQuality ?? 95}
            format={(v) => `${v}%`}
            onCheckpoint={() => {}}
            onChange={(v) => onChange({ imageQuality: v })}
          />
        ) : (
          <p className="image-export__hint">PNG keeps every pixel (100%).</p>
        )}
      </fieldset>

      <fieldset>
        <legend className="section-label">Size</legend>
        <div className="segmented" role="group" aria-label="Size">
          {SCALES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scale === s}
              onClick={() => onChange({ imageScale: s })}
            >
              {s}×
            </button>
          ))}
        </div>
        <p className="image-export__hint image-export__size">
          <span className="mono">{w} × {h} px</span>
          {capped ? " (largest allowed)" : ""}
        </p>
      </fieldset>
    </div>
  );
}
