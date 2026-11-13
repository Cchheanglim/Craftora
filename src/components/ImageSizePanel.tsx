import { useEffect, useState } from "react";
import { IMAGE_SIZES, MAX_IMAGE_SIDE, type Project } from "../project/model";
import type { ProjectApi } from "../project/useProject";
import { ColorField } from "./Inspector";
import "./ImageSizePanel.css";

interface ImageSizePanelProps {
  project: Project;
  api: ProjectApi;
}

/** Draws a rectangle in the item's proportions up to 36px. */
function rectDims(width: number, height: number): { width: number; height: number } {
  const MAX = 36;
  if (width >= height) {
    return {
      width: MAX,
      height: Math.max(10, Math.round(MAX * (height / width))),
    };
  }
  return {
    width: Math.max(10, Math.round(MAX * (width / height))),
    height: MAX,
  };
}

export function ImageSizePanel({ project, api }: ImageSizePanelProps) {
  if (!project.image) return null;

  const currentW = project.image.width;
  const currentH = project.image.height;
  const [wText, setWText] = useState(() => String(currentW));
  const [hText, setHText] = useState(() => String(currentH));

  useEffect(() => {
    setWText(String(currentW));
    setHText(String(currentH));
  }, [currentW, currentH]);

  const applyCustom = () => {
    if (!project.image) return;
    const w = Math.min(MAX_IMAGE_SIDE, Math.max(16, parseInt(wText, 10) || currentW));
    const h = Math.min(MAX_IMAGE_SIDE, Math.max(16, parseInt(hText, 10) || currentH));
    if (w !== currentW || h !== currentH) {
      api.edit({ type: "setImage", patch: { width: w, height: h } });
    } else {
      setWText(String(w));
      setHText(String(h));
    }
  };

  const handleSwap = () => {
    if (!project.image) return;
    api.edit({
      type: "setImage",
      patch: { width: currentH, height: currentW },
    });
  };

  return (
    <div className="image-size-panel">
      <fieldset className="insp__group">
        <legend>Size</legend>
        <div className="image-size-grid">
          {IMAGE_SIZES.map((item) => {
            const isMatch = currentW === item.width && currentH === item.height;
            const dims = rectDims(item.width, item.height);
            return (
              <button
                key={item.id}
                type="button"
                className="image-size-tile"
                aria-pressed={isMatch}
                onClick={() => api.edit({ type: "setImage", patch: { width: item.width, height: item.height } })}
              >
                <div className="image-size-tile__preview">
                  <span
                    className="image-size-tile__rect"
                    style={{ width: `${dims.width}px`, height: `${dims.height}px` }}
                    aria-hidden="true"
                  />
                </div>
                <span className="image-size-tile__label">{item.label}</span>
                <span className="image-size-tile__dims">
                  {item.width} × {item.height}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="insp__group">
        <legend>Custom</legend>
        <div className="image-size-custom">
          <div className="image-size-custom__row">
            <div className="insp__field">
              <label htmlFor="image-size-width">Width</label>
              <input
                id="image-size-width"
                type="number"
                className="field mono"
                min={16}
                max={MAX_IMAGE_SIDE}
                step={1}
                value={wText}
                onChange={(e) => setWText(e.target.value)}
                onBlur={applyCustom}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    applyCustom();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
            </div>
            <div className="insp__field">
              <label htmlFor="image-size-height">Height</label>
              <input
                id="image-size-height"
                type="number"
                className="field mono"
                min={16}
                max={MAX_IMAGE_SIDE}
                step={1}
                value={hText}
                onChange={(e) => setHText(e.target.value)}
                onBlur={applyCustom}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    applyCustom();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
            </div>
          </div>
          <button type="button" className="btn btn--secondary image-size-custom__swap" onClick={handleSwap}>
            Swap
          </button>
        </div>
      </fieldset>

      <fieldset className="insp__group">
        <legend>Background</legend>
        <ColorField
          color={project.image.background}
          onCheckpoint={api.checkpoint}
          onChange={(background, live) => (live ? api.editLive : api.edit)({ type: "setImage", patch: { background } })}
        />
      </fieldset>
    </div>
  );
}
