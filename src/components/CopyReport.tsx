import { useState } from "react";
import { copyReport } from "../lib/engine";

/** Copies what fetching and previewing did, web addresses hidden, to paste when asking for help. */
export function CopyReport() {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="btn btn--ghost" onClick={() => void copyReport().then(() => setCopied(true), () => {})}>
      {copied ? "Report copied" : "Copy report"}
    </button>
  );
}
