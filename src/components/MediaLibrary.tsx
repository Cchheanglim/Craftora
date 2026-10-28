import { useState } from "react";
import type { LibraryEntry } from "../lib/storage";
import { formatClock } from "../lib/timecode";
import { Icon } from "./Icon";
import { FileThumb } from "./Thumb";
import "./Library.css";

interface MediaLibraryProps {
  /** Every file imported into a project, newest first. */
  entries: LibraryEntry[];
  /** Adds the file to the project open in the editor. */
  onAdd: (path: string) => void;
  onSave: (path: string, saved: boolean) => void;
  /** Keeps a picture made from the file, so it's made once. */
  onThumbnail: (path: string, thumbnail: string) => void;
  /** Takes it off this list; the file isn't touched. */
  onForget: (path: string) => void;
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "video", label: "Videos" },
  { id: "audio", label: "Sound" },
  { id: "image", label: "Pictures" },
  { id: "saved", label: "★ Saved" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function MediaLibrary({ entries, onAdd, onSave, onThumbnail, onForget }: MediaLibraryProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const words = search.trim().toLowerCase();
  const shown = entries.filter(
    (e) => (filter === "all" || (filter === "saved" ? e.saved : e.kind === filter)) && (!words || e.name.toLowerCase().includes(words)),
  );

  return (
    <section className="library" aria-labelledby="media-library-title">
      <header className="library__head">
        <h1 id="media-library-title">Media library</h1>
        <p>Every file you've imported, in any project. Star the ones you use often.</p>
      </header>

      <div className="library__tools">
        <label htmlFor="media-search" className="sr-only">
          Search by file name
        </label>
        <input
          id="media-search"
          className="field"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by file name"
          spellCheck={false}
        />
        <div className="segmented" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="library__muted">Files you import into a project show up here, so you can find them again.</p>
      ) : shown.length === 0 ? (
        <p className="library__muted">Nothing matches.</p>
      ) : (
        <div className="library__table-wrap">
          <table className="library__table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col" className="is-num">
                  Length
                </th>
                <th scope="col">Imported</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.path}>
                  <td>
                    <span className="library__name">
                      <FileThumb
                        path={entry.path}
                        src={entry.thumbnail}
                        image={entry.kind === "image"}
                        icon={entry.kind === "image" ? "image" : entry.kind === "audio" ? "music" : "film"}
                        onMade={(thumbnail) => onThumbnail(entry.path, thumbnail)}
                      />
                      <span className="mono truncate" title={entry.path}>
                        {entry.name}
                      </span>
                    </span>
                  </td>
                  <td className="mono is-num">{entry.kind === "image" ? "Picture" : formatClock(entry.duration)}</td>
                  <td className="library__detail">{dateFormat.format(entry.addedAt)}</td>
                  <td className="is-num">
                    <span className="library__actions">
                      <button
                        type="button"
                        className={entry.saved ? "btn btn--icon is-on" : "btn btn--icon"}
                        aria-pressed={Boolean(entry.saved)}
                        aria-label={`${entry.saved ? "Unstar" : "Star"} ${entry.name}`}
                        title={entry.saved ? "Remove from Saved" : "Save it (shown under ★ Saved)"}
                        onClick={() => onSave(entry.path, !entry.saved)}
                      >
                        <Icon name="star" size={14} />
                      </button>
                      <button type="button" className="btn btn--ghost" onClick={() => onAdd(entry.path)}>
                        <Icon name="plus" size={14} />
                        Add to project
                      </button>
                      <button
                        type="button"
                        className="btn btn--icon"
                        aria-label={`Remove ${entry.name} from the list`}
                        title="Remove from this list (the file stays)"
                        onClick={() => onForget(entry.path)}
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
