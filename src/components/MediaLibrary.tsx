import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  addCollection,
  deleteCollection,
  forgetPath,
  moveTab,
  orderedTabs,
  removeFromCollection,
  renameCollection,
  setTitle,
  titleOf,
  toggleInCollection,
  type Collection,
  type Organize,
} from "../lib/libraryOrganize";
import { loadOrganize, saveOrganize, type LibraryEntry } from "../lib/storage";
import { formatClock } from "../lib/timecode";
import { Icon } from "./Icon";
import { FileThumb } from "./Thumb";
import { useConfirm } from "./ConfirmDialog";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { GifLinkBox } from "./GifLinkBox";
import { HiddenFold, useHidden } from "./Hidden";
import { PageSearch, PictureAction, PictureCard } from "./PictureCard";
import "./Library.css";
import "./MediaLibrary.css";

interface MediaLibraryProps {
  /** Every file imported into a project, newest first. */
  entries: LibraryEntry[];
  /** Adds the file to the project open in the editor. */
  onAdd: (path: string) => void;
  onSave: (path: string, saved: boolean) => void;
  /** Keeps a picture made from the file, so it's made once. */
  onThumbnail: (path: string, thumbnail: string) => void;
  /** Takes it off this list; the file isn't touched. */
  onForget: (path: string) => void;
  /** Imports GIF files into the library / project. */
  onImportGifs?: () => void;
  /** Downloads a GIF from a URL and adds it to the library / project. */
  onDownloadGif?: (url: string) => Promise<void>;
}

type Filter = "all" | "video" | "image" | "audio" | "gif" | "saved";

const COLLECTION_PREFIX = "c:";
const BUILTIN_TABS: Filter[] = ["all", "video", "image", "audio", "gif", "saved"];
const TAB_LABELS: Record<Filter, ReactNode> = {
  all: "All",
  video: "Videos",
  image: "Pictures",
  audio: "Sound",
  gif: "GIFs",
  saved: (
    <>
      <Icon name="star" size={14} />
      Saved
    </>
  ),
};

