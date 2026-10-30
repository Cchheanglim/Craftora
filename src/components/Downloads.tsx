import { useEffect, useState } from "react";
import type { Job } from "../types";
import type { Queue } from "../state/useQueue";
import { errorText, listDownloads, revealFile, type DownloadedFile } from "../lib/engine";
import { PlayFile } from "./PlayFile";
import { formatSize } from "../project/exportPlan";
import { Icon } from "./Icon";
import { QueueRow } from "./QueueDock";
import { FileThumb } from "./Thumb";
import { HiddenFold, HideButton, useHidden } from "./Hidden";
import "./Library.css";

interface DownloadsProps {
  queue: Queue;
  /** Adds a downloaded file to the project open in the editor. */
  onAdd: (path: string) => void;
}

/** "Download for editing" and live recordings, as opposed to exports. */
const isDownload = (j: Job) => Boolean(j.prefetch || j.record);
const SOUND = /\.(mp3|m4a|wav|flac|opus|aac|ogg)$/i;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function Downloads({ queue, onAdd }: DownloadsProps) {
  const active = queue.jobs.filter((j) => isDownload(j) && j.status !== "finished");
  const finished = queue.jobs.filter((j) => isDownload(j) && j.status === "finished").length;
  const [folder, setFolder] = useState<{ folder: string; files: DownloadedFile[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const hidden = useHidden("downloads");
  const files = folder?.files.filter((f) => !hidden.isHidden(f.path)) ?? [];
  const hiddenFiles = folder?.files.filter((f) => hidden.isHidden(f.path)) ?? [];
  // The folder is the record of finished downloads (it outlives the queue): read it again whenever one finishes.
  useEffect(() => {
    listDownloads().then(setFolder, (err) => setProblem(errorText(err)));
  }, [finished]);

  const table = (list: DownloadedFile[]) => (
    <div className="library__table-wrap">
      <table className="library__table">
        <thead>
          <tr>
            <th scope="col">File</th>
            <th scope="col" className="is-num">
              Size
            </th>
            <th scope="col">Downloaded</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((file) => (
            <tr key={file.path}>
              <td>
                <span className="library__name">
                  <FileThumb path={file.path} icon={SOUND.test(file.name) ? "music" : "film"} play={!SOUND.test(file.name)} />
                  <span className="mono truncate" title={file.name}>
                    {file.name}
                  </span>
                </span>
              </td>
              <td className="mono is-num">{formatSize(file.sizeBytes / 1_000_000)}</td>
              <td className="library__detail">{dateFormat.format(file.modifiedMs)}</td>
              <td className="is-num">
                <span className="library__actions">
                  <HideButton hidden={hidden} id={file.path} name={file.name} />
                  <button type="button" className="btn btn--ghost" onClick={() => onAdd(file.path)}>
                    <Icon name="plus" size={14} />
                    Add to project
                  </button>
                  <PlayFile path={file.path} name={file.name} label />
                  <button type="button" className="btn btn--ghost" onClick={() => void revealFile(file.path)}>
                    <Icon name="folder" size={14} />
                    Show in folder
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="library" aria-labelledby="downloads-title">
      <header className="library__head">
        <h1 id="downloads-title">Downloads</h1>
        <p>Links downloaded to edit like files on this PC, and live recordings.</p>
        {folder && (
          <div className="library__save">
            <span>Saved in</span>
            <span className="mono truncate">{folder.folder}</span>
          </div>
        )}
      </header>

      <div className="library__group">
        <h2 className="section-label">In progress</h2>
        {active.length === 0 ? (
          <p className="library__muted">Nothing downloading. Fetch a link, then press ⬇ next to it in Media.</p>
        ) : (
          <div className="queue__list">
            <ul>
              {active.map((job) => (
                <QueueRow key={job.id} job={job} queue={queue} fresh={false} />
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="library__group">
        <h2 className="section-label">Finished</h2>
        {problem ? (
          <p className="library__muted">{problem}</p>
        ) : folder && folder.files.length === 0 ? (
          <p className="library__muted">No finished downloads yet.</p>
        ) : folder && files.length === 0 ? (
          <p className="library__muted">Every download is hidden.</p>
        ) : (
          folder && (
            table(files)
          )
        )}
      </div>
      <HiddenFold count={hiddenFiles.length} note="Hidden from this list only. The files are still in your Downloads folder.">
        {table(hiddenFiles)}
      </HiddenFold>
    </section>
  );
}
