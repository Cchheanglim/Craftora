import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { type Crop } from "../project/model";
import { boxOf, boxRatio, cropOf, CROP_RATIOS, fitRatio, moveBox, resizeBox, type CropBox, type CropHandle } from "../project/crop";
import "./CropDialog.css";

const HANDLES: CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const WHOLE: CropBox = { x: 0, y: 0, w: 1, h: 1 };

/** A drag in progress: everything is worked out from where it started, so many small moves don't drift. */
interface Drag {
  pointer: number;
  handle: CropHandle | null;
  start: CropBox;
  px: number;
  py: number;
  width: number;
  height: number;
  ratio: number | null;
}

/**
 * The crop window: the clip's upright picture with a box to drag and resize, shape buttons, Reset, Cancel and Done.
 * Escape, clicking outside or Cancel change nothing.
 */
export function CropDialog({
  frame,
  failed,
  aspect,
  crop,
  onDone,
  onCancel,
}: {
  /** The clip's picture at the playhead, upright (no mirror/rotate): a data: or http URL. Undefined while loading. */
  frame: string | undefined;
  /** True when the picture couldn't be read: the box still works over a dark stage. */
  failed?: boolean;
  /** The picture's width / height (e.g. 16/9). */
  aspect: number;
  /** The clip's crop now. */
  crop: Crop;
  /** Done: the new crop. */
  onDone: (crop: Crop) => void;
  /** Cancel, Escape or a click outside: nothing changes. */
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [box, setBox] = useState<CropBox>(() => boxOf(crop));
  const [shape, setShape] = useState("free");

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  const ratio = boxRatio(CROP_RATIOS.find((r) => r.id === shape)?.ratio ?? null, aspect);

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (e.button !== 0 || !stage) return;
    const rect = stage.getBoundingClientRect();
    const handle = ((e.target as HTMLElement).dataset.handle as CropHandle | undefined) ?? null;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointer: e.pointerId, handle, start: box, px: e.clientX, py: e.clientY, width: rect.width, height: rect.height, ratio };
  };

  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId || !d.width || !d.height) return;
    const dx = (e.clientX - d.px) / d.width;
    const dy = (e.clientY - d.py) / d.height;
    setBox(d.handle ? resizeBox(d.start, d.handle, dx, dy, d.ratio) : moveBox(d.start, dx, dy));
  };

  const endDrag = () => {
    drag.current = null;
  };

  const pickShape = (id: string, r: number | "picture" | null) => {
    setShape(id);
    const fit = boxRatio(r, aspect);
    if (fit !== null) setBox((b) => fitRatio(b, fit));
  };

  return (
    <dialog
      ref={ref}
      className="crop-dialog"
      aria-labelledby="crop-dialog-title"
      // Escape closes a modal dialog by itself; treat it as Cancel.
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself, outside its box) cancels.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="crop-dialog__box">
        <h2 id="crop-dialog-title">Crop</h2>

        {/* Sized to the picture's own shape, so the box's fractions are fractions of the picture. */}
        <div ref={stageRef} className="crop-dialog__stage" style={{ aspectRatio: String(aspect), width: `min(100%, calc(60vh * ${aspect}))` }}>
          {frame && !failed ? (
            <img className="crop-dialog__frame" src={frame} alt="" draggable={false} />
          ) : (
            <div className="crop-dialog__empty">
              {failed ? "Couldn't read this picture. You can still crop: the box is the whole picture." : "Getting the picture…"}
            </div>
          )}
          <div
            className="crop-dialog__crop"
            role="group"
            aria-label="Crop area"
            style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className="crop-dialog__grid" aria-hidden="true" />
            {HANDLES.map((h) => (
              <div key={h} className={`crop-dialog__handle crop-dialog__handle--${h}`} data-handle={h} aria-hidden="true" />
            ))}
          </div>
        </div>

        <div className="crop-dialog__shapes" role="group" aria-label="Shape">
          {CROP_RATIOS.map((r) => (
            <button
              key={r.id}
              type="button"
              className="btn btn--secondary crop-dialog__shape"
              aria-pressed={shape === r.id}
              onClick={() => pickShape(r.id, r.ratio)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="crop-dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setBox(WHOLE);
              setShape("free");
            }}
          >
            Reset
          </button>
          <span className="crop-dialog__spacer" />
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => onDone(cropOf(box))} autoFocus>
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
