import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { fileThumbnail, inDesktopApp, playableFile } from "../lib/engine";
import "./Thumb.css";

/** Hovering a row this long starts its video, so passing over a list doesn't. */
const HOVER_MS = 300;

/**
 * A 16:9 picture for list rows, or the icon when there is none (or it fails to load). With `play`,
 * the video plays muted while the pointer rests on the row; `play` finds its address then.
 */
export function Thumb({ src, icon, play }: { src?: string; icon: IconName; play?: () => Promise<string | undefined> }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const isVideo = Boolean(src && src.includes("#t="));
  const ref = useRef<HTMLSpanElement>(null);
  const playRef = useRef(play);
  playRef.current = play;
  const [playing, setPlaying] = useState<string>();
  const canPlay = Boolean(play);
  useEffect(() => {
    const row = ref.current?.closest("li, tr") ?? ref.current;
    if (!canPlay || !row || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    let hovering = false;
    const enter = () => {
      hovering = true;
      timer = window.setTimeout(() => {
        void playRef.current?.().then((url) => hovering && setPlaying(url)).catch(() => {});
      }, HOVER_MS);
    };
    const leave = () => {
      hovering = false;
      window.clearTimeout(timer);
      setPlaying(undefined);
    };
    row.addEventListener("pointerenter", enter);
    row.addEventListener("pointerleave", leave);
    return () => {
      leave();
      row.removeEventListener("pointerenter", enter);
      row.removeEventListener("pointerleave", leave);
    };
  }, [canPlay]);
  return (
    <span className="thumb" aria-hidden="true" ref={ref}>
      {playing && (
        <video
          className="thumb__play"
          src={playing}
          muted
          autoPlay
          loop
          playsInline
          onLoadedMetadata={(e) => {
            // From a tenth of the way in (past intros and black frames), unless the address says where.
            if (!playing.includes("#t=")) e.currentTarget.currentTime = (e.currentTarget.duration || 0) / 10;
          }}
          onError={() => setPlaying(undefined)}
        />
      )}
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
  play,
}: {
  path: string;
  src?: string;
  icon: IconName;
  image?: boolean;
  onMade?: (thumbnail: string) => void;
  /** Plays the file while hovered (see `Thumb`). */
  play?: boolean;
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
  return <Thumb src={src ?? made} icon={icon} play={play ? () => playableFile(path) : undefined} />;
}
