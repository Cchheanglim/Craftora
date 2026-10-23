import { useState } from "react";
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
  /** Picks the folder new exports are saved in; absent in the browser preview. */
  onChooseOutputDir?: () => void;
  onOpenWorkspace: () => void;
}

const HIDDEN_KEY = "craftora.hideExports";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function Library({ jobs, outputDir, onChooseOutputDir, onOpenWorkspace }: LibraryProps) {
  const finished = jobs;
  // The list can be folded away, so its pictures don't show; remembered.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(HIDDEN_KEY, open ? "1" : "0");
    } catch {
      /* not essential */
    }
  };

  return (
    <section className="library" aria-labelledby="library-title">
      <header className="library__head">
        <h1 id="library-title">Library</h1>
        <p>Everything Craftora has exported.</p>
        <div className="library__save">
          <span>Save new exports to</span>
          <span className="mono truncate">{outputDir}</span>
          {onChooseOutputDir && (
            <button type="button" className="btn btn--secondary" onClick={onChooseOutputDir}>
              <Icon name="folder" size={14} />
              Change
            </button>
          )}
        </div>
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
        <button type="button" className="library__toggle" aria-expanded={open} aria-controls="library-files" onClick={toggle}>
          <Icon name="chevronDown" size={14} />
          Exported files <span className="library__count">{finished.length}</span>
        </button>
      )}
      {finished.length > 0 && open && (
        <div className="library__table-wrap" id="library-files">
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
