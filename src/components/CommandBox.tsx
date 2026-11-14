import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./Icon";
import "./CommandBox.css";

export interface Command {
  id: string;
  label: string;          // "Remove background"
  detail?: string;        // grey text at the right, e.g. "keeps the subject, clears the rest"
  keys?: string;          // its shortcut, shown as <kbd>, e.g. "Ctrl J"
  icon: IconName;
  group: string;          // heading it's listed under, e.g. "Big Buck Bunny", "Add", "Picture"
  run: () => void;
  disabled?: boolean;
}

/** The commands matching `query`, best first, at most `limit`. Empty query: the first `limit` commands as given. */
export function filterCommands(commands: Command[], query: string, limit = 8): Command[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return commands.slice(0, limit);
  }

  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return commands.slice(0, limit);
  }

  const whole = trimmed.toLowerCase();
  const matching: { cmd: Command; originalIndex: number; rank: number }[] = [];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const labelLower = cmd.label.toLowerCase();
    const detailLower = (cmd.detail ?? "").toLowerCase();
    const groupLower = cmd.group.toLowerCase();

    const matches = words.every(
      (w) => labelLower.includes(w) || detailLower.includes(w) || groupLower.includes(w)
    );

    if (matches) {
      let rank = 2;
      if (labelLower.startsWith(whole)) {
        rank = 0;
      } else if (labelLower.includes(whole)) {
        rank = 1;
      }
      matching.push({ cmd, originalIndex: i, rank });
    }
  }

  matching.sort((a, b) => a.rank - b.rank || a.originalIndex - b.originalIndex);
  return matching.slice(0, limit).map((m) => m.cmd);
}

