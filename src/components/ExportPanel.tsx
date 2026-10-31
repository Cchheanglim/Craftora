import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AudioContainer, ExportSettings, VideoContainer } from "../types";
import { FRAMES, formatSize, type ExportPlan } from "../project/exportPlan";
import { Icon } from "./Icon";
import { useConfirm } from "./ConfirmDialog";
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
  /** Captions are on (CC) and will be drawn into the picture. */
  captionsDrawn: boolean;
  /** Bumps each time a job is queued, to replay the confirmation. */
  queuedCount: number;
  /** Where exports are saved. */
  outputDir: string;
  /** Absent in the browser preview. */
  onChooseOutputDir?: () => void;
  /** What does the work for "Fast", e.g. "your NVIDIA graphics card"; null while checking. */
  fastEncoder: string | null;
  /** A preset: picks the frame and sets every picture to fill it (or to fit). */
  onPreset: (frameId: string, fill: boolean) => void;
  /** The selected clip's settings, shown above the export settings. */
  children?: ReactNode;
}

/** One click for the usual places a video goes. */
const PRESETS = [
  { label: "YouTube", detail: "16:9", frameId: "1080p", fill: false },
  { label: "TikTok · Reels · Shorts", detail: "9:16", frameId: "vertical", fill: true },
  { label: "Instagram post", detail: "1:1", frameId: "square", fill: true },
];

const VIDEO_CONTAINERS: VideoContainer[] = ["mp4", "mkv"];
const AUDIO_CONTAINERS: AudioContainer[] = ["mp3", "wav", "flac"];

export function ExportPanel({
  settings,
  onChange,
  plan,
  cutModeApplies,
  hasPicture,
  onAddToQueue,
  captionsDrawn,
  queuedCount,
  outputDir,
  onChooseOutputDir,
  fastEncoder,
  onPreset,
  children,
}: ExportPanelProps) {
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

  const { ask, dialog } = useConfirm();
  // What the file will be, before it's queued: quality, how it's made, size, where it goes.
  const confirmAdd = async () => {
    if (plan.kind === "empty") return;
    const how =
      plan.kind === "simple"
        ? !isVideo
          ? `The sound only, as ${plan.fileName.split(".").pop()?.toUpperCase()}.`
          : settings.cutMode === "fast"
            ? "Copied as it is: no quality lost. The start snaps to the nearest keyframe, up to a second or two early."
            : "Re-made only around the cut, so it starts exactly where you set it."
        : !isVideo
          ? "The timeline's sound, mixed into one file."
          : settings.quality === "fast"
            ? `Re-made quickly${fastEncoder ? ` with ${fastEncoder}` : ""} (Fast).`
            : "Re-made at the best quality, slower and smaller (Best).";
    const rows: [string, string][] = [
      [isVideo ? "Picture" : "Sound", plan.quality],
      ["How", how],
      ["What", plan.summary],
      ["File", `${plan.fileName} · ≈ ${formatSize(plan.sizeMb)}`],
      ["Saves to", outputDir],
    ];
    if (isVideo && captionsDrawn) rows.push(["Captions", "On: drawn into the picture. Turn CC off on the preview to leave them out."]);
    const ok = await ask({
      title: "Add to queue?",
      message: (
        <dl className="export__summary">
          {rows.map(([term, text]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      ),
      confirmLabel: "Add to queue",
      note: "You can cancel it from the queue while it runs.",
    });
    if (ok) onAddToQueue();
  };

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

        {isVideo && hasPicture && (
          <fieldset>
            <legend className="section-label">Made for</legend>
            <div className="export__presets">
              {PRESETS.map((p) => (
                <button key={p.frameId} type="button" className="export__preset" aria-pressed={settings.frameId === p.frameId} onClick={() => onPreset(p.frameId, p.fill)}>
                  <strong>{p.label}</strong>
                  <span>{p.detail}</span>
                </button>
              ))}
            </div>
            <p className="export__hint">Picks the frame. For upright and square ones, every picture fills the frame (edges cut off) instead of showing black bars.</p>
          </fieldset>
        )}

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

        {isVideo && plan.kind === "render" && (
          <fieldset>
            <legend className="section-label">Speed</legend>
            <div className="segmented" role="group" aria-label="Export speed" aria-describedby="speed-detail">
              <button type="button" aria-pressed={settings.quality === "fast"} onClick={() => onChange({ quality: "fast" })}>
                Fast
              </button>
              <button type="button" aria-pressed={settings.quality === "best"} onClick={() => onChange({ quality: "best" })}>
                Best quality
              </button>
            </div>
            <p id="speed-detail" className="export__trade">
              {settings.quality === "fast"
                ? fastEncoder && fastEncoder !== "the processor"
                  ? `Uses ${fastEncoder}: several times quicker. Files are a little larger.`
                  : "Uses a quick setting on the processor. No graphics card encoder was found."
                : "Uses the processor at a careful setting: the smallest, cleanest file, but it takes several times longer."}
            </p>
          </fieldset>
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
            <dt>
              <label htmlFor="export-name">File</label>
            </dt>
            <dd className="export__name">
              <input
                id="export-name"
                className="field mono"
                value={settings.name ?? plan.fileName.replace(/\.[^.]+$/, "")}
                placeholder={plan.fileName.replace(/\.[^.]+$/, "")}
                maxLength={80}
                spellCheck={false}
                title="Name the file, so you can tell your exports apart"
                // What Windows doesn't allow in a file name can't be typed.
                onChange={(e) => onChange({ name: e.target.value.replace(/[\\/:*?"<>|%\u0000-\u001f]/g, "") })}
              />
              <span className="mono">.{plan.fileName.split(".").pop()}</span>
            </dd>
            <dt>Size</dt>
            <dd className="mono">≈ {formatSize(plan.sizeMb)}</dd>
            <dt>Save to</dt>
            <dd className="export__folder">
              <span className="mono truncate" title={outputDir}>
                {outputDir}
              </span>
              {onChooseOutputDir && (
                <button type="button" className="export__change" onClick={onChooseOutputDir}>
                  Change
                </button>
              )}
            </dd>
          </dl>
        )}
        <button type="button" className="btn btn--primary export__add" onClick={() => void confirmAdd()} disabled={!ready}>
          <span key={queuedCount} className={queuedCount > 0 ? "export__add-label is-queued" : "export__add-label"}>
            Add to queue
          </span>
          <kbd>Ctrl ↵</kbd>
        </button>
        {plan.kind === "empty" && <p className="export__hint">{plan.reason}</p>}
      </div>
      {dialog}
    </aside>
  );
}
