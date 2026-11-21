import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
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
  folderFits,
  SAVED_SCOPE,
  type FolderTab,
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
import { SoundWave } from "./SoundWave";
import { useSoundPreview } from "../lib/soundPreview";
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

type Filter = "all" | "video" | "image" | "audio" | "gif" | "sfx" | "saved" | "folders";

/** What an empty tab says (no search typed). */
const EMPTY_NOTES: Partial<Record<Filter, string>> = {
  all: "Nothing here yet. Files you import into a project show up here.",
  video: "No videos yet. Videos you import into a project show up here.",
  image: "No pictures yet. Pictures you import into a project show up here.",
  audio: "No audio yet. Music and sounds you import into a project show up here.",
  saved: "Nothing saved yet. Click the star on a file (or right-click it and pick Save it) to keep it here.",
};

const COLLECTION_PREFIX = "c:";
const BUILTIN_TABS: Filter[] = ["all", "video", "image", "audio", "gif", "sfx", "saved", "folders"];
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
  folders: (
    <>
      <Icon name="folder" size={14} />
      Folders
    </>
  ),
};

/** A kind tab's folder: its card line ("Audio folder") and what it takes, for the note when something else is dropped. */
const FOLDER_TABS: Record<FolderTab, { name: string; takes: string }> = {
  video: { name: "Video", takes: "videos" },
  image: { name: "Picture", takes: "pictures" },
  audio: { name: "Audio", takes: "sounds" },
  gif: { name: "GIF", takes: "GIFs" },
  sfx: { name: "Sound FX", takes: "Sound FX sounds" },
};
const isFolderTab = (tab: string): tab is FolderTab => tab in FOLDER_TABS;

