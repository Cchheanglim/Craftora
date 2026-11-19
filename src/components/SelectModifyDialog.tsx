import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
// The photo-editor dialog look (head, foot, dense buttons).
import "./LayerStyleDialog.css";

export type ModifyKind = "feather" | "expand" | "contract";

const TITLES: Record<ModifyKind, string> = { feather: "Feather selection", expand: "Expand selection", contract: "Contract selection" };
const LABELS: Record<ModifyKind, string> = { feather: "Feather radius", expand: "Expand by", contract: "Contract by" };

/** Select → Modify → Feather / Expand / Contract…: one size in picture pixels, then OK (Enter) or Cancel (Escape). */
export function SelectModifyDialog({ kind, onApply, onClose }: { kind: ModifyKind; onApply: (by: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(kind === "feather" ? "10" : "5");
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    // The size, ready to type over (showModal would focus the close button first).
    input.current?.focus();
    input.current?.select();
  }, []);
  const by = Number(text);
  const valid = Number.isFinite(by) && by > 0 && by <= 500;
  const ok = () => {
    if (!valid) return;
    onApply(by);
    onClose();
  };
  return (
    <dialog
      ref={ref}
      className="layer-style-dialog"
      style={{ width: 280 }}
      aria-labelledby="select-modify-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <header className="layer-style-dialog__head">
        <h2 id="select-modify-title" className="layer-style-dialog__title">
          {TITLES[kind]}
        </h2>
        <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </header>
      <div className="insp__field" style={{ padding: 8 }}>
        <label htmlFor="select-modify-by">{LABELS[kind]} (px)</label>
        <input
          id="select-modify-by"
          className="field mono"
          inputMode="numeric"
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ok()}
          aria-invalid={!valid}
        />
      </div>
      <footer className="layer-style-dialog__foot">
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" disabled={!valid} onClick={ok}>
          OK
        </button>
      </footer>
    </dialog>
  );
}
