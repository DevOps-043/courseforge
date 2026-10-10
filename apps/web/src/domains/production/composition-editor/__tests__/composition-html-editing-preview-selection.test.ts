import assert from "node:assert/strict";
import test from "node:test";
import { captureHtmlEditingPreviewSource, resolveHtmlEditingPreviewChannel, resolveHtmlEditingPublishedPreviewRevision } from "../composition-html-editing-preview-selection";
import { buildHtmlEditingPreviewPageUrl } from "../composition-html-editing-preview-url";

const activeRevisionId = "11111111-1111-4111-8111-111111111111";
const previousRevisionId = "22222222-2222-4222-8222-222222222222";
const documentHash = "a".repeat(64), changedHash = "b".repeat(64);
const snapshots = [{ id: activeRevisionId, documentHash }, { id: previousRevisionId, documentHash }];

test("preview channel identity belongs to captured document, not later editable/proposal content", () => {
  const current = {documentHash, document: {htmlEditing: {items: [{}]}}};
  const source = captureHtmlEditingPreviewSource(current);
  assert.equal(resolveHtmlEditingPreviewChannel(documentHash, source), "HTML_EDITING");
  assert.equal(resolveHtmlEditingPreviewChannel(changedHash, source), null);
  assert.equal(resolveHtmlEditingPreviewChannel(documentHash, null), null);
  assert.equal(resolveHtmlEditingPreviewChannel(null, source), null);
  current.documentHash = changedHash; current.document.htmlEditing.items.length = 0;
  assert.deepEqual(source, {documentHash, hasHtmlEditing: true});
  assert.deepEqual(captureHtmlEditingPreviewSource(current), {documentHash: changedHash, hasHtmlEditing: false});
  const native = {documentHash, document: {htmlEditing: {items: [] as unknown[]}}};
  const nativeSource = captureHtmlEditingPreviewSource(native); native.document.htmlEditing.items.push({});
  assert.equal(nativeSource.hasHtmlEditing, false);
  assert.equal(resolveHtmlEditingPreviewChannel(documentHash, nativeSource), "NATIVE");
});

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
