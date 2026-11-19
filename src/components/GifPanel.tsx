import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { inDesktopApp, playableFile } from "../lib/engine";
import type { LibraryEntry } from "../lib/storage";
import { ContextMenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { Mascot } from "./Mascot";
import "./FxPanel.css";
import "./GifPanel.css";

export interface GifPanelProps {
  entries: LibraryEntry[];
  onAdd: (path: string) => void;
  onDrag: (path: string, e: ReactPointerEvent) => void;
  onImport: () => void;
  onForget: (path: string) => void;
}

function GifImage({ path, fallback }: { path: string; fallback?: string }) {
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
    <img src={src} alt="" draggable={false} onError={() => fallback && src !== fallback && setSrc(fallback)} />
  ) : (
    <Icon name="gif" size={20} />
  );
}

export function GifPanel({ entries, onAdd, onDrag, onImport, onForget }: GifPanelProps) {
  const [rawQuery, setQuery] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; entry: LibraryEntry } | null>(null);
  const query = rawQuery.trim().toLowerCase();
  const matching = entries.filter((e) => !query || e.name.toLowerCase().includes(query));

  if (entries.length === 0) {
    return (
      <section className="fx-panel gif-panel is-empty" aria-label="GIFs">
        <div className="gif-panel__empty">
          <Mascot say="You don't have any GIFs yet." />
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
      <button type="button" className="btn btn--secondary gif-panel__import" onClick={onImport}>
        <Icon name="upload" size={14} />
        Import GIFs
      </button>
    </section>
  );
}
