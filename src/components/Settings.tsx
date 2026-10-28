import type { OutputKind } from "../types";
import { Icon } from "./Icon";
import { Links, type LinkSettings } from "./Home";
import "./Library.css";

interface SettingsProps {
  outputDir: string;
  /** Picks the save folder; absent in the browser preview. */
  onChooseOutputDir?: () => void;
  /** What a new project exports as. */
  defaultOutput: OutputKind;
  onDefaultOutput: (output: OutputKind) => void;
  /** How many downloads and exports run at the same time. */
  maxRunning: number;
  onMaxRunning: (count: number) => void;
  /** Settings for fetching links; absent in the browser preview. */
  links?: LinkSettings;
  /** Make captions from the sound for videos that come without any. */
  autoCaptions: boolean;
  onAutoCaptions: (on: boolean) => void;
}

export function Settings({ outputDir, onChooseOutputDir, defaultOutput, onDefaultOutput, maxRunning, onMaxRunning, links, autoCaptions, onAutoCaptions }: SettingsProps) {
  return (
    <section className="library" aria-labelledby="settings-title">
      <header className="library__head">
        <h1 id="settings-title">Settings</h1>
        <p>Where files go, what new projects export, and how links are fetched.</p>
      </header>

      <div className="library__group">
        <h2 className="section-label">Saving</h2>
        <div className="library__save">
          <span>Exports go to</span>
          <span className="mono truncate">{outputDir}</span>
          {onChooseOutputDir && (
            <button type="button" className="btn btn--secondary" onClick={onChooseOutputDir}>
              <Icon name="folder" size={14} />
              Change
            </button>
          )}
        </div>
        <div className="library__save">
          <span>Downloads go to</span>
          <span className="mono truncate">{outputDir}\Downloads</span>
        </div>
      </div>

      <div className="library__group">
        <h2 className="section-label">New projects export as</h2>
        <div className="segmented library__choice" role="group" aria-label="New projects export as">
          <button type="button" aria-pressed={defaultOutput === "video"} onClick={() => onDefaultOutput("video")}>
            Video (MP4)
          </button>
          <button type="button" aria-pressed={defaultOutput === "audio"} onClick={() => onDefaultOutput("audio")}>
            Sound only (MP3)
          </button>
        </div>
      </div>

      <div className="library__group">
        <h2 className="section-label">Downloads and exports at the same time</h2>
        <div className="segmented library__choice" role="group" aria-label="Downloads and exports at the same time">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" aria-pressed={maxRunning === n} onClick={() => onMaxRunning(n)}>
              {n}
            </button>
          ))}
        </div>
        <p className="library__muted">More at once finishes a long queue sooner but makes each job slower. Live recordings don't count.</p>
      </div>

      <div className="library__group">
        <h2 className="section-label">Captions for videos without any</h2>
        <div className="segmented library__choice" role="group" aria-label="Captions for videos without any">
          <button type="button" aria-pressed={autoCaptions} onClick={() => onAutoCaptions(true)}>
            Make them from the sound
          </button>
          <button type="button" aria-pressed={!autoCaptions} onClick={() => onAutoCaptions(false)}>
            Off
          </button>
        </div>
        <p className="library__muted">
          Craftora listens to what's said and writes it down, on this PC: nothing is sent anywhere. The first time, it downloads a
          148 MB speech model. A long video takes a few minutes and keeps the processor busy meanwhile.
        </p>
      </div>

      {links && (
        <div className="library__group">
          <Links links={links} />
        </div>
      )}
    </section>
  );
}
