import type { EngineStatus } from "../lib/engine";
import type { MediaItem } from "../project/model";
import { formatClock } from "../lib/timecode";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";
import { beginMediaDrag } from "./TimelineEditor";
import "./Sidebar.css";

export type View = "home" | "editor" | "projects" | "media" | "downloads" | "history" | "library" | "settings";

/** Something running now, for the "Working on" box: a download, export, recording or captions. */
export interface Activity {
  id: string;
  /** "Downloading", "Exporting", "Making captions"… */
  label: string;
  /** Which video. */
  detail: string;
  /** 0–100, or null while it can't tell. */
  percent: number | null;
}

interface SidebarProps {
  view: View;
  onViewChange: (view: View) => void;
  collapsed: boolean;
  libraryCount: number;
  /** Downloads running, waiting or paused. */
  downloadsCount: number;
  /** "browser" in a plain browser tab, where downloads are simulated. */
  engines: EngineStatus | "checking" | "browser";
  media: MediaItem[];
  /** Media whose preview copy is still being made. */
  preparing: Set<string>;
  /** Media id → how making its captions from the sound is going. */
  captioning: Record<string, string>;
  /** Links whose preview is being cached: how much (0–100) can already be scrubbed instantly. */
  previewReady: Record<string, number>;
  /** Links being downloaded for editing. */
  downloading: Set<string>;
  /** Downloads a link so it edits like a local file; absent in the browser preview. */
  onDownload?: (mediaId: string) => void;
  /** Absent in the browser preview. */
  onImport?: () => void;
  onAddMedia: (mediaId: string) => void;
  onRemoveMedia: (mediaId: string) => void;
  /** Media used on the timeline can't be removed without removing its clips. */
  usedMedia: Set<string>;
  /** What's running now (shown only while something is). */
  activity: Activity[];
}

export function Sidebar({
  view,
  onViewChange,
  collapsed,
  libraryCount,
  downloadsCount,
  engines,
  media,
  preparing,
  previewReady,
  captioning,
  downloading,
  onDownload,
  onImport,
  onAddMedia,
  onRemoveMedia,
  usedMedia,
  activity,
}: SidebarProps) {
  const groups = [
    {
      label: "Make",
      items: [
        { id: "home" as const, label: "Home", icon: "logo" as const },
        { id: "editor" as const, label: "Editor", icon: "scissors" as const },
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
        className="side__item"
        aria-current={view === entry.id ? "page" : undefined}
        aria-label={collapsed ? entry.label : undefined}
        title={collapsed ? entry.label : undefined}
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
    <nav className={collapsed ? "side is-collapsed" : "side"} aria-label="Main">
      {groups.map((group) => (
        <div key={group.label} className="side__group">
          {!collapsed && <h2 className="section-label side__group-label">{group.label}</h2>}
          <ul className="side__nav">{group.items.map(item)}</ul>
        </div>
      ))}

      {!collapsed && activity.length > 0 && (
        <section className="side__activity" aria-labelledby="activity-title">
          <h2 id="activity-title" className="section-label">
            Working on
          </h2>
          {activity.map((a) => (
            <div key={a.id} className="side__task">
              <span className="side__task-head">
                <span className="truncate">{a.label}</span>
                {a.percent !== null && <span className="mono">{Math.floor(a.percent)}%</span>}
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

      {!collapsed && (
        <section className="side__media" aria-labelledby="media-title">
          <header className="side__media-head">
            <h2 id="media-title" className="section-label">
              In this project
            </h2>
            {onImport && (
              <button type="button" className="btn btn--ghost" onClick={onImport}>
                <Icon name="upload" size={13} />
                Import
              </button>
            )}
          </header>
          {media.length === 0 ? (
            <p className="side__hint">
              {onImport ? "Import files from this PC or fetch a link. They appear here, ready for the timeline." : "Fetch a demo link to add it here."}
            </p>
          ) : (
            <ul className="side__list">
              {media.map((item) => (
                <li
                  key={item.id}
                  className="side__file"
                  onPointerDown={(e) => {
                    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
                    e.preventDefault(); // no text selection while dragging
                    beginMediaDrag(item.id, e);
                  }}
                  title="Drag onto the timeline, or press + to add at the end"
                >
                  <Thumb src={item.source.thumbnail || (item.source.image ? item.source.previewUrl : undefined)} icon={item.source.image ? "image" : item.hasVideo ? "film" : "music"} />
                  <span className="side__file-text">
                    <span className="truncate">{item.name}</span>
                    <span className="side__file-meta">
                      {item.source.image ? "Image" : <span className="mono">{formatClock(item.source.duration)}</span>}
                      {item.source.live && " · recording live"}
                      {item.missing
                        ? " · file not found"
                        : downloading.has(item.id)
                          ? previewReady[item.id] !== undefined
                            ? ` · downloading, ${Math.floor(previewReady[item.id])}% ready to scrub`
                            : " · downloading…"
                          : preparing.has(item.id)
                            ? " · preparing preview…"
                          : captioning[item.id]
                            ? ` · ${captioning[item.id]}`
                          : item.source.local
                            ? " · this PC"
                            : " · link"}
                    </span>
                  </span>
                  {onDownload && !item.source.local && !downloading.has(item.id) && (
                    <button
                      type="button"
                      className="btn btn--icon"
                      aria-label={`Download ${item.name} for editing`}
                      title="Download the whole video, so it edits smoothly and works offline"
                      onClick={() => onDownload(item.id)}
                    >
                      <Icon name="download" size={14} />
                    </button>
                  )}
                  <button type="button" className="btn btn--icon" aria-label={`Add ${item.name} to the timeline`} title="Add to the timeline" onClick={() => onAddMedia(item.id)}>
                    <Icon name="plus" size={14} />
                  </button>
                  {!usedMedia.has(item.id) && (
                    <button type="button" className="btn btn--icon" aria-label={`Remove ${item.name} from media`} title="Remove" onClick={() => onRemoveMedia(item.id)}>
                      <Icon name="x" size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ul className="side__nav side__bottom">{item({ id: "settings", label: "Settings", icon: "sliders" })}</ul>

      {engineTrouble && (
      <section className="side__engines" aria-label="Engines">
        {!collapsed && <h2 className="section-label">Engines</h2>}
        <EngineRow name="yt-dlp" engines={engines} pick={(e) => e.ytDlp} collapsed={collapsed} />
        <EngineRow name="FFmpeg" engines={engines} pick={(e) => e.ffmpeg} collapsed={collapsed} />
        {!collapsed && engines === "browser" && (
          <p className="side__hint">Browser preview. Downloads are simulated; open the desktop app to export for real.</p>
        )}
        {!collapsed && typeof engines === "object" && (!engines.ytDlp || !engines.ffmpeg) && (
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
  collapsed,
}: {
  name: string;
  engines: SidebarProps["engines"];
  pick: (e: EngineStatus) => string | null;
  collapsed: boolean;
}) {
  const version = typeof engines === "object" ? pick(engines) : null;
  const state = version ?? (engines === "checking" ? "Checking…" : "Not connected");
  return (
    <div className="side__engine" title={collapsed ? `${name}: ${state}` : undefined}>
      <span className={version ? "side__dot is-ok" : engines === "checking" ? "side__dot is-checking" : "side__dot"} aria-hidden="true" />
      {!collapsed && (
        <>
          <span className="side__engine-name">{name}</span>
          <span className={version ? "side__engine-state mono" : "side__engine-state"}>{state}</span>
        </>
      )}
      {collapsed && <span className="sr-only">{`${name}: ${state}`}</span>}
    </div>
  );
}

