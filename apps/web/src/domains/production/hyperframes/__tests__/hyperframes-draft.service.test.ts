import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeDraftRelativePath, contentVersion, studioProjectDescriptor } from "../hyperframes-draft.service";

test("creates a Studio-safe descriptor without exposing a storage path", () => {
  assert.deepEqual(studioProjectDescriptor("ea635d7c-2dd0-4214-a0df-1fc3cedcc05e", 4), {
    draftId: "ea635d7c-2dd0-4214-a0df-1fc3cedcc05e",
    projectId: "ea635d7c-2dd0-4214-a0df-1fc3cedcc05e",
    version: 4,
  });
});

test("rejects traversal paths and versions file contents", () => {
  assert.equal(assertSafeDraftRelativePath("scenes/intro.html"), "scenes/intro.html");
  assert.throws(() => assertSafeDraftRelativePath("../secrets.txt"));
  assert.throws(() => assertSafeDraftRelativePath("/absolute.html"));
  assert.equal(contentVersion("same"), contentVersion("same"));
  assert.notEqual(contentVersion("same"), contentVersion("different"));
});
