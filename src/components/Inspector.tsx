import type { ClipPatch } from "../project/actions";
import {
  MAX_CROP,
  NO_CROP,
  POSITIONS,
  SPEEDS,
  TEXT_FONTS,
  TRANSITION_KINDS,
  clipEnd,
  clipLength,
  isBlock as blockClip,
  isCropped,
  isShape as shapeClip,
  isText as textClip,
  presetAt,
  type CaptionLayout,
  type Clip,
  type Crop,
  type MediaItem,
  type Position,
  type TextEdge,
  type TextFont,
  type Track,
  type Transition,
} from "../project/model";
import { formatClock } from "../lib/timecode";
import { formatSize } from "../project/exportPlan";
import { Icon } from "./Icon";
import { ADJUSTMENTS, LOOKS, PICTURE_EFFECTS, adjustSteps, blockLabel } from "../project/effects";
import { SHAPES, shapeLabel } from "../project/shapes";
import "./Inspector.css";

const TEXT_COLORS = [
  { label: "White", value: "#ffffff" },
  { label: "Yellow", value: "#ffd60a" },
  { label: "Black", value: "#111111" },
  { label: "Blue", value: "#4da3ff" },
  { label: "Green", value: "#30d158" },
  { label: "Pink", value: "#ff6fb1" },
];
const CROP_SIDES: { side: keyof Crop; label: string }[] = [
  { side: "left", label: "Left" },
  { side: "right", label: "Right" },
  { side: "top", label: "Top" },
  { side: "bottom", label: "Bottom" },
];
/** Longest fade offered, in seconds. */
const MAX_FADE = 5;

interface InspectorProps {
  clip: Clip;
  track: Track;
  media?: MediaItem;
  /** Applies a change; `live` skips the undo step (use after `checkpoint`). */
  onChange: (patch: ClipPatch, live?: boolean) => void;
  /** Still images and text: sets how many seconds the clip stays on screen. */
  onDuration?: (seconds: number, live?: boolean) => void;
  onSpeed: (speed: number) => void;
  /** Video 1 clips after the first: set the transition into this clip (`live` as in onChange). */
  onTransition?: (transition: Transition | null, live?: boolean) => void;
  onCheckpoint: () => void;
  onFormat: (format: { videoFormat?: string; audioFormat?: string }) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onCutSilences?: () => void;
  cuttingSilences?: boolean;
  onSplitChapters?: () => void;
  /** The video came with captions: put them on the timeline as text. */
  onAddCaptions?: () => void;
  onDelete: () => void;
  /** A moved or renamed file: let the user find it. */
  onRelink: (media: MediaItem) => void;
  /** What the editor calls the clip's track ("Track 2"). */
  trackName: string;
  canSplit: boolean;
}

