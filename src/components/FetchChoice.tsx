import { useEffect, useRef, useState } from "react";
import type { MediaSource } from "../types";
import { formatClock } from "../lib/timecode";
import { formatSize } from "../project/exportPlan";
import { Icon } from "./Icon";
import "./FetchChoice.css";

export type FetchChoiceKind = "edit" | "download";

interface FetchChoiceProps {
  source: MediaSource;
  /** The quality picked by default (the stream id). */
  defaultFormat: string;
  /** Which option to highlight: the one chosen last time. */
  lastChoice: FetchChoiceKind;
  onChoose: (choice: FetchChoiceKind, format: string) => void;
  onCancel: () => void;
}

/**
 * Shown after a link is fetched: start editing straight away (the video streams and only the
 * used parts download at export), or download the whole video first. Each option says what
 * it costs, so the choice is easy to make without knowing how it works.
 */
export function FetchChoice({ source, defaultFormat, lastChoice, onChoose, onCancel }: FetchChoiceProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const pictures = source.streams.filter((s) => s.kind === "video");
  const sounds = source.streams.filter((s) => s.kind === "audio");
  const choices = pictures.length ? pictures : sounds;
  const [format, setFormat] = useState(defaultFormat || choices[0]?.id || "");
  const stream = choices.find((s) => s.id === format);
  const size = stream && stream.sizeMb > 0 ? `about ${formatSize(stream.sizeMb)}` : "the whole file";

  useEffect(() => {
    const el = ref.current;
    if (!el || el.open) return;
    el.showModal();
    // Enter repeats the choice made last time.
    el.querySelector<HTMLButtonElement>(`[data-choice="${lastChoice}"]`)?.focus();
  }, [lastChoice]);

  return (
    <dialog
      ref={ref}
      className="fetch"
      aria-labelledby="fetch-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <div className="fetch__box">
        <header className="fetch__head">
          <p className="section-label">Link found</p>
          <h2 id="fetch-title">{source.title}</h2>
          <p className="fetch__meta">
            {[source.uploader, formatClock(source.duration), pictures.length ? "video" : "audio only"].filter(Boolean).join(" · ")}
          </p>
        </header>

        {choices.length > 1 && (
          <div className="fetch__quality">
            <label htmlFor="fetch-quality">Quality</label>
            <select id="fetch-quality" className="field" value={format} onChange={(e) => setFormat(e.target.value)}>
              {choices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} · {s.detail}
                  {s.sizeMb > 0 ? ` · ~${formatSize(s.sizeMb)} for the whole video` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <p className="fetch__ask">How do you want to work with it?</p>
        <div className="fetch__options">
          <button type="button" className="fetch__option" data-choice="edit" onClick={() => onChoose("edit", format)}>
            <span className="fetch__option-title">
              <Icon name="scissors" size={16} />
              Start editing now
            </span>
            <span className="fetch__option-text">
              Opens right away. The video plays from the internet while you edit, and only the parts you put on the timeline are
              downloaded when you export.
            </span>
            <span className="fetch__option-good">Best for a short part of a long video.</span>
            <span className="fetch__option-cost">Needs the internet while you edit; jumping around can lag a little.</span>
          </button>

          <button type="button" className="fetch__option" data-choice="download" onClick={() => onChoose("download", format)}>
            <span className="fetch__option-title">
              <Icon name="download" size={16} />
              Download first, then edit
            </span>
            <span className="fetch__option-text">
              Saves the whole video ({size}) to Videos\Craftora\Downloads. You can edit while it downloads; once it's done,
              Craftora switches to the file on your PC.
            </span>
            <span className="fetch__option-good">Best for editing a lot of it, or on a slow or unsteady connection.</span>
            <span className="fetch__option-cost">Smooth scrubbing, works offline, faster exports. Uses disk space.</span>
          </button>
        </div>

        <div className="fetch__foot">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
