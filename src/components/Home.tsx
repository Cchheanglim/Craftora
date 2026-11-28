import type { Job } from "../types";
import { loadProject, type ProjectEntry } from "../lib/storage";
import { formatClock, formatWhen } from "../lib/timecode";
import { openUrl } from "@tauri-apps/plugin-opener";
import { errorText, hoverVideo, inDesktopApp, playableFile, revealFile } from "../lib/engine";
import { PlayFile } from "./PlayFile";
import { storeEdition, type Updates } from "../lib/updates";
import { checkSite, signedInSites, signOutOf, type SignedInSite, type SiteChecks, type SiteReport } from "../lib/engine";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";
import { useEffect, useState, type FormEvent } from "react";
import { useConfirm } from "./ConfirmDialog";
import { HideButton, useHidden, type Hidden } from "./Hidden";
import { PictureCard } from "./PictureCard";
import { useProjectMenu } from "./ProjectMenu";
import "./Home.css";

interface HomeProps {
  /** Absent in the browser preview. */
  onImport?: () => void;
  /** Starts a new image (opens the New image window). */
  onNewImage: () => void;
  /** The link box (shared with the top bar's). */
  url: string;
  onUrlChange: (url: string) => void;
  onFetch: (url: string) => void;
  fetching: boolean;
  /** What the running fetch is doing, shown under the link box. */
  fetchStep?: string | null;
  /** Why the last fetch failed, and the button that helps (open the video's page). */
  error: string | null;
  errorAction?: { label: string; onClick: () => void };
  /** Takes the error away (its X). */
  onDismissError: () => void;
  busy: boolean;
  /** Saved projects, most recent first. */
  projects: ProjectEntry[];
  /** The project open in the editor, if it has anything in it. */
  currentId: string | null;
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDuplicateProject: (id: string) => void;
  /** Finished exports, newest first. */
  recent: Job[];
  outputDir: string;
  updates: Updates;
  onOpenWelcome: () => void;
  /** Opens the Projects page, where all of them are. */
  onSeeProjects: () => void;
  /** Scan: VirusTotal's verdict on the link's website (when a key is there); else opens Settings to add one. */
  canCheckSite?: boolean;
  onSetUpSiteCheck?: () => void;
}

type ProjectTab = "recent" | "videos" | "pictures" | "all";

const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: "recent", label: "Recent" },
  { id: "videos", label: "Videos" },
  { id: "pictures", label: "Pictures" },
  { id: "all", label: "All" },
];

function exportKind(job: Job, name: string): { label: string; tone: "video" | "picture" | "link" } {
  if (job.kind === "audio") return { label: "Sound", tone: "link" };
  if (/\.(png|jpe?g|webp)$/i.test(name)) return { label: "Picture", tone: "picture" };
  return { label: "Video", tone: "video" };
}

