import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_ORGANIZE,
  addCollection,
  addFolder,
  childrenOf,
  deleteCollection,
  deleteFolder,
  folderPath,
  forgetPath,
  moveFolder,
  moveTab,
  moveToFolder,
  orderedTabs,
  removeFromCollection,
  renameCollection,
  renameFolder,
  setTitle,
  titleOf,
  toggleInCollection,
  type Organize,
} from "../src/lib/libraryOrganize.ts";

const BUILT_INS = ["all", "video", "image", "audio", "gif", "saved"];

describe("collections", () => {
  it("adds, trims, renames, toggles, removes, and deletes collections without mutating", () => {
    const start: Organize = structuredClone(EMPTY_ORGANIZE);
    const snap = JSON.stringify(start);

    const o1 = addCollection(start, "  B-Roll  ", "c1");
    assert.notEqual(o1, start);
    assert.equal(JSON.stringify(start), snap);
    assert.deepEqual(o1.collections, [{ id: "c1", name: "B-Roll", paths: [] }]);

    // Empty name or duplicate id is ignored.
    assert.equal(addCollection(o1, "   ", "c2"), o1);
    assert.equal(addCollection(o1, "Dup", "c1"), o1);

    // Rename trims and ignores empty names.
    const o2 = renameCollection(o1, "c1", "  Cutaways ");
    assert.equal(o2.collections[0].name, "Cutaways");
    assert.equal(renameCollection(o2, "c1", "   "), o2);
    assert.equal(renameCollection(o2, "missing", "X"), o2);

    // Toggle adds then removes; same file can live in multiple collections.
    const o3 = addCollection(o2, "Favorites", "c2");
    const o4 = toggleInCollection(toggleInCollection(o3, "c1", "/a.mp4"), "c2", "/a.mp4");
    assert.deepEqual(o4.collections[0].paths, ["/a.mp4"]);
    assert.deepEqual(o4.collections[1].paths, ["/a.mp4"]);

    const o5 = toggleInCollection(o4, "c1", "/a.mp4");
    assert.deepEqual(o5.collections[0].paths, []);
    assert.deepEqual(o5.collections[1].paths, ["/a.mp4"]);

    // removeFromCollection removes only if present.
    assert.equal(removeFromCollection(o5, "c1", "/a.mp4"), o5);
    const o6 = removeFromCollection(o5, "c2", "/a.mp4");
    assert.deepEqual(o6.collections[1].paths, []);

    // deleteCollection drops both the collection and its tabOrder entry.
    const withOrder = moveTab(o6, "c:c1", 0, BUILT_INS);
    assert.equal(withOrder.tabOrder[0], "c:c1");
    const afterDel = deleteCollection(withOrder, "c1");
    assert.deepEqual(
      afterDel.collections.map((c) => c.id),
      ["c2"],
    );
    assert.equal(afterDel.tabOrder.includes("c:c1"), false);
  });
});

describe("folders, placement, and navigation", () => {
  it("adds, renames, resolves paths, and lists children", () => {
    let o = addFolder(EMPTY_ORGANIZE, "  Projects ", null, "f1");
    assert.equal(addFolder(o, "   ", null, "f2"), o);
    assert.equal(addFolder(o, "Dup", null, "f1"), o);

    o = addFolder(o, "Client A", "f1", "f2");
    o = addFolder(o, "Drafts", "f2", "f3");
    o = renameFolder(o, "f2", "  Client Alpha ");
    assert.equal(renameFolder(o, "f2", ""), o);
    assert.equal(o.folders.find((f) => f.id === "f2")?.name, "Client Alpha");

    assert.deepEqual(folderPath(o, null), []);
    assert.deepEqual(folderPath(o, "missing"), []);
    assert.deepEqual(
      folderPath(o, "f3").map((f) => f.name),
      ["Projects", "Client Alpha", "Drafts"],
    );

    o = moveToFolder(o, "/top.mp4", null); // already top level -> no-op
    o = moveToFolder(o, "/in-f1.mp4", "f1");
    o = moveToFolder(o, "/in-f2.mp4", "f2");

    const all = ["/top.mp4", "/in-f1.mp4", "/in-f2.mp4"];
    const rootChildren = childrenOf(o, null, all);
    assert.deepEqual(
      rootChildren.folders.map((f) => f.id),
      ["f1"],
    );
    assert.deepEqual(rootChildren.paths, ["/top.mp4"]);

    const f1Children = childrenOf(o, "f1", all);
    assert.deepEqual(
      f1Children.folders.map((f) => f.id),
      ["f2"],
    );
    assert.deepEqual(f1Children.paths, ["/in-f1.mp4"]);

    // Moving file back to top level removes it from placed.
    const movedUp = moveToFolder(o, "/in-f1.mp4", null);
    assert.equal("/in-f1.mp4" in movedUp.placed, false);
  });

  it("deleting a nested folder moves its files and sub-folders up to its parent", () => {
    let o = addFolder(EMPTY_ORGANIZE, "A", null, "a");
    o = addFolder(o, "B", "a", "b");
    o = addFolder(o, "C", "b", "c");
    o = moveToFolder(o, "/in-b.mp4", "b");
    o = moveToFolder(o, "/in-c.mp4", "c");

    const afterDeleteB = deleteFolder(o, "b");
    assert.equal(afterDeleteB.folders.some((f) => f.id === "b"), false);
    assert.equal(afterDeleteB.folders.find((f) => f.id === "c")?.parent, "a");
    assert.equal(afterDeleteB.placed["/in-b.mp4"], "a");
    assert.equal(afterDeleteB.placed["/in-c.mp4"], "c");

    // Deleting top-level folder A moves its contents to top level (parent null).
    const afterDeleteA = deleteFolder(afterDeleteB, "a");
    assert.equal(afterDeleteA.folders.find((f) => f.id === "c")?.parent, null);
    assert.equal("/in-b.mp4" in afterDeleteA.placed, false);
    assert.equal(afterDeleteA.placed["/in-c.mp4"], "c");
  });

  it("refuses moving a folder into itself or its own sub-folder", () => {
    let o = addFolder(EMPTY_ORGANIZE, "A", null, "a");
    o = addFolder(o, "B", "a", "b");
    o = addFolder(o, "C", "b", "c");
    o = addFolder(o, "Other", null, "d");

    assert.equal(moveFolder(o, "a", "a"), o);
    assert.equal(moveFolder(o, "a", "b"), o);
    assert.equal(moveFolder(o, "a", "c"), o);

    // Valid moves: into sibling branch or back to top level.
    const moved = moveFolder(o, "b", "d");
    assert.equal(moved.folders.find((f) => f.id === "b")?.parent, "d");
    const toRoot = moveFolder(moved, "b", null);
    assert.equal(toRoot.folders.find((f) => f.id === "b")?.parent, null);
  });
});

