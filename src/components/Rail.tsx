import type { EngineStatus } from "../lib/engine";
import { Icon } from "./Icon";
import "./Rail.css";

export type View = "workspace" | "library";

interface RailProps {
  view: View;
  onViewChange: (view: View) => void;
  libraryCount: number;
  /** "browser" in a plain browser tab, where downloads are simulated. */
  engines: EngineStatus | "checking" | "browser";
}

export function Rail({ view, onViewChange, libraryCount, engines }: RailProps) {
  return (
    <nav className="rail" aria-label="Main">
      <ul className="rail__nav">
        <li>
          <button
            type="button"
            className="rail__item"
            aria-current={view === "workspace" ? "page" : undefined}
            onClick={() => onViewChange("workspace")}
          >
            <Icon name="scissors" size={15} />
            <span>Workspace</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className="rail__item"
            aria-current={view === "library" ? "page" : undefined}
            onClick={() => onViewChange("library")}
          >
            <Icon name="folder" size={15} />
            <span>Library</span>
            {libraryCount > 0 && <span className="rail__count mono">{libraryCount}</span>}
          </button>
        </li>
      </ul>

      <section className="rail__engines" aria-label="Engines">
        <h2 className="section-label">Engines</h2>
        {typeof engines === "string" ? (
          <>
            <EngineRow name="yt-dlp" version={null} checking={engines === "checking"} />
            <EngineRow name="FFmpeg" version={null} checking={engines === "checking"} />
            {engines === "browser" && (
              <p className="rail__hint">Browser preview. Downloads are simulated; open the desktop app to download for real.</p>
            )}
          </>
        ) : (
          <>
            <EngineRow name="yt-dlp" version={engines.ytDlp} />
            <EngineRow name="FFmpeg" version={engines.ffmpeg} />
            {(!engines.ytDlp || !engines.ffmpeg) && (
              <p className="rail__hint">An engine is missing. Run scripts/fetch-sidecars.ps1, then restart Craftora.</p>
            )}
          </>
        )}
      </section>
    </nav>
  );
}

function EngineRow({ name, version, checking = false }: { name: string; version: string | null; checking?: boolean }) {
  return (
    <div className="rail__engine">
      <span className={version ? "rail__dot is-ok" : checking ? "rail__dot is-checking" : "rail__dot"} aria-hidden="true" />
      <span className="rail__engine-name">{name}</span>
      <span className={version ? "rail__engine-state mono" : "rail__engine-state"}>
        {version ?? (checking ? "Checking…" : "Not connected")}
      </span>
    </div>
  );
}
