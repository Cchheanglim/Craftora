import { beforeEach, expect, test } from "bun:test";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
};
const { savedTheme, saveTheme } = await import("../src/lib/theme");

beforeEach(() => store.clear());

test("nothing saved: Craftora red, no glass", () => {
  expect(savedTheme()).toEqual({ colour: "red", glass: false });
});

test("the old glass themes keep their look", () => {
  store.set("craftora.theme", "dark");
  expect(savedTheme()).toEqual({ colour: "red", glass: true });
  store.set("craftora.theme", "light");
  expect(savedTheme()).toEqual({ colour: "light", glass: true });
  store.set("craftora.theme", "classic");
  expect(savedTheme()).toEqual({ colour: "red", glass: false });
});

test("a saved look wins over the old theme", () => {
  store.set("craftora.theme", "dark");
  saveTheme({ colour: "lively", glass: false });
  expect(savedTheme()).toEqual({ colour: "lively", glass: false });
});
