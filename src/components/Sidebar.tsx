import type { EngineStatus } from "../lib/engine";
import type { MediaItem } from "../project/model";
import { formatClock } from "../lib/timecode";
import { Icon } from "./Icon";
import { MEDIA_DRAG_TYPE } from "./TimelineEditor";
import "./Sidebar.css";

export type View = "home" | "editor" | "library";

interface SidebarProps {
  view: View;
  onViewChange: (view: View) => void;
  collapsed: boolean;
  libraryCount: number;
  /** "browser" in a plain browser tab, where downloads are simulated. */
  engines: EngineStatus | "checking" | "browser";
  media: MediaItem[];
  /** Media whose preview copy is still being made. */
  preparing: Set<string>;
  /** Absent in the browser preview. */
  onImport?: () => void;
  onAddMedia: (mediaId: string) => void;
  onRemoveMedia: (mediaId: string) => void;
  /** Media used on the timeline can't be removed without removing its clips. */
  usedMedia: Set<string>;
}

export function Sidebar({
  view,
  onViewChange,
  collapsed,
  libraryCount,
  engines,
  media,
  preparing,
  onImport,
  onAddMedia,
  onRemoveMedia,
  usedMedia,
}: SidebarProps) {
  const nav = [
    { id: "home" as const, label: "Home", icon: "logo" as const },
    { id: "editor" as const, label: "Editor", icon: "scissors" as const },
    { id: "library" as const, label: "Exports", icon: "folder" as const, count: libraryCount },
  ];

  return (
    <nav className={collapsed ? "side is-collapsed" : "side"} aria-label="Main">
      <ul className="side__nav">
        {nav.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="side__item"
              aria-current={view === item.id ? "page" : undefined}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
              onClick={() => onViewChange(item.id)}
            >
              <Icon name={item.icon} size={15} />
              <span className="side__text">{item.label}</span>
              {item.count ? <span className="side__count mono">{item.count}</span> : null}
            </button>
          </li>
        ))}
      </ul>

      {!collapsed && (
        <section className="side__media" aria-labelledby="media-title">
          <header className="side__media-head">
            <h2 id="media-title" className="section-label">
              Media
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
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(MEDIA_DRAG_TYPE, item.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  title="Drag onto the timeline, or press + to add at the end"
                >
                  <Icon name={item.hasVideo ? "film" : "music"} size={14} />
                  <span className="side__file-text">
                    <span className="truncate">{item.name}</span>
                    <span className="side__file-meta">
                      <span className="mono">{formatClock(item.source.duration)}</span>
                      {item.missing
                        ? " · file not found"
                        : preparing.has(item.id)
                          ? " · preparing preview…"
                          : item.source.local
                            ? " · this PC"
                            : " · link"}
                    </span>
                  </span>
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
