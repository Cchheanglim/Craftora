import { useEffect, useRef, useState } from "react";
import type { ProjectEntry } from "../lib/storage";
import { IMAGE_SIZES, MAX_IMAGE_SIDE } from "../project/model";
import { ColorField } from "./Inspector";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";
import "./NewImageDialog.css";

/** Draws a rectangle in the item's proportions fitting the 44×36 box. */
function rectDims(width: number, height: number): { width: number; height: number } {
  const MAX_W = 44;
  const MAX_H = 36;
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (w / h >= MAX_W / MAX_H) {
    return {
      width: MAX_W,
      height: Math.max(8, Math.round(MAX_W * (h / w))),
    };
  }
  return {
    width: Math.max(8, Math.round(MAX_H * (w / h))),
    height: MAX_H,
  };
}

/** Draws a preview rectangle in the chosen proportions fitting at most 140×77. */
function previewDims(width: number, height: number): { width: number; height: number } {
  const MAX_W = 140;
  const MAX_H = 77;
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (w / h >= MAX_W / MAX_H) {
    return {
      width: MAX_W,
      height: Math.max(4, Math.round(MAX_W * (h / w))),
    };
  }
  return {
    width: Math.max(4, Math.round(MAX_H * (w / h))),
    height: MAX_H,
  };
}

function clampSide(val: number | string): number {
  const n = typeof val === "number" ? val : parseInt(val, 10);
  if (Number.isNaN(n)) return 1080;
  return Math.max(16, Math.min(MAX_IMAGE_SIDE, Math.round(n)));
}

export function NewImageDialog({ open, recent, openId, onCreate, onOpenPhoto, onOpenProject, onClose }: {
  open: boolean;
  /** Recent image projects, newest first (the open one first). */
  recent: ProjectEntry[];
  /** The picture open behind the window, marked in Recent. */
  openId?: string;
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
  // W and H show once "Your own" is picked, and stay while typing (even when the numbers match a preset).
  const [own, setOwn] = useState(false);

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
    setOwn(false);
  }, [open]);

  useEffect(() => {
    if (!own) return;
    widthRef.current?.focus();
    widthRef.current?.select();
  }, [own]);

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
  const preview = previewDims(customW, customH);
  const recentCards = recent.slice(0, 12);

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
        <h2 id="new-image-title">{recentCards.length ? "Image editor" : "New image"}</h2>
        <button
          type="button"
          className="btn btn--icon"
          aria-label="Close"
          onClick={onClose}
          style={{ width: 22, height: 22 }}
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      <div className="new-image__body">
        {recentCards.length > 0 && (
          <div className="new-image__recent">
            <div className="new-image__label">Recent pictures</div>
            <div className="new-image__hint">Click one to carry on</div>
            <div className="new-image__recent-list">
              {recentCards.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="new-image__recent-card"
                  aria-current={item.id === openId || undefined}
                  onClick={() => onOpenProject(item.id)}
                >
                  <Thumb src={item.thumbnail} icon="image" />
                  <span className="new-image__recent-text">
                    <span className="new-image__recent-name">{item.name}</span>
                    {item.id === openId && <span className="new-image__recent-open">Open now</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="new-image__left">
          <div className="new-image__section">
            <div className="new-image__label">New picture</div>
            <div className="new-image__grid">
              {IMAGE_SIZES.map((item) => {
                const dims = rectDims(item.width, item.height);
                const isPicked = selectedId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="new-image__card"
                    aria-pressed={isPicked}
                    onClick={() => {
                      setSelectedId(item.id);
                      setWidth(item.width);
                      setHeight(item.height);
                      setOwn(false);
                    }}
                    onDoubleClick={() => onCreate(item.width, item.height, background)}
                  >
                    <div className="new-image__card-preview">
                      <span
                        className="new-image__card-rect"
                        style={{ width: `${dims.width}px`, height: `${dims.height}px` }}
                        aria-hidden="true"
                      />
                    </div>
                    <span className="new-image__card-name">{item.label}</span>
                    <span className="new-image__card-size">
                      {item.width} × {item.height}
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                className="new-image__card"
                aria-pressed={selectedId === "custom"}
                onClick={() => {
                  setSelectedId("custom");
                  setOwn(true);
                }}
                onDoubleClick={handleCreate}
              >
                <div className="new-image__card-preview">
                  <span
                    className="new-image__card-rect new-image__card-rect--dashed"
                    aria-hidden="true"
                  />
                </div>
                <span className="new-image__card-name">Your own</span>
                <span className="new-image__card-size">any size</span>
              </button>

              <button type="button" className="new-image__card" onClick={onOpenPhoto}>
                <div className="new-image__card-preview">
                  <Icon name="folder" size={18} />
                </div>
                <span className="new-image__card-name">Open a photo…</span>
                <span className="new-image__card-size">its own size</span>
              </button>
            </div>
          </div>

        </div>

        <div className="new-image__right">
          <div className="new-image__label">Size</div>
          {!own ? (
            <div className="new-image__size-summary">
              <span className="mono">{customW} × {customH}</span> px
            </div>
          ) : (
          <>
          <div className="new-image__size-row">
            <div className="new-image__input-wrap">
              <span className="new-image__input-prefix" aria-hidden="true">W</span>
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
                aria-label="Width"
              />
            </div>
            <button
              type="button"
              className="btn btn--icon"
              style={{ width: 22, height: 22 }}
              onClick={handleSwap}
              aria-label="Swap"
            >
              <Icon name="flip" size={13} />
            </button>
            <div className="new-image__input-wrap">
              <span className="new-image__input-prefix" aria-hidden="true">H</span>
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
                aria-label="Height"
              />
            </div>
          </div>
          <div className="new-image__note">
            Up to <span className="mono">8192</span> px a side.
          </div>
          </>
          )}

          <div className="new-image__label">Background</div>
          <ColorField color={background} onChange={(c) => setBackground(c)} />

          <div className="new-image__label">Preview</div>
          <div className="new-image__preview-box">
            <div
              className="new-image__preview-rect"
              style={{
                width: `${preview.width}px`,
                height: `${preview.height}px`,
                background,
              }}
            />
          </div>
        </div>
      </div>

      <div className="new-image__foot">
        <button
          type="button"
          className="btn btn--secondary"
          style={{ width: 80 }}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          style={{ minWidth: 80 }}
          onClick={handleCreate}
        >
          {recentCards.length ? "Create new" : "Create"}
        </button>
      </div>
    </dialog>
  );
}
