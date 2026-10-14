import type { Job } from "../types";
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
  /** Present when a project is in progress. */
  current?: { clips: number; duration: number; onContinue: () => void };
  recent: Job[];
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

export function Home({ onImport, onPasteLink, onTrySample, busy, current, recent }: HomeProps) {
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

            {current && (
              <>
                <h2 className="section-label home__gap">Continue</h2>
                <button type="button" className="home__continue" onClick={current.onContinue}>
                  <Icon name="scissors" size={16} />
                  <span>
                    Your project · {current.clips} clip{current.clips === 1 ? "" : "s"} · <span className="mono">{formatClock(current.duration)}</span>
                  </span>
                  <span className="home__open">Open editor</span>
                </button>
              </>
            )}
          </div>

          <div className="home__col">
            <h2 className="section-label">Recent exports</h2>
            {recent.length === 0 ? (
              <p className="home__muted">Nothing exported yet. Finished files land in Videos\Craftora.</p>
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