const KIND_LABEL: Record<LibraryEntry["kind"], string> = {
  video: "Video",
  image: "Picture",
  audio: "Sound",
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const DRAG_THRESHOLD = 6;

const newCollectionId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type MenuState =
  | { kind: "tab"; x: number; y: number; collection: Collection }
  | { kind: "card"; x: number; y: number; entry: LibraryEntry; hidden: boolean }
  | { kind: "pick-collection"; x: number; y: number; entry: LibraryEntry };

type TabDragState = {
  tabId: string;
  startX: number;
  startY: number;
  active: boolean;
  insertIndex: number;
  line: { left: number; top: number; height: number } | null;
};

type CardDragState = {
  path: string;
  name: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  hoverCollectionId: string | null;
};

function computeTabInsert(
  clientX: number,
  clientY: number,
  tabs: string[],
  tabId: string,
  tabBarEl: HTMLElement | null,
  tabEls: Map<string, HTMLElement>,
) {
  if (!tabBarEl) return { insertIndex: -1, line: null };
  const barRect = tabBarEl.getBoundingClientRect();
  const items = tabs
    .map((id, index) => {
      const el = tabEls.get(id);
      return el ? { id, index, rect: el.getBoundingClientRect() } : null;
    })
    .filter((x): x is { id: string; index: number; rect: DOMRect } => x !== null);
  if (items.length === 0) return { insertIndex: -1, line: null };

  const distY = (r: DOMRect) => (clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0);
  let minDy = Infinity;
  for (const item of items) minDy = Math.min(minDy, distY(item.rect));
  const rowItems = items.filter((item) => distY(item.rect) <= minDy + 2);

  let insertIndex = rowItems[rowItems.length - 1].index + 1;
  let lineX = rowItems[rowItems.length - 1].rect.right - barRect.left - 1;
  let lineTop = rowItems[0].rect.top - barRect.top;
  let lineHeight = rowItems[0].rect.height;

  for (let i = 0; i < rowItems.length; i++) {
    const item = rowItems[i];
    if (clientX < item.rect.left + item.rect.width / 2) {
      insertIndex = item.index;
      lineTop = item.rect.top - barRect.top;
      lineHeight = item.rect.height;
      lineX = i > 0 ? (rowItems[i - 1].rect.right + item.rect.left) / 2 - barRect.left - 1 : item.rect.left - barRect.left - 1;
      break;
    }
  }

  const fromIndex = tabs.indexOf(tabId);
  const isNoop = insertIndex === fromIndex || insertIndex === fromIndex + 1;
  return {
    insertIndex,
    line: isNoop ? null : { left: Math.round(lineX), top: Math.round(lineTop), height: Math.round(lineHeight) },
  };
}

export function MediaLibrary({ entries, onAdd, onSave, onThumbnail, onForget, onImportGifs, onDownloadGif }: MediaLibraryProps) {
  const { ask, dialog } = useConfirm();
  const [organize, setOrganize] = useState<Organize>(() => loadOrganize());
  const updateOrganize = (fn: (prev: Organize) => Organize) => {
    setOrganize((prev) => {
      const next = fn(prev);
      if (next !== prev) saveOrganize(next);
      return next;
    });
  };

  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const gridRef = useRef<HTMLUListElement>(null);

  const [tabDrag, setTabDrag] = useState<TabDragState | null>(null);
  const tabDragRef = useRef<TabDragState | null>(null);
  const suppressTabClickRef = useRef(false);

  const [cardDrag, setCardDrag] = useState<CardDragState | null>(null);
  const cardDragRef = useRef<CardDragState | null>(null);
  const suppressCardClickRef = useRef(false);

  const tabs = orderedTabs(organize, BUILTIN_TABS);
  const collectionsById = new Map(organize.collections.map((c) => [c.id, c]));
  const activeCollection = activeTab.startsWith(COLLECTION_PREFIX)
    ? collectionsById.get(activeTab.slice(COLLECTION_PREFIX.length)) ?? null
    : null;
  const currentTab = activeTab.startsWith(COLLECTION_PREFIX) && !activeCollection ? "all" : activeTab;

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const collectionsRef = useRef(organize.collections);
  collectionsRef.current = organize.collections;

  const isTabDragging = Boolean(tabDrag);
  useEffect(() => {
    if (!isTabDragging) return;
    const onMove = (e: PointerEvent) => {
      const cur = tabDragRef.current;
      if (!cur) return;
      if (!cur.active) {
        if (Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY) < DRAG_THRESHOLD) return;
        window.getSelection()?.removeAllRanges();
      }
      const { insertIndex, line } = computeTabInsert(e.clientX, e.clientY, tabsRef.current, cur.tabId, tabBarRef.current, tabElsRef.current);
      const next: TabDragState = { ...cur, active: true, insertIndex, line };
      tabDragRef.current = next;
      setTabDrag(next);
    };
    const finish = (commit: boolean) => {
      const cur = tabDragRef.current;
      tabDragRef.current = null;
      setTabDrag(null);
      if (!cur?.active) return;
      suppressTabClickRef.current = true;
      window.setTimeout(() => {
        suppressTabClickRef.current = false;
      }, 0);
      if (!commit) return;
      const curTabs = tabsRef.current;
      const fromIndex = curTabs.indexOf(cur.tabId);
      if (fromIndex !== -1 && cur.insertIndex >= 0 && cur.insertIndex !== fromIndex && cur.insertIndex !== fromIndex + 1) {
        const toIndex = cur.insertIndex > fromIndex ? cur.insertIndex - 1 : cur.insertIndex;
        updateOrganize((o) => moveTab(o, cur.tabId, toIndex, BUILTIN_TABS));
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [isTabDragging]);

  const isCardDragging = Boolean(cardDrag);
  useEffect(() => {
    if (!isCardDragging) return;
    const onMove = (e: PointerEvent) => {
      const cur = cardDragRef.current;
      if (!cur) return;
      if (!cur.active) {
        if (Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY) < DRAG_THRESHOLD) return;
        window.getSelection()?.removeAllRanges();
      }
      let hoverCollectionId: string | null = null;
      for (const col of collectionsRef.current) {
        const el = tabElsRef.current.get(COLLECTION_PREFIX + col.id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          hoverCollectionId = col.id;
          break;
        }
      }
      const next: CardDragState = { ...cur, active: true, x: e.clientX, y: e.clientY, hoverCollectionId };
      cardDragRef.current = next;
      setCardDrag(next);
    };
    const finish = (commit: boolean) => {
      const cur = cardDragRef.current;
      cardDragRef.current = null;
      setCardDrag(null);
      if (!cur?.active) return;
      suppressCardClickRef.current = true;
      window.setTimeout(() => {
        suppressCardClickRef.current = false;
      }, 0);
      if (commit && cur.hoverCollectionId) {
        const colId = cur.hoverCollectionId;
        const path = cur.path;
        updateOrganize((o) => {
          const col = o.collections.find((c) => c.id === colId);
          return !col || col.paths.includes(path) ? o : toggleInCollection(o, colId, path);
        });
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [isCardDragging]);

  const forget = async (entry: LibraryEntry) => {
    const shownName = titleOf(organize, entry.path, entry.name);
    const ok = await ask({
      title: `Remove “${shownName}” from the list?`,
      message: "It leaves the Media library (and Saved, if it's starred). The file itself stays on your PC, and it comes back here if you import it again.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) {
      updateOrganize((o) => forgetPath(o, entry.path));
      onForget(entry.path);
    }
  };

  const confirmAdd = async (entry: LibraryEntry) => {
    const shownName = titleOf(organize, entry.path, entry.name);
    const ok = await ask({
      title: "Add to your project?",
      message: `${shownName} goes into the project you're working on.`,
      confirmLabel: "Add",
      danger: true,
      note: "",
    });
    if (ok) onAdd(entry.path);
  };

  const confirmDeleteCollection = async (col: Collection) => {
    const ok = await ask({
      title: `Delete “${col.name}”?`,
      message: "Only the collection is removed. The files stay in your Media library and on your PC.",
      confirmLabel: "Delete collection",
      danger: true,
      note: "This never deletes any files.",
    });
    if (!ok) return;
    updateOrganize((o) => deleteCollection(o, col.id));
    if (activeTab === COLLECTION_PREFIX + col.id) setActiveTab("all");
  };

  const createCollection = () => {
    const id = newCollectionId();
    updateOrganize((o) => addCollection(o, "New collection", id));
    setRenamingTabId(id);
  };

  const words = search.trim().toLowerCase();
  const hidden = useHidden("media");
  const collectionPaths = activeCollection ? new Set(activeCollection.paths) : null;
  const matching = entries.filter((e) => {
    const matchesTab = collectionPaths
      ? collectionPaths.has(e.path)
      : currentTab === "all" ||
        (currentTab === "saved" ? e.saved : currentTab === "gif" ? Boolean(e.animated) : currentTab === "image" ? e.kind === "image" && !e.animated : e.kind === currentTab);
    if (!matchesTab) return false;
    if (!words) return true;
    const shownName = titleOf(organize, e.path, e.name).toLowerCase();
    return shownName.includes(words) || e.name.toLowerCase().includes(words);
  });
  const shown = matching.filter((e) => !hidden.isHidden(e.path));
  const hiddenShown = matching.filter((e) => hidden.isHidden(e.path));

  const openMenuAt = (e: ReactMouseEvent, nextMenu: (x: number, y: number) => MenuState) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.clientX || e.clientY) {
      setMenu(nextMenu(e.clientX, e.clientY));
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setMenu(nextMenu(Math.round(r.left + 12), Math.round(r.top + 12)));
  };

  const renderCard = (entry: LibraryEntry, actions: ReactNode, isHidden = false) => {
    const shownName = titleOf(organize, entry.path, entry.name);
    return (
      <PictureCard
        key={entry.path}
        thumb={
          <FileThumb
            path={entry.path}
            src={entry.thumbnail}
            image={entry.kind === "image"}
            icon={entry.kind === "image" ? "image" : entry.kind === "audio" ? "music" : "film"}
            onMade={(thumbnail) => onThumbnail(entry.path, thumbnail)}
            play={entry.kind === "video"}
          />
        }
        tag={entry.animated ? "GIF" : KIND_LABEL[entry.kind]}
        badge={entry.kind !== "image" && entry.duration > 0 ? formatClock(entry.duration) : undefined}
        name={shownName}
        meta={`Imported ${dateFormat.format(entry.addedAt)}`}
        onOpen={() => void confirmAdd(entry)}
        onMenu={(e) => openMenuAt(e, (x, y) => ({ kind: "card", x, y, entry, hidden: isHidden }))}
        renaming={renamingPath === entry.path}
        onRename={(next) => {
          setRenamingPath(null);
          if (next !== null) updateOrganize((o) => setTitle(o, entry.path, next));
        }}
        actions={actions}
      />
    );
  };

  const menuItems = (): { label: string; items: MenuItem[] } | null => {
    if (!menu) return null;
    if (menu.kind === "tab") {
      const col = menu.collection;
      return {
        label: col.name,
        items: [
          { label: "Rename", icon: "pencil", onClick: () => setRenamingTabId(col.id) },
          { label: "Delete collection", icon: "trash", danger: true, onClick: () => void confirmDeleteCollection(col) },
        ],
      };
    }
    if (menu.kind === "pick-collection") {
      const { entry } = menu;
      const items: MenuItem[] =
        organize.collections.length > 0
          ? organize.collections.map((col) => ({
              label: col.name,
              icon: col.paths.includes(entry.path) ? "check" : undefined,
              onClick: () => updateOrganize((o) => toggleInCollection(o, col.id, entry.path)),
            }))
          : [
              {
                label: "New collection",
                icon: "plus",
                onClick: () => {
                  const id = newCollectionId();
                  updateOrganize((o) => toggleInCollection(addCollection(o, "New collection", id), id, entry.path));
                  setRenamingTabId(id);
                },
              },
            ];
      return { label: "Add to collection", items };
    }
    const { entry, hidden: isHidden } = menu;
    const shownName = titleOf(organize, entry.path, entry.name);
    const items: MenuItem[] = [
      { label: "Add to project", icon: "plus", onClick: () => onAdd(entry.path) },
      "sep",
      { label: "Add to collection", icon: "folder", onClick: () => setMenu({ kind: "pick-collection", x: menu.x, y: menu.y, entry }) },
      ...(activeCollection
        ? [
            {
              label: "Remove from this collection",
              icon: "x" as const,
              onClick: () => updateOrganize((o) => removeFromCollection(o, activeCollection.id, entry.path)),
            },
          ]
        : []),
      { label: "Rename", icon: "pencil", onClick: () => setRenamingPath(entry.path) },
      "sep",
      { label: entry.saved ? "Remove from Saved" : "Save it", icon: "star", onClick: () => onSave(entry.path, !entry.saved) },
      { label: isHidden ? "Unhide" : "Hide from list", icon: isHidden ? "eye" : "eyeOff", onClick: () => hidden.setHidden([entry.path], !isHidden) },
      { label: "Remove from list", icon: "trash", danger: true, onClick: () => void forget(entry) },
    ];
    return { label: shownName, items };
  };

  const activeMenu = menuItems();

  return (
    <section className={tabDrag?.active || cardDrag?.active ? "pc-page is-dragging-org" : "pc-page"} aria-labelledby="media-library-title">
      {dialog}
      {menu && activeMenu && <ContextMenu x={menu.x} y={menu.y} label={activeMenu.label} items={activeMenu.items} onClose={() => setMenu(null)} />}
      {cardDrag?.active && (
        <div className="media-library__drag-ghost" style={{ left: cardDrag.x + 12, top: cardDrag.y + 12 }} aria-hidden="true">
          {cardDrag.name}
        </div>
      )}

      <header className="pc-head">
        <div>
          <h1 id="media-library-title">Media library</h1>
          <p>Videos, pictures and sounds you've imported or fetched.</p>
        </div>
      </header>

      <div className="media-library__list">
        <div className="pc-bar">
          <div className="pc-bar__start">
            <div className="pc-tabs media-library__tabs" role="tablist" aria-label="Show" ref={tabBarRef}>
              {tabs.map((tabId) => {
                const isCollection = tabId.startsWith(COLLECTION_PREFIX);
                const col = isCollection ? collectionsById.get(tabId.slice(COLLECTION_PREFIX.length)) : undefined;
                if (isCollection && !col) return null;
                const isRenaming = col && renamingTabId === col.id;
                const isDraggingThis = tabDrag?.active && tabDrag.tabId === tabId;
                const isDropTarget = Boolean(cardDrag?.active && col && cardDrag.hoverCollectionId === col.id);
                const setTabRef = (el: HTMLElement | null) => {
                  if (el) tabElsRef.current.set(tabId, el);
                  else tabElsRef.current.delete(tabId);
                };

                if (isRenaming && col) {
                  return (
                    <input
                      key={tabId}
                      ref={setTabRef}
                      className="media-library__tab-rename"
                      defaultValue={col.name}
                      aria-label="Collection name"
                      autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          e.currentTarget.dataset.cancel = "1";
                          e.currentTarget.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const cancelled = e.currentTarget.dataset.cancel;
                        const value = e.currentTarget.value;
                        setRenamingTabId(null);
                        if (!cancelled) updateOrganize((o) => renameCollection(o, col.id, value));
                      }}
                    />
                  );
                }

                const label = col ? col.name : TAB_LABELS[tabId as Filter];
                return (
                  <button
                    key={tabId}
                    ref={setTabRef}
                    type="button"
                    role="tab"
                    className={`pc-tab${isDraggingThis ? " is-dragging" : ""}${isDropTarget ? " is-drop-target" : ""}`}
                    aria-selected={currentTab === tabId}
                    onClick={() => {
                      if (suppressTabClickRef.current) return;
                      setActiveTab(tabId);
                    }}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || renamingTabId) return;
                      const initial: TabDragState = { tabId, startX: e.clientX, startY: e.clientY, active: false, insertIndex: -1, line: null };
                      tabDragRef.current = initial;
                      setTabDrag(initial);
                    }}
                    onContextMenu={
                      col
                        ? (e) => openMenuAt(e, (x, y) => ({ kind: "tab", x, y, collection: col }))
                        : undefined
                    }
                  >
                    {label}
                  </button>
                );
              })}
              {tabDrag?.active && tabDrag.line && (
                <span
                  className="media-library__tab-insert"
                  style={{ left: tabDrag.line.left, top: tabDrag.line.top, height: tabDrag.line.height }}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
          <div className="pc-bar__end">
            <PageSearch id="media-search" value={search} onChange={setSearch} placeholder="Search by file name" />
            <button type="button" className="btn btn--secondary" onClick={createCollection}>
              <Icon name="plus" size={14} />
              New Collection
            </button>
          </div>
        </div>

        {currentTab === "gif" && (onDownloadGif || onImportGifs) && (
          <div className="media-library__gif-actions">
            {onDownloadGif && <GifLinkBox onDownload={onDownloadGif} />}
            {onImportGifs && (
              <button type="button" className="btn btn--secondary" onClick={onImportGifs}>
                <Icon name="upload" size={14} />
                Import GIFs
              </button>
            )}
          </div>
        )}

        {currentTab === "gif" && !entries.some((e) => e.animated) ? (
          <p className="pc-muted">No GIFs yet. Import a GIF and it shows up here and in the editor's GIFs tab.</p>
        ) : entries.length === 0 ? (
          <p className="pc-muted">Files you import into a project show up here, so you can find them again.</p>
        ) : activeCollection && !words && matching.length === 0 ? (
          <p className="pc-muted">This collection is empty. Drag files onto its tab or right-click a file to add it.</p>
        ) : shown.length === 0 ? (
          <p className="pc-muted">{hiddenShown.length ? "Everything here is hidden." : "Nothing matches."}</p>
        ) : (
          <ul
            ref={gridRef}
            className="pc-grid is-5"
            onDragStart={(e) => e.preventDefault()}
            onClickCapture={(e) => {
              if (!suppressCardClickRef.current) return;
              e.stopPropagation();
              e.preventDefault();
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              if ((e.target as HTMLElement).closest("input, .pcard__actions")) return;
              const ul = gridRef.current;
              const li = (e.target as HTMLElement).closest(".pcard");
              if (!ul || !li || li.parentElement !== ul) return;
              const idx = Array.prototype.indexOf.call(ul.children, li);
              const entry = shown[idx];
              if (!entry) return;
              const initial: CardDragState = {
                path: entry.path,
                name: titleOf(organize, entry.path, entry.name),
                startX: e.clientX,
                startY: e.clientY,
                x: e.clientX,
                y: e.clientY,
                active: false,
                hoverCollectionId: null,
              };
              cardDragRef.current = initial;
              setCardDrag(initial);
            }}
          >
            {shown.map((entry) => {
              const shownName = titleOf(organize, entry.path, entry.name);
              return renderCard(
                entry,
                <>
                  <PictureAction
                    icon="star"
                    label={entry.saved ? "Remove from Saved" : "Save it"}
                    on={Boolean(entry.saved)}
                    onClick={() => onSave(entry.path, !entry.saved)}
                  />
                  <PictureAction icon="eyeOff" label={`Hide ${shownName}`} onClick={() => hidden.setHidden([entry.path], true)} />
                  <PictureAction icon="trash" label={`Remove ${shownName} from the library`} onClick={() => void forget(entry)} />
                </>,
              );
            })}
          </ul>
        )}
      </div>

      <HiddenFold count={hiddenShown.length} note="Hidden from this list only. The files stay on your PC and in your projects.">
        <ul className="pc-grid is-5">
          {hiddenShown.map((entry) => {
            const shownName = titleOf(organize, entry.path, entry.name);
            return renderCard(
              entry,
              <PictureAction icon="eye" label={`Unhide ${shownName}`} onClick={() => hidden.setHidden([entry.path], false)} />,
              true,
            );
          })}
        </ul>
      </HiddenFold>
    </section>
  );
}
