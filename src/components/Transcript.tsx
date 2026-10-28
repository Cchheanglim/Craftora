import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
}

/** A word's key: line index and word index. */
const keyOf = (line: number, word: number) => `${line}:${word}`;

/**
 * What's said on the timeline, to edit by text: click a sentence or word to jump there, select words
 * and press Delete (or the button) to cut them out of the video.
 */
export function Transcript({ project, api, time, seek, captionStatus }: TranscriptProps) {
  const lines = useMemo(() => transcript(project), [project]);
  const words = useMemo(() => lines.map(wordsOf), [lines]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
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
  const current = lines.findIndex((l) => time >= l.start && time < l.end);
  useEffect(() => currentRef.current?.scrollIntoView({ block: "nearest" }), [current]);

  const needle = query.trim().toLowerCase();
  const shown = lines.map((_, i) => i).filter((i) => !needle || lines[i].text.toLowerCase().includes(needle));

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
        <p className="transcript__muted">
          Videos that come with captions, or get them made from the sound (Settings), show what's said here, to edit by text.
        </p>
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
      </div>

      <ol ref={listRef} className="transcript__lines" tabIndex={0} aria-label="What's said" onKeyDown={onKeyDown} onMouseUp={() => void pickSelection()}>
        {shown.map((i) => {
          const line = lines[i];
          return (
            <li key={line.id} ref={i === current ? currentRef : undefined} className={i === current ? "transcript__line is-current" : "transcript__line"}>
              <button type="button" className="transcript__time mono" onClick={() => seek(line.start)} aria-label={`Jump to ${formatClock(line.start)}`}>
                {formatClock(line.start)}
              </button>
              <span className="transcript__text">
                {words[i].map((w, j) => (
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
