import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import "./PanelTabs.css";

/** One row of panel tabs that scrolls sideways, with ‹ › at the ends when there is more to see. */
export function PanelTabs<T extends string>({
  tabs,
  value,
  onPick,
  label,
}: {
  /** In order; all in one row. */
  tabs: { id: T; label: string }[];
  /** The open tab (pressed), or null when none of these is open (e.g. a settings panel is open). */
  value: T | null;
  onPick: (id: T) => void;
  /** For screen readers, e.g. "Right panel". */
  label: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  // Labels, not the array: callers usually pass a new array each render.
  const labels = tabs.map((t) => t.label).join("\n");

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const update = () => {
      setCanLeft(strip.scrollLeft > 1);
      setCanRight(strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
    };
    update();
    strip.addEventListener("scroll", update, { passive: true });
    // The strip (the panel is resizable) and the tabs (the font loading late widens them) both change what fits.
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    Array.from(strip.children).forEach((tab) => observer.observe(tab));
    return () => {
      strip.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [labels]);

  // Native and not passive: React's onWheel can't stop the panel from scrolling too.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (e: WheelEvent) => {
      // A sideways trackpad swipe already scrolls the strip by itself.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const dy = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
      const room = dy < 0 ? strip.scrollLeft : strip.scrollWidth - strip.clientWidth - strip.scrollLeft;
      if (room <= 1) return; // At that end: let the page scroll as usual.
      e.preventDefault();
      strip.scrollLeft += dy;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  // Bring the open tab into view by scrolling the strip only (scrollIntoView could move the panel or page too).
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !tab) return;
    const start = tab.offsetLeft;
    const end = start + tab.offsetWidth;
    if (start < strip.scrollLeft) strip.scrollTo({ left: start, behavior: "smooth" });
    else if (end > strip.scrollLeft + strip.clientWidth)
      strip.scrollTo({ left: end - strip.clientWidth, behavior: "smooth" });
  }, [value, labels]);

  const page = (dir: -1 | 1) => {
    const strip = stripRef.current;
    if (strip) strip.scrollBy({ left: dir * strip.clientWidth * 0.7, behavior: "smooth" });
  };

  return (
    <div className="ptabs">
      <button
        type="button"
        className="ptabs__arrow"
        aria-label="Earlier tabs"
        style={{ visibility: canLeft ? "visible" : "hidden" }}
        onClick={() => page(-1)}
      >
        <Icon name="chevronLeft" size={14} />
      </button>
      <div ref={stripRef} className="ptabs__strip" role="group" aria-label={label}>
        {tabs.map((tab) => (
          <button key={tab.id} type="button" aria-pressed={tab.id === value} onClick={() => onPick(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="ptabs__arrow"
        aria-label="More tabs"
        style={{ visibility: canRight ? "visible" : "hidden" }}
        onClick={() => page(1)}
      >
        <Icon name="chevronRight" size={14} />
      </button>
    </div>
  );
}
