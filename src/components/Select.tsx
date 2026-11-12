import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import "./Select.css";

/**
 * A dropdown in Craftora's own look: a native <select> opens Windows' white list. The list is a popover (above
 * everything, closes on a click outside or Escape) placed under its button with CSS anchor positioning, flipping up
 * when there is no room below.
 */
export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
  className,
}: {
  /** For a <label htmlFor>. */
  id?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Extra classes for the button, such as "mono". */
  className?: string;
}) {
  // useId gives ":r1:"; anchor names and ids want plain letters.
  const key = `select-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  const pick = (next: T) => {
    if (next !== value) onChange(next);
    list.current?.hidePopover();
  };

  // Up and down move between the choices, like a native list.
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.min(items.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
    items[next]?.focus();
  };

  return (
    <>
      <button
        id={id}
        type="button"
        className={`field select${className ? ` ${className}` : ""}`}
        style={{ anchorName: `--${key}` } as CSSProperties}
        popoverTarget={key}
        aria-haspopup="listbox"
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          list.current?.showPopover();
        }}
      >
        <span className="truncate">{current?.label ?? ""}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      <div
        ref={list}
        id={key}
        popover="auto"
        role="listbox"
        className="select__list"
        style={{ positionAnchor: `--${key}` } as CSSProperties}
        onKeyDown={move}
        onToggle={(e) => {
          const isOpen = e.newState === "open";
          setOpen(isOpen);
          if (isOpen) list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
        }}
      >
        {options.map((o) => (
          <button key={o.value} type="button" role="option" aria-selected={o.value === value} onClick={() => pick(o.value)}>
            <span className="truncate">{o.label}</span>
            {o.value === value && <Icon name="check" size={14} />}
          </button>
        ))}
      </div>
    </>
  );
}
