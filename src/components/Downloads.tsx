import { useEffect, useState } from "react";
import type { Job } from "../types";
import type { Queue } from "../state/useQueue";
import { listDownloads, openFile, revealFile, type DownloadedFile } from "../lib/engine";
import { formatSize } from "../project/exportPlan";
import { Icon } from "./Icon";
import { QueueRow } from "./QueueDock";
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
  // The folder is the record of finished downloads (it outlives the queue): read it again whenever one finishes.
  useEffect(() => {
    listDownloads().then(setFolder, (err) => setProblem(String(err)));
  }, [finished]);

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
        ) : (
          folder && (
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
                  {folder.files.map((file) => (
                    <tr key={file.path}>
                      <td>
                        <span className="library__name">
                          <Icon name={SOUND.test(file.name) ? "music" : "film"} size={14} />
                          <span className="mono truncate" title={file.name}>
                            {file.name}
                          </span>
                        </span>
                      </td>
                      <td className="mono is-num">{formatSize(file.sizeBytes / 1_000_000)}</td>
                      <td className="library__detail">{dateFormat.format(file.modifiedMs)}</td>
                      <td className="is-num">
                        <span className="library__actions">
                          <button type="button" className="btn btn--ghost" onClick={() => onAdd(file.path)}>
                            <Icon name="plus" size={14} />
                            Add to project
                          </button>
                          <button type="button" className="btn btn--ghost" onClick={() => void openFile(file.path)}>
                            <Icon name="play" size={14} />
                            Play
                          </button>
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
          )
        )}
      </div>
    </section>
  );
}
