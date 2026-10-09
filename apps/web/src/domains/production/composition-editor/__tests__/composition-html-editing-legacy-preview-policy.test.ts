import assert from "node:assert/strict";
import test from "node:test";
import { readLegacyRevisionPreview } from "../composition-html-editing-legacy-preview-policy";

const previewHtml = "<html><body>Legacy preview</body></html>";
const snapshot = { schemaVersion: 1, path: "html-editing-revisions.json", sha256: "a".repeat(64) };

test("legacy revision previews without editable metadata remain byte-exact", () => {
  for (const manifest of [
    { preview_html: previewHtml },
    { preview_html: previewHtml, snapshot: true, conformance_reference: { schemaVersion: 1 } },
  ]) assert.deepEqual(readLegacyRevisionPreview(manifest), { kind: "available", html: previewHtml });
});

test("either authoritative editable descriptor blocks legacy HTML delivery", () => {
  for (const markers of [
    { html_editing_snapshot: snapshot },
    { conformance_reference: { htmlEditingSnapshot: snapshot } },
    { html_editing_snapshot: snapshot, conformance_reference: { htmlEditingSnapshot: snapshot } },
  ]) assert.deepEqual(readLegacyRevisionPreview({ preview_html: previewHtml, ...markers }),
    { kind: "html-editing-required" });
});

test("malformed or incomplete editable descriptors cannot downgrade to legacy CSP", () => {
  for (const descriptor of [null, undefined, false, "", [], {}, { sha256: "invalid" }]) {
    assert.deepEqual(readLegacyRevisionPreview({ preview_html: previewHtml, html_editing_snapshot: descriptor }),
      { kind: "html-editing-required" });
    assert.deepEqual(readLegacyRevisionPreview({ preview_html: previewHtml,
      conformance_reference: { htmlEditingSnapshot: descriptor } }), { kind: "html-editing-required" });
  }
});

test("editable marker takes priority over missing or malformed stored HTML without mutating metadata", () => {
  const manifest = Object.freeze({ preview_html: null,
    conformance_reference: Object.freeze({ htmlEditingSnapshot: Object.freeze(snapshot) }) });
  assert.deepEqual(readLegacyRevisionPreview(manifest), { kind: "html-editing-required" });
  assert.equal(manifest.conformance_reference.htmlEditingSnapshot, snapshot);
});

test("missing and oversized legacy previews remain unavailable", () => {
  for (const manifest of [null, undefined, [], "html", {}, { preview_html: 1 },
    { preview_html: "" }, { preview_html: "x".repeat(200_001) }]) {
    assert.deepEqual(readLegacyRevisionPreview(manifest), { kind: "unavailable" });
  }
  assert.equal(readLegacyRevisionPreview({ preview_html: "x".repeat(200_000) }).kind, "available");
});