export interface LinkSettings {
  onSignOut: () => void;
  /** The answer to the last sign-in or sign-out. */
  signInMessage: string | null;
  /** Whether links can be checked with VirusTotal, and whether the user saved their own key. */
  siteChecks: SiteChecks;
  /** Saves the user's VirusTotal key (rejects with why VirusTotal refused it); null removes it. */
  onSiteCheckKey: (key: string | null) => Promise<void>;
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

/** Check for updates, install one, and whether to check by itself (Home → About and Settings). */
export function UpdateControls({ updates }: { updates: Updates }) {
  return (
    <>
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
    </>
  );
}

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

export function ago(ms: number): string {
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
  hidden,
}: Pick<HomeProps, "projects" | "currentId" | "onOpenProject" | "onDeleteProject"> & {
  /** While picking several projects (Projects page): the ticked ones; rows tick instead of opening. */
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  /** Projects page: each row gets Hide (or Unhide). */
  hidden?: Hidden;
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
                <Thumb src={p.thumbnail} icon="scissors" play={() => projectVideo(p.id)} />
                <span className="home__project-text">
                  <span className="truncate">{p.name}</span>
                  <span className="home__project-meta">
                    {p.image ? "Image" : <>{p.clips} clip{p.clips === 1 ? "" : "s"} · <span className="mono">{formatClock(p.duration)}</span></>} · {ago(p.savedAt)}
                  </span>
                </span>
              </label>
            ) : (
            <>
            <button type="button" className="home__project" onClick={() => onOpenProject(p.id)}>
              <Thumb src={p.thumbnail} icon="scissors" play={() => projectVideo(p.id)} />
              <span className="home__project-text">
                <span className="truncate">{p.name}</span>
                <span className="home__project-meta">
                  {p.image ? "Image" : <>{p.clips} clip{p.clips === 1 ? "" : "s"} · <span className="mono">{formatClock(p.duration)}</span></>} · {ago(p.savedAt)}
                </span>
              </span>
              {p.id === currentId && <span className="home__open">Open now</span>}
            </button>
            {hidden && <HideButton hidden={hidden} id={p.id} name={p.name} />}
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
  onNewImage,
  url,
  onUrlChange,
  onFetch,
  fetching,
  fetchStep,
  error,
  errorAction,
  onDismissError,
  busy,
  projects,
  currentId,
  onOpenProject,
  onNewProject,
  recent,
  outputDir,
  updates,
  onOpenWelcome,
  onSeeProjects,
  canCheckSite,
  onSetUpSiteCheck,
  onDeleteProject,
  onRenameProject,
  onDuplicateProject,
}: HomeProps) {
  const hiddenProjects = useHidden("projects");
  const { menu, cardProps } = useProjectMenu({ onOpenProject, onRenameProject, onDuplicateProject, onDeleteProject }, hiddenProjects);
  const shownProjects = projects.filter((p) => !hiddenProjects.isHidden(p.id));
  const [tab, setTab] = useState<ProjectTab>("recent");
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

  // Scan's answer for the link in the box (the top bar's Check, here on Home).
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [checking, setChecking] = useState(false);
  const scan = async () => {
    if (!url.trim() || checking) return;
    setChecking(true);
    setVerdict(null);
    try {
      setVerdict(siteVerdict(await checkSite(url.trim())));
    } catch (err) {
      setVerdict({ tone: "warn", text: errorText(err) });
    } finally {
      setChecking(false);
    }
  };

  const submitLink = (e: FormEvent) => {
    e.preventDefault();
    setVerdict(null);
    const trimmed = url.trim();
    if (trimmed && !fetching) onFetch(trimmed);
  };

  const visibleProjects =
    tab === "videos"
      ? shownProjects.filter((p) => !p.image).slice(0, 5)
      : tab === "pictures"
        ? shownProjects.filter((p) => p.image).slice(0, 5)
        : tab === "all"
          ? shownProjects.slice(0, 10)
          : shownProjects.slice(0, 5);

  const emptyProjectsText =
    tab === "videos"
      ? "No videos yet."
      : tab === "pictures"
        ? "No pictures yet."
        : "Your projects save themselves as you edit and show up here.";

  return (
    <section className="home" aria-labelledby="home-title">
      {menu}
      <div className="home__wrap">
        <h1 id="home-title" className="home__title">
          Home
        </h1>

        <section className="home__start" aria-labelledby="home-start-title">
          <h2 id="home-start-title" className="home__heading">
            Start something
          </h2>
          <form className="home__link-form" onSubmit={submitLink}>
            <label htmlFor="home-link" className="sr-only">
              Video link
            </label>
            <div className="home__link-box">
              <Icon name="link" size={18} />
              <input
                id="home-link"
                type="url"
                value={url}
                onChange={(e) => {
                  setVerdict(null);
                  onUrlChange(e.target.value);
                }}
                onPaste={(e) => {
                  // A whole link pasted in place of the box's text is fetched at once, as in the top bar.
                  const box = e.currentTarget;
                  const link = e.clipboardData.getData("text").trim();
                  const replacesAll = box.selectionStart === 0 && box.selectionEnd === box.value.length;
                  if (fetching || !replacesAll || !/^https?:\/\/\S+$/i.test(link)) return;
                  e.preventDefault();
                  setVerdict(null);
                  onUrlChange(link);
                  onFetch(link);
                }}
                placeholder="Paste a video link from any site"
                spellCheck={false}
              />
            </div>
            {(canCheckSite || onSetUpSiteCheck) && (
              <button
                type="button"
                className="btn btn--secondary home__fetch"
                disabled={checking || (canCheckSite && !url.trim())}
                onClick={() => (canCheckSite ? void scan() : onSetUpSiteCheck?.())}
              >
                <Icon name="shield" size={14} />
                {checking ? "Scanning…" : "Scan"}
              </button>
            )}
            <button type="submit" className="btn btn--primary home__fetch" disabled={fetching || !url.trim()}>
              {fetching ? "Fetching…" : "Fetch"}
            </button>
          </form>
          {fetching && fetchStep && !error && (
            <div className="home__error is-info" role="status">
              <p>{fetchStep}…</p>
            </div>
          )}
          {!error && verdict && (
            <div className={`home__error is-${verdict.tone}`} role={verdict.tone === "warn" ? "alert" : "status"}>
              <p>{verdict.text}</p>
              {verdict.report && (
                <button type="button" className="btn btn--secondary" onClick={() => void openUrl(verdict.report!.reportUrl)}>
                  Full report
                </button>
              )}
            </div>
          )}
          {error && (
            <div className="home__error" role="alert">
              <p>{error}</p>
              {errorAction && (
                <button type="button" className="btn btn--secondary" onClick={errorAction.onClick}>
                  {errorAction.label}
                </button>
              )}
              <button type="button" className="btn btn--icon" aria-label="Close" onClick={onDismissError}>
                <Icon name="x" size={12} />
              </button>
            </div>
          )}
          <div className="home__starts">
            <button type="button" className="home__start-btn" onClick={onNewProject}>
              <span className="home__start-icon is-video">
                <Icon name="film" size={24} />
              </span>
              <span className="home__start-text">
                <span className="home__start-label">New video</span>
                <span className="home__start-sub">Edit clips on a timeline</span>
              </span>
            </button>
            <button type="button" className="home__start-btn" onClick={onNewImage}>
              <span className="home__start-icon is-picture">
                <Icon name="image" size={24} />
              </span>
              <span className="home__start-text">
                <span className="home__start-label">New image</span>
                <span className="home__start-sub">Photos, posters, thumbnails</span>
              </span>
            </button>
            {onImport && (
              <button type="button" className="home__start-btn" onClick={onImport} disabled={busy}>
                <span className="home__start-icon is-link">
                  <Icon name="upload" size={24} />
                </span>
                <span className="home__start-text">
                  <span className="home__start-label">Import files</span>
                  <span className="home__start-sub">Videos, music or voice-overs from this PC</span>
                </span>
              </button>
            )}
          </div>
        </section>

        <section className="home__projects-section" aria-labelledby="home-projects-title">
          <div className="home__projects-head">
            <div className="home__projects-tabs-group">
              <h2 id="home-projects-title" className="home__heading">
                Your projects
              </h2>
              <div className="home__tabs" role="tablist" aria-label="Show">
                {PROJECT_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    className="home__tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            {shownProjects.length > 0 && (
              <button type="button" className="home__see-all" onClick={onSeeProjects}>
                See all {shownProjects.length}
              </button>
            )}
          </div>
          {visibleProjects.length === 0 ? (
            <p className="home__muted">{emptyProjectsText}</p>
          ) : (
            <ul className="pc-grid">
              {visibleProjects.map((p) => {
                const isOpen = p.id === currentId;
                return (
                  <PictureCard
                    key={p.id}
                    thumb={<Thumb src={p.thumbnail} icon={p.image ? "image" : "scissors"} play={() => projectVideo(p.id)} />}
                    tag={isOpen ? "Open now" : p.image ? "Picture" : "Video"}
                    tagOpen={isOpen}
                    badge={p.image ? undefined : formatClock(p.duration)}
                    name={p.name}
                    meta={`Edited ${ago(p.savedAt)}`}
                    onOpen={() => onOpenProject(p.id)}
                    {...cardProps(p)}
                  />
                );
              })}
            </ul>
          )}
        </section>

        <section className="home__exports" aria-labelledby="home-exports-title">
          <div className="home__exports-head">
            <h2 id="home-exports-title" className="home__heading">
              Recent exports
            </h2>
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
            <ul className="home__export-grid">
              {recent.slice(0, 5).map((job) => {
                const name = job.outputPath?.split(/[\\/]/).pop() ?? job.fileName;
                const kind = exportKind(job, name);
                return (
                  <li key={job.id} className="home__export-card">
                    <Thumb
                      src={job.thumbnail}
                      icon={job.kind === "audio" ? "music" : "film"}
                      play={job.kind !== "audio" && job.outputPath ? () => playableFile(job.outputPath!) : undefined}
                    />
                    <span className="home__export-info">
                      <span className={job.outputPath ? "home__export-name has-actions truncate" : "home__export-name truncate"}>{name}</span>
                      <span className="home__export-meta">
                        <span className={`home__export-kind is-${kind.tone}`}>{kind.label}</span>
                        <span className="truncate">{job.summary}</span>
                      </span>
                    </span>
                    {job.outputPath && (
                      <span className="home__export-actions">
                        {kind.tone !== "picture" && <PlayFile path={job.outputPath} name={job.fileName} />}
                        <button
                          type="button"
                          className="btn btn--icon"
                          aria-label={`Show ${job.fileName} in folder`}
                          title="Show in folder"
                          onClick={() => void revealFile(job.outputPath!)}
                        >
                          <Icon name="folder" size={14} />
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>


        <footer className="home__footer">
          <span>
            Craftora{updates.version ? ` ${updates.version}` : ""}
            {/* The number only changes at a release; dev runs already have the newer work. */}
            {import.meta.env.DEV ? " (development build)" : ""} · MIT License · includes FFmpeg (GPL) and yt-dlp
          </span>
          <button type="button" onClick={onOpenWelcome}>
            Welcome guide
          </button>
          {inDesktopApp &&
            LINKS.map((link) => (
              <button key={link.label} type="button" onClick={() => void openUrl(link.url)}>
                {link.label}
              </button>
            ))}
        </footer>
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

/** A saved project's first video (a file on this PC or a link), from where its clip starts, to play while its row is hovered. */
export async function projectVideo(id: string): Promise<string | undefined> {
  const { project } = await loadProject(id);
  for (const clip of [...project.clips].sort((a, b) => a.start - b.start)) {
    const media = project.media.find((m) => m.id === clip.mediaId);
    if (media && !media.source.image && media.hasVideo) {
      const video = media.source.local ? await playableFile(media.source.url) : await hoverVideo(media.source.url);
      return video && `${video}#t=${clip.in}`;
    }
  }
  return undefined;
}

/** Websites logged in to for links that need a login, checking links, and keeping yt-dlp current. */
export function Links({ links }: { links: LinkSettings }) {
  const [toCheck, setToCheck] = useState("");
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const { ask, dialog } = useConfirm();
  const [sites, setSites] = useState<SignedInSite[]>([]);
  // Websites picked to be left out of the list (only hidden here, the cookies stay); remembered on this PC.
  const [hiddenSites, setHiddenSites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("craftora.hiddenSites") ?? "[]");
    } catch {
      return [];
    }
  });
  const [showHidden, setShowHidden] = useState(false);
  const toggleHidden = (site: string) => {
    const next = hiddenSites.includes(site) ? hiddenSites.filter((s) => s !== site) : [...hiddenSites, site];
    setHiddenSites(next);
    try {
      localStorage.setItem("craftora.hiddenSites", JSON.stringify(next));
    } catch {
      /* not essential */
    }
  };
  const hiddenCount = sites.filter((s) => hiddenSites.includes(s.site)).length;
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
      title: `Forget ${site}?`,
      message: `Craftora deletes what ${site} saved in its window: cookies from visiting it, and your login if you signed in. Videos there that need a login can't be fetched until you sign in again.`,
      confirmLabel: "Sign out",
      danger: true,
    });
    if (!ok) return;
    await signOutOf(site).catch(() => {});
    setSites(await signedInSites().catch(() => sites.filter((s) => s.site !== site)));
  };
  const checkLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!toCheck.trim() || checking) return;
    setChecking(true);
    setVerdict(null);
    try {
      setVerdict(siteVerdict(await checkSite(toCheck.trim())));
    } catch (err) {
      setVerdict({ tone: "warn", text: errorText(err) });
    } finally {
      setChecking(false);
    }
  };
  const [vtKey, setVtKey] = useState("");
  const [vtSaving, setVtSaving] = useState(false);
  const [vtMessage, setVtMessage] = useState<string | null>(null);
  const saveVtKey = async (e: FormEvent) => {
    e.preventDefault();
    if (!vtKey.trim() || vtSaving) return;
    setVtSaving(true);
    setVtMessage(null);
    try {
      await links.onSiteCheckKey(vtKey);
      setVtKey("");
      setVtMessage("Key saved. Check next to Fetch now asks VirusTotal.");
    } catch (err) {
      setVtMessage(errorText(err));
    } finally {
      setVtSaving(false);
    }
  };
  const removeVtKey = async () => {
    const ok = await ask({
      title: "Remove your VirusTotal key?",
      message: "Links can't be checked until you add a key again.",
      confirmLabel: "Remove key",
      danger: true,
      note: "You can add it again any time from virustotal.com.",
    });
    if (!ok) return;
    setVtMessage(null);
    await links.onSiteCheckKey(null).catch((err) => setVtMessage(errorText(err)));
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
  return (
    <>
      {dialog}
      <div className="pc-bar">
        <div className="pc-bar__start">
          <h2>Links</h2>
        </div>
      </div>
      <div className="home__about">
        <div className="home__sites-head">
          <p className="home__muted">
            {sites.length > 0
              ? "Websites that saved cookies in Craftora's window (from a visit or a login):"
              : "No website has saved cookies in Craftora's window yet. When a link needs a login, Fetch offers to open its page so you can log in."}
          </p>
          <div className="home__about-row">
            {hiddenCount > 0 && (
              <button type="button" className="btn btn--ghost" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>
                {showHidden ? "Hide hidden" : `Show hidden (${hiddenCount})`}
              </button>
            )}
            <button type="button" className="btn btn--ghost" onClick={() => void signOut()}>
              Sign out of all
            </button>
          </div>
        </div>
        {links.signInMessage && <p className="home__muted">{links.signInMessage}</p>}
        {sites.length > 0 && (
          <ul className="home__sites" aria-label="Websites with saved cookies">
            {sites.filter(({ site }) => showHidden || !hiddenSites.includes(site)).map(({ site, used }) => (
              <li key={site}>
                <Icon name="check" size={13} />
                <span className="mono truncate">{site}</span>
                {used !== null && <span className="home__site-used">used {formatWhen(used)}</span>}
                <button type="button" className="btn btn--ghost" onClick={() => toggleHidden(site)}>
                  {hiddenSites.includes(site) ? "Unhide" : "Hide"}
                </button>
                <button type="button" className="btn btn--ghost" aria-label={`Forget ${site}`} onClick={() => void signOutOfSite(site)}>
                  Forget
                </button>
              </li>
            ))}
          </ul>
        )}
        {links.siteChecks.available && (
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
        {links.siteChecks.ownKey ? (
          <div className="home__about-row home__gap-sm">
            <p className="home__muted">Your VirusTotal key is saved on this PC, in Windows Credential Manager.</p>
            <button type="button" className="btn btn--ghost" onClick={() => void removeVtKey()}>
              Remove key
            </button>
          </div>
        ) : (
          <>
            <form className="home__about-row home__gap-sm" onSubmit={saveVtKey}>
              <label htmlFor="vt-key" className="sr-only">
                VirusTotal API key
              </label>
              <input
                id="vt-key"
                type="password"
                className="field home__site"
                value={vtKey}
                onChange={(e) => setVtKey(e.target.value)}
                placeholder="Paste your VirusTotal API key"
                spellCheck={false}
                autoComplete="off"
              />
              <button type="submit" className="btn btn--secondary" disabled={!vtKey.trim() || vtSaving}>
                {vtSaving ? "Trying the key…" : "Save"}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => void openUrl("https://www.virustotal.com/gui/my-apikey")}>
                Get a free key
              </button>
            </form>
            <p className="home__muted">
              Checking links uses your own free VirusTotal key: sign up at virustotal.com, then copy the key from your name → API
              key. It stays on this PC, in Windows Credential Manager.
            </p>
          </>
        )}
        {vtMessage && <p className="home__muted">{vtMessage}</p>}
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
