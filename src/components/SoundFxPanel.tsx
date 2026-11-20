import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { errorText, playableFile } from "../lib/engine";
import type { LibraryEntry } from "../lib/storage";
import { formatClock } from "../lib/timecode";
import { ContextMenu } from "./ContextMenu";
import { GifLinkBox } from "./GifLinkBox";
import { Icon } from "./Icon";
import "./FxPanel.css";
import "./GifPanel.css";
import "./SoundFxPanel.css";

export interface SoundFxPanelProps {
  entries: LibraryEntry[];
  onAdd: (path: string) => void;
  onDrag: (path: string, e: ReactPointerEvent) => void;
  onImport: () => void;
  onDownload: (url: string) => Promise<void>;
  onForget: (path: string) => void;
}

/** The editor's Sound FX tab: the user's own meme sounds and effects, like the GIFs tab (`data-sound-fx` takes drops). */
export function SoundFxPanel({ entries, onAdd, onDrag, onImport, onDownload, onForget }: SoundFxPanelProps) {
  const [rawQuery, setQuery] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; entry: LibraryEntry } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const query = rawQuery.trim().toLowerCase();
  const matching = entries.filter((e) => !query || e.name.toLowerCase().includes(query));

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  };
  useEffect(() => () => audio.current?.pause(), []);
  const play = async (path: string) => {
    const was = playing;
    stop();
    if (was === path) return;
    setPlayError(null);
    try {
      const el = new Audio(await playableFile(path));
      audio.current = el;
      el.onended = () => audio.current === el && stop();
      setPlaying(path);
      await el.play();
    } catch (err) {
      stop();
      setPlayError(errorText(err));
    }
  };

  const addRow = (
    <>
      <GifLinkBox onDownload={onDownload} label="Paste a sound link" />
      <button type="button" className="btn btn--secondary gif-panel__import" onClick={onImport}>
        <Icon name="upload" size={14} />
        Import sounds
      </button>
    </>
  );

  if (entries.length === 0) {
    return (
      <section className="fx-panel gif-panel is-empty" aria-label="Sound FX" data-sound-fx>
        <div className="gif-panel__empty">
          <Icon name="waveform" size={28} />
          <p className="fx-panel__hint">You don't have any sounds yet. Import some, paste a link to a sound file, or drag them in from File Explorer.</p>
          {addRow}
        </div>
      </section>
    );
  }

  return (
    <section className="fx-panel gif-panel" aria-label="Sound FX" data-sound-fx>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.entry.name}
          onClose={() => setMenu(null)}
          items={[{ label: "Remove from Sound FX", icon: "trash", danger: true, onClick: () => onForget(menu.entry.path) }]}
        />
      )}
      <p className="fx-panel__hint">Click a sound to add it at the playhead, or drag it onto the timeline.</p>
      <input
        type="search"
        className="field fx-panel__search"
        placeholder="Search sounds"
        aria-label="Search sounds"
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
      {playError && (
        <p className="gif-link-box__error" role="alert">
          {playError}
        </p>
      )}
      {matching.length > 0 ? (
        <div className="fx__grid">
          {matching.map((entry) => (
            <div
              key={entry.path}
              role="button"
              tabIndex={0}
              className={playing === entry.path ? "fx-tile sound-fx__tile is-playing" : "fx-tile sound-fx__tile"}
              onPointerDown={(e) => {
                if (e.button === 0 && !(e.target as HTMLElement).closest(".sound-fx__play")) onDrag(entry.path, e);
              }}
              onClick={() => onAdd(entry.path)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onAdd(entry.path);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, entry });
              }}
            >
              <span className="fx-tile__stage">
                <Icon name="waveform" size={26} />
                <span className="sound-fx__length mono">{formatClock(entry.duration)}</span>
                <button
                  type="button"
                  className="btn btn--icon sound-fx__play"
                  aria-label={playing === entry.path ? `Stop ${entry.name}` : `Play ${entry.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void play(entry.path);
                  }}
                >
                  <Icon name={playing === entry.path ? "stop" : "play"} size={12} />
                </button>
              </span>
              <span className="fx-tile__name">{entry.name}</span>
              <span className="fx-tile__add" aria-hidden="true">
                <Icon name="plus" size={14} />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="fx-panel__hint">No sounds match</p>
      )}
      {addRow}
    </section>
  );
}
