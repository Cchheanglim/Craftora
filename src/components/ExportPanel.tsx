import { useEffect, useRef, useState } from "react";
import type { AudioContainer, ExportSettings, MediaSource, OutputKind, VideoContainer } from "../types";
import { formatSize, type ExportPlan } from "../lib/exportPlan";
import { Icon } from "./Icon";
import "./ExportPanel.css";

interface ExportPanelProps {
  source: MediaSource;
  settings: ExportSettings;
  plan: ExportPlan;
  onChange: (patch: Partial<ExportSettings>) => void;
  onAddToQueue: () => void;
  /** Bumps each time a job is queued, to replay the confirmation. */
  queuedCount: number;
}

const VIDEO_CONTAINERS: VideoContainer[] = ["mp4", "mkv"];
const AUDIO_CONTAINERS: AudioContainer[] = ["mp3", "wav", "flac"];

export function ExportPanel({ source, settings, plan, onChange, onAddToQueue, queuedCount }: ExportPanelProps) {
  const [copied, setCopied] = useState(false);
  const [moreBelow, setMoreBelow] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const isVideo = settings.output === "video";

  // Show the "More settings below" bar while the end of the settings is out of view.
  // The marker sits before the bar, so showing the bar never moves it.
  useEffect(() => {
    const body = bodyRef.current;
    const end = endRef.current;
    if (!body || !end) return;
    const observer = new IntersectionObserver(([entry]) => setMoreBelow(!entry.isIntersecting), { root: body });
    observer.observe(end);
    return () => observer.disconnect();
  }, []);
  const streams = source.streams.filter((s) => s.kind === settings.output);
  const hasAudioStreams = source.streams.some((s) => s.kind === "audio");

  const setOutput = (output: OutputKind) => onChange({ output });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plan.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className="export" aria-label="Export settings">
      <div ref={bodyRef} className="export__body">
        <h2 className="export__title">Export</h2>

        <fieldset>
          <legend className="section-label">Output</legend>
          <div className="export__output">
            <div className="segmented" role="group" aria-label="Output type">
              <button type="button" aria-pressed={isVideo} onClick={() => setOutput("video")}>
                Video
              </button>
              <button type="button" aria-pressed={!isVideo} onClick={() => setOutput("audio")} disabled={!hasAudioStreams}>
                Audio only
              </button>
            </div>
            <label htmlFor="container" className="sr-only">
              File type
            </label>
            {isVideo ? (
              <select
                id="container"
                className="field mono"
                value={settings.videoContainer}
                onChange={(e) => onChange({ videoContainer: e.target.value as VideoContainer })}
              >
                {VIDEO_CONTAINERS.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
            ) : (
              <select
                id="container"
                className="field mono"
                value={settings.audioContainer}
                onChange={(e) => onChange({ audioContainer: e.target.value as AudioContainer })}
              >
                {AUDIO_CONTAINERS.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className="section-label">Source quality</legend>
          <div className="export__stack">
            {streams.map((s) => (
              <label key={s.id} className="option">
                <input
                  type="radio"
                  name="stream"
                  checked={plan.stream.id === s.id}
                  onChange={() => onChange(isVideo ? { videoStreamId: s.id } : { audioStreamId: s.id })}
                />
                <span className="export__stream">
                  <span>{s.label}</span>
                  <span className="export__detail mono truncate">{s.detail}</span>
                </span>
                <span className="export__size mono">~{formatSize(s.sizeMb)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {isVideo && (
          <fieldset>
            <legend className="section-label">Transform</legend>
            <div className="export__pair">
              <label className="option">
                <input type="checkbox" checked={settings.mirror} onChange={(e) => onChange({ mirror: e.target.checked })} />
                <span>Mirror</span>
              </label>
              <label className="option">
                <input type="checkbox" checked={settings.reverse} onChange={(e) => onChange({ reverse: e.target.checked })} />
                <span>Reverse</span>
              </label>
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend className="section-label">Cut mode</legend>
          <div className="segmented" role="group" aria-label="Cut mode" aria-describedby="cut-mode-detail">
            <button
              type="button"
              aria-pressed={plan.cutMode === "fast"}
              disabled={plan.cutForced}
              onClick={() => onChange({ cutMode: "fast" })}
            >
              Fast
            </button>
            <button type="button" aria-pressed={plan.cutMode === "precise"} onClick={() => onChange({ cutMode: "precise" })}>
              Precise
            </button>
          </div>
          <p id="cut-mode-detail" className={plan.cutForced ? "export__trade is-forced" : "export__trade"}>
            {plan.cutForced && <Icon name="alert" size={13} />}
            {plan.cutForced
              ? "Mirror and reverse need re-encoding, so Precise is used: frame-accurate, slower."
              : plan.cutMode === "fast"
                ? "Keeps original quality, no re-encoding. The start snaps to the nearest keyframe and can shift a second or two."
                : "Frame-accurate. Re-encodes the clip, so it's slower and compressed again."}
          </p>
        </fieldset>

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

      <div className={moreBelow ? "export__foot has-more" : "export__foot"}>
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
        <button type="button" className="btn btn--primary export__add" onClick={onAddToQueue}>
          <span key={queuedCount} className={queuedCount > 0 ? "export__add-label is-queued" : "export__add-label"}>
            Add to queue
          </span>
          <kbd>Ctrl ↵</kbd>
        </button>
      </div>
    </aside>
  );
}
