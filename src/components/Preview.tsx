import { useEffect, useState, type CSSProperties } from "react";
import type { Frame } from "../types";
import { POSITIONS, clipEnd, mainTrack, type Clip, type Project } from "../project/model";
import type { Playback } from "../project/usePlayback";
import { formatTimecode } from "../lib/timecode";
import { setWindowFullscreen } from "../lib/engine";
import { Icon } from "./Icon";
import { SyncedMedia } from "./SyncedMedia";
import "./Preview.css";

const FRAME = 1 / 30;
const SPEEDS = [0.5, 1, 1.5, 2];

interface PreviewProps {
  project: Project;
  playback: Playback;
  frame: Frame;
  duration: number;
}

/** Plays the timeline: every clip's media follows the playhead, stacked like the export. */
export function Preview({ project, playback, frame, duration }: PreviewProps) {
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const { time, playing } = playback;

  const toggleFullscreen = () => {
    const next = !fullscreen;
    setFullscreen(next);
    void setWindowFullscreen(next);
  };

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFullscreen(false);
        void setWindowFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // "F" from the global shortcuts.
  useEffect(() => {
    const onToggle = () => toggleFullscreen();
    window.addEventListener("craftora:toggle-fullscreen", onToggle);
    return () => window.removeEventListener("craftora:toggle-fullscreen", onToggle);
  });

  const main = mainTrack(project).id;
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i]));
  const mediaOf = (c: Clip) => project.media.find((m) => m.id === c.mediaId);
  const active = (c: Clip) => time >= c.start && time < clipEnd(c);
  const mediaTime = (c: Clip) => (active(c) ? c.in + (time - c.start) : null);

  // Bottom to top: Video 1, then picture tracks from the lowest row up, then text.
  const pictures = project.clips
    .filter((c) => c.mediaId && project.tracks.find((t) => t.id === c.trackId)?.kind === "video")
    .sort((a, b) => (a.trackId === main ? -1 : b.trackId === main ? 1 : (trackIndex.get(b.trackId) ?? 0) - (trackIndex.get(a.trackId) ?? 0)));
  const sounds = project.clips.filter((c) => c.mediaId && project.tracks.find((t) => t.id === c.trackId)?.kind === "audio");
  const texts = project.clips.filter((c) => !c.mediaId);
  const showingReverse = project.clips.some((c) => c.reverse && active(c));
  const nothingHere = !project.clips.some(active);

  return (
    <section className={fullscreen ? "preview is-fullscreen" : "preview"} aria-label="Preview">
      <div className="preview__screen" onClick={playback.toggle}>
        <div className="preview__stage" style={{ "--aspect": frame.width / frame.height } as CSSProperties}>
          {pictures.map((clip) => {
            const media = mediaOf(clip);
            if (!media?.source.previewUrl) return null;
            const t = mediaTime(clip);
            const isMain = clip.trackId === main;
            const { x, y } = POSITIONS[clip.position];
            const separateSound = Boolean(media.source.previewAudioUrl);
            const style: CSSProperties = isMain
              ? { inset: 0, width: "100%", height: "100%", objectFit: "contain" }
              : {
                  left: `${x * 100}%`,
                  top: `${y * 100}%`,
                  width: `${clip.size * 100}%`,
                  transform: `translate(${-x * 100}%, ${-y * 100}%)`,
                };
            return (
              <div key={clip.id} className="preview__layer" style={{ visibility: t === null ? "hidden" : "visible" }}>
                <SyncedMedia
                  kind="video"
                  src={media.source.previewUrl}
                  time={t}
                  playing={playing}
                  volume={clip.volume}
                  muted={muted || separateSound}
                  speed={playback.speed}
                  className={clip.mirror ? "preview__video is-mirrored" : "preview__video"}
                  style={style}
                />
                {separateSound && (
                  <SyncedMedia
                    kind="audio"
                    src={media.source.previewAudioUrl!}
                    time={t}
                    playing={playing}
                    volume={clip.volume}
                    muted={muted}
                    speed={playback.speed}
                  />
                )}
              </div>
            );
          })}
          {sounds.map((clip) => {
            const media = mediaOf(clip);
            const src = media?.source.previewAudioUrl || media?.source.previewUrl;
            if (!src) return null;
            return (
              <SyncedMedia
                key={clip.id}
                kind="audio"
                src={src}
                time={mediaTime(clip)}
                playing={playing}
                volume={clip.volume}
                muted={muted}
                speed={playback.speed}
              />
            );
          })}
          {texts.filter(active).map((clip) => {
            const { x, y } = POSITIONS[clip.position];
            return (
              <div
                key={clip.id}
                className="preview__text"
                style={{
                  left: `${x * 100}%`,
                  top: `${y * 100}%`,
                  transform: `translate(${-x * 100}%, ${-y * 100}%)`,
                  fontSize: `${clip.size * 100}cqh`,
                  color: clip.color,
                }}
              >
                {clip.text}
              </div>
            );
          })}
        </div>
        {nothingHere && duration > 0 && <p className="preview__note">Nothing on the timeline here</p>}
        {showingReverse && <span className="preview__badge">Reverse plays forward here; the export is reversed</span>}
      </div>

      <div className="preview__transport" onClick={(e) => e.stopPropagation()}>
        <div className="preview__buttons">
          <button type="button" className="btn btn--icon" aria-label="Previous frame" onClick={() => playback.seek(time - FRAME)}>
            <Icon name="stepBack" size={15} />
          </button>
          <button type="button" className="preview__play" aria-label={playing ? "Pause" : "Play"} onClick={playback.toggle} disabled={duration <= 0}>
            <Icon name={playing ? "pause" : "play"} size={15} />
          </button>
          <button type="button" className="btn btn--icon" aria-label="Next frame" onClick={() => playback.seek(time + FRAME)}>
            <Icon name="stepForward" size={15} />
          </button>
        </div>
        <p className="preview__clock mono">
          <span>{formatTimecode(time)}</span>
          <span className="preview__total"> / {formatTimecode(duration)}</span>
        </p>
        <div className="preview__right">
          <label htmlFor="speed" className="sr-only">
            Playback speed
          </label>
          <select id="speed" className="field mono" value={playback.speed} onChange={(e) => playback.setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--icon" aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} onClick={() => setMuted((m) => !m)}>
            <Icon name={muted ? "volumeOff" : "volume"} />
          </button>
          <button
            type="button"
            className="btn btn--icon"
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            title={fullscreen ? "Exit full screen (Esc)" : "Full screen (F)"}
            onClick={toggleFullscreen}
          >
            <Icon name={fullscreen ? "minimize" : "maximize"} />
          </button>
        </div>
      </div>
    </section>
  );
}
