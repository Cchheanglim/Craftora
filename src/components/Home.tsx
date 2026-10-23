import type { Job } from "../types";
import type { ProjectEntry } from "../lib/storage";
import { formatClock } from "../lib/timecode";
import { openUrl } from "@tauri-apps/plugin-opener";
import { inDesktopApp, revealFile } from "../lib/engine";
import { storeEdition, type Updates } from "../lib/updates";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";
import { useState, type FormEvent } from "react";
import { useConfirm } from "./ConfirmDialog";
import "./Home.css";

interface HomeProps {
  /** Absent in the browser preview. */
  onImport?: () => void;
  onPasteLink: () => void;
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
  /** Settings for fetching links; absent in the browser preview. */
  links?: LinkSettings;
}

export interface LinkSettings {
  /** A cookies.txt file used instead of Craftora's sign-in window, or null. */
  cookieFile: string | null;
  onPickCookieFile: () => void;
  onClearCookieFile: () => void;
  onSignIn: (site: string) => void;
  onSignOut: () => void;
  /** The answer to the last sign-in or sign-out. */
  signInMessage: string | null;
  /** A VirusTotal key is saved: each fetch checks its website. */
  vtKey: boolean;
  onSaveVtKey: (key: string) => void;
  onRemoveVtKey: () => void;
  /** The answer to the last save or removal of the VirusTotal key. */
  vtMessage: string | null;
  /** Absent in the Store edition, whose install folder can't be changed. */
  onUpdateYtDlp?: () => void;
  updating: boolean;
  /** yt-dlp's answer to the last update. */
  ytDlpMessage: string | null;
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
  busy,
  projects,
  currentId,
  onOpenProject,
  onNewProject,
  onDeleteProject,
  recent,
  outputDir,
  updates,
  links,
}: HomeProps) {
  const { ask, dialog } = useConfirm();
  // Some people don't want their exports' pictures on the start screen; remembered.
  const [hideRecent, setHideRecent] = useState(() => {
    try {
      return localStorage.getItem("craftora.hideRecent") === "1";
    } catch {
      return false;
    }
  });
  const toggleRecent = (hide: boolean) => {
    setHideRecent(hide);
    try {
      localStorage.setItem("craftora.hideRecent", hide ? "1" : "0");
    } catch {
      /* not essential */
    }
  };
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
                      <Thumb src={p.thumbnail} icon="scissors" />
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
            <div className="home__section-head">
              <h2 className="section-label">Recent exports</h2>
              {recent.length > 0 && (
                <button type="button" className="btn btn--ghost" aria-pressed={hideRecent} onClick={() => toggleRecent(!hideRecent)}>
                  {hideRecent ? "Show" : "Hide"}
                </button>
              )}
            </div>
            {hideRecent && recent.length > 0 ? (
              <p className="home__muted">Hidden. Your exports are still in Exports and in your save folder.</p>
            ) : recent.length === 0 ? (
              <p className="home__muted">
                Nothing exported yet. Finished files land in <span className="mono">{outputDir}</span>.
              </p>
            ) : (
              <ul className="home__recent">
                {recent.slice(0, 5).map((job) => (
                  <li key={job.id}>
                    <Thumb src={job.thumbnail} icon={job.kind === "audio" ? "music" : "film"} />
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

            {links && <Links links={links} />}

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

/** Signing in to websites for links that need a login, and keeping yt-dlp current. */
function Links({ links }: { links: LinkSettings }) {
  const [site, setSite] = useState("");
  const [vtKey, setVtKey] = useState("");
  const { ask, dialog } = useConfirm();
  const saveVtKey = (e: FormEvent) => {
    e.preventDefault();
    if (vtKey.trim()) links.onSaveVtKey(vtKey.trim());
    setVtKey("");
  };
  const removeVtKey = async () => {
    const ok = await ask({
      title: "Remove the VirusTotal key?",
      message: "Craftora stops checking websites with VirusTotal. You can add the key again at any time.",
      confirmLabel: "Remove key",
      danger: true,
    });
    if (ok) links.onRemoveVtKey();
  };
  const signOut = async () => {
    const ok = await ask({
      title: "Sign out of all websites?",
      message: "Craftora forgets every login made in its sign-in window. Videos that need a login can't be fetched until you sign in again.",
      confirmLabel: "Sign out",
      danger: true,
    });
    if (ok) links.onSignOut();
  };
  const signIn = (e: FormEvent) => {
    e.preventDefault();
    if (site.trim()) links.onSignIn(site.trim());
  };
  return (
    <>
      {dialog}
      <h2 className="section-label home__gap">Links</h2>
      <div className="home__about">
        <form className="home__about-row" onSubmit={signIn}>
          <label htmlFor="sign-in-site" className="sr-only">
            Website to sign in to
          </label>
          <input
            id="sign-in-site"
            className="field home__site"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="youtube.com"
            spellCheck={false}
          />
          <button type="submit" className="btn btn--secondary" disabled={!site.trim()}>
            Open
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void signOut()}>
            Sign out of all
          </button>
        </form>
        <p className="home__muted">
          For restricted site, private or members-only videos. A window opens: log in, go to the video, then click Fetch this video at the top of the window. Your browser can stay open, and the login is remembered.
        </p>
        {links.signInMessage && <p className="home__muted">{links.signInMessage}</p>}
        <div className="home__about-row">
          {links.cookieFile ? (
            <>
              <span className="home__muted mono truncate">Using {links.cookieFile}</span>
              <button type="button" className="btn btn--ghost" onClick={links.onClearCookieFile}>
                Stop using
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={links.onPickCookieFile}>
              Use a cookie file instead…
            </button>
          )}
        </div>
        {links.vtKey ? (
          <div className="home__about-row">
            <span>
              <Icon name="check" size={13} /> VirusTotal checks each website you fetch from.
            </span>
            <button type="button" className="btn btn--ghost" onClick={() => void removeVtKey()}>
              Remove key
            </button>
          </div>
        ) : (
          <form className="home__about-row" onSubmit={saveVtKey}>
            <label htmlFor="vt-key" className="sr-only">
              VirusTotal API key
            </label>
            <input
              id="vt-key"
              type="password"
              className="field home__site"
              value={vtKey}
              onChange={(e) => setVtKey(e.target.value)}
              placeholder="VirusTotal API key (optional)"
              spellCheck={false}
              autoComplete="off"
            />
            <button type="submit" className="btn btn--secondary" disabled={!vtKey.trim()}>
              Save
            </button>
          </form>
        )}
        <p className="home__muted">
          With a free key from virustotal.com, Craftora asks VirusTotal about each website you fetch from and warns you if
          security vendors flag it. Only the website's name is sent, never the video link. A free key allows about 500 checks a day.
        </p>
        {links.vtMessage && <p className="home__muted">{links.vtMessage}</p>}
        {links.onUpdateYtDlp && (
          <>
            <div className="home__about-row">
              <button type="button" className="btn btn--secondary" onClick={links.onUpdateYtDlp} disabled={links.updating}>
                {links.updating ? "Updating yt-dlp…" : "Update yt-dlp"}
              </button>
              {links.ytDlpMessage && <span className="home__muted">{links.ytDlpMessage}</span>}
            </div>
            <p className="home__muted">If links from a website stop working, update Craftora: websites change often.</p>
          </>
        )}
      </div>
    </>
  );
}
