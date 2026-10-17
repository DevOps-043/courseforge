import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_COMPOSITION_EDITOR_PREFERENCES,
  readCompositionEditorPreferences,
  writeCompositionEditorPreferences,
} from "../composition-editor-preferences";

function createStorage(initialValue: string | null = null) {
  let value = initialValue;
  return {
    getItem: () => value,
    setItem: (_key: string, nextValue: string) => { value = nextValue; },
  };
}

test("round-trips bounded editor preferences without touching the composition document", () => {
  const storage = createStorage();
  const preferences = {
    assetInsertionMode: "OVERWRITE" as const,
    schemaVersion: 1 as const,
    timelineFrameStep: 12,
    timelineKeyboardEditMode: "ROLL_RIGHT" as const,
  };

  assert.equal(writeCompositionEditorPreferences(storage, preferences), true);
  assert.deepEqual(readCompositionEditorPreferences(storage), preferences);
});

test("fails closed for malformed, oversized and future preference payloads", () => {
  for (const serialized of [
    "{malformed",
    "x".repeat(2_049),
    JSON.stringify({ ...DEFAULT_COMPOSITION_EDITOR_PREFERENCES, schemaVersion: 2 }),
    JSON.stringify({ ...DEFAULT_COMPOSITION_EDITOR_PREFERENCES, timelineFrameStep: 301 }),
  ]) {
    assert.deepEqual(
      readCompositionEditorPreferences(createStorage(serialized)),
      DEFAULT_COMPOSITION_EDITOR_PREFERENCES,
    );
  }
});

test("absorbs unavailable storage instead of breaking the editor", () => {
  const unavailableStorage = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
  };
  assert.deepEqual(readCompositionEditorPreferences(unavailableStorage), DEFAULT_COMPOSITION_EDITOR_PREFERENCES);
  assert.equal(writeCompositionEditorPreferences(unavailableStorage, DEFAULT_COMPOSITION_EDITOR_PREFERENCES), false);
});

