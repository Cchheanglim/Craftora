import type { EngineStatus } from "../lib/engine";
import { Icon } from "./Icon";
import "./Sidebar.css";

export type View = "home" | "editor" | "image" | "projects" | "media" | "downloads" | "history" | "library" | "settings";

/** Something running now, for the "Working on" box: a download, export, recording or captions. */
export interface Activity {
  id: string;
  /** "Downloading", "Exporting", "Making captions"… */
  label: string;
  /** Which video. */
  detail: string;
  /** 0–100, or null while it can't tell. */
  percent: number | null;
  /** Stops it (captions only: downloads and exports are cancelled in the Queue). */
  onCancel?: () => void;
}

export interface SidebarProps {
  view: View;
  onViewChange: (view: View) => void;
  libraryCount: number;
  /** Downloads running, waiting or paused. */
  downloadsCount: number;
  /** "browser" in a plain browser tab, where downloads are simulated. */
  engines: EngineStatus | "checking" | "browser";
  /** What's running now (shown only while something is). */
  activity: Activity[];
  /** A column at the left of the pages (Home, Projects…) instead of the editor's pop-up menu. */
  rail?: boolean;
}

export function Sidebar({
  view,
  onViewChange,
  libraryCount,
  downloadsCount,
  engines,
  activity,
  rail,
}: SidebarProps) {
  const groups = [
    {
      label: "Make",
      items: [
        { id: "home" as const, label: "Home", icon: "logo" as const },
        { id: "editor" as const, label: "Editor", icon: "scissors" as const },
        { id: "image" as const, label: "Image editor", icon: "image" as const },
        { id: "projects" as const, label: "Projects", icon: "grid" as const },
      ],
    },
    {
      label: "Library",
      items: [
        { id: "media" as const, label: "Media library", icon: "image" as const },
        { id: "downloads" as const, label: "Downloads", icon: "download" as const, count: downloadsCount },
        { id: "history" as const, label: "History", icon: "clock" as const },
        { id: "library" as const, label: "Exports", icon: "folder" as const, count: libraryCount },
      ],
    },
  ];
  const item = (entry: { id: View; label: string; icon: "logo" | "scissors" | "grid" | "image" | "download" | "clock" | "folder" | "sliders"; count?: number }) => (
    <li key={entry.id}>
      <button
        type="button"
        role={rail ? undefined : "menuitem"}
        className="side__item"
        aria-current={view === entry.id ? "page" : undefined}
        onClick={() => onViewChange(entry.id)}
      >
        <Icon name={entry.icon} size={15} />
        <span className="side__text">{entry.label}</span>
        {entry.count ? <span className="side__count mono">{entry.count}</span> : null}
      </button>
    </li>
  );
  // yt-dlp and FFmpeg only take room when one is missing (or in the browser preview).
  const engineTrouble = engines === "browser" || (typeof engines === "object" && (!engines.ytDlp || !engines.ffmpeg));

  return (
    <nav className={rail ? "side is-rail" : "side"} aria-label="Main">
      {groups.map((group) => (
        <div key={group.label} className="side__group">
          <h2 className="section-label side__group-label">{group.label}</h2>
          <ul className="side__nav">{group.items.map(item)}</ul>
        </div>
      ))}

      {activity.length > 0 && (
        <section className="side__activity" aria-labelledby="activity-title">
          <h2 id="activity-title" className="section-label">
            Working on
          </h2>
          {activity.map((a) => (
            <div key={a.id} className="side__task">
              <span className="side__task-head">
                <span className="truncate">{a.label}</span>
                {a.percent !== null && <span className="mono">{Math.floor(a.percent)}%</span>}
                {a.onCancel && (
                  <button type="button" className="side__task-cancel" aria-label={`Cancel: ${a.label}`} title="Cancel" onClick={a.onCancel}>
                    <Icon name="x" size={12} />
                  </button>
                )}
              </span>
              <span className={a.percent === null ? "side__task-bar is-indeterminate" : "side__task-bar"}>
                <span style={{ width: a.percent === null ? undefined : `${a.percent}%` }} />
              </span>
              <span className="side__task-detail truncate" title={a.detail}>
                {a.detail}
              </span>
            </div>
          ))}
        </section>
      )}

      <ul className="side__nav side__bottom">{item({ id: "settings", label: "Settings", icon: "sliders" })}</ul>

      {engineTrouble && (
        <section className="side__engines" aria-label="Engines">
          <h2 className="section-label">Engines</h2>
          <EngineRow name="yt-dlp" engines={engines} pick={(e) => e.ytDlp} />
          <EngineRow name="FFmpeg" engines={engines} pick={(e) => e.ffmpeg} />
          {engines === "browser" && (
            <p className="side__hint">Browser preview. Downloads are simulated; open the desktop app to export for real.</p>
          )}
          {typeof engines === "object" && (!engines.ytDlp || !engines.ffmpeg) && (
            <p className="side__hint">An engine is missing. Run scripts/fetch-sidecars.ps1, then restart Craftora.</p>
          )}
        </section>
      )}
    </nav>
  );
}

function EngineRow({
  name,
  engines,
  pick,
}: {
  name: string;
  engines: SidebarProps["engines"];
  pick: (e: EngineStatus) => string | null;
}) {
  const version = typeof engines === "object" ? pick(engines) : null;
  const state = version ?? (engines === "checking" ? "Checking…" : "Not connected");
  return (
    <div className="side__engine">
      <span className={version ? "side__dot is-ok" : engines === "checking" ? "side__dot is-checking" : "side__dot"} aria-hidden="true" />
      <span className="side__engine-name">{name}</span>
      <span className={version ? "side__engine-state mono" : "side__engine-state"}>{state}</span>
    </div>
  );
}
