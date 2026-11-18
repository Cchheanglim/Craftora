import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import "./MenuBar.css";

export interface MenuItem {
  id: string;
  label: string;
  keys?: string;
  disabled?: boolean;
  checked?: boolean;
  items?: MenuItem[];
  run: () => void;
}

export interface Menu {
  label: string;
  items: (MenuItem | "sep")[];
}

export function MenuBar({ menus }: { menus: Menu[] }): JSX.Element {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [openSubId, setOpenSubId] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const parentRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const titleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusFirstRef = useRef(false);
  const focusFirstSubRef = useRef(false);
  const hoverTimerRef = useRef<number | null>(null);

  const safeActive = menus.length > 0 ? Math.min(activeIndex, menus.length - 1) : 0;

  const clearHoverTimer = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const getMainItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(':scope > [role^="menuitem"]:not(:disabled), :scope > .menubar__parent > [role^="menuitem"]:not(:disabled)') ?? []);

  const focusFirstInMenu = (menuIdx: number) => {
    const first = getMainItems()[0];
    if (first) first.focus();
    else titleRefs.current[menuIdx]?.focus();
  };

  const focusFirstInSub = (parentId: string) => {
    const first = subRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)');
    if (first) first.focus();
    else parentRefs.current[parentId]?.focus();
  };

  const openSubAndFocusFirst = (parentId: string) => {
    clearHoverTimer();
    if (openSubId === parentId) {
      focusFirstInSub(parentId);
    } else {
      focusFirstSubRef.current = true;
      setOpenSubId(parentId);
    }
  };

  const openAndFocusFirst = (menuIdx: number) => {
    setActiveIndex(menuIdx);
    if (openIndex === menuIdx) {
      setOpenSubId(null);
      focusFirstInMenu(menuIdx);
    } else {
      focusFirstRef.current = true;
      setOpenIndex(menuIdx);
    }
  };

  // One menu at a time: the main menu (Toolbar.tsx) closes when one of these opens, and the other way round.
  useEffect(() => {
    clearHoverTimer();
    setOpenSubId(null);
    if (openIndex !== null) window.dispatchEvent(new Event("craftora:menubar-open"));
    const close = () => setOpenIndex(null);
    window.addEventListener("craftora:nav-open", close);
    return () => {
      clearHoverTimer();
      window.removeEventListener("craftora:nav-open", close);
    };
  }, [openIndex]);

  useEffect(() => {
    if (openIndex !== null && focusFirstRef.current) {
      focusFirstRef.current = false;
      focusFirstInMenu(openIndex);
    }
  }, [openIndex]);

  useEffect(() => {
    if (openSubId !== null && focusFirstSubRef.current) {
      focusFirstSubRef.current = false;
      focusFirstInSub(openSubId);
    }
  }, [openSubId]);

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
        if (openSubId !== null && subRef.current?.contains(document.activeElement)) {
          const id = openSubId;
          setOpenSubId(null);
          parentRefs.current[id]?.focus();
        } else {
          const idx = openIndex;
          setOpenIndex(null);
          titleRefs.current[idx]?.focus();
        }
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openIndex, openSubId]);

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
      clearHoverTimer();
      setOpenSubId(null);
      const items = getMainItems();
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

  const onSubKeyDown = (e: KeyboardEvent<HTMLDivElement>, parentId: string) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const items = Array.from(subRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (at === -1 ? 0 : (at + 1) % items.length) : at <= 0 ? items.length - 1 : at - 1;
      items[next]?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpenSubId(null);
      parentRefs.current[parentId]?.focus();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const runItem = (item: MenuItem) => {
    if (item.disabled) return;
    setOpenSubId(null);
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
                {menu.items.map((item, j) => {
                  if (item === "sep") {
                    return <div key={`sep-${j}`} className="menubar__sep" role="separator" />;
                  }
                  if (item.items) {
                    const isSubOpen = openSubId === item.id && !item.disabled;
                    return (
                      <div
                        key={item.id}
                        className="menubar__parent"
                        onPointerLeave={() => clearHoverTimer()}
                      >
                        <button
                          ref={(el) => {
                            parentRefs.current[item.id] = el;
                          }}
                          type="button"
                          className="menubar__item"
                          role="menuitem"
                          aria-haspopup="menu"
                          aria-expanded={isSubOpen}
                          tabIndex={-1}
                          disabled={item.disabled}
                          onClick={() => {
                            if (!item.disabled) openSubAndFocusFirst(item.id);
                          }}
                          onPointerEnter={(e) => {
                            clearHoverTimer();
                            if (openSubId !== null && openSubId !== item.id) {
                              setOpenSubId(null);
                            }
                            if (!item.disabled) {
                              e.currentTarget.focus();
                              if (openSubId !== item.id) {
                                hoverTimerRef.current = window.setTimeout(() => {
                                  hoverTimerRef.current = null;
                                  setOpenSubId(item.id);
                                }, 120);
                              }
                            }
                          }}
                          onKeyDown={(e) => {
                            if (!item.disabled && (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")) {
                              e.preventDefault();
                              e.stopPropagation();
                              openSubAndFocusFirst(item.id);
                            }
                          }}
                        >
                          {item.checked && <Icon name="check" size={12} />}
                          <span>{item.label}</span>
                          <Icon name="chevronRight" size={12} className="menubar__chevron" />
                        </button>
                        {isSubOpen && (
                          <div
                            ref={subRef}
                            className="menubar__sub"
                            role="menu"
                            onKeyDown={(e) => onSubKeyDown(e, item.id)}
                          >
                            {item.items.map((sub) => (
                              <button
                                key={sub.id}
                                type="button"
                                className="menubar__item"
                                role={sub.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                                aria-checked={sub.checked}
                                tabIndex={-1}
                                disabled={sub.disabled}
                                onClick={() => runItem(sub)}
                                onPointerEnter={(e) => {
                                  if (!sub.disabled) e.currentTarget.focus();
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    runItem(sub);
                                  }
                                }}
                              >
                                {sub.checked && <Icon name="check" size={12} />}
                                <span>{sub.label}</span>
                                {sub.keys && <span className="menubar__keys">{sub.keys}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="menubar__item"
                      role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                      aria-checked={item.checked}
                      tabIndex={-1}
                      disabled={item.disabled}
                      onClick={() => runItem(item)}
                      onPointerEnter={(e) => {
                        clearHoverTimer();
                        if (openSubId !== null) setOpenSubId(null);
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
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
