import { expect, test } from "bun:test";

// engine.ts looks at `window` when it loads (desktop app or browser preview).
(globalThis as { window?: object }).window ??= {};
const { errorText } = await import("../src/lib/engine");

test("errors read as sentences, never as programmer text", () => {
  expect(errorText("This link has expired.")).toBe("This link has expired.");
  expect(errorText(new Error("Couldn't open the project."))).toBe("Couldn't open the project.");
  const slip = errorText(new TypeError("Cannot read properties of undefined (reading 'invoke')"));
  expect(slip).toStartWith("Something went wrong inside Craftora");
});
