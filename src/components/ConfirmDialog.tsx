import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import "./ConfirmDialog.css";

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  /** The button that goes ahead, e.g. "Delete project". */
  confirmLabel: string;
  /** Red confirm button, for things that destroy work. */
  danger?: boolean;
  /** Replaces "This can't be undone." when there's a way back outside Craftora. */
  note?: string;
}

/**
 * A "Are you sure?" step for actions that can't be undone. `ask` resolves true when the
 * user confirms; Escape, clicking outside or Cancel resolve false. Render `dialog` once.
 */
export function useConfirm() {
  const [request, setRequest] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const ask = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setRequest({ ...options, resolve })), []);

  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };

  const dialog = request ? <ConfirmDialog {...request} onClose={close} /> : null;
  return { ask, dialog };
}

function ConfirmDialog({ title, message, confirmLabel, danger, note, onClose }: ConfirmOptions & { onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby="confirm-title"
      // Escape closes a modal dialog by itself; treat it as Cancel.
      onCancel={(e) => {
        e.preventDefault();
        onClose(false);
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself, outside its box) cancels.
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <div className="confirm__box">
        <h2 id="confirm-title">{title}</h2>
        <div className="confirm__message">{message}</div>
        <p className="confirm__note">{note ?? "This can't be undone."}</p>
        <div className="confirm__actions">
          <button type="button" className="btn btn--ghost" onClick={() => onClose(false)} autoFocus>
            Cancel
          </button>
          <button type="button" className={danger ? "btn btn--primary" : "btn btn--secondary"} onClick={() => onClose(true)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
