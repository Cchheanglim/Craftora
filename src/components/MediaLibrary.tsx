import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  addCollection,
  addFolder,
  collectionNameTaken,
  deleteCollection,
  deleteFolder,
  folderPath,
  freeName,
  forgetPath,
  moveFolder,
  moveTab,
  moveToFolder,
  placedIn,
  orderedTabs,
  removeFromCollection,
  renameCollection,
  renameFolder,
  setFolderCover,
  setTitle,
  titleOf,
  toggleInCollection,
  type Collection,
  type Folder,
  type Organize,
} from "../lib/libraryOrganize";
import { errorText, fileThumbnail, inDesktopApp, pickPicture } from "../lib/engine";
import { loadOrganize, saveOrganize, type LibraryEntry } from "../lib/storage";
import { formatClock } from "../lib/timecode";
import { Icon } from "./Icon";
import { FileThumb } from "./Thumb";
import { useConfirm } from "./ConfirmDialog";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { GifImage } from "./GifPanel";
import { GifLinkBox } from "./GifLinkBox";
import { HiddenFold, useHidden } from "./Hidden";
import { HoverPreview } from "./HoverPreview";
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
  /** The Sound FX tab's Import sounds and Paste a sound link (desktop app only). */
  onImportSounds?: () => void;
  onDownloadSound?: (url: string) => Promise<void>;
}

type Filter = "all" | "video" | "image" | "audio" | "gif" | "sfx" | "saved";

