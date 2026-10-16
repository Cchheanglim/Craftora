import type { Job } from "../types";
import type { ProjectEntry } from "../lib/storage";
import { formatClock } from "../lib/timecode";
import { openUrl } from "@tauri-apps/plugin-opener";
import { inDesktopApp, revealFile } from "../lib/engine";
import { storeEdition, type Updates } from "../lib/updates";
import { Icon } from "./Icon";
import { useConfirm } from "./ConfirmDialog";
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
  updates: Updates;
}

const REPO = "https://github.com/Cchheanglim/Craftora";
const LINKS = [
  { label: "Licences", url: `${REPO}/blob/main/THIRD_PARTY_NOTICES.md` },
  { label: "Privacy", url: `${REPO}/blob/main/PRIVACY.md` },
  { label: "Releases", url: `${REPO}/releases` },
];

function updateText(status: Updates["status"]): string {
  switch (status.kind) {
    case "checking":
      return "Checking for updates…";
    case "current":
      return "You have the latest version.";
    case "available":
      return `Version ${status.version} is available.`;
    case "installing":
      return `Installing version ${status.version}…`;
    case "error":
      return `Couldn't check for updates: ${status.message}`;
    default:
      return "";
  }
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
  updates,
}: HomeProps) {
  const { ask, dialog } = useConfirm();
  const deleteProject = async (p: ProjectEntry) => {
    const ok = await ask({
      title: `Delete “${p.name}”?`,
      message: "The project and its edits are deleted for good. Your video files and finished exports aren't touched.",
      confirmLabel: "Delete project",
      danger: true,
    });
    if (ok) onDeleteProject(p.id);
  };

  return (
    <section className="home" aria-labelledby="home-title">
      {dialog}
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
                    <button
                      type="button"
                      className="btn btn--icon home__delete"
                      aria-label={`Delete ${p.name}`}
                      title="Delete project"
                      onClick={() => void deleteProject(p)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
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

            <h2 className="section-label home__gap">About</h2>
            <div className="home__about">
              <p>
                Craftora{updates.version ? ` ${updates.version}` : ""} · MIT License · includes FFmpeg (GPL) and yt-dlp
              </p>
              {updates.available ? (
                <>
                  {updateText(updates.status) && <p className="home__muted">{updateText(updates.status)}</p>}
                  <div className="home__about-row">
                    {updates.status.kind === "available" ? (
                      <button type="button" className="btn btn--secondary" onClick={() => void updates.install()}>
                        Install and restart
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--secondary"
                        onClick={() => void updates.checkNow()}
                        disabled={updates.status.kind === "checking" || updates.status.kind === "installing"}
                      >
                        Check for updates
                      </button>
                    )}
                    <label className="home__check">
                      <input type="checkbox" checked={updates.auto} onChange={(e) => updates.setAuto(e.target.checked)} />
                      Check automatically
                    </label>
                  </div>
                </>
              ) : (
                <p className="home__muted">
                  {storeEdition
                    ? "Updates come through the Microsoft Store."
                    : "Updates are checked in installed copies of Craftora, not in development runs."}
                </p>
              )}
              {inDesktopApp && (
                <p className="home__links">
                  {LINKS.map((link) => (
                    <button key={link.label} type="button" onClick={() => void openUrl(link.url)}>
                      {link.label}
                    </button>
                  ))}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