/** Settings for the selected clip. */
export function Inspector({
  clip,
  track,
  media,
  onChange,
  onDuration,
  onSpeed,
  onTransition,
  onCheckpoint,
  onFormat,
  onSplit,
  onDuplicate,
  onCutSilences,
  cuttingSilences,
  onSplitChapters,
  onAddCaptions,
  onDelete,
  onRelink,
  trackName,
  canSplit,
}: InspectorProps) {
  // A filter or effect block: only its timing is set here.
  const isBlock = blockClip(clip);
  const isShape = shapeClip(clip);
  const isText = textClip(clip);
  const isLine = Boolean(isShape && SHAPES.find((s) => s.id === clip.shape)?.line);
  const outlined = Boolean((clip.outline && clip.outline > 0) || isLine);
  const isImage = Boolean(media?.source.image);
  const isPicture = Boolean(media?.hasVideo);
  const hasSound = Boolean(media?.hasAudio);
  const streams = media && !media.source.local ? media.source.streams.filter((s) => s.kind === (isPicture ? "video" : "audio")) : [];
  const length = clipLength(clip);
  const maxSoundFade = Math.floor(length * 10) / 10;
  const maxFade = Math.min(MAX_FADE, maxSoundFade);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const sec = (v: number) => `${v.toFixed(1)} s`;

  return (
    <section className="insp" aria-labelledby="insp-title">
      <header className="insp__head">
        <Icon name={isBlock ? "sparkle" : isShape ? "star" : isText ? "text" : isImage ? "image" : isPicture ? "film" : "music"} size={14} />
        <h2 id="insp-title" className="truncate">
          {isBlock ? `${clip.look ? "Filter" : "Effect"}: ${blockLabel(clip)}` : isShape ? `Shape: ${shapeLabel(clip.shape)}` : isText ? "Text" : (media?.name ?? "Clip")}
        </h2>
      </header>
      <p className="insp__meta">
        {trackName} · <span className="mono">{formatClock(clip.start)}</span> → <span className="mono">{formatClock(clipEnd(clip))}</span> ·{" "}
        <span className="mono">{formatClock(length)}</span> long
      </p>
      {media?.missing && (
        <p className="insp__warn">
          <Icon name="alert" size={13} />
          This file can't be found. It was moved, renamed or deleted.
        </p>
      )}
      {media?.missing && (
        <button type="button" className="btn btn--secondary" onClick={() => onRelink(media)}>
          <Icon name="folder" size={14} />
          Find file
        </button>
      )}

      {isBlock && (
        <p className="insp__hint">
          It changes the pictures under it while it lasts (not text). Drag it on the timeline to move it, or drag its edges to start or end it
          somewhere else.
        </p>
      )}

      {/* A filter or effect dropped on this video clip: named, with a way to take it off. */}
      {clip.mediaId &&
        ([
          ["look", "Filter", LOOKS.find((l) => l.id === clip.look)?.label],
          ["effect", "Effect", PICTURE_EFFECTS.find((f) => f.id === clip.effect)?.label],
        ] as const).map(
          ([field, kind, name]) =>
            name && (
              <p key={field} className="insp__hint">
                {kind}: {name}{" "}
                <button type="button" className="btn btn--ghost" onClick={() => onChange(field === "look" ? { look: undefined, lookAmount: undefined } : { effect: undefined })}>
                  Remove
                </button>
              </p>
            ),
        )}

      {clip.look && (
        <Slider
          id="insp-strength"
          label="Strength"
          min={0}
          max={1}
          step={0.05}
          value={clip.lookAmount ?? 1}
          format={pct}
          onCheckpoint={onCheckpoint}
          onChange={(lookAmount) => onChange({ lookAmount }, true)}
        />
      )}

      {onDuration && (
        <div className="insp__slider">
          <label htmlFor="insp-duration">Duration</label>
          <input
            id="insp-duration"
            type="range"
            min={0.5}
            max={Math.max(30, Math.ceil(length))}
            step={0.5}
            value={length}
            onPointerDown={onCheckpoint}
            onKeyDown={onCheckpoint}
            onChange={(e) => onDuration(Number(e.target.value), true)}
          />
          <label className="insp__num mono" aria-label="Duration in seconds">
            <input
              type="number"
              min={0.2}
              max={3600}
              step={0.5}
              value={Math.round(length * 10) / 10}
              onFocus={onCheckpoint}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0.2) onDuration(v, true);
              }}
            />
            <span>s</span>
          </label>
        </div>
      )}

      {isShape && (
        <>
          <ColorField color={clip.color} onChange={(color) => onChange({ color })} />
          {!isLine && (
            <fieldset className="insp__field">
              <legend>Style</legend>
              <div className="segmented" role="group" aria-label="Style">
                <button type="button" aria-pressed={!outlined} onClick={() => onChange({ outline: 0 })}>
                  Filled
                </button>
                <button
                  type="button"
                  aria-pressed={outlined}
                  onClick={() => onChange({ outline: clip.outline && clip.outline > 0 ? clip.outline : 0.01 })}
                >
                  Outline
                </button>
              </div>
            </fieldset>
          )}
          {outlined && (
            <Slider
              id="insp-outline"
              label="Thickness"
              min={0.002}
              max={0.05}
              step={0.002}
              value={clip.outline && clip.outline > 0 ? clip.outline : 0.01}
              format={(v) => `${Math.round(v * 500)}`}
              onCheckpoint={onCheckpoint}
              onChange={(outline) => onChange({ outline }, true)}
            />
          )}
          <Slider
            id="insp-opacity"
            label="Opacity"
            min={0}
            max={1}
            step={0.05}
            value={clip.opacity ?? 1}
            format={pct}
            onCheckpoint={onCheckpoint}
            onChange={(opacity) => onChange({ opacity }, true)}
          />
          <Slider
            id="insp-rotate"
            label="Angle"
            min={-180}
            max={180}
            step={1}
            value={clip.rotate ?? 0}
            format={(v) => `${Math.round(v)}°`}
            onCheckpoint={onCheckpoint}
            onChange={(rotate) => onChange({ rotate }, true)}
          />
          <Slider
            id="insp-width"
            label="Width"
            min={0.02}
            max={2}
            step={0.01}
            value={clip.size}
            format={pct}
            onCheckpoint={onCheckpoint}
            onChange={(size) => onChange({ size }, true)}
          />
          <Slider
            id="insp-height"
            label="Height"
            min={0.05}
            max={5}
            step={0.01}
            value={clip.aspect ?? 1}
            format={pct}
            onCheckpoint={onCheckpoint}
            onChange={(aspect) => onChange({ aspect }, true)}
          />
        </>
      )}

      {isText && (
        <>
          <div className="insp__field">
            <label htmlFor="insp-text">Text</label>
            <textarea
              id="insp-text"
              className="field insp__textarea"
              value={clip.text ?? ""}
              rows={3}
              maxLength={500}
              onFocus={onCheckpoint}
              onChange={(e) => onChange({ text: e.target.value }, true)}
            />
          </div>
          {/* A caption's size, place and look are set for all captions at once (Captions, above). */}
          {track.name !== "Captions" && (
            <>
              <Slider id="insp-text-size" label="Size" min={0.02} max={0.3} step={0.005} value={clip.size} format={pct} onCheckpoint={onCheckpoint} onChange={(size) => onChange({ size }, true)} />
              <PositionSelect clip={clip} onChange={onChange} />
              <TextLook id="insp" look={clip} onChange={onChange} />
            </>
          )}
        </>
      )}

      {isPicture && (
        <>
          <p className="insp__hint">Drag the picture on the preview to move it; drag a corner to resize.</p>
          <Slider id="insp-size" label="Size" min={0.1} max={1} step={0.01} value={clip.size} format={pct} onCheckpoint={onCheckpoint} onChange={(size) => onChange({ size }, true)} />
          <PositionSelect clip={clip} onChange={onChange} />
        </>
      )}

      {isPicture && (
        <fieldset className="insp__group">
          <legend>
            Crop
            {isCropped(clip.crop) && (
              <button type="button" className="insp__reset" onClick={() => onChange({ crop: NO_CROP })}>
                Reset
              </button>
            )}
          </legend>
          {CROP_SIDES.map(({ side, label }) => (
            <Slider
              key={side}
              id={`insp-crop-${side}`}
              label={label}
              min={0}
              max={MAX_CROP}
              step={0.005}
              value={clip.crop[side]}
              format={pct}
              onCheckpoint={onCheckpoint}
              onChange={(v) => onChange({ crop: { ...clip.crop, [side]: v } }, true)}
            />
          ))}
        </fieldset>
      )}

      {isPicture && (
        <div className="insp__pair">
          <label className="option">
            <input type="checkbox" checked={clip.mirror} onChange={(e) => onChange({ mirror: e.target.checked })} />
            <span>Mirror</span>
          </label>
          <button type="button" className="btn btn--ghost insp__rotate" title="Turn it a quarter clockwise" onClick={() => onChange({ rotate: ((clip.rotate ?? 0) + 90) % 360 || undefined })}>
            <Icon name="rotate" size={14} />
            Rotate{clip.rotate ? ` · ${clip.rotate}°` : ""}
          </button>
          <label className="option" title="Cover the whole frame, cutting off the edges, instead of showing black bars">
            <input type="checkbox" checked={Boolean(clip.fill)} onChange={(e) => onChange({ fill: e.target.checked })} />
            <span>Fill the frame</span>
          </label>
        </div>
      )}

      {(isPicture || (isBlock && clip.look)) && (
        <fieldset className="insp__group">
          <legend>
            Adjust
            {adjustSteps(clip.adjust).length > 0 && (
              <button type="button" className="insp__reset" onClick={() => onChange({ adjust: undefined })}>
                Reset
              </button>
            )}
          </legend>
          {ADJUSTMENTS.map(({ id, label }) => (
            <Slider
              key={id}
              id={`insp-adjust-${id}`}
              label={label}
              min={-100}
              max={100}
              step={1}
              value={clip.adjust?.[id] ?? 0}
              format={(v) => (v > 0 ? `+${v}` : String(v))}
              onCheckpoint={onCheckpoint}
              onChange={(v) => onChange({ adjust: { ...clip.adjust, [id]: v } }, true)}
            />
          ))}
        </fieldset>
      )}

      {!isText && !isShape && !isImage && !isBlock && (
        <div className="insp__field">
          <label htmlFor="insp-speed">Speed</label>
          <select id="insp-speed" className="field" value={clip.speed} onChange={(e) => onSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×{s === 1 ? " (normal)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {!isText && !isShape && !isBlock && !onTransition && (
        <p className="insp__hint">To add a transition, put this clip right after another one and click the + where they meet.</p>
      )}

      {onTransition && (
        <fieldset className="insp__group">
          <legend>Transition from the clip before</legend>
          <label htmlFor="insp-transition" className="sr-only">
            Transition
          </label>
          <select
            id="insp-transition"
            className="field"
            value={clip.transition?.kind ?? "none"}
            onChange={(e) => {
              const kind = e.target.value;
              onTransition(kind === "none" ? null : { kind: kind as Transition["kind"], duration: clip.transition?.duration ?? 1 });
            }}
          >
            <option value="none">None (straight cut)</option>
            {TRANSITION_KINDS.map((t) => (
              <option key={t.kind} value={t.kind}>
                {t.label}
              </option>
            ))}
          </select>
          {clip.transition && (
            <Slider
              id="insp-transition-length"
              label="Length"
              min={0.1}
              max={3}
              step={0.1}
              value={clip.transition.duration}
              format={sec}
              onCheckpoint={onCheckpoint}
              onChange={(duration) => onTransition({ ...clip.transition!, duration }, true)}
            />
          )}
        </fieldset>
      )}

      {!isBlock && (
      <fieldset className="insp__group">
        <legend>Fade</legend>
        <Slider id="insp-fade-in" label="In" min={0} max={maxFade} step={0.1} value={clip.fadeIn} format={sec} onCheckpoint={onCheckpoint} onChange={(fadeIn) => onChange({ fadeIn }, true)} />
        <Slider id="insp-fade-out" label="Out" min={0} max={maxFade} step={0.1} value={clip.fadeOut} format={sec} onCheckpoint={onCheckpoint} onChange={(fadeOut) => onChange({ fadeOut }, true)} />
      </fieldset>
      )}

      {!isText &&
        !isShape &&
        !isImage &&
        !isBlock &&
        (hasSound ? (
          <>
            <Slider
              id="insp-volume"
              label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={clip.volume}
              format={pct}
              onCheckpoint={onCheckpoint}
              onChange={(volume) => onChange({ volume }, true)}
            />
            <fieldset className="insp__group">
              <legend>Sound fade</legend>
              <Slider
                id="insp-sound-fade-in"
                label="In"
                min={0}
                max={maxSoundFade}
                step={0.1}
                value={clip.soundFadeIn ?? 0}
                format={sec}
                onCheckpoint={onCheckpoint}
                onChange={(soundFadeIn) => onChange({ soundFadeIn }, true)}
              />
              <Slider
                id="insp-sound-fade-out"
                label="Out"
                min={0}
                max={maxSoundFade}
                step={0.1}
                value={clip.soundFadeOut ?? 0}
                format={sec}
                onCheckpoint={onCheckpoint}
                onChange={(soundFadeOut) => onChange({ soundFadeOut }, true)}
              />
            </fieldset>
          </>
        ) : (
          <p className="insp__note">This file has no sound.</p>
        ))}

      {streams.length > 0 && media && (
        <div className="insp__field">
          <label htmlFor="insp-quality">Source quality</label>
          <select
            id="insp-quality"
            className="field"
            value={isPicture ? media.videoFormat : media.audioFormat}
            onChange={(e) => onFormat(isPicture ? { videoFormat: e.target.value } : { audioFormat: e.target.value })}
          >
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} · {s.detail} · ~{formatSize(s.sizeMb)}
              </option>
            ))}
          </select>
        </div>
      )}

      {onAddCaptions && media?.captions && (
        <button type="button" className="btn btn--secondary" onClick={onAddCaptions} title={`Put the ${media.captions.label} captions on the timeline as text you can edit`}>
          <Icon name="captions" size={14} />
          Add captions · {media.captions.label}
        </button>
      )}

      {(onCutSilences || onSplitChapters) && (
        <div className="insp__pair">
          {onCutSilences && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onCutSilences}
              disabled={cuttingSilences}
              title="Find and remove silent pauses in this clip"
            >
              <Icon name="waveform" size={14} />
              {cuttingSilences ? "Cutting silences…" : "Cut silences"}
            </button>
          )}
          {onSplitChapters && (
            <button type="button" className="btn btn--secondary" onClick={onSplitChapters} title="Split this clip at each chapter mark">
              <Icon name="scissors" size={14} />
              Split chapters
            </button>
          )}
        </div>
      )}

      <div className="insp__actions">
        <button type="button" className="btn btn--secondary" onClick={onSplit} disabled={!canSplit} title="Split at the playhead (S)">
          <Icon name="scissors" size={14} />
          Split
        </button>
        <button type="button" className="btn btn--secondary" onClick={onDuplicate} title="Duplicate (Ctrl+D)">
          <Icon name="copy" size={14} />
          Duplicate
        </button>
        <button type="button" className="btn btn--secondary" onClick={onDelete} title="Delete (Delete)">
          <Icon name="trash" size={14} />
          Delete
        </button>
      </div>
    </section>
  );
}

