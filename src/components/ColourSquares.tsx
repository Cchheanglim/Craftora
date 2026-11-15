import { useRef, useState, type JSX } from "react";
import { COLOURS_START, type PaintColours } from "../lib/paint";
import { ColorWheel } from "./ColorWheel";
import "./ColourSquares.css";

type ActiveSquare = "fg" | "bg";

export function ColourSquares(props: {
  colours: PaintColours;
  onChange: (colours: PaintColours) => void;
}): JSX.Element {
  const { colours, onChange } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const suppressOpenRef = useRef(false);
  const [active, setActive] = useState<ActiveSquare | null>(null);
  const [pos, setPos] = useState({ left: 44, top: 0 });

  const toggleSquare = (which: ActiveSquare, btn: HTMLButtonElement) => {
    if (suppressOpenRef.current) {
      suppressOpenRef.current = false;
      return;
    }
    const panel = panelRef.current;
    if (active === which) {
      setActive(null);
      if (panel?.matches(":popover-open")) panel.hidePopover();
      return;
    }
    const r = btn.getBoundingClientRect();
    const box = rootRef.current?.getBoundingClientRect() ?? r;
    setActive(which);
    if (panel && !panel.matches(":popover-open")) {
      panel.showPopover();
    }
    const w = panel?.offsetWidth || 220;
    const h = panel?.offsetHeight || 280;
    setPos({
      left: Math.max(8, Math.min(box.right + 6, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(r.top, window.innerHeight - h - 8)),
    });
  };

  const target: ActiveSquare = active ?? "fg";

  return (
    <div ref={rootRef} className="colour-squares">
      <button
        type="button"
        className={`colour-squares__swatch colour-squares__swatch--fg${active === "fg" ? " is-open" : ""}`}
        style={{ background: colours.fg }}
        aria-label="Foreground colour"
        aria-expanded={active === "fg"}
        onPointerDown={() => {
          if (active === "fg") {
            suppressOpenRef.current = true;
            setActive(null);
            if (panelRef.current?.matches(":popover-open")) panelRef.current.hidePopover();
          } else {
            suppressOpenRef.current = false;
          }
        }}
        onClick={(e) => toggleSquare("fg", e.currentTarget)}
      />
      <button
        type="button"
        className={`colour-squares__swatch colour-squares__swatch--bg${active === "bg" ? " is-open" : ""}`}
        style={{ background: colours.bg }}
        aria-label="Background colour"
        aria-expanded={active === "bg"}
        onPointerDown={() => {
          if (active === "bg") {
            suppressOpenRef.current = true;
            setActive(null);
            if (panelRef.current?.matches(":popover-open")) panelRef.current.hidePopover();
          } else {
            suppressOpenRef.current = false;
          }
        }}
        onClick={(e) => toggleSquare("bg", e.currentTarget)}
      />
      <button
        type="button"
        className="colour-squares__swap"
        aria-label="Swap colours (X)"
        onClick={() => onChange({ fg: colours.bg, bg: colours.fg })}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 1 1.5 3 3.5 5M1.5 3H7V8.5M5 6.5 7 8.5 9 6.5" />
        </svg>
      </button>
      <button
        type="button"
        className="colour-squares__reset"
        aria-label="Default colours (D)"
        onClick={() => onChange(COLOURS_START)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="3.5" y="3.5" width="6" height="6" fill="#ffffff" stroke="#8a8a8a" strokeWidth="1" />
          <rect x="0.5" y="0.5" width="6" height="6" fill="#000000" stroke="#8a8a8a" strokeWidth="1" />
        </svg>
      </button>
      <div
        ref={panelRef}
        popover="auto"
        className="colour-squares__panel"
        style={{ left: pos.left, top: pos.top }}
        onToggle={(e) => {
          if (e.newState === "closed") setActive(null);
        }}
      >
        <div className="colour-squares__title">{target === "fg" ? "Foreground colour" : "Background colour"}</div>
        <ColorWheel
          color={colours[target]}
          onChange={(color) => onChange({ ...colours, [target]: color })}
        />
      </div>
    </div>
  );
}
