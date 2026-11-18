import { useEffect, useState } from "react";
import type { Job } from "../types";
import { folded, type Queue } from "../state/useQueue";
import { deleteFile, errorText, listDownloads, openFile, revealFile, type DownloadedFile } from "../lib/engine";
import { formatSize } from "../project/exportPlan";
import { Icon } from "./Icon";
import { QueueRow } from "./QueueDock";
import { FileThumb } from "./Thumb";
import { formatWhen } from "../lib/timecode";
import { HiddenFold, useHidden } from "./Hidden";
import { useConfirm } from "./ConfirmDialog";
import { PictureAction, PictureCard } from "./PictureCard";
import "./Library.css";

interface DownloadsProps {
  queue: Queue;
  /** Where downloads are saved now: the list is read again when it changes. */
  folderPath: string;
  /** Picks the downloads folder; absent in the browser preview. */
  onChooseFolder?: () => void;
  /** Adds a downloaded file to the project open in the editor. */
  onAdd: (path: string) => void;
}

/** "Download for editing" and live recordings, as opposed to exports. */
const isDownload = (j: Job) => Boolean(j.prefetch || j.record);
const SOUND = /\.(mp3|m4a|wav|flac|opus|aac|ogg)$/i;

export function Downloads({ queue, folderPath, onChooseFolder, onAdd }: DownloadsProps) {
  // An export's own video download shows with the export instead.
  const downloads = queue.jobs.filter((j) => isDownload(j) && !folded(j, queue.jobs));
  const active = downloads.filter((j) => j.status !== "finished");
  const finished = downloads.filter((j) => j.status === "finished").length;
  const [folder, setFolder] = useState<{ folder: string; files: DownloadedFile[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Per file: why Play didn't work (most often the file was moved or deleted).
  const [playProblems, setPlayProblems] = useState<Record<string, string>>({});
  const { ask, dialog } = useConfirm();
  const remove = async (file: DownloadedFile) => {
    const ok = await ask({
      title: `Delete “${file.name}”?`,
      message: "The file moves to the Recycle Bin. Projects that use it show it as missing until you put it back.",
      note: "Craftora can't undo this, but you can restore the file from the Recycle Bin.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setDeleteError(null);
    try {
      await deleteFile(file.path);
      setFolder((f) => f && { ...f, files: f.files.filter((x) => x.path !== file.path) });
    } catch (err) {
      setDeleteError(errorText(err));
    }
  };
  const play = (path: string) =>
    void openFile(path).catch((err) => {
      const msg = errorText(err);
      setPlayProblems((prev) => ({ ...prev, [path]: /isn't there/i.test(msg) ? "Moved or deleted" : "Couldn't play" }));
    });
  const hidden = useHidden("downloads");
  const files = folder?.files.filter((f) => !hidden.isHidden(f.path)) ?? [];
  const hiddenFiles = folder?.files.filter((f) => hidden.isHidden(f.path)) ?? [];
  // The folder is the record of finished downloads (it outlives the queue): read it again whenever one finishes.
  useEffect(() => {
    const read = () => void listDownloads().then(setFolder, (err) => setProblem(errorText(err)));
    read();
    // Back from File Explorer, where a download may have been deleted.
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [finished, folderPath]);

  const renderCard = (file: DownloadedFile, isHidden: boolean) => {
    const sound = SOUND.test(file.name);
    return (
      <PictureCard
        key={file.path}
        thumb={<FileThumb path={file.path} icon={sound ? "music" : "film"} play={!sound} />}
        tag={sound ? "Sound" : "Video"}
        badge={formatSize(file.sizeBytes / 1_000_000)}
        name={file.name}
        meta={playProblems[file.path] ?? `Downloaded ${formatWhen(file.modifiedMs)}`}
        onOpen={() => onAdd(file.path)}
        actions={
          <>
            <PictureAction icon="play" label={`Play ${file.name}`} onClick={() => play(file.path)} />
            <PictureAction icon="folder" label={`Show ${file.name} in folder`} onClick={() => void revealFile(file.path)} />
            <PictureAction
              icon={isHidden ? "eye" : "eyeOff"}
              label={`${isHidden ? "Unhide" : "Hide"} ${file.name}`}
              onClick={() => hidden.setHidden([file.path], !isHidden)}
            />
            <PictureAction icon="trash" label={`Delete ${file.name}`} onClick={() => void remove(file)} />
          </>
        }
      />
    );
  };

  return (
    <section className="pc-page" aria-labelledby="downloads-title">
      {dialog}
      <header className="pc-head">
        <div>
          <h1 id="downloads-title">Downloads</h1>
          <p>Links downloaded to edit like files on this PC, and live recordings. Click one to add it to your project.</p>
        </div>
        {folder && (
          <div className="pc-head__actions">
            <button type="button" className="btn btn--secondary" onClick={() => void revealFile(folder.folder)}>
              <Icon name="folder" size={14} />
              Open folder
            </button>
          </div>
        )}
      </header>

      <section className="library__group" aria-labelledby="downloads-progress">
        <div className="pc-bar">
          <div className="pc-bar__start">
            <h2 id="downloads-progress">In progress</h2>
          </div>
        </div>
        {active.length === 0 ? (
          <p className="pc-muted">Nothing downloading. Fetch a link, then press ⬇ next to it under In this project.</p>
        ) : (
          <div className="queue__list">
            <ul>
              {active.map((job) => (
                <QueueRow key={job.id} job={job} queue={queue} fresh={false} />
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="library__group" aria-labelledby="downloads-finished">
        <div className="pc-bar">
          <div className="pc-bar__start">
            <h2 id="downloads-finished">Finished</h2>
          </div>
          {folder && (
            <div className="pc-bar__end">
              <span className="truncate">
                Saving to <span className="mono">{folder.folder}</span>
              </span>
              {onChooseFolder && (
                <button type="button" className="btn btn--ghost" onClick={onChooseFolder}>
                  Change
                </button>
              )}
            </div>
          )}
        </div>
        {deleteError && (
          <p className="pc-muted" role="alert">
            {deleteError}
          </p>
        )}
        {problem ? (
          <p className="pc-muted">{problem}</p>
        ) : folder && folder.files.length === 0 ? (
          <p className="pc-muted">No finished downloads yet.</p>
        ) : folder && files.length === 0 ? (
          <p className="pc-muted">Every download is hidden.</p>
        ) : (
          folder && <ul className="pc-grid">{files.map((f) => renderCard(f, false))}</ul>
        )}
      </section>
      <HiddenFold count={hiddenFiles.length} note="Hidden from this list only. The files are still in your Downloads folder.">
        <ul className="pc-grid">{hiddenFiles.map((f) => renderCard(f, true))}</ul>
      </HiddenFold>
    </section>
  );
}
