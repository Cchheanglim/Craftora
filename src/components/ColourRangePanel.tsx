import { useEffect } from "react";
import type { ClipPatch } from "../project/actions";
import type { Clip } from "../project/model";
import { Icon } from "./Icon";
import { RemoveColour } from "./Inspector";
import "./ColourRangePanel.css";

/** Non-modal floating panel for chroma-key / colour range removal in the Image editor. */
export function ColourRangePanel({
  clip,
  onChange,
  onCheckpoint,
  onPick,
  onClose,
}: {
  clip: Clip;
  onChange: (patch: ClipPatch, live?: boolean) => void;
  onCheckpoint: () => void;
  onPick?: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Leave Escape to the colour picker while it is active on the preview.
      if (document.querySelector(".preview__picker")) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <section className="colour-range" role="dialog" aria-labelledby="colour-range-title">
      <header className="colour-range__head">
        <h2 id="colour-range-title">Colour range</h2>
        <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </header>
      <RemoveColour clip={clip} onChange={onChange} onCheckpoint={onCheckpoint} onPick={onPick} />
    </section>
  );
}