describe("titles, tab ordering, and forgetting", () => {
  it("sets, reads, and clears custom titles", () => {
    const o1 = setTitle(EMPTY_ORGANIZE, "/clip.mp4", "  Hero Shot  ");
    assert.equal(titleOf(o1, "/clip.mp4", "clip.mp4"), "Hero Shot");
    assert.equal(titleOf(o1, "/other.mp4", "other.mp4"), "other.mp4");

    const o2 = setTitle(o1, "/clip.mp4", "   ");
    assert.equal("/clip.mp4" in o2.titles, false);
    assert.equal(titleOf(o2, "/clip.mp4", "clip.mp4"), "clip.mp4");
  });

  it("orderedTabs appends a new collection after existing tabOrder, and moveTab moves to front and end", () => {
    let o = addCollection(EMPTY_ORGANIZE, "One", "1");
    assert.deepEqual(orderedTabs(o, BUILT_INS), [...BUILT_INS, "c:1"]);

    // Move "c:1" to the front (index 0).
    o = moveTab(o, "c:1", 0, BUILT_INS);
    assert.deepEqual(orderedTabs(o, BUILT_INS), ["c:1", ...BUILT_INS]);

    // Add a new collection: it is not in tabOrder yet, so it lands at the end in natural order.
    o = addCollection(o, "Two", "2");
    assert.deepEqual(orderedTabs(o, BUILT_INS), ["c:1", ...BUILT_INS, "c:2"]);

    // Move "all" to the end (clamped past length).
    o = moveTab(o, "all", 999, BUILT_INS);
    const tabs = orderedTabs(o, BUILT_INS);
    assert.equal(tabs[tabs.length - 1], "all");
    assert.equal(tabs[0], "c:1");
  });

  it("forgetPath removes a file from all collections, placed, and titles", () => {
    let o = addCollection(EMPTY_ORGANIZE, "One", "1");
    o = addCollection(o, "Two", "2");
    o = toggleInCollection(o, "1", "/gone.mp4");
    o = toggleInCollection(o, "2", "/gone.mp4");
    o = toggleInCollection(o, "2", "/keep.mp4");
    o = addFolder(o, "F", null, "f1");
    o = moveToFolder(o, "/gone.mp4", "f1");
    o = moveToFolder(o, "/keep.mp4", "f1");
    o = setTitle(o, "/gone.mp4", "Gone");
    o = setTitle(o, "/keep.mp4", "Keep");

    const cleaned = forgetPath(o, "/gone.mp4");
    assert.deepEqual(cleaned.collections[0].paths, []);
    assert.deepEqual(cleaned.collections[1].paths, ["/keep.mp4"]);
    assert.equal("/gone.mp4" in cleaned.placed, false);
    assert.equal(cleaned.placed["/keep.mp4"], "f1");
    assert.equal("/gone.mp4" in cleaned.titles, false);
    assert.equal(cleaned.titles["/keep.mp4"], "Keep");
  });
});
