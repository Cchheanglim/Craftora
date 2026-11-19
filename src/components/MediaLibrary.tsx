import { useState, type ReactNode } from "react";
import type { LibraryEntry } from "../lib/storage";
import { formatClock } from "../lib/timecode";
import { Icon } from "./Icon";
import { FileThumb } from "./Thumb";
import { useConfirm } from "./ConfirmDialog";
import { HiddenFold, useHidden } from "./Hidden";
import { PageSearch, PageTabs, PictureAction, PictureCard } from "./PictureCard";
import "./Library.css";
import "./MediaLibrary.css";

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
  /** Imports new files into the library / project. */
  onImport?: () => void;
}

type Filter = "all" | "video" | "image" | "audio" | "gif" | "saved";

const FILTERS: { id: Filter; label: ReactNode }[] = [
  { id: "all", label: "All" },
  { id: "video", label: "Videos" },
  { id: "image", label: "Pictures" },
  { id: "audio", label: "Sound" },
  { id: "gif", label: "GIFs" },
  {
    id: "saved",
    label: (
      <>
        <Icon name="star" size={14} />
        Saved
      </>
    ),
  },
];

const KIND_LABEL: Record<LibraryEntry["kind"], string> = {
  video: "Video",
  image: "Picture",
  audio: "Sound",
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function MediaLibrary({ entries, onAdd, onSave, onThumbnail, onForget, onImport }: MediaLibraryProps) {
  const { ask, dialog } = useConfirm();
  const forget = async (entry: LibraryEntry) => {
    const ok = await ask({
      title: `Remove “${entry.name}” from the list?`,
      message: "It leaves the Media library (and Saved, if it's starred). The file itself stays on your PC, and it comes back here if you import it again.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) onForget(entry.path);
  };
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const words = search.trim().toLowerCase();
  const hidden = useHidden("media");
  const matching = entries.filter(
    (e) =>
      (filter === "all" ||
        (filter === "saved" ? e.saved : filter === "gif" ? Boolean(e.animated) : filter === "image" ? e.kind === "image" && !e.animated : e.kind === filter)) &&
      (!words || e.name.toLowerCase().includes(words)),
  );
  const shown = matching.filter((e) => !hidden.isHidden(e.path));
  const hiddenShown = matching.filter((e) => hidden.isHidden(e.path));

  const renderCard = (entry: LibraryEntry, actions: ReactNode) => (
    <PictureCard
      key={entry.path}
      thumb={
        <FileThumb
          path={entry.path}
          src={entry.thumbnail}
          image={entry.kind === "image"}
          icon={entry.kind === "image" ? "image" : entry.kind === "audio" ? "music" : "film"}
          onMade={(thumbnail) => onThumbnail(entry.path, thumbnail)}
          play={entry.kind === "video"}
        />
      }
      tag={entry.animated ? "GIF" : KIND_LABEL[entry.kind]}
      badge={entry.kind !== "image" && entry.duration > 0 ? formatClock(entry.duration) : undefined}
      name={entry.name}
      meta={`Imported ${dateFormat.format(entry.addedAt)}`}
      onOpen={() => onAdd(entry.path)}
      actions={actions}
    />
  );

  return (
    <section className="pc-page" aria-labelledby="media-library-title">
      {dialog}
      <header className="pc-head">
        <div>
          <h1 id="media-library-title">Media library</h1>
          <p>Videos, pictures and sounds you've imported or fetched.</p>
        </div>
        {onImport && (
          <div className="pc-head__actions">
            <button type="button" className="btn btn--primary" onClick={onImport}>
              <Icon name="upload" size={14} />
              Import files
            </button>
          </div>
        )}
      </header>

      <div className="media-library__list">
        <div className="pc-bar">
          <div className="pc-bar__start">
            <PageTabs tabs={FILTERS} value={filter} onChange={setFilter} label="Show" />
          </div>
          <div className="pc-bar__end">
            <PageSearch id="media-search" value={search} onChange={setSearch} placeholder="Search by file name" />
          </div>
        </div>

        {filter === "gif" && !entries.some((e) => e.animated) ? (
          <p className="pc-muted">No GIFs yet. Import a GIF and it shows up here and in the editor's GIFs tab.</p>
        ) : entries.length === 0 ? (
          <p className="pc-muted">Files you import into a project show up here, so you can find them again.</p>
        ) : shown.length === 0 ? (
          <p className="pc-muted">{hiddenShown.length ? "Everything here is hidden." : "Nothing matches."}</p>
        ) : (
          <ul className="pc-grid is-5">
            {shown.map((entry) =>
              renderCard(
                entry,
                <>
                  <PictureAction
                    icon="star"
                    label={entry.saved ? "Remove from Saved" : "Save it"}
                    on={Boolean(entry.saved)}
                    onClick={() => onSave(entry.path, !entry.saved)}
                  />
                  <PictureAction icon="eyeOff" label={`Hide ${entry.name}`} onClick={() => hidden.setHidden([entry.path], true)} />
                  <PictureAction icon="trash" label={`Remove ${entry.name} from the library`} onClick={() => void forget(entry)} />
                </>,
              ),
            )}
          </ul>
        )}
      </div>

      <HiddenFold count={hiddenShown.length} note="Hidden from this list only. The files stay on your PC and in your projects.">
        <ul className="pc-grid is-5">
          {hiddenShown.map((entry) =>
            renderCard(entry, <PictureAction icon="eye" label={`Unhide ${entry.name}`} onClick={() => hidden.setHidden([entry.path], false)} />),
          )}
        </ul>
      </HiddenFold>
    </section>
  );
}
