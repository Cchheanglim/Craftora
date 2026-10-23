import type { FormEvent, RefObject } from "react";
import { Icon } from "./Icon";
import "./Toolbar.css";

interface ToolbarProps {
  url: string;
  onUrlChange: (url: string) => void;
  onFetch: (url: string) => void;
  fetching: boolean;
  error: string | null;
  /** A short note under the link box, such as VirusTotal's verdict on the website. */
  notice?: { tone: "ok" | "info" | "warn"; text: string } | null;
  /** A button next to the error, such as "Sign in to youtube.com". */
  errorAction?: { label: string; onClick: () => void };
  /** Imports files from this PC; absent in the browser preview. */
  onImport?: () => void;
  /** Lets Home's "Paste a link" focus the field. */
  inputRef: RefObject<HTMLInputElement | null>;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  /** Absent where there is no right panel (Home, Exports). */
  onToggleRight?: () => void;
  /** A newer version: a button to install it, or its progress (no `onClick`) while installing. */
  update?: { label: string; onClick?: () => void };
}

export function Toolbar({
  url,
  onUrlChange,
  onFetch,
  fetching,
  error,
  notice,
  errorAction,
  onImport,
  inputRef,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
  update,
}: ToolbarProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) onFetch(url.trim());
  };


  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <button
          type="button"
          className="btn btn--icon"
          aria-label={leftOpen ? "Collapse the left panel" : "Expand the left panel"}
          aria-pressed={leftOpen}
          title="Left panel (Ctrl+B)"
          onClick={onToggleLeft}
        >
          <Icon name="panelLeft" />
        </button>
        <img src="/craftora.svg" width={22} height={22} alt="" className="toolbar__logo" />
        <span>Craftora</span>
      </div>

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
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="Paste a video or audio link"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "media-url-error" : undefined}
            spellCheck={false}
          />
        </div>
        <button type="submit" className="btn btn--secondary" disabled={fetching || !url.trim()}>
          {fetching ? "Fetching…" : "Fetch"}
        </button>
        {(error || notice) && (
          <div className="toolbar__notes">
            {error && (
              <p id="media-url-error" className="toolbar__error" role="alert">
                <Icon name="alert" size={13} />
                {error}
                {errorAction && (
                  <button type="button" className="btn btn--primary" onClick={errorAction.onClick}>
                    {errorAction.label}
                  </button>
                )}
              </p>
            )}
            {notice && (
              <p className={`toolbar__error toolbar__note is-${notice.tone}`} role={notice.tone === "warn" ? "alert" : "status"}>
                <Icon name={notice.tone === "ok" ? "check" : "alert"} size={13} />
                {notice.text}
              </p>
            )}
          </div>
        )}
      </form>

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
        {onImport && (
          <button type="button" className="btn btn--secondary" onClick={onImport} disabled={fetching} title="Import files (Ctrl+O)">
            <Icon name="upload" size={14} />
            Import
          </button>
        )}
        {onToggleRight && (
          <button
            type="button"
            className="btn btn--icon"
            aria-label={rightOpen ? "Collapse the right panel" : "Expand the right panel"}
            aria-pressed={rightOpen}
            title="Right panel (Ctrl+Alt+B)"
            onClick={onToggleRight}
          >
            <Icon name="panelRight" />
          </button>
        )}
      </div>
    </header>
  );
}
