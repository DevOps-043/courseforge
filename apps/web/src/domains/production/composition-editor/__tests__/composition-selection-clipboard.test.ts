import assert from "node:assert/strict";
import test from "node:test";
import {
  CompositionSelectionClipboardError,
  createCompositionSelectionClipboardEntry,
  resolveCompositionSelectionClipboardEntry,
} from "../composition-selection-clipboard";

test("creates a bounded clipboard entry with unique clip identities", () => {
  const entry = createCompositionSelectionClipboardEntry({
    clipIds: ["clip-a", "clip-a", "clip-b"],
    compositionId: "composition-a",
    now: 1_000,
  });

  assert.deepEqual(entry.clipIds, ["clip-a", "clip-b"]);
  assert.deepEqual(resolveCompositionSelectionClipboardEntry(entry, {
    compositionId: "composition-a",
    now: 2_000,
  }), ["clip-a", "clip-b"]);
});

test("rejects cross-composition and expired clipboard entries", () => {
  const entry = createCompositionSelectionClipboardEntry({
    clipIds: ["clip-a"],
    compositionId: "composition-a",
    now: 1_000,
  });

  assert.throws(() => resolveCompositionSelectionClipboardEntry(entry, {
    compositionId: "composition-b",
    now: 2_000,
  }), CompositionSelectionClipboardError);
  assert.throws(() => resolveCompositionSelectionClipboardEntry(entry, {
    compositionId: "composition-a",
    now: 1_000 + 30 * 60 * 1_000 + 1,
  }), /expiró/);
});

test("rejects empty and oversized clipboard selections", () => {
  assert.throws(() => createCompositionSelectionClipboardEntry({
    clipIds: [],
    compositionId: "composition-a",
  }), /al menos un clip/);
  assert.throws(() => createCompositionSelectionClipboardEntry({
    clipIds: Array.from({ length: 101 }, (_, index) => `clip-${index}`),
    compositionId: "composition-a",
  }), /máximo 100/);
});
