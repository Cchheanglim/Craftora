import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { inDesktopApp, playableFile } from "../lib/engine";
import { preference } from "../lib/preferences";
import type { LibraryEntry } from "../lib/storage";
import { ContextMenu } from "./ContextMenu";
import { GifLinkBox } from "./GifLinkBox";
import { Icon } from "./Icon";
import { Mascot } from "./Mascot";
import "./FxPanel.css";
import "./GifPanel.css";

export interface GifPanelProps {
  entries: LibraryEntry[];
  onAdd: (path: string) => void;
  onDrag: (path: string, e: ReactPointerEvent) => void;
  onImport: () => void;
  onDownload: (url: string) => Promise<void>;
  onForget: (path: string) => void;
}

/** A GIF file on this PC, moving (the `fallback` picture until it loads, or if it can't). */
export function GifImage({ path, fallback, className }: { path: string; fallback?: string; className?: string }) {
  const [src, setSrc] = useState<string | undefined>(fallback);
  useEffect(() => {
    setSrc(fallback);
    if (!inDesktopApp) return;
    let live = true;
    void playableFile(path)
      .then((url) => {
        if (live && url) setSrc(url);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [path, fallback]);

  return src ? (
    <img className={className} src={src} alt="" draggable={false} onError={() => fallback && src !== fallback && setSrc(fallback)} />
  ) : (
    <Icon name="gif" size={20} />
  );
}

export function GifPanel({ entries, onAdd, onDrag, onImport, onDownload, onForget }: GifPanelProps) {
  const [rawQuery, setQuery] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; entry: LibraryEntry } | null>(null);
  const query = rawQuery.trim().toLowerCase();
  const matching = entries.filter((e) => !query || e.name.toLowerCase().includes(query));

  if (entries.length === 0) {
    return (
      <section className="fx-panel gif-panel is-empty" aria-label="GIFs">
        <div className="gif-panel__empty">
          {preference("showCat") ? <Mascot say="You don't have any GIFs yet." /> : <p className="fx-panel__hint">You don't have any GIFs yet.</p>}
          <GifLinkBox onDownload={onDownload} />
          <button type="button" className="btn btn--secondary gif-panel__import" onClick={onImport}>
            <Icon name="upload" size={14} />
            Import GIFs
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="fx-panel gif-panel" aria-label="GIFs">
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.entry.name}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Remove from My GIFs",
              icon: "trash",
              danger: true,
              onClick: () => onForget(menu.entry.path),
            },
          ]}
        />
      )}
      <p className="fx-panel__hint">Click a GIF to add it at the playhead, or drag it onto the timeline.</p>
      <input
        type="search"
        className="field fx-panel__search"
        placeholder="Search GIFs"
        aria-label="Search GIFs"
        value={rawQuery}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setQuery("");
          }
        }}
      />
      {matching.length > 0 ? (
        <div className="fx__grid">
          {matching.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="fx-tile gif-panel__tile"
              title="Drag onto the timeline, or click to add at the playhead"
              onPointerDown={(e) => {
                if (e.button === 0) onDrag(entry.path, e);
              }}
              onClick={() => onAdd(entry.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, entry });
              }}
            >
              <span className="fx-tile__stage">
                <GifImage path={entry.path} fallback={entry.thumbnail} />
              </span>
              <span className="fx-tile__name">{entry.name}</span>
              <span className="fx-tile__add" aria-hidden="true">
                <Icon name="plus" size={14} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="fx-panel__hint">No GIFs match</p>
      )}
      {preference("showCat") && (
        <div className="gif-panel__mascot">
          <Mascot
            say={entries.length >= 4 ? ["Nice GIFs!", "Cool!", "Interesting GIFs"] : "Don't be shy, import more!"}
            cycle={10000}
            mood={entries.length >= 4 ? "excited" : "shy"}
          />
        </div>
      )}
      <GifLinkBox onDownload={onDownload} />
      <button type="button" className="btn btn--secondary gif-panel__import" onClick={onImport}>
        <Icon name="upload" size={14} />
        Import GIFs
      </button>
    </section>
  );
}
