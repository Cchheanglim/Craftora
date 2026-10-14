import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AudioContainer, ExportSettings, VideoContainer } from "../types";
import { FRAMES, formatSize, type ExportPlan } from "../project/exportPlan";
import { Icon } from "./Icon";
import "./ExportPanel.css";

interface ExportPanelProps {
  settings: ExportSettings;
  onChange: (patch: Partial<ExportSettings>) => void;
  plan: ExportPlan;
  /** Whether Fast/Precise applies (a single untouched clip). */
  cutModeApplies: boolean;
  /** Whether anything on the timeline has a picture. */
  hasPicture: boolean;
  onAddToQueue: () => void;
  /** Bumps each time a job is queued, to replay the confirmation. */
  queuedCount: number;
  /** The selected clip's settings, shown above the export settings. */
  children?: ReactNode;
}

const VIDEO_CONTAINERS: VideoContainer[] = ["mp4", "mkv"];
const AUDIO_CONTAINERS: AudioContainer[] = ["mp3", "wav", "flac"];

export function ExportPanel({ settings, onChange, plan, cutModeApplies, hasPicture, onAddToQueue, queuedCount, children }: ExportPanelProps) {
  const [copied, setCopied] = useState(false);
  const [moreBelow, setMoreBelow] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const isVideo = settings.output === "video";
  const ready = plan.kind !== "empty";

  // Show the "More settings below" bar while the end of the settings is out of view.
  useEffect(() => {
    const body = bodyRef.current;
    const end = endRef.current;
    if (!body || !end) return;
    const observer = new IntersectionObserver(([entry]) => setMoreBelow(!entry.isIntersecting), { root: body });
    observer.observe(end);
    return () => observer.disconnect();
  }, []);

  const copy = async () => {
    if (plan.kind === "empty") return;
    try {
      await navigator.clipboard.writeText(plan.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className="export" aria-label="Clip and export settings">
      <div ref={bodyRef} className="export__body">
        {children}

        <h2 className="export__title">Export</h2>

        <fieldset>
          <legend className="section-label">Output</legend>
          <div className="export__output">
            <div className="segmented" role="group" aria-label="Output type">
              <button type="button" aria-pressed={isVideo} disabled={!hasPicture} onClick={() => onChange({ output: "video" })}>
                Video
              </button>
              <button type="button" aria-pressed={!isVideo} onClick={() => onChange({ output: "audio" })}>
                Audio only
              </button>
            </div>
            <label htmlFor="container" className="sr-only">
              File type
            </label>
            {isVideo ? (
              <select id="container" className="field mono" value={settings.videoContainer} onChange={(e) => onChange({ videoContainer: e.target.value as VideoContainer })}>
                {VIDEO_CONTAINERS.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
            ) : (
              <select id="container" className="field mono" value={settings.audioContainer} onChange={(e) => onChange({ audioContainer: e.target.value as AudioContainer })}>
                {AUDIO_CONTAINERS.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
            )}
          </div>
        </fieldset>

        {isVideo && plan.kind === "render" && (
          <div className="export__field">
            <label htmlFor="frame" className="section-label">
              Frame
            </label>
            <select id="frame" className="field" value={settings.frameId} onChange={(e) => onChange({ frameId: e.target.value })}>
              {FRAMES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <fieldset>
          <legend className="section-label">Cut mode</legend>
          {cutModeApplies ? (
            <>
              <div className="segmented" role="group" aria-label="Cut mode" aria-describedby="cut-mode-detail">
                <button type="button" aria-pressed={settings.cutMode === "fast"} onClick={() => onChange({ cutMode: "fast" })}>
                  Fast
                </button>
                <button type="button" aria-pressed={settings.cutMode === "precise"} onClick={() => onChange({ cutMode: "precise" })}>
                  Precise
                </button>
              </div>
              <p id="cut-mode-detail" className="export__trade">
                {settings.cutMode === "fast"
                  ? "Keeps original quality, no re-encoding. The start snaps to the nearest keyframe and can shift a second or two."
                  : "Frame-accurate. Re-encodes the clip, so it's slower and compressed again."}
              </p>
            </>
          ) : (
            <p className="export__trade">
              {ready
                ? "Your timeline is rendered as one new video: frame-accurate, every edit included. A single untouched clip can use the faster lossless cut instead."
                : "Add something to the timeline first."}
            </p>
          )}
        </fieldset>

        {ready && (
          <details className="export__command">
            <summary>
              <Icon name="terminal" size={14} />
              Command that will run
              <Icon name="chevronDown" size={14} className="export__chevron" />
            </summary>
            <div className="export__code">
              <pre className="mono">{plan.command}</pre>
              <button type="button" className="btn btn--ghost" onClick={copy}>
                <Icon name={copied ? "check" : "copy"} size={13} />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </details>
        )}
        <div ref={endRef} className="export__end" aria-hidden="true" />

        {moreBelow && (
          <button
            type="button"
            className="export__more"
            onClick={() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" })}
          >
            More settings below
            <Icon name="chevronDown" size={14} />
          </button>
        )}
      </div>

      <div className="export__foot">
        {ready && (
          <dl className="export__summary">
            <dt>File</dt>
            <dd className="mono truncate" title={plan.fileName}>
              {plan.fileName}
            </dd>
            <dt>Size</dt>
            <dd className="mono">≈ {formatSize(plan.sizeMb)}</dd>
            <dt>Save to</dt>
            <dd className="mono truncate">Videos\Craftora</dd>
          </dl>
        )}
        <button type="button" className="btn btn--primary export__add" onClick={onAddToQueue} disabled={!ready}>
          <span key={queuedCount} className={queuedCount > 0 ? "export__add-label is-queued" : "export__add-label"}>
            Add to queue
          </span>
          <kbd>Ctrl ↵</kbd>
        </button>
      </div>
    </aside>
  );
}
