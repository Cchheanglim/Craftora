import { useEffect, useRef, useState } from "react";
import type { ProjectEntry } from "../lib/storage";
import { IMAGE_SIZES, MAX_IMAGE_SIDE } from "../project/model";
import { ColorField } from "./Inspector";
import { Icon } from "./Icon";
import "./NewImageDialog.css";

/** Draws a rectangle in the item's proportions up to 40×40. */
function rectDims(width: number, height: number): { width: number; height: number } {
  const MAX = 40;
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (w >= h) {
    return {
      width: MAX,
      height: Math.max(8, Math.round(MAX * (h / w))),
    };
  }
  return {
    width: Math.max(8, Math.round(MAX * (w / h))),
    height: MAX,
  };
}

function clampSide(val: number | string): number {
  const n = typeof val === "number" ? val : parseInt(val, 10);
  if (Number.isNaN(n)) return 1080;
  return Math.max(16, Math.min(MAX_IMAGE_SIDE, Math.round(n)));
}

export function NewImageDialog({ open, recent, onCreate, onOpenPhoto, onOpenProject, onClose }: {
  open: boolean;
  /** Recent image projects, newest first. */
  recent: ProjectEntry[];
  onCreate: (width: number, height: number, background: string) => void;
  onOpenPhoto: () => void;
  onOpenProject: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const widthRef = useRef<HTMLInputElement>(null);

  const [selectedId, setSelectedId] = useState<string>(IMAGE_SIZES[0].id);
  const [width, setWidth] = useState<number | string>(IMAGE_SIZES[0].width);
  const [height, setHeight] = useState<number | string>(IMAGE_SIZES[0].height);
  const [background, setBackground] = useState("#ffffff");

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (el && !el.open) el.showModal();
    // showModal focuses the first button; dialog takes focus instead.
    el?.focus();
    setSelectedId(IMAGE_SIZES[0].id);
    setWidth(IMAGE_SIZES[0].width);
    setHeight(IMAGE_SIZES[0].height);
    setBackground("#ffffff");
  }, [open]);

  if (!open) return null;

  const handleCreate = () => {
    onCreate(clampSide(width), clampSide(height), background);
  };

  const handleWidthChange = (val: string) => {
    setWidth(val);
    const nw = parseInt(val, 10);
    const nh = typeof height === "number" ? height : parseInt(height, 10);
    const match = IMAGE_SIZES.find((p) => p.width === nw && p.height === nh);
    setSelectedId(match ? match.id : "custom");
  };

  const handleHeightChange = (val: string) => {
    setHeight(val);
    const nh = parseInt(val, 10);
    const nw = typeof width === "number" ? width : parseInt(width, 10);
    const match = IMAGE_SIZES.find((p) => p.width === nw && p.height === nh);
    setSelectedId(match ? match.id : "custom");
  };

  const handleSwap = () => {
    const nextW = clampSide(height);
    const nextH = clampSide(width);
    setWidth(nextW);
    setHeight(nextH);
    const match = IMAGE_SIZES.find((p) => p.width === nextW && p.height === nextH);
    setSelectedId(match ? match.id : "custom");
  };

  const customW = clampSide(width);
  const customH = clampSide(height);
  const customDims = rectDims(customW, customH);
  const recentCards = recent.slice(0, 6);

  return (
    <dialog
      ref={ref}
      className="new-image"
      aria-labelledby="new-image-title"
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="new-image__head">
        <h2 id="new-image-title">New image</h2>
        <button
          type="button"
          className="btn btn--icon"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      <div className="new-image__body">
        <div className="new-image__left">
          <div className="new-image__section">
            <h3 className="new-image__section-title">Blank sizes</h3>
            <div className="new-image__grid">
              {IMAGE_SIZES.map((item) => {
                const dims = rectDims(item.width, item.height);
                const isPicked = selectedId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="new-image__tile"
                    aria-pressed={isPicked}
                    onClick={() => {
                      setSelectedId(item.id);
                      setWidth(item.width);
                      setHeight(item.height);
                    }}
                    onDoubleClick={() => onCreate(item.width, item.height, background)}
                  >
                    <div className="new-image__tile-preview">
                      <span
                        className="new-image__tile-rect"
                        style={{ width: `${dims.width}px`, height: `${dims.height}px` }}
                        aria-hidden="true"
                      />
                    </div>
                    <span className="new-image__tile-label">{item.label}</span>
                    <span className="new-image__tile-dims">
                      {item.width} × {item.height} px
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                className="new-image__tile"
                aria-pressed={selectedId === "custom"}
                onClick={() => {
                  setSelectedId("custom");
                  widthRef.current?.focus();
                  widthRef.current?.select();
                }}
                onDoubleClick={handleCreate}
              >
                <div className="new-image__tile-preview">
                  <span
                    className="new-image__tile-rect"
                    style={{ width: `${customDims.width}px`, height: `${customDims.height}px` }}
                    aria-hidden="true"
                  />
                </div>
                <span className="new-image__tile-label">Custom</span>
                <span className="new-image__tile-dims">
                  {customW} × {customH} px
                </span>
              </button>
            </div>
          </div>

          {recentCards.length > 0 && (
            <div className="new-image__section">
              <h3 className="new-image__section-title">Recent images</h3>
              <div className="new-image__recent-grid">
                {recentCards.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="new-image__recent-card"
                    onClick={() => onOpenProject(item.id)}
                  >
                    <div className="new-image__recent-thumb">
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail}
                          alt=""
                          className="new-image__recent-img"
                        />
                      ) : (
                        <div className="new-image__recent-placeholder" aria-hidden="true">
                          <Icon name="image" size={24} />
                        </div>
                      )}
                    </div>
                    <span className="new-image__recent-name">{item.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="new-image__right">
          <div className="new-image__dims">
            <div className="new-image__dims-row">
              <div className="new-image__field">
                <label htmlFor="new-image-width">Width</label>
                <div className="new-image__input-wrap">
                  <input
                    ref={widthRef}
                    id="new-image-width"
                    type="number"
                    className="field mono"
                    min={16}
                    max={MAX_IMAGE_SIDE}
                    step={1}
                    value={width}
                    onChange={(e) => handleWidthChange(e.target.value)}
                    onBlur={() => setWidth((prev) => clampSide(prev))}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />
                  <span className="new-image__suffix" aria-hidden="true">px</span>
                </div>
              </div>
              <div className="new-image__field">
                <label htmlFor="new-image-height">Height</label>
                <div className="new-image__input-wrap">
                  <input
                    id="new-image-height"
                    type="number"
                    className="field mono"
                    min={16}
                    max={MAX_IMAGE_SIDE}
                    step={1}
                    value={height}
                    onChange={(e) => handleHeightChange(e.target.value)}
                    onBlur={() => setHeight((prev) => clampSide(prev))}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />
                  <span className="new-image__suffix" aria-hidden="true">px</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="btn btn--secondary new-image__swap"
              onClick={handleSwap}
            >
              <Icon name="flip" size={13} />
              Swap
            </button>
          </div>

          <div className="new-image__section">
            <label className="new-image__label">Background</label>
            <ColorField color={background} onChange={(c) => setBackground(c)} />
          </div>

          <div className="new-image__actions">
            <button
              type="button"
              className="btn btn--secondary new-image__btn-photo"
              onClick={onOpenPhoto}
            >
              Open a photo…
            </button>
            <div className="new-image__actions-row">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={onClose}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleCreate}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}
