import { useState } from "react";
import type { Job } from "../types";
import { formatSize } from "../project/exportPlan";
import { openFile, revealFile } from "../lib/engine";
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
  /** Hides an export from the list (and from Home), or shows it again. The file isn't touched. */
  onHide: (id: string, hidden: boolean) => void;
}

const HIDDEN_KEY = "craftora.hideExports";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function Library({ jobs, outputDir, onChooseOutputDir, onOpenWorkspace, onHide }: LibraryProps) {
  const shown = jobs.filter((j) => !j.hidden);
  const hidden = jobs.filter((j) => j.hidden);
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
  // Hidden files stay folded away each time the page opens, so they're out of sight by default.
  const [hiddenOpen, setHiddenOpen] = useState(false);

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

      {jobs.length === 0 ? (
        <div className="library__empty">
          <p>No finished files yet.</p>
          <button type="button" className="btn btn--secondary" onClick={onOpenWorkspace}>
            <Icon name="scissors" size={14} />
            Go to Workspace
          </button>
        </div>
      ) : (
        <>
          <div className="library__group">
            <button type="button" className="library__toggle" aria-expanded={open} aria-controls="library-files" onClick={toggle}>
              <Icon name="chevronDown" size={14} />
              Exported files <span className="library__count">{shown.length}</span>
            </button>
            {open &&
              (shown.length === 0 ? (
                <p className="library__muted" id="library-files">
                  Every export is hidden. They're under Hidden below.
                </p>
              ) : (
                <ExportTable id="library-files" jobs={shown} onHide={onHide} />
              ))}
          </div>

          {hidden.length > 0 && (
            <div className="library__group">
              <button
                type="button"
                className="library__toggle"
                aria-expanded={hiddenOpen}
                aria-controls="library-hidden"
                onClick={() => setHiddenOpen(!hiddenOpen)}
              >
                <Icon name="chevronDown" size={14} />
                Hidden <span className="library__count">{hidden.length}</span>
              </button>
              {hiddenOpen && (
                <>
                  <p className="library__muted">Hidden here and on Home. The files are still in your save folder.</p>
                  <ExportTable id="library-hidden" jobs={hidden} onHide={onHide} />
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** A list of exports; hidden ones offer Unhide instead of Hide. */
function ExportTable({ id, jobs, onHide }: { id: string; jobs: Job[]; onHide: (id: string, hidden: boolean) => void }) {
  return (
    <div className="library__table-wrap" id={id}>
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
          {jobs.map((job) => {
            const name = job.outputPath?.split(/[\\/]/).pop() ?? job.fileName;
            return (
              <tr key={job.id}>
                <td>
                  <span className="library__name">
                    <Thumb src={job.thumbnail} icon={job.kind === "audio" ? "music" : "film"} />
                    <span className="mono truncate">{name}</span>
                  </span>
                </td>
                <td className="library__detail">{job.summary}</td>
                <td className="mono is-num">{formatSize(job.sizeMb)}</td>
                <td className="library__detail">{job.finishedAt ? dateFormat.format(job.finishedAt) : ""}</td>
                <td className="is-num">
                  <span className="library__actions">
                    {job.outputPath && (
                      <>
                        <button type="button" className="btn btn--ghost" onClick={() => void openFile(job.outputPath!)}>
                          <Icon name="play" size={14} />
                          Play
                        </button>
                        <button type="button" className="btn btn--ghost" onClick={() => void revealFile(job.outputPath!)}>
                          <Icon name="folder" size={14} />
                          Show in folder
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn btn--ghost"
                      aria-label={`${job.hidden ? "Unhide" : "Hide"} ${name}`}
                      title={job.hidden ? "Show it in the list and on Home again" : "Hide it from this list and from Home (the file stays)"}
                      onClick={() => onHide(job.id, !job.hidden)}
                    >
                      <Icon name={job.hidden ? "eye" : "eyeOff"} size={14} />
                      {job.hidden ? "Unhide" : "Hide"}
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
