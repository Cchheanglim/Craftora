import { expect, test } from "bun:test";
import { applyEdit } from "../src/project/actions";
import { emptyProject, projectName } from "../src/project/model";

test("a project's own name wins; an empty one goes back to its first file's", () => {
  const named = applyEdit(emptyProject(), { type: "renameProject", name: "  Rally edit  " });
  expect(named.name).toBe("Rally edit");
  expect(projectName(named)).toBe("Rally edit");
  const cleared = applyEdit(named, { type: "renameProject", name: "   " });
  expect(cleared.name).toBeUndefined();
  expect(projectName(cleared)).toBe("Untitled project");
});
