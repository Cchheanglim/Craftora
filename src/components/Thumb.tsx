import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { fileThumbnail, inDesktopApp } from "../lib/engine";
import "./Thumb.css";

/** A 16:9 picture for list rows, or the icon when there is none (or it fails to load). */
export function Thumb({ src, icon }: { src?: string; icon: IconName }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const isVideo = Boolean(src && src.includes("#t="));
  return (
    <span className="thumb" aria-hidden="true">
      {src && !failed ? (
        isVideo ? (
          <video
            src={src}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = Math.min(0.5, (e.currentTarget.duration || 0) / 2);
            }}
            onError={() => setFailed(true)}
          />
        ) : (
          <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        )
      ) : (
        <Icon name={icon} size={14} />
      )}
    </span>
  );
}

/**
 * A Thumb for a file on this PC: its saved picture, or else one made from the file itself (not for
 * sound files). `onMade` gets a made picture, so the caller can keep it.
 */
export function FileThumb({
  path,
  src,
  icon,
  image = false,
  onMade,
}: {
  path: string;
  src?: string;
  icon: IconName;
  image?: boolean;
  onMade?: (thumbnail: string) => void;
}) {
  const [made, setMade] = useState<string>();
  const madeRef = useRef(onMade);
  madeRef.current = onMade;
  useEffect(() => {
    if (src || icon === "music" || !inDesktopApp) return;
    let live = true;
    void fileThumbnail(path, image).then((thumbnail) => {
      if (!live || !thumbnail) return;
      setMade(thumbnail);
      madeRef.current?.(thumbnail);
    });
    return () => {
      live = false;
    };
  }, [path, src, icon, image]);
  return <Thumb src={src ?? made} icon={icon} />;
}
