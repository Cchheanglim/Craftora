import { describe, expect, test } from "bun:test";
import { filterCommands, type Command } from "../src/components/CommandBox";

const cmd = (id: string, label: string, group = "Picture", detail?: string): Command => ({ id, label, detail, group, icon: "sparkle", run: () => {} });

const COMMANDS = [
  cmd("text", "Add text", "Add"),
  cmd("cut", "Remove background", "Big Buck Bunny", "keeps the subject, clears the rest"),
  cmd("colour", "Remove a colour", "Big Buck Bunny", "green or blue screen"),
  cmd("delete", "Delete layer", "Big Buck Bunny"),
  cmd("story", "Make it a Story", "Picture", "1080 × 1920"),
];

describe("filterCommands", () => {
  test("no query: the first ones, as given", () => {
    expect(filterCommands(COMMANDS, "", 3).map((c) => c.id)).toEqual(["text", "cut", "colour"]);
  });

  test("label starting with the query comes first", () => {
    expect(filterCommands(COMMANDS, "remove").map((c) => c.id)).toEqual(["cut", "colour"]);
    expect(filterCommands(COMMANDS, "REMOVE back").map((c) => c.id)).toEqual(["cut"]);
  });

  test("every word must be found, in the label, detail or group", () => {
    expect(filterCommands(COMMANDS, "green screen").map((c) => c.id)).toEqual(["colour"]);
    expect(filterCommands(COMMANDS, "bunny layer").map((c) => c.id)).toEqual(["delete"]);
    expect(filterCommands(COMMANDS, "1920").map((c) => c.id)).toEqual(["story"]);
    expect(filterCommands(COMMANDS, "rocket")).toEqual([]);
  });

  test("a label containing the query beats a detail match", () => {
    const list = [cmd("a", "Turn 90°", "Picture", "make it a story"), cmd("b", "Make it a Story")];
    expect(filterCommands(list, "story").map((c) => c.id)).toEqual(["b", "a"]);
  });

  test("at most `limit`", () => {
    expect(filterCommands(COMMANDS, "e", 2)).toHaveLength(2);
  });
});
