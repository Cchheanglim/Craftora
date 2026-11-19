import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { inDesktopApp, playableFile } from "../lib/engine";
import type { LibraryEntry } from "../lib/storage";
import "./HoverPreview.css";

const WIDTH = 360;
const GAP = 12;

/**
 * A bigger look at a Media library card while the pointer rests on it: a video plays muted from the start, a GIF moves,
 * a picture shows large. Beside the card on the side with room, on the page itself so nothing clips it. It never takes
 * the pointer (the hover stays on the card underneath).
 */
export function HoverPreview({ entry, anchor, name, leaving }: { entry: LibraryEntry; anchor: DOMRect; name: string; leaving: boolean }) {
  const [src, setSrc] = useState<string | undefined>(inDesktopApp ? undefined : entry.thumbnail);
  useEffect(() => {
    if (!inDesktopApp) return;
    let live = true;
    void playableFile(entry.path)
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(entry.thumbnail));
    return () => {
      live = false;
    };
  }, [entry.path, entry.thumbnail]);

  const right = anchor.right + GAP + WIDTH <= window.innerWidth - GAP;
  const left = right ? anchor.right + GAP : Math.max(GAP, anchor.left - GAP - WIDTH);
  // Kept inside the window: the box is at most 260px of media plus its name line.
  const top = Math.min(Math.max(GAP, anchor.top), window.innerHeight - GAP - 300);
  const video = entry.kind === "video";
  return createPortal(
    <div className={leaving ? "hover-preview is-leaving" : "hover-preview"} style={{ left, top, width: WIDTH }} aria-hidden="true">
      <div className="hover-preview__media">
        {src && (video ? <video src={src} muted autoPlay loop playsInline /> : <img src={src} alt="" draggable={false} />)}
      </div>
      <p className="hover-preview__name">{name}</p>
    </div>,
    document.body,
  );
}
