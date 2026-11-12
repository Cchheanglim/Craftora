import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { fitTabs } from "../lib/fitTabs";
import { Icon } from "./Icon";
import "./Select.css";
import "./PanelTabs.css";

/** Space between the tabs, as in PanelTabs.css. */
const GAP = 2;

/**
 * One row of panel tabs: those that fit whole, and a More menu with the rest (no tab half cut off or faded). The open
 * tab always stays in the row.
 */
export function PanelTabs<T extends string>({
  tabs,
  value,
  onPick,
  label,
}: {
  /** In order. */
  tabs: { id: T; label: string }[];
  /** The open tab (pressed), or null when none of these is open (e.g. a settings panel is open). */
  value: T | null;
  onPick: (id: T) => void;
  /** For screen readers, e.g. "Right panel". */
  label: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const key = `ptabs-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [shown, setShown] = useState<number[]>(() => tabs.map((_, i) => i));
  // Labels, not the array: callers usually pass a new array each render.
  const labels = tabs.map((t) => t.label).join("\n");

  // Every tab (and More) is measured in a hidden copy of the row, so what fits is known before anything is cut.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const measure = measureRef.current;
    if (!box || !measure) return;
    const update = () => {
      const sizes = Array.from(measure.children).map((el) => (el as HTMLElement).offsetWidth);
      const more = sizes.pop() ?? 0;
      const style = getComputedStyle(box);
      const room = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const next = fitTabs(sizes, room, more + GAP, GAP);
      setShown((now) => (now.join() === next.join() ? now : next));
    };
    update();
    // The panel is resizable, and the font loading late widens the tabs.
    const observer = new ResizeObserver(update);
    observer.observe(box);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [labels]);

  const hidden = tabs.filter((_, i) => !shown.includes(i));

  return (
    <div ref={boxRef} className="ptabs">
      <div className="ptabs__strip" role="group" aria-label={label}>
        {shown.map((i) => (
          <button key={tabs[i].id} type="button" aria-pressed={tabs[i].id === value} onClick={() => onPick(tabs[i].id)}>
            {tabs[i].label}
          </button>
        ))}
        {hidden.length > 0 && (
          <button
            type="button"
            className="ptabs__more"
            style={{ anchorName: `--${key}` } as CSSProperties}
            popoverTarget={key}
            aria-haspopup="menu"
            // The open tab is one of these: More shows it, the row stays as it is.
            aria-pressed={hidden.some((t) => t.id === value)}
            title={hidden.map((t) => t.label).join(", ")}
          >
            More
            <Icon name="chevronDown" size={13} />
          </button>
        )}
      </div>
      {hidden.length > 0 && (
        <div ref={listRef} id={key} popover="auto" role="menu" className="select__list ptabs__list" style={{ positionAnchor: `--${key}` } as CSSProperties}>
          {hidden.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={t.id === value}
              onClick={() => {
                listRef.current?.hidePopover();
                onPick(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div ref={measureRef} className="ptabs__strip ptabs__measure" aria-hidden="true">
        {tabs.map((t) => (
          <button key={t.id} type="button" tabIndex={-1} aria-pressed={t.id === value}>
            {t.label}
          </button>
        ))}
        <button type="button" tabIndex={-1} className="ptabs__more">
          More
          <Icon name="chevronDown" size={13} />
        </button>
      </div>
    </div>
  );
}
