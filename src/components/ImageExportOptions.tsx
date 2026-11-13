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
  const png = (settings.imageContainer ?? "png") === "png";
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
          <button
            type="button"
            aria-pressed={png}
            onClick={() => onChange({ imageContainer: "png" })}
          >
            PNG
          </button>
          <button
            type="button"
            aria-pressed={!png}
            onClick={() => onChange({ imageContainer: "jpg" })}
          >
            JPG
          </button>
        </div>
        <p className="image-export__hint">
          {png ? "Sharpest, keeps see-through areas." : "Smaller file, for photos."}
        </p>
      </fieldset>

      <fieldset>
        <legend className="section-label">Transparent background</legend>
        <label className="option">
          <input
            type="checkbox"
            checked={png && Boolean(settings.transparent)}
            disabled={!png}
            onChange={(e) => onChange({ transparent: e.target.checked })}
          />
          <span>Transparent background</span>
        </label>
        <p className="image-export__hint">
          {png
            ? "Saves without the background colour: only the layers."
            : "PNG only: JPG can't keep see-through areas."}
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
