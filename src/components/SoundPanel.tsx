import type { ClipPatch } from "../project/actions";
import { clipLength, type Clip, type MediaItem } from "../project/model";
import { Icon } from "./Icon";
import { Slider } from "./Inspector";
import "./SoundPanel.css";

/** A settings panel's head: Back, its title over what it belongs to, and X. */
export function PanelHead({ id, title, sub, onBack, onClose }: { id: string; title: string; sub: string; onBack: () => void; onClose: () => void }) {
  return (
    <div className="panel-head">
      <button type="button" className="btn btn--icon" aria-label="Back" title="Back" onClick={onBack}>
        <Icon name="chevronLeft" />
      </button>
      <div>
        <h2 id={id} className="panel-head__title">
          {title}
        </h2>
        <p className="panel-head__sub truncate">{sub}</p>
      </div>
      <button type="button" className="btn btn--icon" aria-label="Close" title="Close" onClick={onClose}>
        <Icon name="x" />
      </button>
    </div>
  );
}

/** The selected clip's sound: volume and fades, opened by clicking its sound wave on the timeline. */
export function SoundPanel({
  clip,
  media,
  onChange,
  onCheckpoint,
  onBack,
  onClose,
}: {
  clip: Clip;
  media?: MediaItem;
  onChange: (patch: ClipPatch, live?: boolean) => void; // live = while a slider moves
  onCheckpoint: () => void; // a slider's first press (one undo step)
  onBack: () => void; // back to the tab the user came from
  onClose: () => void; // close the right panel
}) {
  const maxFade = Math.floor(clipLength(clip) * 10) / 10;
  const sec = (v: number) => `${v.toFixed(1)} s`;

  return (
    <section className="sound-panel" aria-labelledby="sound-title">
      <PanelHead id="sound-title" title="Sound" sub={media?.name ?? "Clip"} onBack={onBack} onClose={onClose} />
      {!media?.hasAudio || media.source.image ? (
        <p className="insp__note">This clip has no sound.</p>
      ) : (
        <>
          <Slider
            id="sound-volume"
            label="Volume"
            min={0}
            max={1}
            step={0.05}
            value={clip.volume}
            format={(v) => `${Math.round(v * 100)}%`}
            onCheckpoint={onCheckpoint}
            onChange={(volume) => onChange({ volume }, true)}
          />
          <fieldset className="insp__group">
            <legend>Fade</legend>
            <Slider
              id="sound-fade-in"
              label="In"
              min={0}
              max={maxFade}
              step={0.1}
              value={clip.soundFadeIn ?? 0}
              format={sec}
              onCheckpoint={onCheckpoint}
              onChange={(soundFadeIn) => onChange({ soundFadeIn }, true)}
            />
            <Slider
              id="sound-fade-out"
              label="Out"
              min={0}
              max={maxFade}
              step={0.1}
              value={clip.soundFadeOut ?? 0}
              format={sec}
              onCheckpoint={onCheckpoint}
              onChange={(soundFadeOut) => onChange({ soundFadeOut }, true)}
            />
          </fieldset>
          <p className="sound-panel__hint">Only the sound fades; the picture stays. On the timeline the sound wave gets smaller where it fades.</p>
        </>
      )}
    </section>
  );
}
