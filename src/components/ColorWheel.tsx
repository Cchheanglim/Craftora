import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import "./ColorWheel.css";

type Hsv = [number, number, number];

/** #rrggbb → hue (0–360), saturation and brightness (0–1). */
export function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.replace("#", ""), 16) || 0;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max === 0 ? 0 : d / max, max];
}

/** Hue (0–360), saturation and brightness (0–1) → #rrggbb. */
export function hsvToHex([h, s, v]: Hsv): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  return `#${[f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Any colour: a wheel (hue around, white in the middle) to click or drag on, a brightness slider and the colour's
 * code. Dragging changes it live (`live`), one undo step from `onCheckpoint`.
 */
export function ColorWheel({ color, onChange, onCheckpoint }: { color: string; onChange: (color: string, live?: boolean) => void; onCheckpoint?: () => void }) {
  // Kept here too: a hue means nothing in grey or black, but dragging back out should find it again.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color));
  const [code, setCode] = useState(color);
  const wheel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hsvToHex(hsv) !== color.toLowerCase()) setHsv(hexToHsv(color));
    setCode(color);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);
  const set = (next: Hsv, live: boolean) => {
    setHsv(next);
    onChange(hsvToHex(next), live);
  };
  const pickAt = (e: { clientX: number; clientY: number }) => {
    const r = wheel.current!.getBoundingClientRect();
    const [dx, dy] = [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2];
    // Hue clockwise from the top (red), as the wheel is drawn; saturation from the middle out.
    const hue = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    set([hue, Math.min(1, Math.hypot(dx, dy) / (r.width / 2)), hsv[2] || 1], true);
  };
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    onCheckpoint?.();
    e.currentTarget.setPointerCapture(e.pointerId);
    pickAt(e);
  };
  const [h, s, v] = hsv;
  const angle = (h * Math.PI) / 180;
  const applyCode = () => {
    const hex = `#${code.replace("#", "").toLowerCase()}`;
    if (!/^#[0-9a-f]{6}$/.test(hex)) return false;
    if (hex !== color.toLowerCase()) onChange(hex);
    return true;
  };
  return (
    <div className="color-wheel" style={{ "--full": hsvToHex([h, s, 1]) } as CSSProperties}>
      <div
        ref={wheel}
        className="color-wheel__disc"
        role="slider"
        aria-label="Colour"
        aria-valuetext={hsvToHex(hsv)}
        tabIndex={0}
        onPointerDown={drag}
        onPointerMove={(e) => e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId) && pickAt(e)}
      >
        <span className="color-wheel__dark" style={{ opacity: 1 - v }} />
        <span className="color-wheel__mark" style={{ left: `${50 + 50 * s * Math.sin(angle)}%`, top: `${50 - 50 * s * Math.cos(angle)}%`, background: hsvToHex(hsv) }} />
      </div>
      <input
        type="range"
        className="color-wheel__light"
        aria-label="Brightness"
        min={0}
        max={100}
        value={Math.round(v * 100)}
        onPointerDown={onCheckpoint}
        onChange={(e) => set([h, s, Number(e.target.value) / 100], true)}
      />
      <input
        className="field color-wheel__code mono"
        aria-label="Colour code"
        value={code}
        maxLength={7}
        spellCheck={false}
        onChange={(e) => setCode(e.target.value)}
        // Leaving the box applies a whole code too; half a code goes back to the colour.
        onBlur={() => (applyCode() ? undefined : setCode(color))}
        onKeyDown={(e) => e.key === "Enter" && applyCode()}
      />
    </div>
  );
}
