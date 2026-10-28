import type { Job } from "../types";
import type { ProjectEntry } from "../lib/storage";
import { formatClock } from "../lib/timecode";
import { openUrl } from "@tauri-apps/plugin-opener";
import { inDesktopApp, revealFile } from "../lib/engine";
import { PlayFile } from "./PlayFile";
import { storeEdition, type Updates } from "../lib/updates";
import { checkSite, signedInSites, signOutOf, type SiteReport } from "../lib/engine";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";
import { useEffect, useState, type FormEvent } from "react";
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
  onOpenWelcome: () => void;
}

export interface LinkSettings {
  onSignIn: (site: string) => void;
  onSignOut: () => void;
  /** The answer to the last sign-in or sign-out. */
  signInMessage: string | null;
  /** This copy can ask VirusTotal whether a link's website is safe. */
  siteChecks: boolean;
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

/** Saved projects, most recent first, to open or delete (Home and the Projects page). */
export function ProjectList({
  projects,
  currentId,
  onOpenProject,
  onDeleteProject,
  selected,
  onToggle,
}: Pick<HomeProps, "projects" | "currentId" | "onOpenProject" | "onDeleteProject"> & {
  /** While picking several projects (Projects page): the ticked ones; rows tick instead of opening. */
  selected?: Set<string>;
  onToggle?: (id: string) => void;
}) {
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
  if (projects.length === 0) return <p className="home__muted">Your projects save themselves as you edit and show up here.</p>;
  return (
    <>
      {dialog}
      <ul className="home__projects">
        {projects.map((p) => (
          <li key={p.id} className={p.id === currentId ? "is-current" : undefined}>
            {selected ? (
              <label className="home__project">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => onToggle?.(p.id)} />
                <Thumb src={p.thumbnail} icon="scissors" />
                <span className="home__project-text">
                  <span className="truncate">{p.name}</span>
                  <span className="home__project-meta">
                    {p.clips} clip{p.clips === 1 ? "" : "s"} · <span className="mono">{formatClock(p.duration)}</span> · {ago(p.savedAt)}
                  </span>
                </span>
              </label>
            ) : (
            <>
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
            <button type="button" className="btn btn--icon home__delete" aria-label={`Delete ${p.name}`} title="Delete project" onClick={() => void deleteProject(p)}>
              <Icon name="trash" size={14} />
            </button>
            </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
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
  onOpenWelcome,
}: HomeProps) {
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
            </ul>

            <div className="home__section-head home__gap">
              <h2 className="section-label">Projects</h2>
              <button type="button" className="btn btn--ghost" onClick={onNewProject}>
                <Icon name="plus" size={13} />
                New project
              </button>
            </div>
            <ProjectList projects={projects} currentId={currentId} onOpenProject={onOpenProject} onDeleteProject={onDeleteProject} />
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
                      <>
                        <PlayFile path={job.outputPath} name={job.fileName} />
                        <button type="button" className="btn btn--icon" aria-label={`Show ${job.fileName} in folder`} title="Show in folder" onClick={() => void revealFile(job.outputPath!)}>
                          <Icon name="folder" size={14} />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}


            <h2 className="section-label home__gap">About</h2>
            <div className="home__about">
              <p>
                Craftora{updates.version ? ` ${updates.version}` : ""}
                {/* The number only changes at a release; dev runs already have the newer work. */}
                {import.meta.env.DEV ? " (development build)" : ""} · MIT License · includes FFmpeg (GPL) and yt-dlp
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
              <p className="home__links">
                <button type="button" onClick={onOpenWelcome}>
                  Welcome guide
                </button>
                {inDesktopApp &&
                  LINKS.map((link) => (
                    <button key={link.label} type="button" onClick={() => void openUrl(link.url)}>
                      {link.label}
                    </button>
                  ))}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** VirusTotal's verdict on a website, in words. */
export function siteVerdict(report: SiteReport): Verdict {
  if (report.total === 0) return { tone: "info", text: `VirusTotal has no report on ${report.site} yet, so there's no verdict.`, report };
  const flagged = report.malicious + report.suspicious;
  if (flagged === 0) return { tone: "ok", text: `${report.site} looks safe: none of ${report.total} security vendors flag it.`, report };
  const kinds = [...new Set(report.flaggedBy.map((f) => f.verdict))].join(", ");
  return { tone: "warn", text: `Be careful: ${flagged} of ${report.total} security vendors flag ${report.site}${kinds ? ` (${kinds})` : ""}.`, report };
}

export type Verdict = { tone: "ok" | "info" | "warn"; text: string; report?: SiteReport };

/** The details behind a verdict, in plain words. */
function ReportDetails({ report }: { report: SiteReport }) {
  const flagged = report.flaggedBy.map((f) => `${f.vendor} (${f.verdict})`).join(", ");
  const votes = report.votesSafe + report.votesDangerous;
  const rows: [string, string][] = [
    ["What it is", report.categories.join(", ") || "Not sorted into a category yet"],
    ["Flagged by", flagged || (report.total ? `Nobody, out of ${report.total} security vendors` : "Not scanned yet")],
    ["People's votes", votes ? `${report.votesSafe} say safe · ${report.votesDangerous} say dangerous` : "No votes yet"],
    [
      "Reputation",
      `${report.reputation}: ${report.reputation > 0 ? "trusted by VirusTotal's community" : report.reputation < 0 ? "reported as harmful by VirusTotal's community" : "neutral"}`,
    ],
    ["Last scanned", report.scannedAt ? ago(report.scannedAt * 1000) : "Never"],
  ];
  return (
    <>
      <dl className="home__report">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="home__report-link" onClick={() => void openUrl(report.reportUrl)}>
        See the full report on VirusTotal
      </button>
    </>
  );
}

/** Signing in to websites for links that need a login, checking links, and keeping yt-dlp current. */
export function Links({ links }: { links: LinkSettings }) {
  const [site, setSite] = useState("");
  const [toCheck, setToCheck] = useState("");
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const { ask, dialog } = useConfirm();
  const [sites, setSites] = useState<string[]>([]);
  useEffect(() => {
    if (!inDesktopApp) return;
    const refresh = () => void signedInSites().then(setSites).catch(() => {});
    refresh();
    // Back from the sign-in window, which may have added a login.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const signOutOfSite = async (site: string) => {
    const ok = await ask({
      title: `Sign out of ${site}?`,
      message: `Craftora forgets your login on ${site}. Videos there that need a login can't be fetched until you sign in again.`,
      confirmLabel: "Sign out",
      danger: true,
    });
    if (!ok) return;
    await signOutOf(site).catch(() => {});
    setSites(await signedInSites().catch(() => sites.filter((s) => s !== site)));
  };
  const checkLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!toCheck.trim() || checking) return;
    setChecking(true);
    setVerdict(null);
    try {
      setVerdict(siteVerdict(await checkSite(toCheck.trim())));
    } catch (err) {
      setVerdict({ tone: "warn", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setChecking(false);
    }
  };
  const signOut = async () => {
    const ok = await ask({
      title: "Sign out of all websites?",
      message: "Craftora forgets every login made in its sign-in window. Videos that need a login can't be fetched until you sign in again.",
      confirmLabel: "Sign out",
      danger: true,
    });
    if (ok) {
      links.onSignOut();
      setSites([]);
    }
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
        {sites.length > 0 && (
          <ul className="home__sites" aria-label="Signed in">
            {sites.map((site) => (
              <li key={site}>
                <Icon name="check" size={13} />
                <span className="mono truncate">{site}</span>
                <button type="button" className="btn btn--ghost" aria-label={`Sign out of ${site}`} onClick={() => void signOutOfSite(site)}>
                  Sign out
                </button>
              </li>
            ))}
          </ul>
        )}
        {links.siteChecks && (
          <>
            <form className="home__about-row home__gap-sm" onSubmit={checkLink}>
              <label htmlFor="check-link" className="sr-only">
                Link to check
              </label>
              <input
                id="check-link"
                className="field home__site"
                value={toCheck}
                onChange={(e) => setToCheck(e.target.value)}
                placeholder="Paste a link to check"
                spellCheck={false}
              />
              <button type="submit" className="btn btn--secondary" disabled={!toCheck.trim() || checking}>
                {checking ? "Checking…" : "Check"}
              </button>
            </form>
            <p className="home__muted">
              Not sure a link is safe? Paste it here before you fetch it: Craftora asks VirusTotal whether security vendors
              flag its website. Only the website's name is sent, never the full link.
            </p>
            {verdict && (
              <div className={`home__verdict is-${verdict.tone}`} role={verdict.tone === "warn" ? "alert" : "status"}>
                <Icon name={verdict.tone === "ok" ? "check" : "alert"} size={14} />
                <span>
                  {verdict.text}
                  {verdict.report && <ReportDetails report={verdict.report} />}
                </span>
              </div>
            )}
          </>
        )}
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
