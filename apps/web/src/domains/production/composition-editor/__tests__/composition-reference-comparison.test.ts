import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompositionComparisonPreviewUrl,
  buildCompositionSavedPreviewUrl,
  buildCompositionVersionedPreviewUrl,
  isCompositionDocumentHash,
  matchesCompositionPreviewNavigation,
  parseCompositionPreviewGeneration,
  readCompositionPreviewGeneration,
} from "../composition-preview-comparison";

test("accepts only valid saved document hashes for the comparison baseline", () => {
  assert.equal(isCompositionDocumentHash("a".repeat(64)), true);
  assert.equal(isCompositionDocumentHash("g".repeat(64)), false);
  assert.equal(isCompositionDocumentHash("a".repeat(63)), false);
});

test("builds a private preview URL bound to the selected saved version", () => {
  assert.equal(
    buildCompositionComparisonPreviewUrl({ draftId: "draft-1", documentHash: "a".repeat(64) }),
    `/api/production/hyperframes/drafts/draft-1/preview?documentHash=${"a".repeat(64)}&r=${"a".repeat(64)}`,
  );
});

test("pins the editable preview to its exact saved version across reloads", () => {
  const documentHash = "b".repeat(64);
  assert.equal(
    buildCompositionVersionedPreviewUrl({ draftId: "draft-1", documentHash, refreshKey: 7 }),
    `/api/production/hyperframes/drafts/draft-1/preview?documentHash=${documentHash}&r=7`,
  );
});

test("preserves the existing preview URL until strict sync is enabled", () => {
  const documentHash = "b".repeat(64);
  assert.equal(
    buildCompositionSavedPreviewUrl({ draftId: "draft-1", documentHash, refreshKey: 7, strictSyncEnabled: false }),
    `/api/production/hyperframes/drafts/draft-1/preview?v=${documentHash}&r=7`,
  );
  assert.equal(
    buildCompositionSavedPreviewUrl({ draftId: "draft-1", documentHash, refreshKey: 7, strictSyncEnabled: true }),
    `/api/production/hyperframes/drafts/draft-1/preview?documentHash=${documentHash}&r=7&sync=2`,
  );
});

test("rejects malformed navigation generations and distinguishes equal-hash reloads", () => {
  const documentHash = "c".repeat(64);
  const first = buildCompositionSavedPreviewUrl({ draftId: "draft-1", documentHash, refreshKey: 1, strictSyncEnabled: true });
  const second = buildCompositionSavedPreviewUrl({ draftId: "draft-1", documentHash, refreshKey: 2, strictSyncEnabled: true });
  assert.equal(readCompositionPreviewGeneration(first), 1);
  assert.equal(readCompositionPreviewGeneration(second), 2);
  assert.equal(parseCompositionPreviewGeneration("01"), null);
  assert.equal(parseCompositionPreviewGeneration("-1"), null);
  assert.equal(parseCompositionPreviewGeneration("2147483648"), null);
  assert.equal(readCompositionPreviewGeneration("not a URL"), null);
  assert.equal(matchesCompositionPreviewNavigation({ expectedDocumentHash: documentHash, expectedGeneration: 2, receivedDocumentHash: documentHash, receivedGeneration: 1 }), false);
  assert.equal(matchesCompositionPreviewNavigation({ expectedDocumentHash: documentHash, expectedGeneration: 2, receivedDocumentHash: documentHash, receivedGeneration: 2 }), true);
  assert.equal(matchesCompositionPreviewNavigation({ expectedDocumentHash: documentHash, expectedGeneration: 2, receivedDocumentHash: documentHash, receivedGeneration: null }), false);
});
