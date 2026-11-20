import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ExportSettings } from "../types";
import { MAX_IMAGE_SIDE } from "../project/model";
import { aiSharpen, enhanceColours } from "../lib/compose";
import { errorText, inDesktopApp } from "../lib/engine";
import { setPreference } from "../lib/preferences";
import { Slider } from "./Inspector";
import "./ImageExportOptions.css";

/** 4× only with AI sharpen. */
const SCALES = [0.5, 1, 2, 4] as const;

export function ImageExportOptions({
  settings,
  onChange,
  image,
  picture,
}: {
  settings: ExportSettings;
  onChange: (patch: Partial<ExportSettings>) => void;
  image: { width: number; height: number };
  /** The picture as it is now (compose.ts), for Enhance's before/after. */
  picture?: () => Promise<HTMLCanvasElement>;
}) {
  const format = settings.imageContainer ?? "png";
  const png = format === "png";
  // PNG and WebP keep see-through areas; JPG and WebP have a quality.
  const clear = format !== "jpg";
  const ai = Boolean(settings.imageAi) && inDesktopApp;
  const enhance = Boolean(settings.imageEnhance);
  const scale = settings.imageScale === 4 && !ai ? 2 : (settings.imageScale ?? 1);
  const maxSide = Math.max(image.width, image.height) || 1;
  const k = Math.min(scale, MAX_IMAGE_SIDE / maxSide);
  const w = Math.round(image.width * k);
  const h = Math.round(image.height * k);
  const capped = scale >= 2 && k < scale;
  const choose = (name: "imageEnhance" | "imageAi", on: boolean) => {
    setPreference(name, on);
    onChange(name === "imageAi" && !on && scale === 4 ? { imageAi: false, imageScale: 2 } : { [name]: on });
  };

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
          {SCALES.filter((s) => s < 4 || ai).map((s) => (
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

      <fieldset>
        <legend className="section-label">Enhance</legend>
        <label className="option">
          <input type="checkbox" checked={enhance} onChange={(e) => choose("imageEnhance", e.target.checked)} />
          <span>Enhance colours</span>
        </label>
        <label className="option">
          <input type="checkbox" checked={ai} disabled={!inDesktopApp} onChange={(e) => choose("imageAi", e.target.checked)} />
          <span>AI sharpen</span>
        </label>
        <p className="image-export__hint">
          {!inDesktopApp
            ? "AI sharpen needs the desktop app."
            : ai
              ? "Redraws the detail with AI on this PC, sharper at every size (and up to 4×). It takes a while: the picture is made in the Queue."
              : "Enhance colours: brighter shadows, softer brights, a little more contrast, colour and sharpness."}
        </p>
        {(enhance || ai) && picture && <EnhancePreview picture={picture} enhance={enhance} ai={ai} />}
      </fieldset>
    </div>
  );
}

/** The before/after piece: this many picture pixels square (one of the AI's pieces). */
const PIECE = 112;

/** Enhance's before/after: a square piece of the picture at full size; drag it to look at another part. */
function EnhancePreview({ picture, enhance, ai }: { picture: () => Promise<HTMLCanvasElement>; enhance: boolean; ai: boolean }) {
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const [at, setAt] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const before = useRef<HTMLCanvasElement>(null);
  const after = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; at: { x: number; y: number } } | null>(null);
  // The picture is drawn once per window opening (the function changes every render).
  const draw = useRef(picture);

  useEffect(() => {
    let live = true;
    draw
      .current()
      .then((c) => {
        if (!live) return;
        setSource(c);
        setAt({ x: c.width / 2, y: c.height / 2 });
      })
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, []);

  // The piece around `at`: shown as it is at once, then (a moment after the last change) enhanced.
  useEffect(() => {
    if (!source) return;
    const size = Math.min(PIECE, source.width, source.height);
    const left = Math.round(Math.min(Math.max(at.x - size / 2, 0), source.width - size));
    const top = Math.round(Math.min(Math.max(at.y - size / 2, 0), source.height - size));
    const piece = document.createElement("canvas");
    piece.width = piece.height = size;
    piece.getContext("2d")!.drawImage(source, left, top, size, size, 0, 0, size, size);
    paint(before.current, piece);
    let live = true;
    const timer = window.setTimeout(async () => {
      setError(null);
      try {
        let result = enhance ? enhanceColours(piece) : piece;
        if (ai) {
          setBusy(true);
          result = await aiSharpen(result, 4);
        }
        if (live) paint(after.current, result);
      } catch (err) {
        if (live) setError(errorText(err));
      } finally {
        if (live) setBusy(false);
      }
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [source, at, enhance, ai]);

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !source) return;
    // The box shows PIECE picture pixels across its width.
    const k = Math.min(PIECE, source.width, source.height) / e.currentTarget.clientWidth;
    setAt({
      x: Math.min(Math.max(d.at.x - (e.clientX - d.x) * k, 0), source.width),
      y: Math.min(Math.max(d.at.y - (e.clientY - d.y) * k, 0), source.height),
    });
  };

  return (
    <div className="enhance-preview">
      <div
        className="enhance-preview__pane is-before"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, at };
        }}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <canvas ref={before} />
        <span className="enhance-preview__label">Before</span>
      </div>
      <div className="enhance-preview__pane">
        <canvas ref={after} />
        <span className="enhance-preview__label">{busy ? "Sharpening…" : "After"}</span>
      </div>
      <p className="image-export__hint enhance-preview__hint">{error ?? "Drag the left picture to look at another part."}</p>
    </div>
  );
}

/** Draws `picture` into `canvas` at its own size (the box scales it). */
function paint(canvas: HTMLCanvasElement | null, picture: HTMLCanvasElement) {
  if (!canvas) return;
  canvas.width = picture.width;
  canvas.height = picture.height;
  canvas.getContext("2d")!.drawImage(picture, 0, 0);
}
