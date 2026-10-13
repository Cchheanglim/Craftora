import { Icon } from "./Icon";
import "./Rail.css";

export type View = "workspace" | "library";

interface RailProps {
  view: View;
  onViewChange: (view: View) => void;
  libraryCount: number;
}

export function Rail({ view, onViewChange, libraryCount }: RailProps) {
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
        <EngineRow name="yt-dlp" />
        <EngineRow name="FFmpeg" />
        <p className="rail__hint">Preview mode. Downloads are simulated until the engines are connected.</p>
      </section>
    </nav>
  );
}

function EngineRow({ name }: { name: string }) {
  return (
    <div className="rail__engine">
      <span className="rail__dot" aria-hidden="true" />
      <span className="rail__engine-name">{name}</span>
      <span className="rail__engine-state">Not connected</span>
    </div>
  );
}
