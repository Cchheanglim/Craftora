import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import "./MenuBar.css";

export interface MenuItem {
  id: string;
  label: string;
  keys?: string;
  disabled?: boolean;
  checked?: boolean;
  run: () => void;
}

export interface Menu {
  label: string;
  items: (MenuItem | "sep")[];
}

export function MenuBar({ menus }: { menus: Menu[] }): JSX.Element {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const titleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusFirstRef = useRef(false);

  const safeActive = menus.length > 0 ? Math.min(activeIndex, menus.length - 1) : 0;

  const focusFirstInMenu = (menuIdx: number) => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    if (first) first.focus();
    else titleRefs.current[menuIdx]?.focus();
  };

  const openAndFocusFirst = (menuIdx: number) => {
    setActiveIndex(menuIdx);
    if (openIndex === menuIdx) {
      focusFirstInMenu(menuIdx);
    } else {
      focusFirstRef.current = true;
      setOpenIndex(menuIdx);
    }
  };

  useEffect(() => {
    if (openIndex !== null && focusFirstRef.current) {
      focusFirstRef.current = false;
      focusFirstInMenu(openIndex);
    }
  }, [openIndex]);

  useEffect(() => {
    if (openIndex === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) {
        setOpenIndex(null);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        const idx = openIndex;
        setOpenIndex(null);
        titleRefs.current[idx]?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openIndex]);

  const onTitleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (menus.length === 0) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      const next = (i + (e.key === "ArrowRight" ? 1 : -1) + menus.length) % menus.length;
      setActiveIndex(next);
      if (openIndex !== null) setOpenIndex(next);
      titleRefs.current[next]?.focus();
    } else if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      openAndFocusFirst(i);
    } else if (e.key === "Escape" && openIndex !== null) {
      e.preventDefault();
      e.stopPropagation();
      setOpenIndex(null);
      titleRefs.current[i]?.focus();
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (at === -1 ? 0 : (at + 1) % items.length) : at <= 0 ? items.length - 1 : at - 1;
      items[next]?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      const next = (i + (e.key === "ArrowRight" ? 1 : -1) + menus.length) % menus.length;
      openAndFocusFirst(next);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpenIndex(null);
      titleRefs.current[i]?.focus();
    }
  };

  const runItem = (item: MenuItem) => {
    if (item.disabled) return;
    setOpenIndex(null);
    item.run();
  };

  return (
    <nav
      ref={navRef}
      className="menubar"
      role="menubar"
      aria-label="Menu bar"
      onBlur={(e) => {
        if (openIndex !== null && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) {
          setOpenIndex(null);
        }
      }}
    >
      {menus.map((menu, i) => {
        const isOpen = openIndex === i;
        return (
          <div key={menu.label} className="menubar__group">
            <button
              ref={(el) => {
                titleRefs.current[i] = el;
              }}
              type="button"
              className="menubar__title"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              tabIndex={i === safeActive ? 0 : -1}
              onClick={() => {
                setActiveIndex(i);
                setOpenIndex(isOpen ? null : i);
              }}
              onPointerEnter={() => {
                if (openIndex !== null && openIndex !== i) {
                  setActiveIndex(i);
                  setOpenIndex(i);
                  titleRefs.current[i]?.focus();
                }
              }}
              onKeyDown={(e) => onTitleKeyDown(e, i)}
            >
              {menu.label}
            </button>
            {isOpen && (
              <div ref={menuRef} className="menubar__menu" role="menu" onKeyDown={(e) => onMenuKeyDown(e, i)}>
                {menu.items.map((item, j) =>
                  item === "sep" ? (
                    <div key={`sep-${j}`} className="menubar__sep" role="separator" />
                  ) : (
                    <button
                      key={item.id}
                      type="button"
                      className="menubar__item"
                      role="menuitem"
                      tabIndex={-1}
                      disabled={item.disabled}
                      onClick={() => runItem(item)}
                      onPointerEnter={(e) => {
                        if (!item.disabled) e.currentTarget.focus();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          runItem(item);
                        }
                      }}
                    >
                      {item.checked && <Icon name="check" size={12} />}
                      <span>{item.label}</span>
                      {item.keys && <span className="menubar__keys">{item.keys}</span>}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
