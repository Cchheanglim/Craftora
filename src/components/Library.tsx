import type { Job } from "../types";
import { formatSize } from "../project/exportPlan";
import { revealFile } from "../lib/engine";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";
import "./Library.css";

interface LibraryProps {
  /** Finished exports, newest first. */
  jobs: Job[];
  outputDir: string;
  onOpenWorkspace: () => void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function Library({ jobs, outputDir, onOpenWorkspace }: LibraryProps) {
  const finished = jobs;

  return (
    <section className="library" aria-labelledby="library-title">
      <header className="library__head">
        <h1 id="library-title">Library</h1>
        <p>
          Everything Craftora has exported. New files are saved in <span className="mono">{outputDir}</span>.
        </p>
      </header>

      {finished.length === 0 ? (
        <div className="library__empty">
          <p>No finished files yet.</p>
          <button type="button" className="btn btn--secondary" onClick={onOpenWorkspace}>
            <Icon name="scissors" size={14} />
            Go to Workspace
          </button>
        </div>
      ) : (
        <div className="library__table-wrap">
          <table className="library__table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Details</th>
                <th scope="col" className="is-num">
                  Size
                </th>
                <th scope="col">Finished</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {finished.map((job) => (
                <tr key={job.id}>
                  <td>
                    <span className="library__name">
                      <Thumb src={job.thumbnail} icon={job.kind === "audio" ? "music" : "film"} />
                      <span className="mono truncate">{job.outputPath?.split(/[\\/]/).pop() ?? job.fileName}</span>
                    </span>
                  </td>
                  <td className="library__detail">{job.summary}</td>
                  <td className="mono is-num">{formatSize(job.sizeMb)}</td>
                  <td className="library__detail">{job.finishedAt ? dateFormat.format(job.finishedAt) : ""}</td>
                  <td className="is-num">
                    {job.outputPath && (
                      <button type="button" className="btn btn--ghost" onClick={() => void revealFile(job.outputPath!)}>
                        <Icon name="folder" size={14} />
                        Show in folder
                      </button>
                    )}
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
