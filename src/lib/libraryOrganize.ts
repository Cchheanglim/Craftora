/**
 * Pure state and operations for organising the Media library: collections (tabs),
 * nested folders, per-file custom display titles, and custom tab ordering.
 */

export interface Collection {
  id: string;
  name: string;
  paths: string[];
}

export interface Folder {
  id: string;
  name: string;
  parent: string | null;
}

export interface Organize {
  collections: { id: string; name: string; paths: string[] }[];
  folders: { id: string; name: string; parent: string | null }[];
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

export function addCollection(o: Organize, name: string, id: string): Organize {
  const trimmed = name.trim();
  if (!trimmed || o.collections.some((c) => c.id === id)) return o;
  return { ...o, collections: [...o.collections, { id, name: trimmed, paths: [] }] };
}

export function renameCollection(o: Organize, id: string, name: string): Organize {
  const trimmed = name.trim();
  if (!trimmed) return o;
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
    tabOrder: o.tabOrder.filter((t) => t !== tabId),
  };
}

export function toggleInCollection(o: Organize, id: string, path: string): Organize {
  return mapCollection(o, id, (c) => ({
    ...c,
    paths: c.paths.includes(path) ? c.paths.filter((p) => p !== path) : [...c.paths, path],
  }));
}

export function removeFromCollection(o: Organize, id: string, path: string): Organize {
  return mapCollection(o, id, (c) =>
    c.paths.includes(path) ? { ...c, paths: c.paths.filter((p) => p !== path) } : c,
  );
}

export function addFolder(o: Organize, name: string, parent: string | null, id: string): Organize {
  const trimmed = name.trim();
  if (!trimmed || o.folders.some((f) => f.id === id)) return o;
  return { ...o, folders: [...o.folders, { id, name: trimmed, parent }] };
}

export function renameFolder(o: Organize, id: string, name: string): Organize {
  const trimmed = name.trim();
  if (!trimmed) return o;
  const target = o.folders.find((f) => f.id === id);
  if (!target || target.name === trimmed) return o;
  return { ...o, folders: o.folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)) };
}

export function deleteFolder(o: Organize, id: string): Organize {
  const target = o.folders.find((f) => f.id === id);
  if (!target) return o;
  const up = target.parent;
  const folders = o.folders
    .filter((f) => f.id !== id)
    .map((f) => (f.parent === id ? { ...f, parent: up } : f));
  const placed: Record<string, string> = {};
  for (const [path, folderId] of Object.entries(o.placed)) {
    if (folderId === id) {
      if (up !== null) placed[path] = up;
    } else {
      placed[path] = folderId;
    }
  }
  return { ...o, folders, placed };
}

export function moveToFolder(o: Organize, path: string, folderId: string | null): Organize {
  if (folderId === null) {
    const placed = omitKey(o.placed, path);
    return placed === o.placed ? o : { ...o, placed };
  }
  if (hasKey(o.placed, path) && o.placed[path] === folderId) return o;
  return { ...o, placed: { ...o.placed, [path]: folderId } };
}

export function moveFolder(o: Organize, id: string, newParent: string | null): Organize {
  const target = o.folders.find((f) => f.id === id);
  if (!target || target.parent === newParent || id === newParent) return o;
  if (newParent !== null && !o.folders.some((f) => f.id === newParent)) return o;

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
  for (const id of natural) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
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
  const inAnyCollection = o.collections.some((c) => c.paths.includes(path));
  const placed = omitKey(o.placed, path);
  const titles = omitKey(o.titles, path);
  if (!inAnyCollection && placed === o.placed && titles === o.titles) return o;
  return {
    ...o,
    collections: inAnyCollection
      ? o.collections.map((c) => (c.paths.includes(path) ? { ...c, paths: c.paths.filter((p) => p !== path) } : c))
      : o.collections,
    placed,
    titles,
  };
}
