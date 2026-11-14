import { useEffect, useRef, type ReactNode } from "react";
import { PanelHead } from "./SoundPanel";
import "./ExportDialog.css";

/** The export settings in a pop-up, opened by Export next to Queue. Back and X both close it: nothing comes before it. */
export function ExportDialog({ sub, onClose, children, picture }: { sub: string; onClose: () => void; children: ReactNode; /** The Image editor's: beside the layers, which stay in view. */ picture?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    // showModal focuses Back with a focus ring; the window itself takes focus instead.
    el?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`export-dialog${picture ? " is-picture" : ""}`}
      aria-labelledby="export-dialog-title"
      tabIndex={-1}
      // Escape closes a modal dialog by itself; let React unmount it instead.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself, outside its box) closes it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <PanelHead id="export-dialog-title" title={picture ? "Export picture" : "Export"} sub={sub} onBack={onClose} onClose={onClose} />
      {children}
    </dialog>
  );
}
