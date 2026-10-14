import { useState } from "react";
import type { Job } from "../types";
import type { ProjectEntry } from "../lib/storage";
import { formatClock } from "../lib/timecode";
import { revealFile } from "../lib/engine";
import { Icon } from "./Icon";
import "./Home.css";

interface HomeProps {
  /** Absent in the browser preview. */
  onImport?: () => void;
  onPasteLink: () => void;
  onTrySample: () => void;
  busy: boolean;
  /** Saved projects, most recent first. */
  projects: ProjectEntry[];
  /** The project open in the editor, if it has anything in it. */
  currentId: string | null;
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onDeleteProject: (id: string) => void;
  /** Finished exports, newest first. */
  recent: Job[];
  outputDir: string;
}

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["S", "Split at the playhead"],
  ["Delete", "Delete the selected clip"],
  ["Ctrl Z / Ctrl Y", "Undo / redo"],
  ["T", "Add text"],
  ["I / O", "Trim selected clip to the playhead"],
  ["F", "Full-screen preview"],
  ["Ctrl ↵", "Add to queue"],
];

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(ms);
}

export function Home({
  onImport,
  onPasteLink,
  onTrySample,
  busy,
  projects,
  currentId,
  onOpenProject,
  onNewProject,
  onDeleteProject,
  recent,
  outputDir,
}: HomeProps) {
  // Deleting asks once more, inline, on the same button.
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <section className="home" aria-labelledby="home-title">
      <div className="home__inner">
        <header className="home__head">
          <h1 id="home-title">Craftora</h1>
          <p>Bring in video and sound, cut them on the timeline, add text, and export a clean file. Files on this PC work offline.</p>
        </header>

        <div className="home__grid">
          <div className="home__col">
            <h2 className="section-label">Start</h2>
            <ul className="home__actions">
              {onImport && (
                <li>
                  <button type="button" className="home__action" onClick={onImport} disabled={busy}>
                    <Icon name="upload" size={18} />
                    <span>
                      <strong>Import files</strong>
                      <span>Videos, music or voice-overs from this PC</span>
                    </span>
                  </button>
                </li>
              )}
              <li>
                <button type="button" className="home__action" onClick={onPasteLink}>
                  <Icon name="link" size={18} />
                  <span>
                    <strong>Paste a link</strong>
                    <span>YouTube and many other sites, through yt-dlp</span>
                  </span>
                </button>
              </li>
              <li>
                <button type="button" className="home__action" onClick={onTrySample} disabled={busy}>
                  <Icon name="film" size={18} />
                  <span>
                    <strong>{busy ? "Opening…" : "Try a sample"}</strong>
                    <span>Big Buck Bunny, a free Blender film</span>
                  </span>
                </button>
              </li>
            </ul>

            <div className="home__section-head home__gap">
              <h2 className="section-label">Projects</h2>
              <button type="button" className="btn btn--ghost" onClick={onNewProject}>
                <Icon name="plus" size={13} />
                New project
              </button>
            </div>
            {projects.length === 0 ? (
              <p className="home__muted">Your projects save themselves as you edit and show up here.</p>
            ) : (
              <ul className="home__projects">
                {projects.map((p) => (
                  <li key={p.id} className={p.id === currentId ? "is-current" : undefined}>
                    <button type="button" className="home__project" onClick={() => onOpenProject(p.id)}>
                      <Icon name="scissors" size={14} />
                      <span className="home__project-text">
                        <span className="truncate">{p.name}</span>
                        <span className="home__project-meta">
                          {p.clips} clip{p.clips === 1 ? "" : "s"} · <span className="mono">{formatClock(p.duration)}</span> · {ago(p.savedAt)}
                        </span>
                      </span>
                      {p.id === currentId && <span className="home__open">Open now</span>}
                    </button>
                    {confirming === p.id ? (
                      <button
                        type="button"
                        className="btn btn--ghost home__delete is-confirming"
                        onClick={() => {
                          setConfirming(null);
                          onDeleteProject(p.id);
                        }}
                        onBlur={() => setConfirming(null)}
                        autoFocus
                      >
                        Delete?
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--icon home__delete"
                        aria-label={`Delete ${p.name}`}
                        title="Delete project"
                        onClick={() => setConfirming(p.id)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="home__col">
            <h2 className="section-label">Recent exports</h2>
            {recent.length === 0 ? (
              <p className="home__muted">
                Nothing exported yet. Finished files land in <span className="mono">{outputDir}</span>.
              </p>
            ) : (
              <ul className="home__recent">
                {recent.slice(0, 5).map((job) => (
                  <li key={job.id}>
                    <Icon name={job.kind === "audio" ? "music" : "film"} size={14} />
                    <span className="truncate mono">{job.outputPath?.split(/[\\/]/).pop() ?? job.fileName}</span>
                    {job.outputPath && (
                      <button type="button" className="btn btn--icon" aria-label={`Show ${job.fileName} in folder`} title="Show in folder" onClick={() => void revealFile(job.outputPath!)}>
                        <Icon name="folder" size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <h2 className="section-label home__gap">Shortcuts</h2>
            <dl className="home__keys">
              {SHORTCUTS.map(([keys, label]) => (
                <div key={keys}>
                  <dt>
                    {keys.split(" / ").map((k, i) => (
                      <span key={k}>
                        {i > 0 && " / "}
                        <kbd>{k}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
