import { useState } from "react";
import type { ClipPatch } from "../project/actions";
import {
  MAX_CROP,
  NO_CROP,
  POSITIONS,
  SPEEDS,
  TEXT_FONTS,
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
} from "../project/model";
import { formatClock } from "../lib/timecode";
import { formatSize } from "../project/exportPlan";
import { fontLoaded, loadFont } from "../lib/fonts";
import { ColorWheel } from "./ColorWheel";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { ADJUSTMENTS, LOOKS, PICTURE_EFFECTS, adjustMin, blockLabel, keyLine } from "../project/effects";
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

/** The right panel's tab this is: Edit, or one of the clip's own tabs. */
export type ClipSection = "edit" | "text" | "adjust" | "enhance" | "background" | "speed";

interface InspectorProps {
  /** Which settings to show (Edit when absent). */
  section?: ClipSection;
  clip: Clip;
  track: Track;
  media?: MediaItem;
  /** Applies a change; `live` skips the undo step (use after `checkpoint`). */
  onChange: (patch: ClipPatch, live?: boolean) => void;
  /** Still images and text: sets how many seconds the clip stays on screen. */
  onDuration?: (seconds: number, live?: boolean) => void;
  onSpeed: (speed: number) => void;
  onCheckpoint: () => void;
  onFormat: (format: { videoFormat?: string; audioFormat?: string }) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  /** Opens the crop window (CropDialog) for this clip. */
  onOpenCrop?: () => void;
  onCutSilences?: () => void;
  cuttingSilences?: boolean;
  onSplitChapters?: () => void;
  /** The video came with captions: put them on the timeline as text. */
  onAddCaptions?: () => void;
  onDelete: () => void;
  /** A moved or renamed file: let the user find it. */
  onRelink: (media: MediaItem) => void;
  /** Remove a colour → Pick: the next click on the preview picks the colour (App `pickColour`). */
  onPickColour?: () => void;
  /** Text tab with something else picked: a new text at the playhead (its letter height, or the usual). */
  onAddText?: (size?: number) => void;
  /** What the editor calls the clip's track ("Track 2"). */
  trackName: string;
  canSplit: boolean;
}