function highlightMatch(text: string, query: string): ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return text;
  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return text;

  const textLower = text.toLowerCase();
  const ranges: { start: number; end: number }[] = [];

  for (const word of words) {
    let index = textLower.indexOf(word);
    while (index !== -1) {
      ranges.push({ start: index, end: index + word.length });
      index = textLower.indexOf(word, index + 1);
    }
  }

  if (ranges.length === 0) return text;

  ranges.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: { start: number; end: number }[] = [];
  let current = ranges[0];
  for (let i = 1; i < ranges.length; i++) {
    const next = ranges[i];
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  for (let i = 0; i < merged.length; i++) {
    const { start, end } = merged[i];
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }
    parts.push(
      <strong key={i} className="cmd-box__match">
        {text.slice(start, end)}
      </strong>
    );
    lastIndex = end;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

interface CommandGroup {
  name: string;
  commands: Command[];
}

interface NavRow {
  id: string;
  run: () => void;
  disabled?: boolean;
}

export function CommandBox({
  commands,
  onAsk,
}: {
  commands: Command[];
  onAsk: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const baseId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const listId = `cmd-box-list-${baseId}`;

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);
  const hasQuery = query.trim().length > 0;

  // Group commands under their group headings in order of first appearance
  const groups = useMemo(() => {
    const list: CommandGroup[] = [];
    const map = new Map<string, Command[]>();
    for (const cmd of filtered) {
      let groupCommands = map.get(cmd.group);
      if (!groupCommands) {
        groupCommands = [];
        map.set(cmd.group, groupCommands);
        list.push({ name: cmd.group, commands: groupCommands });
      }
      groupCommands.push(cmd);
    }
    return list;
  }, [filtered]);

  // Flattened navigable rows matching DOM visual order
  const navigableRows = useMemo(() => {
    const rows: NavRow[] = [];
    for (const group of groups) {
      for (const cmd of group.commands) {
        rows.push({
          id: `${baseId}-cmd-${cmd.id}`,
          run: cmd.run,
          disabled: cmd.disabled,
        });
      }
    }
    if (hasQuery) {
      rows.push({
        id: `${baseId}-ask`,
        run: () => onAsk(query),
        disabled: false,
      });
    }
    return rows;
  }, [groups, hasQuery, baseId, query, onAsk]);

  // Keep highlight index within valid bounds
  useEffect(() => {
    if (highlightIndex >= navigableRows.length && navigableRows.length > 0) {
      setHighlightIndex(0);
    }
  }, [navigableRows.length, highlightIndex]);

  const activeRow =
    navigableRows.length > 0 && highlightIndex >= 0 && highlightIndex < navigableRows.length
      ? navigableRows[highlightIndex]
      : undefined;

  // Scroll highlighted row into view inside the listbox
  useEffect(() => {
    if (!open || !activeRow) return;
    const listEl = listRef.current;
    if (!listEl) return;
    const el = document.getElementById(activeRow.id);
    if (!el) return;

    const listRect = listEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    if (elRect.top < listRect.top) {
      listEl.scrollTop -= listRect.top - elRect.top;
    } else if (elRect.bottom > listRect.bottom) {
      listEl.scrollTop += elRect.bottom - listRect.bottom;
    }
  }, [open, activeRow?.id]);

  // Ctrl+K anywhere: focus input, open list
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        inputRef.current?.focus();
        // Typing replaces what was there.
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Click outside closes the list
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setHighlightIndex(0);
    if (!open) {
      setOpen(true);
    }
  };

  const execute = (action: () => void) => {
    action();
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (navigableRows.length > 0) {
        setHighlightIndex((prev) => (prev + 1) % navigableRows.length);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (navigableRows.length > 0) {
        setHighlightIndex((prev) => (prev - 1 + navigableRows.length) % navigableRows.length);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (!open) return;
      if (activeRow && !activeRow.disabled) {
        execute(activeRow.run);
      }
      return;
    }
  };

  let rowCounter = 0;

  return (
    <div ref={containerRef} className="cmd-box">
      <div
        className={`cmd-box__field${open ? " cmd-box__field--open" : ""}`}
        onClick={() => inputRef.current?.focus()}
      >
        <span className="cmd-box__search-icon" aria-hidden="true">
          <Icon name="search" size={14} />
        </span>
        <input
          ref={inputRef}
          type="text"
          className="cmd-box__input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeRow ? activeRow.id : undefined}
          value={query}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          onBlur={(e) => {
            if (containerRef.current && containerRef.current.contains(e.relatedTarget as Node)) {
              return;
            }
            setOpen(false);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Add text, remove background, make it a story…"
          spellCheck={false}
          autoComplete="off"
        />
        <kbd className="cmd-box__kbd">{open ? "Esc" : "Ctrl K"}</kbd>
      </div>

      {open && navigableRows.length > 0 && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="cmd-box__list"
          onMouseDown={(e) => e.preventDefault()}
        >
          {groups.map((group) => (
            <div key={group.name} className="cmd-box__group" role="presentation">
              <div className="cmd-box__group-heading" role="presentation">
                {group.name}
              </div>
              {group.commands.map((cmd) => {
                const rowIndex = rowCounter++;
                const rowId = `${baseId}-cmd-${cmd.id}`;
                const isSelected = activeRow?.id === rowId;
                return (
                  <div
                    key={cmd.id}
                    id={rowId}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={cmd.disabled ? true : undefined}
                    className={`cmd-box__row${isSelected ? " cmd-box__row--selected" : ""}${
                      cmd.disabled ? " cmd-box__row--disabled" : ""
                    }`}
                    onMouseEnter={() => setHighlightIndex(rowIndex)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (!cmd.disabled) {
                        execute(cmd.run);
                      }
                    }}
                  >
                    <span className="cmd-box__row-icon" aria-hidden="true">
                      <Icon name={cmd.icon} size={16} />
                    </span>
                    <span className="cmd-box__row-label">
                      {highlightMatch(cmd.label, query)}
                    </span>
                    {(cmd.detail || cmd.keys) && (
                      <span className="cmd-box__row-end">
                        {cmd.detail && (
                          <span className="cmd-box__row-detail">{cmd.detail}</span>
                        )}
                        {cmd.keys && (
                          <kbd className="cmd-box__row-keys">{cmd.keys}</kbd>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {hasQuery && (
            <>
              {filtered.length > 0 && (
                <div className="cmd-box__divider" role="separator" />
              )}
              {(() => {
                const askRowIndex = rowCounter++;
                const askRowId = `${baseId}-ask`;
                const isSelected = activeRow?.id === askRowId;
                return (
                  <div
                    id={askRowId}
                    role="option"
                    aria-selected={isSelected}
                    className={`cmd-box__row cmd-box__row--ask${
                      isSelected ? " cmd-box__row--selected" : ""
                    }`}
                    onMouseEnter={() => setHighlightIndex(askRowIndex)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => execute(() => onAsk(query))}
                  >
                    <span className="cmd-box__row-icon" aria-hidden="true">
                      <Icon name="sparkle" size={16} />
                    </span>
                    <span className="cmd-box__row-label">
                      Ask the assistant: <span className="cmd-box__match">“{query}”</span>
                    </span>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}
    </div>
  );
}
