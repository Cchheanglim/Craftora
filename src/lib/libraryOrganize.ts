/**
 * Pure state and operations for organising the Media library: collections (tabs),
 * nested folders, per-file custom display titles, and custom tab ordering.
 */

export interface Collection {
  id: string;
  name: string;
  paths: string[];
  /** Files put in this collection's own folders (path -> folder id). */
  placed?: Record<string, string>;
}

export interface Folder {
  id: string;
  name: string;
  parent: string | null;
  /** The collection it was made in; absent = the library's own folders (All and the kind tabs). */
  collection?: string;
  /** The picture on its card instead of the folder icon: a small JPEG data URL, or a GIF file's path (so it moves). */
  cover?: string;
}

export interface Organize {
  collections: Collection[];
  folders: Folder[];
  placed: Record<string, string>;
  titles: Record<string, string>;
  tabOrder: string[];
}

export const EMPTY_ORGANIZE: Organize = {
  collections: [],
  folders: [],
  placed: {},
  titles: {},
  tabOrder: [],
};

const COLLECTION_TAB_PREFIX = "c:";
const hasKey = (obj: Record<string, string>, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

function omitKey(record: Record<string, string>, key: string): Record<string, string> {
  if (!hasKey(record, key)) return record;
  const copy = { ...record };
  delete copy[key];
  return copy;
}

function mapCollection(o: Organize, id: string, fn: (c: Collection) => Collection): Organize {
  const idx = o.collections.findIndex((c) => c.id === id);
  if (idx === -1) return o;
  const next = fn(o.collections[idx]);
  if (next === o.collections[idx]) return o;
  return { ...o, collections: o.collections.map((c, i) => (i === idx ? next : c)) };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** `base`, or `base 2`, `base 3`… whichever none of `taken` is called. */
export function freeName(base: string, taken: string[]): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!taken.some((t) => sameName(t, name))) return name;
  }
}

/** Whether a collection other than `id` already has this name (any case). */
export const collectionNameTaken = (o: Organize, name: string, id?: string) =>
  o.collections.some((c) => c.id !== id && sameName(c.name, name));

/** The files' folder places for the library (`collection` absent) or one collection. */
export const placedIn = (o: Organize, collection?: string | null): Record<string, string> =>
  collection ? (o.collections.find((c) => c.id === collection)?.placed ?? {}) : o.placed;

function withPlaced(o: Organize, collection: string | null | undefined, placed: Record<string, string>): Organize {
  if (placed === placedIn(o, collection)) return o;
  return collection ? mapCollection(o, collection, (c) => ({ ...c, placed })) : { ...o, placed };
}

export function addCollection(o: Organize, name: string, id: string): Organize {
  const trimmed = name.trim();
  if (!trimmed || o.collections.some((c) => c.id === id) || collectionNameTaken(o, trimmed)) return o;
  return { ...o, collections: [...o.collections, { id, name: trimmed, paths: [] }] };
}

export function renameCollection(o: Organize, id: string, name: string): Organize {
  const trimmed = name.trim();
  if (!trimmed || collectionNameTaken(o, trimmed, id)) return o;
  return mapCollection(o, id, (c) => (c.name === trimmed ? c : { ...c, name: trimmed }));
}

export function deleteCollection(o: Organize, id: string): Organize {
  const tabId = COLLECTION_TAB_PREFIX + id;
  const hasCollection = o.collections.some((c) => c.id === id);
  const hasTab = o.tabOrder.includes(tabId);
  if (!hasCollection && !hasTab) return o;
  return {
    ...o,
    collections: o.collections.filter((c) => c.id !== id),
    folders: o.folders.filter((f) => f.collection !== id),
    tabOrder: o.tabOrder.filter((t) => t !== tabId),
  };
}

export function toggleInCollection(o: Organize, id: string, path: string): Organize {
  return mapCollection(o, id, (c) => ({
    ...c,
    paths: c.paths.includes(path) ? c.paths.filter((p) => p !== path) : [...c.paths, path],
    ...(c.placed && { placed: omitKey(c.placed, path) }),
  }));
}

export function removeFromCollection(o: Organize, id: string, path: string): Organize {
  return mapCollection(o, id, (c) =>
    c.paths.includes(path) ? { ...c, paths: c.paths.filter((p) => p !== path), ...(c.placed && { placed: omitKey(c.placed, path) }) } : c,
  );
}

/** `collection`: made inside that collection (a sub-folder always goes where its parent is). */
export function addFolder(o: Organize, name: string, parent: string | null, id: string, collection?: string | null): Organize {
  const trimmed = name.trim();
  if (!trimmed || o.folders.some((f) => f.id === id)) return o;
  const where = parent ? o.folders.find((f) => f.id === parent)?.collection : collection ?? undefined;
  return { ...o, folders: [...o.folders, { id, name: trimmed, parent, ...(where && { collection: where }) }] };
}

export function renameFolder(o: Organize, id: string, name: string): Organize {
  const trimmed = name.trim();
  if (!trimmed) return o;
  const target = o.folders.find((f) => f.id === id);
  if (!target || target.name === trimmed) return o;
  return { ...o, folders: o.folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)) };
}

/** A folder's card picture; null puts the folder icon back. */
export function setFolderCover(o: Organize, id: string, cover: string | null): Organize {
  const target = o.folders.find((f) => f.id === id);
  if (!target || (target.cover ?? null) === cover) return o;
  return { ...o, folders: o.folders.map((f) => (f.id === id ? { ...f, cover: cover ?? undefined } : f)) };
}