const KIND_LABEL: Record<LibraryEntry["kind"], string> = {
  video: "Video",
  image: "Picture",
  audio: "Audio",
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** A folder's key among the selected cards (files use their path). */
const folderKey = (id: string) => `folder:${id}`;
const folderOf = (key: string) => (key.startsWith("folder:") ? key.slice(7) : null);

/** Selected cards (`keys`) into folder `to` (null = the top level of `scope`'s folders). */
function moveKeys(o: Organize, keys: string[], to: string | null, scope: string | null): Organize {
  return keys.reduce((n, key) => {
    const folder = folderOf(key);
    return folder ? moveFolder(n, folder, to) : moveToFolder(n, key, to, scope);
  }, o);
}

/** The files among `keys` into collection `id` (folders aren't put in collections). */
function addKeysTo(o: Organize, keys: string[], id: string): Organize {
  return keys.reduce((n, key) => {
    const col = n.collections.find((c) => c.id === id);
    return folderOf(key) || !col || col.paths.includes(key) ? n : toggleInCollection(n, id, key);
  }, o);
}
const DRAG_THRESHOLD = 6;

const newCollectionId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type MenuState =
  | { kind: "tab"; x: number; y: number; collection: Collection }
  | { kind: "card"; x: number; y: number; entry: LibraryEntry; hidden: boolean }
  | { kind: "pick-collection"; x: number; y: number; entry: LibraryEntry }
  | { kind: "folder"; x: number; y: number; folder: Folder }
  | { kind: "selection"; x: number; y: number };

type TabDragState = {
  tabId: string;
  startX: number;
  startY: number;
  active: boolean;
  /** Where in the tab it was picked up, so it stays under the pointer at that spot. */
  grabX: number;
  grabY: number;
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
  /** Every selected card's key when the dragged card is one of several selected: they all move. */
  group?: string[];
  /** The folder under the pointer (a folder card or a part of the path line); null = the top level; absent = none. */
  hoverFolder?: string | null;
  /** Why the folder under the pointer won't take what's dragged (it doesn't light up; the note shows on drop). */
  refused?: string | null;
};

/** Where a dragged tab goes among `others` (in order) for its centre (`cx`, `cy`, in the tab bar): the nearest row,
 * before the first tab whose centre is to the right. Uses the tabs' laid-out places, not where they're animating. */
function dropIndex(others: string[], els: Map<string, HTMLElement>, cx: number, cy: number): number {
  const placed = others.flatMap((id, i) => {
    const el = els.get(id);
    return el ? [{ i, x: el.offsetLeft + el.offsetWidth / 2, top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight }] : [];
  });
  if (placed.length === 0) return 0;
  const away = (t: (typeof placed)[number]) => (cy < t.top ? t.top - cy : cy > t.bottom ? cy - t.bottom : 0);
  const nearest = Math.min(...placed.map(away));
  const row = placed.filter((t) => away(t) <= nearest + 2);
  const before = row.find((t) => cx < t.x);
  return before ? before.i : row[row.length - 1].i + 1;
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
  /** New folder's pop-up is open, with this name to start from. */
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  /** New Collection's pop-up is open, with this name to start from. */
  const [newCollectionName, setNewCollectionName] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [dropNote, setDropNote] = useState<string | null>(null);
  useEffect(() => {
    if (!dropNote) return;
    const timer = window.setTimeout(() => setDropNote(null), 4000);
    return () => window.clearTimeout(timer);
  }, [dropNote]);
  const sound = useSoundPreview();
  /** Selected cards, like File Explorer: file paths, and folders as `folder:<id>` (`folderKey`). */
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  /** Select mode (the Select button, for picking with the mouse only): every click ticks or unticks a card. */
  const [selectMode, setSelectMode] = useState(false);
  /** Where Shift+click picks from: the last card clicked. */
  const anchorRef = useRef<string | null>(null);
  /** The box dragged over empty space to select cards (window coordinates), while it's being dragged. */
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
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
  /** The tabs' order while one is dragged: they make room as it moves; saved on drop. */
  const [tabPreview, setTabPreview] = useState<string[] | null>(null);
  const shownTabs = tabPreview ?? tabs;
  const shownTabsRef = useRef(shownTabs);
  shownTabsRef.current = shownTabs;
  const tabPointRef = useRef({ x: 0, y: 0 });
  /** Every tab's place on screen just before the order changes, so each one slides from there (FLIP). */
  const tabsFromRef = useRef<Map<string, DOMRect> | null>(null);
  const rememberTabPlaces = () => {
    const from = new Map<string, DOMRect>();
    tabElsRef.current.forEach((el, id) => from.set(id, el.getBoundingClientRect()));
    tabsFromRef.current = from;
  };
  /** The lifted tab under the pointer, kept inside the tab bar. */
  const placeLiftedTab = () => {
    const cur = tabDragRef.current;
    const el = cur?.active ? tabElsRef.current.get(cur.tabId) : undefined;
    const bar = tabBarRef.current;
    if (!cur || !el || !bar) return null;
    const b = bar.getBoundingClientRect();
    const left = Math.max(0, Math.min(b.width - el.offsetWidth, tabPointRef.current.x - cur.grabX - b.left));
    const top = Math.max(0, Math.min(b.height - el.offsetHeight, tabPointRef.current.y - cur.grabY - b.top));
    el.style.transform = `translate(${left - el.offsetLeft}px, ${top - el.offsetTop}px)`;
    return { left, top, el };
  };
  useLayoutEffect(() => {
    const from = tabsFromRef.current;
    if (!from) return;
    tabsFromRef.current = null;
    const lifted = tabDragRef.current?.active ? tabDragRef.current.tabId : null;
    tabElsRef.current.forEach((el, id) => {
      const was = from.get(id);
      if (id === lifted || !was) return;
      el.style.transition = "none";
      el.style.transform = "";
      const now = el.getBoundingClientRect();
      if (Math.abs(was.left - now.left) < 0.5 && Math.abs(was.top - now.top) < 0.5) return;
      el.style.transform = `translate(${was.left - now.left}px, ${was.top - now.top}px)`;
      void el.offsetWidth;
      el.style.transition = "transform var(--dur) var(--ease-out)";
      el.style.transform = "";
    });
    placeLiftedTab();
  });
  useEffect(() => {
    if (!isTabDragging) return;
    const onMove = (e: PointerEvent) => {
      const cur = tabDragRef.current;
      if (!cur) return;
      tabPointRef.current = { x: e.clientX, y: e.clientY };
      if (!cur.active) {
        if (Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY) < DRAG_THRESHOLD) return;
        window.getSelection()?.removeAllRanges();
        const lifting: TabDragState = { ...cur, active: true };
        tabDragRef.current = lifting;
        setTabDrag(lifting);
        const el = tabElsRef.current.get(cur.tabId);
        if (el) el.style.transition = "none";
      }
      const placed = placeLiftedTab();
      if (!placed) return;
      const order = shownTabsRef.current;
      const others = order.filter((id) => id !== cur.tabId);
      const at = dropIndex(others, tabElsRef.current, placed.left + placed.el.offsetWidth / 2, placed.top + placed.el.offsetHeight / 2);
      const next = [...others.slice(0, at), cur.tabId, ...others.slice(at)];
      if (next.some((id, i) => id !== order[i])) {
        rememberTabPlaces();
        setTabPreview(next);
      }
    };
    const finish = (commit: boolean) => {
      const cur = tabDragRef.current;
      tabDragRef.current = null;
      if (!cur?.active) {
        setTabDrag(null);
        return;
      }
      suppressTabClickRef.current = true;
      window.setTimeout(() => {
        suppressTabClickRef.current = false;
      }, 0);
      // It glides from under the pointer into its place (or back to where it was, on Esc).
      rememberTabPlaces();
      const order = shownTabsRef.current;
      setTabDrag(null);
      setTabPreview(null);
      const toIndex = order.indexOf(cur.tabId);
      if (commit && toIndex !== tabsRef.current.indexOf(cur.tabId)) updateOrganize((o) => moveTab(o, cur.tabId, toIndex, BUILTIN_TABS));
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
        // Like File Explorer: dragging a card that isn't selected selects just it.
        if (!cur.group) {
          const key = cur.folderId ? folderKey(cur.folderId) : cur.path;
          setSelected(new Set([key]));
          anchorRef.current = key;
        }
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
      if (hoverFolder && (hoverFolder === cur.folderId || cur.group?.includes(folderKey(hoverFolder)))) hoverFolder = undefined;
      const refused = hoverFolder ? refusalRef.current(cur.group ?? [cur.folderId ? folderKey(cur.folderId) : cur.path], hoverFolder) : null;
      if (refused) hoverFolder = undefined;
      const next: CardDragState = { ...cur, active: true, x: e.clientX, y: e.clientY, hoverCollectionId, hoverFolder, refused };
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
      const keys = cur.group ?? [cur.folderId ? folderKey(cur.folderId) : cur.path];
      if (commit && cur.refused) {
        setDropNote(cur.refused);
      } else if (commit && cur.hoverFolder !== undefined) {
        const to = cur.hoverFolder;
        updateOrganize((o) => moveKeys(o, keys, to, cur.scope));
      } else if (commit && cur.hoverCollectionId) {
        const colId = cur.hoverCollectionId;
        updateOrganize((o) => addKeysTo(o, keys, colId));
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

  /** How many selected cards a tab holds (its number next to its name). */
  const tickedIn = (tabId: string) =>
    tabId === "folders" ? tickedFolders.length + ticked.filter((e) => organize.placed[e.path]).length : ticked.filter((e) => inTab(e, tabId)).length;
  const clearSelection = () => {
    setSelected(new Set());
    anchorRef.current = null;
  };
  /** Ticks or unticks one card (its tick box, Ctrl+click, or any click in Select mode). */
  const tickCard = (key: string) => {
    anchorRef.current = key;
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  /** A click on a card, like File Explorer: just it; Ctrl (or Select mode) adds or drops it; Shift picks a run. */
  const pickCard = (key: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const add = selectMode || e.ctrlKey || e.metaKey;
    const from = anchorRef.current ? levelKeys.indexOf(anchorRef.current) : -1;
    if (e.shiftKey && from >= 0) {
      const to = levelKeys.indexOf(key);
      const run = levelKeys.slice(Math.min(from, to), Math.max(from, to) + 1);
      setSelected((s) => new Set(add ? [...s, ...run] : run));
      return;
    }
    if (add) return tickCard(key);
    anchorRef.current = key;
    setSelected(new Set([key]));
  };
  /** Right-click on a card: one that isn't selected becomes the only one; then the menu for all selected. */
  const cardMenu = (key: string, e: ReactMouseEvent, single: (x: number, y: number) => MenuState) => {
    if (!selected.has(key) || selected.size === 1) {
      setSelected(new Set([key]));
      anchorRef.current = key;
      return openMenuAt(e, single);
    }
    openMenuAt(e, (x, y) => ({ kind: "selection", x, y }));
  };
  const removeSelected = async () => {
    const [files, folders] = [ticked, tickedFolders];
    if (files.length + folders.length === 0) return;
    const fileWords = `${files.length} file${files.length === 1 ? "" : "s"}`;
    const folderWords = `${folders.length} folder${folders.length === 1 ? "" : "s"}`;
    const ok = await ask({
      title: files.length && folders.length ? `Remove ${fileWords} and delete ${folderWords}?` : files.length ? `Remove ${fileWords} from the list?` : `Delete ${folderWords}?`,
      message: [
        files.length ? "The files leave the Media library (and Saved, if starred); they stay on your PC and come back if you import them again." : "",
        folders.length ? "What's inside the folders moves up one level." : "",
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: files.length ? "Remove" : "Delete",
      danger: true,
      note: "This never deletes any files from your PC.",
    });
    if (!ok) return;
    updateOrganize((o) => folders.reduce((n, f) => deleteFolder(n, f.id), files.reduce((n, e) => forgetPath(n, e.path), o)));
    for (const e of files) onForget(e.path);
    clearSelection();
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

  /** From New Collection's pop-up: made, then opened. */
  const createCollection = (name: string) => {
    setNewCollectionName(null);
    const id = newCollectionId();
    updateOrganize((o) => addCollection(o, name, id));
    setOpenFolder(null);
    setSearch("");
    setActiveTab(COLLECTION_PREFIX + id);
  };

  const words = search.trim().toLowerCase();
  const hidden = useHidden("media");
  const collectionPaths = activeCollection ? new Set(activeCollection.paths) : null;
  /** Whether a file belongs on tab `tabId` (a kind, Saved, or a collection's `c:` tab). */
  const inTab = (e: LibraryEntry, tabId: string): boolean => {
    if (tabId.startsWith(COLLECTION_PREFIX)) return Boolean(collectionsById.get(tabId.slice(COLLECTION_PREFIX.length))?.paths.includes(e.path));
    switch (tabId as Filter) {
      case "all":
      case "folders":
        return true;
      case "saved":
        return Boolean(e.saved);
      case "gif":
        return Boolean(e.animated);
      case "sfx":
        return Boolean(e.sfx);
      case "image":
        return e.kind === "image" && !e.animated;
      case "audio":
        return e.kind === "audio" && !e.sfx;
      default:
        return e.kind === tabId;
    }
  };
  const matching = entries.filter((e) => {
    if (!(collectionPaths ? collectionPaths.has(e.path) : inTab(e, currentTab))) return false;
    if (!words) return true;
    const shownName = titleOf(organize, e.path, e.name).toLowerCase();
    return shownName.includes(words) || e.name.toLowerCase().includes(words);
  });
  const shown = matching.filter((e) => !hidden.isHidden(e.path));
  const hiddenShown = matching.filter((e) => hidden.isHidden(e.path));

  // Folders show on every tab: the library's own on All, Folders and the kind tabs, Saved's and a collection's their
  // own. A search is a flat list of every match.
  const foldersOn = !words;
  const scope = activeCollection?.id ?? (currentTab === "saved" ? SAVED_SCOPE : null);
  const kindTab = isFolderTab(currentTab) ? currentTab : undefined;
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
  // A kind tab shows its own folders, and the others (made on All) when they hold its files.
  const levelFolders = foldersOn
    ? scopeFolders.filter((f) => f.parent === here && (currentTab === "all" || currentTab === "folders" || scope || f.tab === kindTab || (!f.tab && matchingInside.has(f.id))))
    : [];
  const entryAt = new Map(entries.map((e) => [e.path, e]));
  /** Why folder `to` won't take `keys`, or null when it will: a kind tab's folder takes only that tab's files and folders. */
  const refusal = (keys: string[], to: string | null): string | null => {
    const tab = to ? organize.folders.find((f) => f.id === to)?.tab : undefined;
    if (!tab) return null;
    const fits = keys.every((key) => {
      const folder = folderOf(key);
      if (folder) return folderFits(organize, folder, to);
      const entry = entryAt.get(key);
      return !entry || inTab(entry, tab);
    });
    return fits ? null : `${FOLDER_TABS[tab].name} folders only take ${FOLDER_TABS[tab].takes}.`;
  };
  const refusalRef = useRef(refusal);
  refusalRef.current = refusal;
  const levelFoldersRef = useRef(levelFolders);
  levelFoldersRef.current = levelFolders;
  // Folders tab: only folders at the top; inside one, its files as usual.
  const levelFiles = !foldersOn ? shown : currentTab === "folders" && !here ? [] : shown.filter((e) => (placed[e.path] ?? null) === here);

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
  const busy = Boolean(cardDrag || tabDrag || menu || renamingPath || renamingFolderId || renamingTabId || box);
  // Selected cards on every tab (switching tabs keeps them), not hidden files.
  const ticked = entries.filter((e) => selected.has(e.path) && !hidden.isHidden(e.path));
  const tickedFolders = organize.folders.filter((f) => selected.has(folderKey(f.id)));
  const selectedCount = ticked.length + tickedFolders.length;
  /** The cards in view, in grid order (folders first): Shift+click runs, Ctrl+A and the drag box use it. */
  const levelKeys = [...levelFolders.map((f) => folderKey(f.id)), ...levelFiles.map((e) => e.path)];
  const levelKeysRef = useRef(levelKeys);
  levelKeysRef.current = levelKeys;
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
    const cover = await coverOf(path, thumbnail);
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

  // Made where you are: on this tab, inside the open folder if there is one.
  const openNewFolder = () => setNewFolderName(freeName("New folder", scopeFolders.filter((f) => f.parent === here).map((f) => f.name)));
  const createFolder = (name: string, cover: string | null) => {
    setNewFolderName(null);
    const id = newCollectionId();
    updateOrganize((o) => {
      const made = addFolder(o, name, here, id, scope, kindTab);
      return cover ? setFolderCover(made, id, cover) : made;
    });
    setSearch("");
    setSelected(new Set([folderKey(id)]));
  };

  /** Star or un-star; un-starred, it leaves Saved's folders too (starred again, it's back loose at the top). */
  const save = (path: string, on: boolean) => {
    onSave(path, on);
    if (!on) updateOrganize((o) => moveToFolder(o, path, null, SAVED_SCOPE));
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

  /** The selected cards to drag together when `key` is one of several selected; undefined drags just it. */
  const groupFor = (key: string) => (selected.has(key) && selected.size > 1 ? [...selected] : undefined);

  // Drag a box over the empty space to select the cards it touches (Ctrl keeps what's selected); a click there clears.
  const startBox = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, input, a, label, .pcard, .pc-bar, .pc-head, dialog, details, [role=menu], .media-library__path, .media-library__gif-actions")) return;
    // Not on the page's own scrollbar.
    if (t === e.currentTarget && e.nativeEvent.offsetX >= e.currentTarget.clientWidth) return;
    const keep = e.ctrlKey || e.metaKey || selectMode ? new Set(selected) : new Set<string>();
    const [x0, y0] = [e.clientX, e.clientY];
    let moved = false;
    const move = (m: PointerEvent) => {
      if (!moved && Math.hypot(m.clientX - x0, m.clientY - y0) < DRAG_THRESHOLD) return;
      moved = true;
      window.getSelection()?.removeAllRanges();
      setBox({ x0, y0, x1: m.clientX, y1: m.clientY });
      const [left, right, top, bottom] = [Math.min(x0, m.clientX), Math.max(x0, m.clientX), Math.min(y0, m.clientY), Math.max(y0, m.clientY)];
      const cards = gridRef.current ? [...gridRef.current.children] : [];
      const hits = levelKeysRef.current.filter((_, i) => {
        const r = cards[i]?.querySelector(".pcard__main")?.getBoundingClientRect();
        return r && r.left < right && r.right > left && r.top < bottom && r.bottom > top;
      });
      setSelected(new Set([...keep, ...hits]));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBox(null);
      if (!moved && !selectMode) clearSelection();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Ctrl+A selects every card in view, Delete removes the selected (asks first), Escape clears, like File Explorer.
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keysRef.current = (e) => {
    if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable=true]") || document.querySelector("dialog[open]") || menu) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set(levelKeys));
    } else if (e.key === "Delete" && selectedCount > 0) {
      e.preventDefault();
      void removeSelected();
    } else if (e.key === "Escape" && (selectedCount > 0 || selectMode)) {
      clearSelection();
      setSelectMode(false);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const renderCard = (entry: LibraryEntry, actions: ReactNode, isHidden = false) => {
    const shownName = titleOf(organize, entry.path, entry.name);
    return (
      <PictureCard
        key={entry.path}
        selected={!isHidden && selected.has(entry.path)}
        onTick={selectMode && !isHidden ? () => tickCard(entry.path) : undefined}
        thumb={
          entry.kind === "audio" ? (
            <SoundWave path={entry.path} />
          ) : (
            <FileThumb
              path={entry.path}
              src={entry.thumbnail}
              image={entry.kind === "image"}
              icon={entry.kind === "image" ? "image" : "film"}
              onMade={(thumbnail) => onThumbnail(entry.path, thumbnail)}
              play={entry.kind === "video"}
            />
          )
        }
        overlay={
          entry.kind === "audio" && inDesktopApp ? (
            <button
              type="button"
              className="btn btn--icon media-library__play"
              aria-label={sound.playing === entry.path ? `Stop ${shownName}` : `Play ${shownName}`}
              onClick={() => void sound.toggle(entry.path)}
            >
              <Icon name={sound.playing === entry.path ? "stop" : "play"} size={13} />
            </button>
          ) : undefined
        }
        tag={entry.animated ? "GIF" : entry.sfx ? "Sound FX" : KIND_LABEL[entry.kind]}
        badge={entry.kind !== "image" && entry.duration > 0 ? formatClock(entry.duration) : undefined}
        name={shownName}
        meta={`Imported ${dateFormat.format(entry.addedAt)}`}
        onOpen={isHidden ? () => void confirmAdd(entry) : (e) => pickCard(entry.path, e)}
        onDoubleOpen={isHidden ? undefined : () => void confirmAdd(entry)}
        onMenu={(e) =>
          isHidden
            ? openMenuAt(e, (x, y) => ({ kind: "card", x, y, entry, hidden: true }))
            : cardMenu(entry.path, e, (x, y) => ({ kind: "card", x, y, entry, hidden: false }))
        }
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
    if (menu.kind === "selection") {
      const files = ticked;
      const moveTo = (to: string | null) => updateOrganize((o) => moveKeys(o, [...selected], to, scope));
      const folderItems: MenuItem[] = scopeFolders
        .filter((f) => !selected.has(folderKey(f.id)) && !refusal([...selected], f.id))
        .map((f) => ({ label: folderPath(organize, f.id).map((x) => x.name).join(" / "), icon: "folder", onClick: () => moveTo(f.id) }));
      const newFolderFor = () => {
        const id = newCollectionId();
        updateOrganize((o) => {
          const top = o.folders.filter((f) => f.parent === null && (f.collection ?? null) === scope).map((f) => f.name);
          return moveKeys(addFolder(o, freeName("New folder", top), null, id, scope, kindTab), [...selected], id, scope);
        });
        setOpenFolder(null);
        setRenamingFolderId(id);
      };
      return {
        label: `${selectedCount} selected`,
        items: [
          ...(files.length ? [{ label: "Add to project", icon: "plus" as const, onClick: () => files.forEach((e) => onAdd(e.path)) }, "sep" as const] : []),
          {
            label: "Move to folder",
            icon: "folder",
            items: [{ label: "Top level", icon: "chevronUp", onClick: () => moveTo(null) }, ...folderItems, "sep", { label: "New folder", icon: "plus", onClick: newFolderFor }],
          },
          ...(files.length
            ? [
                {
                  label: "Add to collection",
                  icon: "grid" as const,
                  items: [
                    ...organize.collections.map((c): MenuItem => ({ label: c.name, icon: files.every((e) => c.paths.includes(e.path)) ? "check" : undefined, onClick: () => updateOrganize((o) => addKeysTo(o, [...selected], c.id)) })),
                    ...(organize.collections.length ? ["sep" as const] : []),
                    {
                      label: "New collection",
                      icon: "plus" as const,
                      onClick: () => {
                        const id = newCollectionId();
                        updateOrganize((o) => addKeysTo(addCollection(o, freeName("New collection", o.collections.map((c) => c.name)), id), [...selected], id));
                        setRenamingTabId(id);
                      },
                    },
                  ],
                },
                "sep" as const,
                { label: "Save", icon: "star" as const, onClick: () => files.forEach((e) => !e.saved && save(e.path, true)) },
                {
                  label: "Hide from list",
                  icon: "eyeOff" as const,
                  onClick: () => {
                    hidden.setHidden(
                      files.map((e) => e.path),
                      true,
                    );
                    clearSelection();
                  },
                },
              ]
            : []),
          "sep",
          { label: files.length ? "Remove" : "Delete", icon: "trash", danger: true, onClick: () => void removeSelected() },
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
      { label: entry.saved ? "Remove from Saved" : "Save it", icon: "star", onClick: () => save(entry.path, !entry.saved) },
      { label: isHidden ? "Unhide" : "Hide from list", icon: isHidden ? "eye" : "eyeOff", onClick: () => hidden.setHidden([entry.path], !isHidden) },
      { label: "Remove from list", icon: "trash", danger: true, onClick: () => void forget(entry) },
    ];
    return { label: shownName, items };
  };

  const activeMenu = menuItems();

  return (
    <section
      className={`pc-page${tabDrag?.active || cardDrag?.active ? " is-dragging-org" : ""}${selectMode ? " is-selecting" : ""}`}
      aria-labelledby="media-library-title"
      onPointerDown={startBox}
    >
      {box &&
        createPortal(
          <div
            className="media-library__box"
            style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }}
            aria-hidden="true"
          />,
          document.body,
        )}
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
              {shownTabs.map((tabId) => {
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
                    className={`pc-tab${isDraggingThis ? " is-lifted" : ""}${isDropTarget ? " is-drop-target" : ""}`}
                    aria-selected={currentTab === tabId}
                    onClick={() => {
                      if (suppressTabClickRef.current) return;
                      setActiveTab(tabId);
                    }}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || renamingTabId) return;
                      const r = e.currentTarget.getBoundingClientRect();
                      const initial: TabDragState = { tabId, startX: e.clientX, startY: e.clientY, active: false, grabX: e.clientX - r.left, grabY: e.clientY - r.top };
                      tabPointRef.current = { x: e.clientX, y: e.clientY };
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
                    {selectedCount > 0 && tickedIn(tabId) > 0 && <span className="media-library__tab-count">{tickedIn(tabId)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="pc-bar__end">
            <PageSearch id="media-search" value={search} onChange={setSearch} placeholder="Search by file name" />
            {selectedCount > 0 && (
              <span className="media-library__count">
                {selectedCount} selected
                <button type="button" className="media-library__clear" aria-label="Clear the selection" onClick={clearSelection}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            )}
            {selectMode && (
              <button type="button" className="btn btn--ghost" onClick={() => setSelected((s) => new Set([...s, ...levelKeys]))}>
                Select all
              </button>
            )}
            {(entries.length > 0 || organize.folders.length > 0) && (
              <button
                type="button"
                className="btn btn--secondary"
                aria-pressed={selectMode}
                onClick={() => {
                  if (selectMode) clearSelection();
                  setSelectMode(!selectMode);
                }}
              >
                {selectMode ? (
                  "Cancel"
                ) : (
                  <>
                    <Icon name="check" size={14} />
                    Select
                  </>
                )}
              </button>
            )}
            <button type="button" className="btn btn--secondary" onClick={() => setNewCollectionName(freeName("New collection", organize.collections.map((c) => c.name)))}>
              <Icon name="plus" size={14} />
              New Collection
            </button>
            <button type="button" className="btn btn--secondary" onClick={openNewFolder}>
              <Icon name="folder" size={14} />
              New folder
            </button>
          </div>
        </div>

        {tabNameClash && <p className="media-library__note" role="alert">There's already a collection called “{tabNameClash}”.</p>}
        {coverError && <p className="media-library__note" role="alert">{coverError}</p>}
        {dropNote && <p className="media-library__note" role="alert">{dropNote}</p>}
        {sound.error && <p className="media-library__note" role="alert">{sound.error}</p>}
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
        {newCollectionName !== null && (
          <NewCollectionDialog
            name={newCollectionName}
            taken={(name) => collectionNameTaken(organize, name)}
            onCreate={createCollection}
            onClose={() => setNewCollectionName(null)}
          />
        )}
        {newFolderName !== null && (
          <NewFolderDialog
            name={newFolderName}
            pictures={entries.filter((e) => e.kind === "image")}
            nameOf={(e) => titleOf(organize, e.path, e.name)}
            onCreate={createFolder}
            onClose={() => setNewFolderName(null)}
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

        {currentTab === "gif" && !entries.some((e) => e.animated) && levelFolders.length === 0 ? (
          <p className="pc-muted">No GIFs yet. Import a GIF and it shows up here and in the editor's GIFs tab.</p>
        ) : currentTab === "sfx" && !entries.some((e) => e.sfx) && levelFolders.length === 0 ? (
          <p className="pc-muted">No sounds yet. Import meme sounds and effects, paste a link to a sound file, or drag them in from File Explorer: they show up here and in the editor's Sound FX tab.</p>
        ) : currentTab === "folders" && !here && !words && levelFolders.length === 0 ? (
          <p className="pc-muted">No folders yet. Make one with New folder, then drag files onto it.</p>
        ) : entries.length === 0 && levelFolders.length === 0 ? (
          <p className="pc-muted">Files you import into a project show up here, so you can find them again.</p>
        ) : activeCollection && !here && !words && matching.length === 0 && levelFolders.length === 0 ? (
          <p className="pc-muted">This collection is empty. Drag files onto its tab or right-click a file to add it.</p>
        ) : levelFiles.length + levelFolders.length === 0 ? (
          <p className="pc-muted">
            {here
              ? "This folder is empty. Drag files onto a folder card, or onto a name in the path above, to move them."
              : hiddenShown.length
                ? "Everything here is hidden."
                : words
                  ? `No files called “${search.trim()}” here. Try another name.`
                  : EMPTY_NOTES[currentTab as Filter] ?? "Nothing here yet."}
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
              if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
              if ((e.target as HTMLElement).closest("input, .pcard__actions, .pcard__overlay")) return;
              const ul = gridRef.current;
              const li = (e.target as HTMLElement).closest(".pcard");
              if (!ul || !li || li.parentElement !== ul) return;
              const idx = Array.prototype.indexOf.call(ul.children, li);
              const folder = levelFolders[idx];
              if (folder) {
                if (renamingFolderId === folder.id) return;
                const group = groupFor(folderKey(folder.id));
                const start: CardDragState = { path: "", name: group ? `${group.length} items` : folder.name, folderId: folder.id, group, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false, hoverCollectionId: null, scope };
                cardDragRef.current = start;
                setCardDrag(start);
                return;
              }
              const entry = levelFiles[idx - levelFolders.length];
              if (!entry) return;
              const group = groupFor(entry.path);
              const initial: CardDragState = {
                path: entry.path,
                name: group ? `${group.length} items` : titleOf(organize, entry.path, entry.name),
                group,
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
                  thumb={<FolderThumb cover={folder.cover} target={target} />}
                  tag={folder.tab && folder.tab !== currentTab ? `${FOLDER_TABS[folder.tab].name} folder` : "Folder"}
                  name={folder.name}
                  meta={n === 1 ? "1 file" : `${n} files`}
                  selected={selected.has(folderKey(folder.id))}
                  onTick={selectMode ? () => tickCard(folderKey(folder.id)) : undefined}
                  onOpen={(e) => pickCard(folderKey(folder.id), e)}
                  onDoubleOpen={() => setOpenFolder(folder.id)}
                  onMenu={(e) => cardMenu(folderKey(folder.id), e, (x, y) => ({ kind: "folder", x, y, folder }))}
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
                    onClick={() => save(entry.path, !entry.saved)}
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

/** A picture file as a folder's cover: a GIF stays its file (it moves on the card); others keep a small thumbnail, so
 * the cover stays if the file moves. `null` when it can't be read. */
async function coverOf(path: string, thumbnail?: string): Promise<string | null> {
  if (/\.gif$/i.test(path)) return path;
  return thumbnail ?? (await fileThumbnail(path, true)) ?? null;
}

/** A folder card's picture: its cover with a small folder badge, else the folder icon. */
function FolderThumb({ cover, target }: { cover?: string; target?: boolean }) {
  return (
    <span className={target ? "media-library__folder is-drop-target" : "media-library__folder"}>
      {cover?.startsWith("data:") ? (
        <img className="media-library__folder-cover" src={cover} alt="" draggable={false} />
      ) : cover ? (
        <GifImage className="media-library__folder-cover" path={cover} />
      ) : (
        <Icon name="folder" size={36} />
      )}
      {cover && (
        <span className="media-library__folder-badge" aria-hidden="true">
          <Icon name="folder" size={14} />
        </span>
      )}
    </span>
  );
}

/** New folder: a pop-up for its name and cover, with the card as it will look; the folder is made on Create. */
function NewFolderDialog({
  name: startName,
  pictures,
  nameOf,
  onCreate,
  onClose,
}: {
  name: string;
  pictures: LibraryEntry[];
  nameOf: (e: LibraryEntry) => string;
  onCreate: (name: string, cover: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(startName);
  const [cover, setCover] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const take = async (path: string, thumbnail?: string) => {
    setError(null);
    try {
      const picked = await coverOf(path, thumbnail);
      if (picked) setCover(picked);
      else setError("Couldn't read that picture.");
    } catch (err) {
      setError(errorText(err));
    }
  };
  const fromPc = async () => {
    try {
      const path = await pickPicture();
      if (path) await take(path);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const trimmed = name.trim();
  return (
    <>
      <dialog
        ref={ref}
        className="confirm media-library__new-folder"
        aria-labelledby="new-folder-title"
        onCancel={(e) => {
          e.preventDefault();
          onClose();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <form
          className="confirm__box"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) onCreate(trimmed, cover);
          }}
        >
          <h2 id="new-folder-title">New folder</h2>
          <div className="media-library__new-folder-body">
            <div className="media-library__new-folder-card">
              <FolderThumb cover={cover ?? undefined} />
            </div>
            <div className="media-library__new-folder-fields">
              <label className="section-label" htmlFor="new-folder-name">
                Name
              </label>
              <input id="new-folder-name" className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
              <span className="section-label">Cover</span>
              <div className="media-library__new-folder-cover">
                <button type="button" className="btn btn--secondary" onClick={() => setPicking(true)}>
                  <Icon name="image" size={14} />
                  Media library
                </button>
                {inDesktopApp && (
                  <button type="button" className="btn btn--secondary" onClick={() => void fromPc()}>
                    <Icon name="upload" size={14} />
                    This PC
                  </button>
                )}
                {cover && (
                  <button type="button" className="btn btn--ghost" onClick={() => setCover(null)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
          {error && (
            <p className="confirm__note" role="alert">
              {error}
            </p>
          )}
          <div className="confirm__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={!trimmed}>
              Create folder
            </button>
          </div>
        </form>
      </dialog>
      {/* Beside the pop-up, not in it: its Esc and outside clicks close only the picker. */}
      {picking && (
        <CoverPicker
          pictures={pictures}
          name={nameOf}
          onPick={(e) => {
            setPicking(false);
            void take(e.path, e.thumbnail);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

/** New Collection: a pop-up for its name (no two collections share one); the collection is made on Create. */
function NewCollectionDialog({ name: startName, taken, onCreate, onClose }: { name: string; taken: (name: string) => boolean; onCreate: (name: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(startName);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const trimmed = name.trim();
  const clash = Boolean(trimmed) && taken(trimmed);
  return (
    <dialog
      ref={ref}
      className="confirm media-library__new-collection"
      aria-labelledby="new-collection-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="confirm__box"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed && !clash) onCreate(trimmed);
        }}
      >
        <h2 id="new-collection-title">New collection</h2>
        <p className="confirm__message">A tab of its own for files you pick. Drag files onto its tab, or right-click a file to add it.</p>
        <div className="media-library__new-folder-fields">
          <label className="section-label" htmlFor="new-collection-name">
            Name
          </label>
          <input
            id="new-collection-name"
            className="field"
            value={name}
            maxLength={60}
            aria-invalid={clash}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
          {clash && (
            <p className="media-library__note" role="alert">
              There's already a collection called “{trimmed}”.
            </p>
          )}
        </div>
        <div className="confirm__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!trimmed || clash}>
            Create collection
          </button>
        </div>
      </form>
    </dialog>
  );
}
