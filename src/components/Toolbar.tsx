import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkSite, errorText } from "../lib/engine";
import { siteVerdict, type Verdict } from "./Home";
import { Icon } from "./Icon";
import "./Toolbar.css";

interface ToolbarProps {
  /** The main menu (Sidebar), shown from the round button at the left; absent: no button (other pages show it as a column). */
  menu?: ReactNode;
  /** The Queue button (QueueDock), next to Import. */
  queue: ReactNode;
  url: string;
  onUrlChange: (url: string) => void;
  onFetch: (url: string) => void;
  fetching: boolean;
  error: string | null;
  /** A button next to the error, such as "Sign in to youtube.com". */
  errorAction?: { label: string; onClick: () => void };
  /** This copy can ask VirusTotal whether a link's website is safe. */
  canCheckSite?: boolean;
  /** Without a VirusTotal key, Check opens Settings to add one. */
  onSetUpSiteCheck?: () => void;
  /** Imports files from this PC; absent in the browser preview. */
  onImport?: () => void;
  /** Opens the export pop-up; only in the editor. */
  onExport?: () => void;
  /** Lets Home's "Paste a link" focus the field. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** A newer version: a button to install it, or its progress (no `onClick`) while installing. */
  update?: { label: string; onClick?: () => void };
  /** The Image editor's bar instead of the link box: its name and file buttons, the middle, and tools before Export. */
  image?: { start: ReactNode; middle: ReactNode; end: ReactNode };
}

export function Toolbar({
  menu,
  queue,
  url,
  onUrlChange,
  onFetch,
  fetching,
  error,
  errorAction,
  canCheckSite,
  onSetUpSiteCheck,
  onImport,
  onExport,
  inputRef,
  update,
  image,
}: ToolbarProps) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const navRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearTimer();
    setOpen(true);
  };

  const handleMouseLeave = () => {
    clearTimer();
    closeTimer.current = setTimeout(() => {
      setOpen(false);
    }, 250);
  };

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        clearTimer();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const handleButtonClick = () => {
    clearTimer();
    setOpen((prev) => !prev);
  };

  const handleButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      clearTimer();
      setOpen(true);
      const focusFirst = () => {
        const firstBtn = navRef.current?.querySelector<HTMLButtonElement>(".toolbar__nav-menu button");
        firstBtn?.focus();
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(focusFirst);
      } else {
        setTimeout(focusFirst, 0);
      }
    }
  };

  const handleNavKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      clearTimer();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) {
      clearTimer();
      setOpen(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setVerdict(null);
    if (url.trim()) onFetch(url.trim());
  };

  const checkUrl = async () => {
    if (!url.trim() || checking) return;
    setChecking(true);
    setVerdict(null);
    try {
      setVerdict(siteVerdict(await checkSite(url.trim())));
    } catch (err) {
      setVerdict({ tone: "warn", text: errorText(err) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        {menu && (
        <div
          ref={navRef}
          className="toolbar__nav"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onKeyDown={handleNavKeyDown}
        >
          <button
            ref={buttonRef}
            type="button"
            className="btn btn--icon"
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={handleButtonClick}
            onKeyDown={handleButtonKeyDown}
          >
            <Icon name="menu" />
          </button>
          {open && (
            <div className="toolbar__nav-menu" onClick={handleMenuClick}>
              {menu}
            </div>
          )}
        </div>
        )}
        <img src="/craftora.svg" width={22} height={22} alt="" className="toolbar__logo" />
        {image ? image.start : <span>Craftora</span>}
      </div>

      {image ? (
        <div className="toolbar__form toolbar__form--image">
          {image.middle}
          {error && (
            <p className="toolbar__error" role="alert">
              <Icon name="alert" size={13} />
              {error}
            </p>
          )}
        </div>
      ) : (
      <form className="toolbar__form" onSubmit={submit} role="search" aria-label="Fetch media">
        <div className="toolbar__url">
          <label htmlFor="media-url" className="sr-only">
            Media link
          </label>
          <Icon name="link" size={14} className="toolbar__url-icon" />
          <input
            ref={inputRef}
            id="media-url"
            type="url"
            className="field mono"
            value={url}
            onChange={(e) => {
              setVerdict(null);
              onUrlChange(e.target.value);
            }}
            onPaste={(e) => {
              // A whole link pasted in place of the box's text is fetched at once: no Fetch click to wait for.
              const box = e.currentTarget;
              const link = e.clipboardData.getData("text").trim();
              const replacesAll = box.selectionStart === 0 && box.selectionEnd === box.value.length;
              if (fetching || !replacesAll || !/^https?:\/\/\S+$/i.test(link)) return;
              e.preventDefault();
              setVerdict(null);
              onFetch(link);
            }}
            placeholder="Paste a video or audio link"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "media-url-error" : undefined}
            spellCheck={false}
          />
        </div>
        {(canCheckSite || onSetUpSiteCheck) && (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={checking || (canCheckSite && !url.trim())}
            title={canCheckSite ? "Ask VirusTotal whether this link's website is safe" : "Add your free VirusTotal key in Settings to check links"}
            onClick={() => (canCheckSite ? void checkUrl() : onSetUpSiteCheck?.())}
          >
            <Icon name="shield" size={14} />
            {checking ? "Checking…" : "Check"}
          </button>
        )}
        <button type="submit" className="btn btn--secondary" disabled={fetching || !url.trim()}>
          {fetching ? "Fetching…" : "Fetch"}
        </button>
        {error ? (
          <p id="media-url-error" className="toolbar__error" role="alert">
            <Icon name="alert" size={13} />
            {error}
            {errorAction && (
              <button type="button" className="btn btn--primary" onClick={errorAction.onClick}>
                {errorAction.label}
              </button>
            )}
          </p>
        ) : (
          verdict && (
            <p className={`toolbar__error is-${verdict.tone}`} role={verdict.tone === "warn" ? "alert" : "status"}>
              <Icon name={verdict.tone === "ok" ? "check" : "alert"} size={13} />
              {verdict.text}
              {verdict.report && (
                <button type="button" className="btn btn--ghost" onClick={() => void openUrl(verdict.report!.reportUrl)}>
                  Full report
                </button>
              )}
              <button type="button" className="btn btn--icon" aria-label="Close" onClick={() => setVerdict(null)}>
                <Icon name="x" size={12} />
              </button>
            </p>
          )
        )}
      </form>
      )}

      <div className="toolbar__end">
        {update && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={update.onClick}
            disabled={!update.onClick}
            title="Install the new version and restart Craftora"
          >
            <Icon name="rotate" size={14} />
            {update.label}
          </button>
        )}
        {image?.end}
        {queue}
        {onExport && (
          <button type="button" className="btn btn--primary" onClick={onExport} title={image ? undefined : "Export this project (pick where it's going, then Add to queue)"}>
            <Icon name="film" size={14} />
            Export
          </button>
        )}
        {onImport && !image && (
          <button type="button" className="btn btn--secondary" onClick={onImport} disabled={fetching} title="Import files (Ctrl+O)">
            <Icon name="upload" size={14} />
            Import
          </button>
        )}
      </div>
    </header>
  );
}
