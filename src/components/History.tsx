import { useState } from "react";
import type { FetchEntry } from "../lib/storage";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";
import { useConfirm } from "./ConfirmDialog";
import "./Library.css";

interface HistoryProps {
  /** Links fetched, newest first. */
  history: FetchEntry[];
  /** Fetches the link again into the open project. */
  onFetchAgain: (url: string) => void;
  /** Takes these links off History. */
  onRemove: (urls: string[]) => void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Every link fetched: the video's title, the link itself, to fetch again, copy or remove. */
export function History({ history, onFetchAgain, onRemove }: HistoryProps) {
  const [search, setSearch] = useState("");
  // Links ticked while picking several; null when not picking.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();
  const words = search.trim().toLowerCase();
  const shown = history.filter((e) => !words || e.title.toLowerCase().includes(words) || e.url.toLowerCase().includes(words));

  const toggle = (url: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(url)) next.add(url);
      return next;
    });
  const remove = async (urls: string[], all = false) => {
    const n = urls.length;
    const ok = await ask({
      title: all ? "Clear history?" : n === 1 ? "Remove from history?" : `Remove ${n} links from history?`,
      message: all
        ? "Every link in History is removed for good. Your projects, media and exports aren't touched."
        : `${n === 1 ? "It leaves" : "They leave"} History for good. Projects that use ${n === 1 ? "it aren't" : "them aren't"} touched.`,
      confirmLabel: all ? "Clear history" : "Remove",
      danger: true,
    });
    if (!ok) return;
    onRemove(urls);
    setPicked(null);
  };
  const copy = (url: string) =>
    void navigator.clipboard.writeText(url).then(
      () => {
        setCopied(url);
        window.setTimeout(() => setCopied((c) => (c === url ? null : c)), 1600);
      },
      () => {},
    );
  const ticked = shown.filter((e) => picked?.has(e.url)).map((e) => e.url);

  return (
    <section className="library" aria-labelledby="history-page-title">
      {dialog}
      <header className="library__head">
        <h1 id="history-page-title">History</h1>
        <p>Every link you've fetched, newest first: fetch one again, copy its link, or clear them.</p>
      </header>

      {history.length > 0 && (
        <div className="library__tools">
          <label htmlFor="history-search" className="sr-only">
            Search by title or link
          </label>
          <input
            id="history-search"
            className="field"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or link"
            spellCheck={false}
          />
          {picked ? (
            <div className="library__bar">
              <span className="library__count">{ticked.length} selected</span>
              <button type="button" className="btn btn--ghost" onClick={() => setPicked(new Set(shown.map((e) => e.url)))}>
                Select all
              </button>
              <button type="button" className="btn btn--secondary" disabled={ticked.length === 0} onClick={() => void remove(ticked)}>
                <Icon name="trash" size={14} />
                Remove
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setPicked(null)}>
                Done
              </button>
            </div>
          ) : (
            <div className="library__bar">
              <button type="button" className="btn btn--ghost" onClick={() => setPicked(new Set())}>
                <Icon name="check" size={14} />
                Select
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => void remove(history.map((e) => e.url), true)}>
                <Icon name="trash" size={14} />
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

      {history.length === 0 ? (
        <p className="library__muted">Links you fetch show up here, so you can find them again.</p>
      ) : shown.length === 0 ? (
        <p className="library__muted">Nothing matches.</p>
      ) : (
        <div className="library__table-wrap">
          <table className="library__table">
            <thead>
              <tr>
                <th scope="col">Video</th>
                <th scope="col">Fetched</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.url}>
                  <td>
                    <span className="library__name">
                      {picked && (
                        <input type="checkbox" checked={picked.has(entry.url)} onChange={() => toggle(entry.url)} aria-label={`Select ${entry.title}`} />
                      )}
                      <Thumb src={entry.thumbnail} icon="link" />
                      <span className="library__entry">
                        <span className="truncate" title={entry.title}>
                          {entry.title}
                        </span>
                        <span className="library__link mono" title={entry.url}>
                          {entry.url}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="library__detail">{dateFormat.format(entry.fetchedAt)}</td>
                  <td className="is-num">
                    <span className="library__actions">
                      <button type="button" className="btn btn--ghost" onClick={() => onFetchAgain(entry.url)}>
                        <Icon name="rotate" size={14} />
                        Fetch again
                      </button>
                      <button
                        type="button"
                        className="btn btn--icon"
                        aria-label={copied === entry.url ? "Link copied" : `Copy the link of ${entry.title}`}
                        title={copied === entry.url ? "Copied" : "Copy link"}
                        onClick={() => copy(entry.url)}
                      >
                        <Icon name={copied === entry.url ? "check" : "copy"} size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn--icon"
                        aria-label={`Remove ${entry.title} from history`}
                        title="Remove from history"
                        onClick={() => void remove([entry.url])}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
