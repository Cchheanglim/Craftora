import { useState } from "react";
import { formatTimecode, parseTimecode } from "../lib/timecode";

interface TimeFieldProps {
  id: string;
  label: string;
  value: number;
  /** Returns an error message when the value is rejected, otherwise null. */
  onCommit: (seconds: number) => string | null;
}

/** A timecode input that accepts typing and only applies on Enter or blur. */
export function TimeField({ id, label, value, onCommit }: TimeFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const seconds = parseTimecode(draft);
    const problem = seconds === null ? "Use a time like 01:24 or 00:01:24.50" : onCommit(seconds);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setDraft(null);
  };

  return (
    <div className="time-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="field mono"
        value={draft ?? formatTimecode(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(null);
            setError(null);
          }
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        spellCheck={false}
        inputMode="decimal"
      />
      {error && (
        <span id={`${id}-error`} className="time-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
