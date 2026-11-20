import { useEffect, useRef, useState } from "react";
import { audioPeaks, allowLocal, errorText, inDesktopApp, playableFile } from "./engine";

/** Plays one sound file at a time for a quick listen (Sound FX tab, Media library); `toggle` again stops it. */
export function useSoundPreview() {
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  };
  useEffect(() => () => audio.current?.pause(), []);

  const toggle = async (path: string) => {
    const was = audio.current ? playing : null;
    stop();
    if (was === path) return;
    setError(null);
    try {
      const el = new Audio(await playableFile(path));
      audio.current = el;
      el.onended = () => audio.current === el && stop();
      setPlaying(path);
      await el.play();
    } catch (err) {
      stop();
      setError(errorText(err));
    }
  };

  return { playing, error, toggle };
}

const waves = new Map<string, Promise<number[] | undefined>>();
let waveTurn: Promise<unknown> = Promise.resolve();

/** A sound file's wave (0–255 a bar), made once per file and one file at a time; undefined in the browser preview. */
export function soundWave(path: string): Promise<number[] | undefined> {
  if (!inDesktopApp) return Promise.resolve(undefined);
  let made = waves.get(path);
  if (!made) {
    made = waveTurn.then(() => allowLocal(path).then(() => audioPeaks(path))).catch(() => undefined);
    waveTurn = made;
    waves.set(path, made);
  }
  return made;
}