export function deleteFolder(o: Organize, id: string): Organize {
  const target = o.folders.find((f) => f.id === id);
  if (!target) return o;
  const up = target.parent;
  const folders = o.folders
    .filter((f) => f.id !== id)
    .map((f) => (f.parent === id ? { ...f, parent: up } : f));
  const placed: Record<string, string> = {};
  for (const [path, folderId] of Object.entries(placedIn(o, target.collection))) {
    if (folderId === id) {
      if (up !== null) placed[path] = up;
    } else {
      placed[path] = folderId;
    }
  }
  return withPlaced({ ...o, folders }, target.collection, placed);
}

/** `collection`: with `folderId` null, which top level (a collection's or the library's); a folder knows its own. */
export function moveToFolder(o: Organize, path: string, folderId: string | null, collection?: string | null): Organize {
  const scope = folderId === null ? collection : o.folders.find((f) => f.id === folderId)?.collection;
  const now = placedIn(o, scope);
  if (folderId === null) return withPlaced(o, scope, omitKey(now, path));
  if (hasKey(now, path) && now[path] === folderId) return o;
  return withPlaced(o, scope, { ...now, [path]: folderId });
}

export function moveFolder(o: Organize, id: string, newParent: string | null): Organize {
  const target = o.folders.find((f) => f.id === id);
  if (!target || target.parent === newParent || id === newParent) return o;
  const parent = newParent === null ? null : o.folders.find((f) => f.id === newParent);
  if (parent === undefined || (parent && parent.collection !== target.collection)) return o;

  // Walk up from newParent to refuse moving a folder into its own descendant subtree.
  let cur: string | null = newParent;
  const seen = new Set<string>();
  while (cur !== null) {
    if (cur === id) return o;
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = o.folders.find((f) => f.id === cur)?.parent ?? null;
  }

  return { ...o, folders: o.folders.map((f) => (f.id === id ? { ...f, parent: newParent } : f)) };
}

export function folderPath(o: Organize, id: string | null): Folder[] {
  if (id === null) return [];
  const byId = new Map(o.folders.map((f) => [f.id, f]));
  const chain: Folder[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur !== null) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const folder = byId.get(cur);
    if (!folder) break;
    chain.push(folder);
    cur = folder.parent;
  }
  return chain.reverse();
}

export function childrenOf(
  o: Organize,
  folderId: string | null,
  allPaths: string[],
): { folders: Folder[]; paths: string[] } {
  const folders = o.folders.filter((f) => f.parent === folderId);
  const paths = allPaths.filter((p) => {
    const placedIn = hasKey(o.placed, p) ? o.placed[p] || null : null;
    return placedIn === folderId;
  });
  return { folders, paths };
}

export function setTitle(o: Organize, path: string, name: string): Organize {
  const trimmed = name.trim();
  if (!trimmed) {
    const titles = omitKey(o.titles, path);
    return titles === o.titles ? o : { ...o, titles };
  }
  if (hasKey(o.titles, path) && o.titles[path] === trimmed) return o;
  return { ...o, titles: { ...o.titles, [path]: trimmed } };
}

export function titleOf(o: Organize, path: string, fileName: string): string {
  return (hasKey(o.titles, path) && o.titles[path].trim()) || fileName;
}

export function orderedTabs(o: Organize, builtIns: string[]): string[] {
  const natural = [...builtIns, ...o.collections.map((c) => COLLECTION_TAB_PREFIX + c.id)];
  const valid = new Set(natural);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const id of o.tabOrder) {
    if (valid.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  // A built-in tab missing from a saved order (one added in an update) goes right after the tab before it; a new
  // collection goes at the end.
  natural.forEach((id, i) => {
    if (seen.has(id)) return;
    seen.add(id);
    const before = !id.startsWith(COLLECTION_TAB_PREFIX) && i > 0 ? result.indexOf(natural[i - 1]) : -1;
    result.splice(before >= 0 ? before + 1 : result.length, 0, id);
  });
  return result;
}

export function moveTab(o: Organize, tabId: string, toIndex: number, builtIns: string[]): Organize {
  const tabs = orderedTabs(o, builtIns);
  const fromIndex = tabs.indexOf(tabId);
  if (fromIndex === -1) return o;
  const clamped = Math.max(0, Math.min(tabs.length - 1, Math.trunc(toIndex)));
  if (fromIndex === clamped) return o;
  const next = [...tabs];
  next.splice(fromIndex, 1);
  next.splice(clamped, 0, tabId);
  return { ...o, tabOrder: next };
}

export function forgetPath(o: Organize, path: string): Organize {
  const inAnyCollection = o.collections.some((c) => c.paths.includes(path) || (c.placed && hasKey(c.placed, path)));
  const placed = omitKey(o.placed, path);
  const titles = omitKey(o.titles, path);
  if (!inAnyCollection && placed === o.placed && titles === o.titles) return o;
  return {
    ...o,
    collections: inAnyCollection
      ? o.collections.map((c) => (c.paths.includes(path) || (c.placed && hasKey(c.placed, path)) ? { ...c, paths: c.paths.filter((p) => p !== path), ...(c.placed && { placed: omitKey(c.placed, path) }) } : c))
      : o.collections,
    placed,
    titles,
  };
}
