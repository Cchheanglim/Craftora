import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TOOLS } from "../src/assistant/tools";
import { PICTURE_EFFECTS } from "../src/project/effects";
import { TRANSITION_KINDS } from "../src/project/model";

const css = readFileSync(new URL("../src/components/FxPanel.css", import.meta.url), "utf8");

test("every picture effect has a unique id, a label, and a picker card entry", () => {
  expect(PICTURE_EFFECTS.length).toBeGreaterThanOrEqual(34);
  const ids = PICTURE_EFFECTS.map((e) => e.id);
  expect(new Set(ids).size).toBe(PICTURE_EFFECTS.length);
  const labels = PICTURE_EFFECTS.map((e) => e.label);
  expect(new Set(labels).size).toBe(PICTURE_EFFECTS.length);

  const effectDescription = JSON.stringify(TOOLS.find((t) => t.name === "update_clip"));
  for (const effect of PICTURE_EFFECTS) {
    expect(effect.id.trim().length).toBeGreaterThan(0);
    expect(effect.label.trim().length).toBeGreaterThan(0);
    expect(css).toContain(`.fx-tile.is-${effect.id}`);
    expect(effectDescription).toContain(effect.id);
  }
});

test("every transition kind has a unique id, a label, and a picker card entry", () => {
  expect(TRANSITION_KINDS.length).toBe(29);
  const ids = TRANSITION_KINDS.map((t) => t.kind);
  expect(new Set(ids).size).toBe(TRANSITION_KINDS.length);
  const labels = TRANSITION_KINDS.map((t) => t.label);
  expect(new Set(labels).size).toBe(TRANSITION_KINDS.length);

  const transitionTool = TOOLS.find((t) => t.name === "set_transition")!;
  const kindProp = (transitionTool.parameters.properties as { kind: { enum: string[]; description: string } }).kind;
  for (const transition of TRANSITION_KINDS) {
    expect(transition.kind.trim().length).toBeGreaterThan(0);
    expect(transition.label.trim().length).toBeGreaterThan(0);
    expect(css).toContain(`.fx-tile.is-${transition.kind}`);
    expect(kindProp.enum).toContain(transition.kind);
    expect(kindProp.description).toContain(transition.kind);
  }
});