/** Settings for the selected clip. */
export function Inspector({
  section = "edit",
  clip,
  track,
  media,
  onChange,
  onDuration,
  onSpeed,
  onCheckpoint,
  onFormat,
  onSplit,
  onDuplicate,
  onOpenCrop,
  onCutSilences,
  cuttingSilences,
  onSplitChapters,
  onAddCaptions,
  onDelete,
  onRelink,
  onPickColour,
  onAddText,
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
  const moving = Boolean(media) && !isImage;
  const ownTab = {
    text: isText && (
      track.name === "Captions" ? (
        <p className="insp__hint">Captions are styled all together: select the captions track's clips in Edit to change them.</p>
      ) : (
        <>
          <Slider id="insp-text-size" label="Size" min={0.02} max={0.3} step={0.005} value={clip.size} format={pct} onCheckpoint={onCheckpoint} onChange={(size) => onChange({ size }, true)} />
          <ColorField color={clip.color} onChange={(color, live) => onChange({ color }, live)} onCheckpoint={onCheckpoint} />
          <fieldset className="insp__field">
            <legend>Edge</legend>
            <div className="segmented" role="group" aria-label="Edge">
              {([[undefined, "Shadow"], ["outline", "Outline"], ["box", "Box"]] as const).map(([edge, label]) => (
                <button key={label} type="button" aria-pressed={clip.edge === edge} onClick={() => onChange({ edge })}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <FontLibrary selected={clip.font} onChange={onChange} />
        </>
      )
    ),
    adjust: isPicture && (
      <fieldset className="insp__group">
        <legend>
          Adjust
          {ADJUSTMENTS.some(({ id }) => clip.adjust?.[id]) && (
            // Enhance has its own tab: Reset leaves it as it is.
            <button type="button" className="insp__reset" onClick={() => onChange({ adjust: clip.adjust?.enhance ? { enhance: 1 } : {} })}>
              Reset
            </button>
          )}
        </legend>
        {ADJUSTMENTS.map(({ id, label }) => (
          <Slider
            key={id}
            id={`insp-adjust-${id}`}
            label={label}
            min={adjustMin(id)}
            max={100}
            step={1}
            value={clip.adjust?.[id] ?? 0}
            format={(v) => (v > 0 ? `+${v}` : String(v))}
            onCheckpoint={onCheckpoint}
            onChange={(v) => onChange({ adjust: { ...clip.adjust, [id]: v } }, true)}
          />
        ))}
      </fieldset>
    ),
    enhance: isPicture && (
      <>
        <label className="option">
          <input type="checkbox" checked={Boolean(clip.adjust?.enhance)} onChange={(e) => onChange({ adjust: { ...clip.adjust, enhance: e.target.checked ? 1 : 0 } })} />
          <span>Enhance</span>
        </label>
        <p className="insp__hint">Clearer, brighter and more vivid in one click: dark parts lifted, bright parts held back, a little more colour and sharpness.</p>
      </>
    ),
    background: isPicture && <RemoveColour clip={clip} onChange={onChange} onCheckpoint={onCheckpoint} onPick={onPickColour} />,
    speed: moving && (
      <>
        <div className="insp__field">
          <label htmlFor="insp-speed">Speed</label>
          <Select
            id="insp-speed"
            value={String(clip.speed)}
            options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×${s === 1 ? " (normal)" : ""}` }))}
            onChange={(s) => onSpeed(Number(s))}
          />
        </div>
        {isPicture && (
          <label className="option" title="Slowed down with in-between frames made in the export, instead of each frame shown longer">
            <input type="checkbox" checked={Boolean(clip.smooth)} disabled={clip.speed >= 1} onChange={(e) => onChange({ smooth: e.target.checked || undefined })} />
            <span>Smooth slow-mo{clip.speed >= 1 ? " (pick a speed under 1×)" : ""}</span>
          </label>
        )}
        <label className="option">
          <input type="checkbox" checked={clip.reverse} onChange={(e) => onChange({ reverse: e.target.checked })} />
          <span>Reverse</span>
        </label>
      </>
    ),
  }[section as Exclude<ClipSection, "edit">];

  return (
    <section className="insp" aria-labelledby="insp-title">
      <header className="insp__head">
        <Icon name={isBlock ? "sparkle" : isShape ? "star" : isText ? "text" : isImage ? "image" : isPicture ? "film" : "music"} size={14} />
        <h2 id="insp-title" className="truncate">
          {isBlock ? (clip.look || clip.effect ? `${clip.look ? "Filter" : "Effect"}: ${blockLabel(clip)}` : blockLabel(clip)) : isShape ? `Shape: ${shapeLabel(clip.shape)}` : isText ? "Text" : (media?.name ?? "Clip")}
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

      {section !== "edit" &&
        (ownTab || (
          <>
            <p className="insp__hint">
              {section === "speed"
                ? "Select a video or sound clip on the timeline to change its speed."
                : section === "text"
                  ? "Select a text on the timeline to change its font and style, or add one."
                  : "Select a video or picture on the timeline."}
            </p>
            {section === "text" && onAddText && <AddText onAdd={onAddText} />}
          </>
        ))}
      {section === "edit" && (
        <>
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
              <ColorField color={clip.color} onChange={(color, live) => onChange({ color }, live)} onCheckpoint={onCheckpoint} />
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
                  <PositionSelect clip={clip} onChange={onChange} />
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
              {onOpenCrop && (
                <button type="button" className="btn btn--secondary" onClick={onOpenCrop}>
                  <Icon name="crop" size={13} /> Crop on the picture…
                </button>
              )}
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
              <Select
                id="insp-quality"
                value={(isPicture ? media.videoFormat : media.audioFormat) ?? ""}
                options={streams.map((s) => ({ value: s.id, label: `${s.label} · ${s.detail} · ~${formatSize(s.sizeMb)}` }))}
                onChange={(id) => onFormat(isPicture ? { videoFormat: id } : { audioFormat: id })}
              />
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
        </>
      )}
    </section>
  );
}

/** A labelled range with its value; one undo step per drag. */
type Look = { color?: string; font?: TextFont; edge?: TextEdge };

/** A few quick colours, and any colour on the wheel (open already when the colour is none of the quick ones). */
function ColorField({ color, onChange, onCheckpoint }: { color?: string; onChange: (color: string, live?: boolean) => void; onCheckpoint?: () => void }) {
  const current = color ?? "#ffffff";
  const [wheel, setWheel] = useState(() => !TEXT_COLORS.some((c) => c.value === current));
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
        <button type="button" className="insp__swatch insp__swatch-wheel" aria-label="Any colour" aria-pressed={wheel} onClick={() => setWheel((w) => !w)} />
      </div>
      {wheel && <ColorWheel color={current} onChange={onChange} onCheckpoint={onCheckpoint} />}
    </fieldset>
  );
}

/** Font, colour and edge of text: a text clip's own, or every caption's. */
function TextLook({ id, look, onChange, onCheckpoint }: { id: string; look: Look; onChange: (patch: Look, live?: boolean) => void; onCheckpoint?: () => void }) {
  return (
    <>
      <div className="insp__field">
        <label htmlFor={`${id}-font`}>Font</label>
        <Select<string>
          id={`${id}-font`}
          value={look.font ?? ""}
          options={[{ value: "", label: "Segoe UI" }, ...TEXT_FONTS.map((f) => ({ value: f.id as string, label: f.label }))]}
          onChange={(font) => onChange({ font: (font || undefined) as TextFont | undefined })}
        />
      </div>
      <ColorField color={look.color} onChange={(color, live) => onChange({ color }, live)} onCheckpoint={onCheckpoint} />
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
      <TextLook id="captions" look={layout} onChange={onChange} onCheckpoint={onCheckpoint} />
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

export function Slider({
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

const KEY_COLOURS = [
  { label: "Green screen", value: "#00b140" },
  { label: "Blue screen", value: "#0047bb" },
];
export const KEY_START = { strength: 50, softness: 20 };

/** Remove a colour (chroma key): a green or blue screen, or any colour picked on the preview, and how much goes. */
function RemoveColour({ clip, onChange, onCheckpoint, onPick }: { clip: Clip; onChange: (patch: ClipPatch, live?: boolean) => void; onCheckpoint: () => void; onPick?: () => void }) {
  const key = clip.chroma;
  return (
    <fieldset className="insp__group">
      <legend>
        Remove a colour
        {key && (
          <button type="button" className="insp__reset" onClick={() => onChange({ chroma: undefined })}>
            Reset
          </button>
        )}
      </legend>
      <div className="insp__swatches">
        {KEY_COLOURS.map((c) => (
          <button
            key={c.value}
            type="button"
            className="insp__swatch"
            style={{ background: c.value }}
            aria-label={c.label}
            title={c.label}
            aria-pressed={key?.color === c.value}
            onClick={() => onChange({ chroma: { ...KEY_START, ...key, color: c.value } })}
          />
        ))}
        {onPick && (
          <button type="button" className="btn btn--secondary" title="Then click the colour on the preview" onClick={onPick}>
            <Icon name="eyedropper" size={13} /> Pick from the picture
          </button>
        )}
      </div>
      {!key && <p className="insp__hint">Make one colour see-through, like a green screen, to show what's under this clip.</p>}
      {key && !keyLine(key) && <p className="insp__hint">That colour is grey, so there's nothing to take out. Pick the coloured background.</p>}
      {key && (
        <>
          {/* The colour being removed, on its own line: next to the presets, a picked green looked like one of them. */}
          <div className="insp__slider">
            <span className="insp__row-label">Colour</span>
            <span className="insp__key-colour">
              <span className="insp__swatch" style={{ background: key.color }} aria-hidden="true" />
              <span className="mono">{key.color.toUpperCase()}</span>
            </span>
          </div>
          <Slider id="insp-key-strength" label="Strength" min={0} max={100} step={1} value={key.strength} format={(v) => String(v)} onCheckpoint={onCheckpoint} onChange={(strength) => onChange({ chroma: { ...key, strength } }, true)} />
          <Slider id="insp-key-soft" label="Soft edge" min={0} max={100} step={1} value={key.softness} format={(v) => String(v)} onCheckpoint={onCheckpoint} onChange={(softness) => onChange({ chroma: { ...key, softness } }, true)} />
        </>
      )}
    </fieldset>
  );
}

/** Text tab with no text picked: a new one at the playhead, in three sizes (letter height over the frame's). */
export function AddText({ onAdd }: { onAdd: (size?: number) => void }) {
  return (
    <div className="insp__add-text">
      <button type="button" className="insp__add-title" onClick={() => onAdd(0.12)}>
        Add a title
      </button>
      <button type="button" className="insp__add-subtitle" onClick={() => onAdd(0.07)}>
        Add a subtitle
      </button>
      <button type="button" onClick={() => onAdd(0.045)}>
        Add body text
      </button>
      <p className="insp__hint">It goes on the timeline at the red playhead.</p>
    </div>
  );
}

/** The font library (model.ts `TEXT_FONTS`), by kind; a library font downloads the first time it's picked (lib/fonts.ts). */
function FontLibrary({ selected, onChange }: { selected?: TextFont; onChange: (patch: ClipPatch) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const pick = (id?: TextFont) => {
    setBusy(id ?? null);
    setFailed(false);
    loadFont(id)
      .then(() => onChange({ font: id }))
      .catch(() => setFailed(true))
      .finally(() => setBusy(null));
  };
  const groups = [...new Set(TEXT_FONTS.map((f) => f.group))];
  const row = (id: TextFont | undefined, label: string, css?: string) => {
    const ready = fontLoaded(id);
    return (
      <button key={id ?? "default"} type="button" className="insp__font" aria-pressed={selected === id} onClick={() => pick(id)}>
        <span style={ready && css ? { fontFamily: `${css}, "Segoe UI", sans-serif` } : undefined}>{label}</span>
        {busy === (id ?? null) && id ? (
          <span className="insp__font-note">Downloading…</span>
        ) : (
          !ready && <Icon name="download" size={13} aria-label="Downloads the first time you pick it" />
        )}
      </button>
    );
  };
  return (
    <fieldset className="insp__group">
      <legend>Font</legend>
      <div className="insp__fonts">
        {row(undefined, "Segoe UI (default)")}
        {groups.map((group) => (
          <div key={group} className="insp__fonts">
            <span className="insp__fonts-group">{group}</span>
            {TEXT_FONTS.filter((f) => f.group === group).map((f) => row(f.id, f.label, f.css))}
          </div>
        ))}
      </div>
      {failed && <p className="insp__hint">Couldn't download that font. Check the internet connection and try again.</p>}
      <p className="insp__hint">Free fonts from Google Fonts: each one downloads the first time you pick it.</p>
    </fieldset>
  );
}

function PositionSelect({ clip, onChange, disabled }: { clip: Clip; onChange: (patch: ClipPatch) => void; disabled?: boolean }) {
  const preset = presetAt(clip.x, clip.y);
  return (
    <div className="insp__field">
      <label htmlFor="insp-position">Place</label>
      <Select<string>
        id="insp-position"
        value={preset ?? "custom"}
        disabled={disabled}
        options={[
          ...(preset ? [] : [{ value: "custom", label: "Where you dragged it" }]),
          ...Object.entries(POSITIONS).map(([key, p]) => ({ value: key, label: p.label })),
        ]}
        onChange={(key) => {
          const p = POSITIONS[key as Position];
          if (p) onChange({ x: p.x, y: p.y });
        }}
      />
    </div>
  );
}