const COLLECTION_PREFIX = "c:";
const BUILTIN_TABS: Filter[] = ["all", "video", "image", "audio", "gif", "sfx", "saved"];
const TAB_LABELS: Record<Filter, ReactNode> = {
  all: "All",
  video: "Videos",
  image: "Pictures",
  audio: "Audio",
  gif: "GIFs",
  sfx: "Sound FX",
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
  audio: "Audio",
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
  | { kind: "pick-collection"; x: number; y: number; entry: LibraryEntry }
  | { kind: "folder"; x: number; y: number; folder: Folder };

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
  /** The collection whose folders it's among (null = the library's own). */
  scope: string | null;
  /** Dragging a folder card instead of a file. */
  folderId?: string;
  /** The folder under the pointer (a folder card or a part of the path line); null = the top level; absent = none. */
  hoverFolder?: string | null;
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

export function MediaLibrary({ entries, onAdd, onSave, onThumbnail, onForget, onImportGifs, onDownloadGif, onImportSounds, onDownloadSound }: MediaLibraryProps) {
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
  /** The name typed for a collection that another one already has. */
  const [tabNameClash, setTabNameClash] = useState<string | null>(null);
  /** The folder whose cover is being picked from the Media library's pictures. */
  const [coverFor, setCoverFor] = useState<Folder | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  /** The folder being viewed (null = the top level). */
  const [openFolder, setOpenFolder] = useState<string | null>(null);
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
      // A folder card or a part of the path line under the pointer (folder cards come first in the grid).
      let hoverFolder: string | null | undefined;
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const crumb = under?.closest<HTMLElement>("[data-drop-folder]");
      if (crumb) hoverFolder = crumb.dataset.dropFolder || null;
      else {
        const li = under?.closest(".pcard");
        const ul = gridRef.current;
        const idx = li && ul && li.parentElement === ul ? Array.prototype.indexOf.call(ul.children, li) : -1;
        if (idx >= 0 && idx < levelFoldersRef.current.length) hoverFolder = levelFoldersRef.current[idx].id;
      }
      if (hoverFolder !== undefined && hoverFolder === cur.folderId) hoverFolder = undefined;
      const next: CardDragState = { ...cur, active: true, x: e.clientX, y: e.clientY, hoverCollectionId, hoverFolder };
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
      if (commit && cur.hoverFolder !== undefined) {
        const to = cur.hoverFolder;
        const folderId = cur.folderId;
        updateOrganize((o) => (folderId ? moveFolder(o, folderId, to) : moveToFolder(o, cur.path, to, cur.scope)));
      } else if (commit && cur.hoverCollectionId && !cur.folderId) {
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

  const confirmDeleteFolder = async (folder: Folder) => {
    const ok = await ask({
      title: `Delete the folder “${folder.name}”?`,
      message: "What's inside moves up one level. Nothing is deleted from your Media library or your PC.",
      confirmLabel: "Delete folder",
      danger: true,
      note: "This never deletes any files.",
    });
    if (!ok) return;
    updateOrganize((o) => deleteFolder(o, folder.id));
    if (openFolder && folderPath(organize, openFolder).some((f) => f.id === folder.id)) setOpenFolder(folder.parent);
  };

  const createCollection = () => {
    const id = newCollectionId();
    updateOrganize((o) => addCollection(o, freeName("New collection", o.collections.map((c) => c.name)), id));
    setRenamingTabId(id);
  };

  const words = search.trim().toLowerCase();
  const hidden = useHidden("media");
  const collectionPaths = activeCollection ? new Set(activeCollection.paths) : null;
  const matching = entries.filter((e) => {
    const matchesTab = collectionPaths
      ? collectionPaths.has(e.path)
      : currentTab === "all" ||
        (currentTab === "saved"
          ? e.saved
          : currentTab === "gif"
            ? Boolean(e.animated)
            : currentTab === "sfx"
              ? Boolean(e.sfx)
              : currentTab === "image"
                ? e.kind === "image" && !e.animated
                : currentTab === "audio"
                  ? e.kind === "audio" && !e.sfx
                  : e.kind === currentTab);
    if (!matchesTab) return false;
    if (!words) return true;
    const shownName = titleOf(organize, e.path, e.name).toLowerCase();
    return shownName.includes(words) || e.name.toLowerCase().includes(words);
  });
  const shown = matching.filter((e) => !hidden.isHidden(e.path));
  const hiddenShown = matching.filter((e) => hidden.isHidden(e.path));

  // Folders show on All, the kind tabs (the library's own folders) and a collection (its own); Saved and a search are
  // flat lists of every match.
  const foldersOn = !words && currentTab !== "saved";
  const scope = activeCollection?.id ?? null;
  const placed = placedIn(organize, scope);
  const scopeFolders = organize.folders.filter((f) => (f.collection ?? null) === scope);
  const here = openFolder && scopeFolders.some((f) => f.id === openFolder) ? openFolder : null;
  const parentOf = new Map(organize.folders.map((f) => [f.id, f.parent]));
  /** Every folder that holds (at any depth) one of `list`, with how many. */
  const holding = (list: LibraryEntry[]) => {
    const counts = new Map<string, number>();
    for (const e of list) {
      for (let f: string | null | undefined = placed[e.path]; f; f = parentOf.get(f)) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return counts;
  };
  const inside = holding(entries);
  const matchingInside = holding(shown);
  const levelFolders = foldersOn ? scopeFolders.filter((f) => f.parent === here && (currentTab === "all" || scope || matchingInside.has(f.id))) : [];
  const levelFoldersRef = useRef(levelFolders);
  levelFoldersRef.current = levelFolders;
  const levelFiles = foldersOn ? shown.filter((e) => (placed[e.path] ?? null) === here) : shown;

  // A bigger look at a file card when the pointer rests on it (owner): 450 ms the first time, 150 ms to the next card
  // while one is showing. Not for sounds, nor while dragging, renaming or with a menu open.
  const [preview, setPreview] = useState<{ entry: LibraryEntry; rect: DOMRect; leaving: boolean } | null>(null);
  const hoverTimer = useRef(0);
  const hoverPath = useRef<string | null>(null);
  const hidePreview = () => {
    window.clearTimeout(hoverTimer.current);
    hoverPath.current = null;
    setPreview((p) => (p && !p.leaving ? { ...p, leaving: true } : p));
    hoverTimer.current = window.setTimeout(() => setPreview(null), 120);
  };
  const busy = Boolean(cardDrag || tabDrag || menu || renamingPath || renamingFolderId || renamingTabId);
  useEffect(() => {
    if (!preview) return;
    const hide = () => hidePreview();
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [preview !== null]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const hoverCard = (e: ReactPointerEvent<HTMLUListElement>) => {
    if (e.pointerType !== "mouse" || e.buttons || busy) return hidePreview();
    const ul = gridRef.current;
    const li = (e.target as HTMLElement).closest(".pcard");
    const idx = li && ul && li.parentElement === ul ? Array.prototype.indexOf.call(ul.children, li) : -1;
    const entry = idx >= levelFolders.length ? levelFiles[idx - levelFolders.length] : undefined;
    if (!entry || entry.kind === "audio") return hoverPath.current && hidePreview();
    if (hoverPath.current === entry.path) return;
    hoverPath.current = entry.path;
    window.clearTimeout(hoverTimer.current);
    const rect = (li as HTMLElement).getBoundingClientRect();
    hoverTimer.current = window.setTimeout(() => setPreview({ entry, rect, leaving: false }), preview && !preview.leaving ? 150 : 450);
  };
  /** A picture file as a folder's cover: its small thumbnail is kept, so the cover stays if the file moves. */
  const setCoverFrom = async (folder: Folder, path: string, thumbnail?: string) => {
    setCoverError(null);
    // A GIF stays a GIF (it moves on the card), so the cover is its file.
    if (/\.gif$/i.test(path)) return updateOrganize((o) => setFolderCover(o, folder.id, path));
    const cover = thumbnail ?? (await fileThumbnail(path, true));
    if (!cover) return setCoverError("Couldn't read that picture.");
    updateOrganize((o) => setFolderCover(o, folder.id, cover));
  };
  const coverFromPc = async (folder: Folder) => {
    try {
      const path = await pickPicture();
      if (path) await setCoverFrom(folder, path);
    } catch (err) {
      setCoverError(errorText(err));
    }
  };

  const createFolder = () => {
    const id = newCollectionId();
    const parent = foldersOn ? here : null;
    if (!foldersOn) {
      if (currentTab === "saved") setActiveTab("all");
      setSearch("");
    }
    const where = currentTab === "saved" ? null : scope;
    updateOrganize((o) => {
      const siblings = o.folders.filter((f) => f.parent === parent && (f.collection ?? null) === where).map((f) => f.name);
      return addFolder(o, freeName("New folder", siblings), parent, id, where);
    });
    setRenamingFolderId(id);
  };

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
        tag={entry.animated ? "GIF" : entry.sfx ? "Sound FX" : KIND_LABEL[entry.kind]}
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
    if (menu.kind === "folder") {
      const { folder } = menu;
      return {
        label: folder.name,
        items: [
          { label: "Open", icon: "folder", onClick: () => setOpenFolder(folder.id) },
          { label: "Rename", icon: "pencil", onClick: () => setRenamingFolderId(folder.id) },
          "sep",
          { label: "Cover from Media library", icon: "image", onClick: () => setCoverFor(folder) },
          ...(inDesktopApp ? [{ label: "Cover from this PC", icon: "upload" as const, onClick: () => void coverFromPc(folder) }] : []),
          ...(folder.cover ? [{ label: "Remove cover", icon: "x" as const, onClick: () => updateOrganize((o) => setFolderCover(o, folder.id, null)) }] : []),
          "sep",
          { label: "Delete folder", icon: "trash", danger: true, onClick: () => void confirmDeleteFolder(folder) },
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
                  updateOrganize((o) => toggleInCollection(addCollection(o, freeName("New collection", o.collections.map((c) => c.name)), id), id, entry.path));
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
      {preview && <HoverPreview entry={preview.entry} anchor={preview.rect} name={titleOf(organize, preview.entry.path, preview.entry.name)} leaving={preview.leaving} />}
      {/* On the body: in the page, a glass blur or the page's fade-in moves where "fixed" is measured from. */}
      {cardDrag?.active &&
        createPortal(
          <div className="media-library__drag-ghost" style={{ left: cardDrag.x + 12, top: cardDrag.y + 12 }} aria-hidden="true">
            {cardDrag.name}
          </div>,
          document.body,
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
                      className={tabNameClash ? "media-library__tab-rename is-invalid" : "media-library__tab-rename"}
                      defaultValue={col.name}
                      aria-invalid={Boolean(tabNameClash)}
                      onChange={(e) => setTabNameClash(collectionNameTaken(organize, e.currentTarget.value, col.id) ? e.currentTarget.value.trim() : null)}
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
                        setTabNameClash(null);
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
            <button type="button" className="btn btn--secondary" onClick={createFolder}>
              <Icon name="folder" size={14} />
              New folder
            </button>
          </div>
        </div>

        {tabNameClash && <p className="media-library__note" role="alert">There's already a collection called “{tabNameClash}”.</p>}
        {coverError && <p className="media-library__note" role="alert">{coverError}</p>}
        {coverFor && (
          <CoverPicker
            pictures={entries.filter((e) => e.kind === "image")}
            name={(e) => titleOf(organize, e.path, e.name)}
            onPick={(e) => {
              const folder = coverFor;
              setCoverFor(null);
              void setCoverFrom(folder, e.path, e.thumbnail);
            }}
            onClose={() => setCoverFor(null)}
          />
        )}

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

        {currentTab === "sfx" && (
          <div className="media-library__gif-actions" data-sound-fx>
            {onDownloadSound && <GifLinkBox onDownload={onDownloadSound} label="Paste a sound link" />}
            {onImportSounds && (
              <button type="button" className="btn btn--secondary" onClick={onImportSounds}>
                <Icon name="upload" size={14} />
                Import sounds
              </button>
            )}
          </div>
        )}

        {foldersOn && here && (
          <nav className="media-library__path" aria-label="Folder">
            {[null, ...folderPath(organize, here).map((f) => f.id)].map((id, i, all) => {
              const name = id ? organize.folders.find((f) => f.id === id)?.name : (activeCollection?.name ?? "Media library");
              const target = cardDrag?.active && cardDrag.hoverFolder !== undefined && cardDrag.hoverFolder === id;
              return (
                <span key={id ?? "top"} className="media-library__crumb">
                  {i > 0 && <Icon name="chevronRight" size={12} />}
                  <button
                    type="button"
                    data-drop-folder={id ?? ""}
                    className={target ? "is-drop-target" : undefined}
                    aria-current={i === all.length - 1 ? "location" : undefined}
                    onClick={() => setOpenFolder(id)}
                  >
                    {name}
                  </button>
                </span>
              );
            })}
          </nav>
        )}

        {currentTab === "gif" && !entries.some((e) => e.animated) ? (
          <p className="pc-muted">No GIFs yet. Import a GIF and it shows up here and in the editor's GIFs tab.</p>
        ) : currentTab === "sfx" && !entries.some((e) => e.sfx) ? (
          <p className="pc-muted">No sounds yet. Import meme sounds and effects, paste a link to a sound file, or drag them in from File Explorer: they show up here and in the editor's Sound FX tab.</p>
        ) : entries.length === 0 ? (
          <p className="pc-muted">Files you import into a project show up here, so you can find them again.</p>
        ) : activeCollection && !words && matching.length === 0 ? (
          <p className="pc-muted">This collection is empty. Drag files onto its tab or right-click a file to add it.</p>
        ) : levelFiles.length + levelFolders.length === 0 ? (
          <p className="pc-muted">
            {here
              ? "This folder is empty. Drag files onto a folder card, or onto a name in the path above, to move them."
              : hiddenShown.length
                ? "Everything here is hidden."
                : "Nothing matches."}
          </p>
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
            onPointerMove={hoverCard}
            onPointerLeave={hidePreview}
            onPointerDown={(e) => {
              hidePreview();
              if (e.button !== 0) return;
              if ((e.target as HTMLElement).closest("input, .pcard__actions")) return;
              const ul = gridRef.current;
              const li = (e.target as HTMLElement).closest(".pcard");
              if (!ul || !li || li.parentElement !== ul) return;
              const idx = Array.prototype.indexOf.call(ul.children, li);
              const folder = levelFolders[idx];
              if (folder) {
                if (renamingFolderId === folder.id) return;
                const start: CardDragState = { path: "", name: folder.name, folderId: folder.id, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false, hoverCollectionId: null, scope };
                cardDragRef.current = start;
                setCardDrag(start);
                return;
              }
              const entry = levelFiles[idx - levelFolders.length];
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
                scope,
              };
              cardDragRef.current = initial;
              setCardDrag(initial);
            }}
          >
            {levelFolders.map((folder) => {
              const n = inside.get(folder.id) ?? 0;
              const target = cardDrag?.active && cardDrag.hoverFolder === folder.id;
              return (
                <PictureCard
                  key={`folder:${folder.id}`}
                  thumb={
                    <span className={target ? "media-library__folder is-drop-target" : "media-library__folder"}>
                      {folder.cover?.startsWith("data:") ? (
                        <img className="media-library__folder-cover" src={folder.cover} alt="" draggable={false} />
                      ) : folder.cover ? (
                        <GifImage className="media-library__folder-cover" path={folder.cover} />
                      ) : (
                        <Icon name="folder" size={36} />
                      )}
                    </span>
                  }
                  tag="Folder"
                  name={folder.name}
                  meta={n === 1 ? "1 file" : `${n} files`}
                  onOpen={() => setOpenFolder(folder.id)}
                  onMenu={(e) => openMenuAt(e, (x, y) => ({ kind: "folder", x, y, folder }))}
                  renaming={renamingFolderId === folder.id}
                  onRename={(next) => {
                    setRenamingFolderId(null);
                    if (next !== null) updateOrganize((o) => renameFolder(o, folder.id, next));
                  }}
                />
              );
            })}
            {levelFiles.map((entry) => {
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

/** Right-click a folder > Cover from Media library: the library's pictures in a window; a click picks one. */
function CoverPicker({ pictures, name, onPick, onClose }: { pictures: LibraryEntry[]; name: (e: LibraryEntry) => string; onPick: (e: LibraryEntry) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm media-library__cover-pick"
      aria-labelledby="cover-pick-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="confirm__box">
        <h2 id="cover-pick-title">Choose a cover</h2>
        {pictures.length === 0 ? (
          <p className="confirm__message">There are no pictures in your Media library yet.</p>
        ) : (
          <ul className="media-library__cover-grid">
            {pictures.map((e) => (
              <li key={e.path}>
                <button type="button" onClick={() => onPick(e)} title={name(e)}>
                  <FileThumb path={e.path} src={e.thumbnail} image icon="image" />
                  <span className="truncate">{name(e)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="confirm__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
