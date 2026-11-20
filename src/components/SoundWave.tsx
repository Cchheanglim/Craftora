import { useEffect, useState } from "react";
import { soundWave } from "../lib/soundPreview";
import { waveBars } from "../project/model";
import { Icon } from "./Icon";
import "./SoundWave.css";

const BARS = 36;

/** A sound file's own wave as the picture on its card (the wave icon until it's read, or if it can't be). */
export function SoundWave({ path }: { path: string }) {
  const [bars, setBars] = useState<number[]>();
  useEffect(() => {
    let live = true;
    setBars(undefined);
    void soundWave(path).then((peaks) => {
      if (live && peaks?.length) setBars(waveBars(peaks, BARS));
    });
    return () => {
      live = false;
    };
  }, [path]);

  return (
    <span className="sound-wave" aria-hidden="true">
      {bars ? (
        <svg className="sound-wave__bars" viewBox={`0 0 ${BARS * 2} 20`} preserveAspectRatio="none">
          {bars.map((b, i) => {
            const h = Math.max(1, b * 20);
            return <rect key={i} x={i * 2 + 0.3} y={(20 - h) / 2} width={1.4} height={h} />;
          })}
        </svg>
      ) : (
        <Icon name="waveform" size={26} />
      )}
    </span>
  );
}
