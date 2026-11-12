import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { WelcomeScene } from "./WelcomeScene";
import "./WelcomeDialog.css";

// Not the old "craftora.welcomeDialog" (closed once): that ticked nothing, so it shows again until ticked.
const HIDDEN_KEY = "craftora.hideWelcome";

/** Whether "Don't show this again" was ticked; until then the guide opens at every start. */
export function welcomeHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function setWelcomeHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, "1");
    else localStorage.removeItem(HIDDEN_KEY);
  } catch {
    /* not essential: it just shows again next time */
  }
}

/** How long the closing fade takes; matches `.welcome.is-leaving` in WelcomeDialog.css. */
const LEAVE_MS = 160;

interface WelcomeDialogProps {
  /** Absent in the browser preview. */
  onImport?: () => void;
  onPasteLink: () => void;
  busy: boolean;
  /** Called once the guide has faded out; "Don't show this again" has been saved by then. */
  onClose: () => void;
}

/**
 * The welcome guide: a pop-up that fades and slides in over the app with three steps, at every
 * start until "Don't show this again" is ticked (Home → Welcome guide opens it any time, and
 * unticking it there brings it back).
 */
export function WelcomeDialog({ onImport, onPasteLink, busy, onClose }: WelcomeDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [hide, setHide] = useState(welcomeHidden);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    // showModal focuses the first button (the X) with a focus ring; the window itself takes focus instead.
    el?.focus();
  }, []);

  const close = (then?: () => void) => {
    if (leaving) return;
    setWelcomeHidden(hide);
    setLeaving(true);
    window.setTimeout(() => {
      ref.current?.close();
      onClose();
      then?.();
    }, LEAVE_MS);
  };

  return (
    <dialog
      ref={ref}
      className={leaving ? "welcome is-leaving" : "welcome"}
      aria-labelledby="welcome-title"
      tabIndex={-1}
      // Escape closes a modal dialog by itself; fade out first instead.
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself, outside its box) closes it.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="welcome__box">
        <WelcomeScene />
        <div className="welcome__head">
          <div>
            <h2 id="welcome-title">Welcome to Craftora</h2>
            <p>Make a video in three steps.</p>
          </div>
          <button type="button" className="btn btn--icon welcome__close" aria-label="Close the welcome guide" title="Close" onClick={() => close()}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <ol className="welcome__steps">
          <li>
            <strong>Bring in a video.</strong>
            <span>Import files from your PC, or paste a link in the box at the top and click Fetch.</span>
          </li>
          <li>
            <strong>Edit it on the timeline.</strong>
            <span>Drag clips to move and trim them, press S to split, T to add text, and drag media onto any track.</span>
          </li>
          <li>
            <strong>Export it.</strong>
            <span>On the right, pick where it's going (YouTube, TikTok…) and click Add to queue.</span>
          </li>
        </ol>
        <div className="welcome__actions">
          <label className="welcome__hide">
            <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />
            Don't show this again
          </label>
          <button type="button" className="btn btn--ghost" onClick={() => close()}>
            Got it
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => close(onPasteLink)}>
            <Icon name="link" size={14} />
            Paste a link
          </button>
          {onImport && (
            <button type="button" className="btn btn--primary" onClick={() => close(onImport)} disabled={busy} autoFocus>
              <Icon name="upload" size={14} />
              Import files
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