/** A labelled range with its value; one undo step per drag. */
type Look = { color?: string; font?: TextFont; edge?: TextEdge };

function ColorField({ color, onChange }: { color?: string; onChange: (color: string) => void }) {
  return (
    <fieldset className="insp__field">
      <legend>Color</legend>
      <div className="insp__swatches">
        {TEXT_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            className="insp__swatch"
            style={{ background: c.value }}
            aria-label={c.label}
            aria-pressed={(color ?? "#ffffff") === c.value}
            onClick={() => onChange(c.value)}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** Font, colour and edge of text: a text clip's own, or every caption's. */
function TextLook({ id, look, onChange }: { id: string; look: Look; onChange: (patch: Look) => void }) {
  return (
    <>
      <div className="insp__field">
        <label htmlFor={`${id}-font`}>Font</label>
        <select id={`${id}-font`} className="field" value={look.font ?? ""} onChange={(e) => onChange({ font: (e.target.value || undefined) as TextFont | undefined })}>
          <option value="">Segoe UI</option>
          {TEXT_FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <ColorField color={look.color} onChange={(color) => onChange({ color })} />
      <fieldset className="insp__field">
        <legend>Edge</legend>
        <div className="segmented" role="group" aria-label="Edge">
          {([[undefined, "Shadow"], ["outline", "Outline"], ["box", "Box"]] as const).map(([edge, label]) => (
            <button key={label} type="button" aria-pressed={look.edge === edge} onClick={() => onChange({ edge })}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}

/** How every caption looks (and where it's saved as .srt): shown when the captions are selected. */
export function CaptionStyle({
  layout,
  onChange,
  onCheckpoint,
  onSaveSrt,
  onOpenCaptions,
}: {
  layout: CaptionLayout;
  /** `live` skips the undo step (use after `onCheckpoint`). */
  onChange: (patch: Partial<CaptionLayout>, live?: boolean) => void;
  onCheckpoint: () => void;
  /** Absent in the browser preview. */
  onSaveSrt?: () => void;
  onOpenCaptions?: () => void;
}) {
  return (
    <section className="insp" aria-labelledby="captions-title">
      <header className="insp__head">
        <Icon name="captions" size={14} />
        <h2 id="captions-title">Captions</h2>
      </header>
      <p className="insp__meta">Changes every caption. Drag them on the preview to move them.</p>
      <Slider id="captions-size" label="Size" min={0.02} max={0.15} step={0.005} value={layout.size} format={(v) => `${Math.round(v * 100)}%`} onCheckpoint={onCheckpoint} onChange={(size) => onChange({ size }, true)} />
      <TextLook id="captions" look={layout} onChange={onChange} />
      {onSaveSrt && (
        <button type="button" className="btn btn--secondary" onClick={onSaveSrt} title="For YouTube and video players: the captions as a file next to the video">
          <Icon name="download" size={14} />
          Save as .srt
        </button>
      )}
      {onOpenCaptions && (
        <button type="button" className="btn btn--secondary" onClick={onOpenCaptions} title="Use an .srt, .vtt or .lrc caption file from this PC">
          <Icon name="upload" size={14} />
          Open captions file
        </button>
      )}
    </section>
  );
}

function Slider({
  id,
  label,
  min,
  max,
  step,
  value,
  format,
  onCheckpoint,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onCheckpoint: () => void;
  onChange: (v: number) => void;
}) {
  return (
    <div className="insp__slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, value)}
        disabled={max <= min}
        onPointerDown={onCheckpoint}
        onKeyDown={onCheckpoint}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="mono">{format(value)}</span>
    </div>
  );
}

function PositionSelect({ clip, onChange, disabled }: { clip: Clip; onChange: (patch: ClipPatch) => void; disabled?: boolean }) {
  const preset = presetAt(clip.x, clip.y);
  return (
    <div className="insp__field">
      <label htmlFor="insp-position">Place</label>
      <select
        id="insp-position"
        className="field"
        value={preset ?? "custom"}
        disabled={disabled}
        onChange={(e) => {
          const p = POSITIONS[e.target.value as Position];
          if (p) onChange({ x: p.x, y: p.y });
        }}
      >
        {!preset && <option value="custom">Where you dragged it</option>}
        {Object.entries(POSITIONS).map(([key, p]) => (
          <option key={key} value={key}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
