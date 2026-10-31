import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { cutRanges, isFiller, transcript, wordsOf, type Project } from "../project/model";
import type { ProjectApi } from "../project/useProject";
import { formatClock } from "../lib/timecode";
import { Icon } from "./Icon";
import "./Transcript.css";

interface TranscriptProps {
  project: Project;
  api: ProjectApi;
  /** The playhead, timeline seconds. */
  time: number;
  seek: (t: number) => void;
  /** How making captions from the sound is going, while it is. */
  captionStatus?: string;
  /** Makes captions from the sound for the media that has none; absent when there's nothing to do. */
  onMakeCaptions?: () => void;
}

/** Captions are made only when asked: whisper keeps the processor busy for minutes. */
function MakeCaptions({ onMake }: { onMake: () => void }) {
  return (
    <button type="button" className="btn btn--secondary" onClick={onMake}>
      <Icon name="captions" size={14} />
      Make captions from the sound
    </button>
  );
}

/** A word's key: line index and word index. */
const keyOf = (line: number, word: number) => `${line}:${word}`;

/**
 * What's said on the timeline, to edit by text: click a sentence or word to jump there, select words
 * and press Delete (or the button) to cut them out of the video.
 */
export function Transcript({ project, api, time, seek, captionStatus, onMakeCaptions }: TranscriptProps) {
  const lines = useMemo(() => transcript(project), [project]);
  const words = useMemo(() => lines.map(wordsOf), [lines]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [replacement, setReplacement] = useState("");
  /** The line being retyped (its id), and its text so far. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);
  const listRef = useRef<HTMLOListElement>(null);
  const currentRef = useRef<HTMLLIElement>(null);
  // Edits change the lines: earlier picks would point at other words.
  useEffect(() => setPicked(new Set()), [lines]);

  const clipOf = (line: number) => project.clips.find((c) => c.id === lines[line].clipId);
  /** A word's media time on the timeline. */
  const timelineAt = (line: number, mediaT: number) => {
    const clip = clipOf(line);
    return clip ? clip.start + (Math.max(mediaT, clip.in) - clip.in) / clip.speed : lines[line].start;
  };
  /** A word still on the timeline: cut ones (outside its clip) are hidden. */
  const kept = (line: number, word: number) => {
    const clip = clipOf(line);
    const w = words[line][word];
    const middle = (w.start + w.end) / 2;
    return !clip || (middle >= clip.in && middle < clip.out);
  };
  const current = lines.findIndex((l) => time >= l.start && time < l.end);
  // In braces: scrollIntoView returns a promise in WebView2, which React would take for a clean-up.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const needle = query.trim().toLowerCase();
  const shown = lines
    .map((_, i) => i)
    .filter((i) => words[i].some((w, j) => w.word && kept(i, j)) && (!needle || lines[i].text.toLowerCase().includes(needle)));

  const pickedWords = [...picked].map((k) => k.split(":").map(Number) as [number, number]).filter(([l, w]) => words[l]?.[w]);
  const cutLength = pickedWords.reduce((sum, [l, w]) => sum + (words[l][w].end - words[l][w].start) / (clipOf(l)?.speed ?? 1), 0);
  const fillers = words.flatMap((ws, l) => ws.flatMap((w, i): [number, number][] => (isFiller(w.text) ? [[l, i]] : [])));

  const cut = (which: [number, number][]) => {
    const ranges = cutRanges(
      which.map(([l, w]) => {
        const word = words[l][w];
        // A word takes the space after it along, so the cut doesn't leave a double gap.
        const next = words[l][w + 1];
        const end = next && !next.word ? next.end : word.end;
        return { clipId: lines[l].clipId, start: word.start, end };
      }),
    );
    for (const [clipId, r] of ranges) api.edit({ type: "cutSilences", clipId, ranges: r, exact: true });
    setPicked(new Set());
  };

  // Words picked by dragging across them, like selecting text.
  const pickSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !listRef.current) return false;
    const next = new Set<string>();
    for (const span of listRef.current.querySelectorAll<HTMLElement>("[data-word]")) {
      if (selection.containsNode(span, true) && span.dataset.word) next.add(span.dataset.word);
    }
    selection.removeAllRanges();
    if (next.size === 0) return false;
    setPicked(next);
    return true;
  };
  // A wrong name, fixed in every caption at once; the search then shows the lines it changed.
  const replaceAll = (e: FormEvent) => {
    e.preventDefault();
    if (!replacement.trim()) return;
    api.edit({ type: "editCaptions", find: query.trim(), replace: replacement });
    setQuery(replacement.trim());
    setReplacement("");
  };
  /** Keeps the retyped line (Enter or clicking away); Escape drops it. */
  const finishEditing = (i: number) => {
    const line = lines[i];
    const text = draft.trim();
    const mediaId = clipOf(i)?.mediaId;
    if (!cancelled.current && mediaId && text && text !== line.text) {
      api.edit({ type: "editCaptions", find: line.text, replace: text, line: { mediaId, at: (line.mediaStart + line.mediaEnd) / 2 } });
    }
    cancelled.current = false;
    setEditing(null);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && pickedWords.length) {
      e.preventDefault();
      e.stopPropagation(); // not the timeline's Delete (which removes the selected clip)
      cut(pickedWords);
    } else if (e.key === "Escape") setPicked(new Set());
  };

  if (lines.length === 0) {
    return (
      <div className="transcript transcript--empty">
        <Icon name="captions" size={18} />
        <p>{captionStatus ? `${captionStatus[0].toUpperCase()}${captionStatus.slice(1)}. The transcript fills in as it's heard.` : "Nothing said on the timeline yet."}</p>
        <p className="transcript__muted">Videos that come with captions show what's said here, to edit by text.</p>
        {onMakeCaptions && (
          <>
            <MakeCaptions onMake={onMakeCaptions} />
            <p className="transcript__muted">
              Craftora listens to what's said and writes it down, on this PC: nothing is sent anywhere. The first time, it downloads a
              148 MB speech model. A long video takes a few minutes and keeps the processor busy meanwhile.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="transcript">
      <div className="transcript__tools">
        <label htmlFor="transcript-find" className="transcript__find">
          <Icon name="search" size={14} />
          <span className="sr-only">Find a word in what's said</span>
          <input id="transcript-find" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a word in what's said" spellCheck={false} />
        </label>
        <p className="transcript__muted">
          {needle
            ? `${shown.length} line${shown.length === 1 ? "" : "s"} with “${query.trim()}”.`
            : "Click a sentence or word to jump there. Select words and press Delete to cut them out of the video."}
        </p>
        {needle && shown.length > 0 && (
          <form className="transcript__replace" onSubmit={replaceAll}>
            <label htmlFor="transcript-replace" className="sr-only">
              Replace with
            </label>
            <input
              id="transcript-replace"
              className="field"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder={`Replace “${query.trim()}” with…`}
              spellCheck={false}
            />
            <button type="submit" className="btn btn--secondary" disabled={!replacement.trim()}>
              Replace all
            </button>
          </form>
        )}
        {onMakeCaptions && <MakeCaptions onMake={onMakeCaptions} />}
      </div>

      <ol ref={listRef} className="transcript__lines" tabIndex={0} aria-label="What's said" onKeyDown={onKeyDown} onMouseUp={() => void pickSelection()}>
        {shown.map((i) => {
          const line = lines[i];
          return (
            <li key={line.id} ref={i === current ? currentRef : undefined} className={i === current ? "transcript__line is-current" : "transcript__line"}>
              <button type="button" className="transcript__time mono" onClick={() => seek(line.start)} aria-label={`Jump to ${formatClock(line.start)}`}>
                {formatClock(line.start)}
              </button>
              {editing === line.id ? (
                <input
                  className="field transcript__input"
                  aria-label="Caption text"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => finishEditing(i)}
                  // Not the list's Delete (which cuts picked words) or its word picking.
                  onMouseUp={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") cancelled.current = true;
                    if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                  }}
                />
              ) : (
                <>
                  <span className="transcript__text">
                    {words[i].map((w, j) => kept(i, j) && (
                      <span
                        key={j}
                        data-word={w.word ? keyOf(i, j) : undefined}
                        className={picked.has(keyOf(i, j)) ? "is-picked" : undefined}
                        onClick={() => {
                          if (!window.getSelection()?.isCollapsed) return;
                          seek(timelineAt(i, w.start));
                        }}
                      >
                        {w.text}
                      </span>
                    ))}
                  </span>
                  <button
                    type="button"
                    className="btn btn--icon transcript__edit"
                    aria-label={`Edit the caption at ${formatClock(line.start)}`}
                    title="Edit this caption"
                    onClick={() => {
                      setDraft(line.text);
                      setEditing(line.id);
                    }}
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                </>
              )}
            </li>
          );
        })}
        {captionStatus && <li className="transcript__line transcript__pending">{`${captionStatus[0].toUpperCase()}${captionStatus.slice(1)}. The rest fills in as it's heard.`}</li>}
      </ol>

      <div className="transcript__foot">
        <p>
          {pickedWords.length ? (
            <>
              <span className="transcript__count">
                {pickedWords.length} word{pickedWords.length === 1 ? "" : "s"} selected
              </span>{" "}
              · cuts <span className="mono">{cutLength.toFixed(1)} s</span> from the video
            </>
          ) : (
            "Select words to cut them."
          )}
        </p>
        <div className="transcript__actions">
          <button type="button" className="btn btn--primary" disabled={!pickedWords.length} onClick={() => cut(pickedWords)}>
            Cut these words <kbd>Delete</kbd>
          </button>
          <button type="button" className="btn btn--secondary" disabled={!fillers.length} onClick={() => cut(fillers)} title="Cut every um, uh, erm and hmm">
            {fillers.length ? `Cut every “um” (${fillers.length})` : "No “um” found"}
          </button>
        </div>
      </div>
    </div>
  );
}
