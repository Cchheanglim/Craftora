import { useEffect, useRef } from "react";

/** How often the glow looks at the video again. */
const EVERY_MS = 500;

/**
 * The glass themes' glow (styles/themes.css): the colours of the video in the preview, blurred
 * behind the panels. Twice a second the picture is shrunk to 12×6 pixels; its left, middle and
 * right thirds each give one colour, and the glow eases to them.
 */
export function Ambient({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      const video = [...document.querySelectorAll<HTMLVideoElement>(".preview__stage video")].find(
        (v) => v.readyState >= 2 && v.videoWidth > 0,
      );
      if (!video || !ref.current) return;
      try {
        // A new canvas each time: one picture the page may not read would block every later one.
        const canvas = document.createElement("canvas");
        canvas.width = 12;
        canvas.height = 6;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(video, 0, 0, 12, 6);
        const { data } = context.getImageData(0, 0, 12, 6);
        // Middle third → the big glow at the top, right → right, left → bottom left.
        ([4, 8, 0] as const).forEach((from, glow) => {
          let r = 0;
          let g = 0;
          let b = 0;
          for (let y = 0; y < 6; y++) {
            for (let x = from; x < from + 4; x++) {
              const i = (y * 12 + x) * 4;
              r += data[i];
              g += data[i + 1];
              b += data[i + 2];
            }
          }
          // Dark scenes still glow a little, in their own colour.
          const top = Math.max(r, g, b) / 24;
          const lift = top > 0 ? Math.min(3, Math.max(1, 150 / top)) : 1;
          const channel = (sum: number) => Math.min(255, Math.round((sum / 24) * lift));
          ref.current!.style.setProperty(`--glow-${glow + 1}`, `${channel(r)} ${channel(g)} ${channel(b)}`);
        });
      } catch {
        // A picture this page may not read (a site's own address): the glow keeps its colours.
      }
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  return (
    <div ref={ref} className="ambient" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}
