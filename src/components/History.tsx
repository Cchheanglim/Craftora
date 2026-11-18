import { useState } from "react";
import type { FetchEntry } from "../lib/storage";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";
import { hoverVideo, inDesktopApp } from "../lib/engine";
import { formatWhen } from "../lib/timecode";
import { useConfirm } from "./ConfirmDialog";
import { HiddenFold, useHidden } from "./Hidden";
import { PageSearch, PictureAction, PictureCard } from "./PictureCard";
import "./Projects.css";

interface HistoryProps {
  /** Links fetched, newest first. */
  history: FetchEntry[];
  /** Fetches the link again into the open project. */
  onFetchAgain: (url: string) => void;
  /** Takes these links off History. */
  onRemove: (urls: string[]) => void;
}

/** "youtube.com" from a link; the link itself when it isn't one. */
function site(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Every link fetched: the video's title and its site; a click fetches it again; copy, hide or remove. */
export function History({ history, onFetchAgain, onRemove }: HistoryProps) {
  const [search, setSearch] = useState("");
  // Links ticked while picking several; null when not picking.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();
  const words = search.trim().toLowerCase();
  const hidden = useHidden("history");
  const matching = history.filter((e) => !words || e.title.toLowerCase().includes(words) || e.url.toLowerCase().includes(words));
  const shown = matching.filter((e) => !hidden.isHidden(e.url));
  const hiddenShown = matching.filter((e) => hidden.isHidden(e.url));

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

  const renderCard = (entry: FetchEntry, isHidden: boolean) => (
    <PictureCard
      key={entry.url}
      thumb={<Thumb src={entry.thumbnail} icon="link" play={inDesktopApp ? () => hoverVideo(entry.url) : undefined} />}
      tag={site(entry.url)}
      name={entry.title}
      meta={copied === entry.url ? "Link copied" : `Fetched ${formatWhen(entry.fetchedAt)}`}
      onOpen={() => onFetchAgain(entry.url)}
      picked={!isHidden && picked ? picked.has(entry.url) : undefined}
      onPick={!isHidden && picked ? () => toggle(entry.url) : undefined}
      actions={
        <>
          <PictureAction icon={copied === entry.url ? "check" : "copy"} label={`Copy the link of ${entry.title}`} onClick={() => copy(entry.url)} />
          <PictureAction
            icon={isHidden ? "eye" : "eyeOff"}
            label={`${isHidden ? "Unhide" : "Hide"} ${entry.title}`}
            onClick={() => hidden.setHidden([entry.url], !isHidden)}
          />
          <PictureAction icon="trash" label={`Remove ${entry.title} from history`} onClick={() => void remove([entry.url])} />
        </>
      }
    />
  );

  return (
    <section className="pc-page" aria-labelledby="history-page-title">
      {dialog}
      <header className="pc-head">
        <div>
          <h1 id="history-page-title">History</h1>
          <p>Every link you've fetched, newest first. Click one to fetch it again.</p>
        </div>
        {history.length > 0 && (
          <div className="pc-head__actions">
            {picked ? (
              <>
                <span className="projects__count">{ticked.length} selected</span>
                <button type="button" className="btn btn--ghost" onClick={() => setPicked(new Set(shown.map((e) => e.url)))}>
                  Select all
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={ticked.length === 0}
                  onClick={() => {
                    hidden.setHidden(ticked, true);
                    setPicked(null);
                  }}
                >
                  <Icon name="eyeOff" size={14} />
                  Hide
                </button>
                <button type="button" className="btn btn--secondary" disabled={ticked.length === 0} onClick={() => void remove(ticked)}>
                  <Icon name="trash" size={14} />
                  Remove
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setPicked(null)}>
                  Done
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn--secondary" onClick={() => setPicked(new Set())}>
                  <Icon name="check" size={14} />
                  Select
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => void remove(history.map((e) => e.url), true)}>
                  <Icon name="trash" size={14} />
                  Clear all
                </button>
              </>
            )}
          </div>
        )}
      </header>

      <div className="projects__list">
        <div className="pc-bar">
          <div className="pc-bar__start">
            <h2>Links</h2>
          </div>
          <div className="pc-bar__end">
            <PageSearch id="history-search" value={search} onChange={setSearch} placeholder="Search by title or link" />
          </div>
        </div>

        {history.length === 0 ? (
          <p className="pc-muted">Links you fetch show up here, so you can find them again.</p>
        ) : shown.length === 0 ? (
          <p className="pc-muted">{hiddenShown.length ? "Everything here is hidden." : "Nothing matches."}</p>
        ) : (
          <ul className="pc-grid">{shown.map((e) => renderCard(e, false))}</ul>
        )}
      </div>

      <HiddenFold count={hiddenShown.length} note="Hidden from this list only. They're still in your history.">
        <ul className="pc-grid">{hiddenShown.map((e) => renderCard(e, true))}</ul>
      </HiddenFold>
    </section>
  );
}
