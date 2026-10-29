import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export type HiddenListName = "projects" | "media" | "downloads" | "history";

function read(key: string): Set<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * What the user hid from a list: out of view only, nothing is deleted. Kept on this PC, per list.
 * shortcut: ids of items deleted later stay in the list (a few bytes each); prune if lists grow huge.
 */
export function useHidden(list: HiddenListName) {
  const key = `craftora.hidden.${list}`;
  const [ids, setIds] = useState(() => read(key));
  const setHidden = (changed: string[], hide: boolean) =>
    setIds((prev) => {
      const next = new Set(prev);
      for (const id of changed) {
        if (hide) next.add(id);
        else next.delete(id);
      }
      try {
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        /* not remembered */
      }
      return next;
    });
  return { isHidden: (id: string) => ids.has(id), setHidden };
}

export type Hidden = ReturnType<typeof useHidden>;

const SHOW_KEY = "craftora.showHidden";

/** Settings → Privacy: whether pages show their Hidden list at all (on unless turned off). */
export function showHiddenLists(): boolean {
  try {
    return localStorage.getItem(SHOW_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setShowHiddenLists(on: boolean) {
  try {
    localStorage.setItem(SHOW_KEY, on ? "1" : "0");
  } catch {
    /* not remembered */
  }
}

/** The eye button on a row: Hide, or Unhide in the Hidden list. */
export function HideButton({ hidden, id, name }: { hidden: Hidden; id: string; name: string }) {
  const isHidden = hidden.isHidden(id);
  return (
    <button
      type="button"
      className="btn btn--icon"
      aria-label={`${isHidden ? "Unhide" : "Hide"} ${name}`}
      title={isHidden ? "Unhide: show it in the list again" : "Hide it from this list (nothing is deleted)"}
      onClick={() => hidden.setHidden([id], !isHidden)}
    >
      <Icon name={isHidden ? "eye" : "eyeOff"} size={14} />
    </button>
  );
}

/**
 * The folded "Hidden" list at the bottom of a page; closed each time the page opens, and not
 * there at all when Settings → Privacy says not to show hidden items.
 */
export function HiddenFold({ count, note, children }: { count: number; note: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (count === 0 || !showHiddenLists()) return null;
  return (
    <div className="library__group">
      <button type="button" className="library__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chevronDown" size={14} />
        Hidden <span className="library__count">{count}</span>
      </button>
      {open && (
        <>
          <p className="library__muted">{note}</p>
          {children}
        </>
      )}
    </div>
  );
}
