import { useState } from "react";
import { errorText } from "../lib/engine";
import "./GifLinkBox.css";

export interface GifLinkBoxProps {
  onDownload: (url: string) => Promise<void>;
  /** The box's placeholder; "Paste a GIF link" when absent. */
  label?: string;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function GifLinkBox({ onDownload, label = "Paste a GIF link" }: GifLinkBoxProps) {
  const [link, setLink] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const trimmedLink = link.trim();
  const canDownload = isHttpUrl(trimmedLink);

  const submitLink = async () => {
    if (!canDownload || downloading) return;
    setDownloading(true);
    setLinkError(null);
    try {
      await onDownload(trimmedLink);
      setLink("");
    } catch (err) {
      setLinkError(errorText(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="gif-link-box">
      <form
        className="gif-link-box__row"
        onSubmit={(e) => {
          e.preventDefault();
          void submitLink();
        }}
      >
        <input
          type="text"
          className="field gif-link-box__input"
          placeholder={label}
          aria-label={label}
          aria-invalid={Boolean(linkError) || undefined}
          value={link}
          disabled={downloading}
          onChange={(e) => {
            setLink(e.target.value);
            if (linkError) setLinkError(null);
          }}
        />
        <button type="submit" className="btn btn--secondary" disabled={!canDownload || downloading}>
          {downloading ? "Downloading…" : "Download"}
        </button>
      </form>
      {linkError && (
        <p className="gif-link-box__error" role="alert">
          {linkError}
        </p>
      )}
    </div>
  );
}
