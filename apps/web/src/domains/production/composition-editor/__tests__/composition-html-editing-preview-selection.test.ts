import assert from "node:assert/strict";
import test from "node:test";
import { resolveHtmlEditingPublishedPreviewRevision } from "../composition-html-editing-preview-selection";
import { buildHtmlEditingPreviewPageUrl } from "../composition-html-editing-preview-url";

const activeRevisionId = "11111111-1111-4111-8111-111111111111";
const previousRevisionId = "22222222-2222-4222-8222-222222222222";
const documentHash = "a".repeat(64), changedHash = "b".repeat(64);
const snapshots = [{ id: activeRevisionId, documentHash }, { id: previousRevisionId, documentHash }];

test("HTML preview selects only the active publication with the exact displayed hash", () => {
  assert.equal(resolveHtmlEditingPublishedPreviewRevision({ documentHash, activeRevisionId, snapshots }), activeRevisionId);
  for (const input of [
    { documentHash: changedHash, activeRevisionId, snapshots },
    { documentHash, activeRevisionId: previousRevisionId, snapshots: [snapshots[0]] },
    { documentHash, activeRevisionId: null, snapshots },
    { documentHash, activeRevisionId, snapshots: null },
    { documentHash: null, activeRevisionId, snapshots },
  ]) assert.equal(resolveHtmlEditingPublishedPreviewRevision(input), undefined);
});

test("comparison freezes its publication while the primary draft advances", () => {
  const baselineRevisionId = resolveHtmlEditingPublishedPreviewRevision({ documentHash, activeRevisionId, snapshots });
  const session = { version: 1 as const, documentHash, previewGeneration: 0, nonce: "c".repeat(64) };
  const baselineUrl = buildHtmlEditingPreviewPageUrl(activeRevisionId, session, baselineRevisionId);
  snapshots[0] = { id: activeRevisionId, documentHash: changedHash };
  try {
    assert.equal(resolveHtmlEditingPublishedPreviewRevision({ documentHash, activeRevisionId, snapshots }), undefined);
    assert.equal(new URL(baselineUrl, "https://preview.invalid").searchParams.get("revisionId"), activeRevisionId);
    assert.equal(new URL(buildHtmlEditingPreviewPageUrl(activeRevisionId, { ...session, documentHash: changedHash }), "https://preview.invalid").searchParams.has("revisionId"), false);
  } finally { snapshots[0] = { id: activeRevisionId, documentHash }; }
});
