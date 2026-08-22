import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_COMPOSITION_PREVIEW_SYNC_STATE,
  transitionCompositionPreviewSyncState,
} from "../composition-preview-sync-state";

test("tracks persisted and rendered document versions independently", () => {
  const loaded = transitionCompositionPreviewSyncState(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE, {
    documentHash: "hash-a",
    type: "DOCUMENT_LOADED",
  });
  assert.equal(loaded.phase, "VISUAL_SYNC_PENDING");
  assert.equal(loaded.renderedDocumentHash, null);
  assert.equal(loaded.pendingRenderDocumentHash, "hash-a");

  const ready = transitionCompositionPreviewSyncState(loaded, { documentHash: "hash-a", type: "PREVIEW_READY" });
  assert.equal(ready.phase, "SYNCED");

  const dirty = transitionCompositionPreviewSyncState(ready, { type: "EDIT_ACCEPTED" });
  const saving = transitionCompositionPreviewSyncState(dirty, { type: "SAVE_STARTED" });
  const saved = transitionCompositionPreviewSyncState(saving, { documentHash: "hash-b", type: "SAVE_SUCCEEDED" });
  assert.equal(saved.phase, "VISUAL_SYNC_PENDING");
  assert.equal(saved.renderedDocumentHash, "hash-a");
  assert.equal(saved.persistedDocumentHash, "hash-b");
});

test("keeps conflicts and runtime failures explicit", () => {
  const conflicted = transitionCompositionPreviewSyncState(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE, {
    documentHash: "server-hash",
    type: "CONFLICT",
  });
  assert.equal(conflicted.phase, "CONFLICT");
  assert.equal(transitionCompositionPreviewSyncState(conflicted, { type: "RUNTIME_FAILED" }).phase, "RUNTIME_FAILED");
});
