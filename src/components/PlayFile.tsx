import { useState } from "react";
import { errorText, openFile } from "../lib/engine";
import { Icon } from "./Icon";
import "./PlayFile.css";

/**
 * Plays a file in the PC's default player. When that fails (most often the file was moved or
 * deleted since), it says so in place of the button instead of doing nothing.
 */
export function PlayFile({ path, name, label = false }: { path: string; name: string; label?: boolean }) {
  const [problem, setProblem] = useState<string | null>(null);
  if (problem) {
    const gone = /isn't there/i.test(problem);
    return (
      <span className="play-file__problem" title={problem}>
        {gone ? "Moved or deleted" : "Couldn't play"}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={label ? "btn btn--ghost" : "btn btn--icon"}
      aria-label={`Play ${name}`}
      title={label ? undefined : "Play"}
      onClick={() => openFile(path).catch((err) => setProblem(errorText(err)))}
    >
      <Icon name="play" size={14} />
      {label && "Play"}
    </button>
  );
}
