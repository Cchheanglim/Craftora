import { useState, type FormEvent, type RefObject } from "react";
import { Icon } from "./Icon";
import "./Toolbar.css";

interface ToolbarProps {
  url: string;
  onUrlChange: (url: string) => void;
  onFetch: (url: string) => void;
  fetching: boolean;
  /** What happens after fetching; absent in the browser preview. */
  afterFetch?: "edit" | "download";
  onAfterFetchChange: (choice: "edit" | "download") => void;
  error: string | null;
  /** Links offered as suggestions in the URL field. */
  suggestions: { url: string; title: string }[];
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
  afterFetch,
  onAfterFetchChange,
  error,
  suggestions,
  onImport,
  inputRef,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
  update,
}: ToolbarProps) {
  const [pasteFailed, setPasteFailed] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) onFetch(url.trim());
  };

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return;
      onUrlChange(text);
      onFetch(text);
      setPasteFailed(false);
    } catch {
      setPasteFailed(true);
    }
  };

  const message = error ?? (pasteFailed ? "Couldn't read the clipboard. Paste with Ctrl+V instead." : null);

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
        <Icon name="logo" size={20} className="toolbar__logo" />
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
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? "media-url-error" : undefined}
            spellCheck={false}
            list="media-url-suggestions"
          />
          <datalist id="media-url-suggestions">
            {suggestions.map((s) => (
              <option key={s.url} value={s.url} label={s.title} />
            ))}
          </datalist>
        </div>
        <button type="button" className="btn btn--ghost" onClick={paste}>
          Paste
        </button>
        <button type="submit" className="btn btn--secondary" disabled={fetching || !url.trim()}>
          {fetching ? "Fetching…" : "Fetch"}
        </button>
        {afterFetch && (
          <>
            <label htmlFor="after-fetch" className="sr-only">
              After fetching
            </label>
            <select
              id="after-fetch"
              className="field toolbar__then"
              value={afterFetch}
              onChange={(e) => onAfterFetchChange(e.target.value as "edit" | "download")}
              title="Edit now: start editing right away; only the parts you use are downloaded when you export. Download first: the whole video is saved to Videos\Craftora\Downloads, then it edits like a file on this PC (smoother, works offline)."
            >
              <option value="edit">Then edit now</option>
              <option value="download">Then download first</option>
            </select>
          </>
        )}
        {message && (
          <p id="media-url-error" className="toolbar__error" role="alert">
            <Icon name="alert" size={13} />
            {message}
          </p>
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
