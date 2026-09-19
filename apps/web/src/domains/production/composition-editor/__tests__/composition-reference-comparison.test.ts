import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompositionComparisonPreviewUrl,
  isCompositionDocumentHash,
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
