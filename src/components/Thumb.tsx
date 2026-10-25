import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icon";
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
