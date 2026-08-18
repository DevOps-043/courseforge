import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCompositionDocumentEtag,
  parseCompositionDocumentEtag,
  resolveCompositionDocumentVersion,
} from "../composition-document-version";

const DOCUMENT_HASH = "a".repeat(64);

test("uses a strong quoted ETag for the document concurrency token", () => {
  assert.equal(formatCompositionDocumentEtag(DOCUMENT_HASH), `"${DOCUMENT_HASH}"`);
  assert.equal(parseCompositionDocumentEtag(`"${DOCUMENT_HASH.toUpperCase()}"`), DOCUMENT_HASH);
});

test("parses only a strong quoted ETag when an HTTP client needs one", () => {
  assert.equal(parseCompositionDocumentEtag(`W/"${DOCUMENT_HASH}"`), null);
  assert.equal(parseCompositionDocumentEtag(DOCUMENT_HASH), null);
});

test("uses the persisted document hash regardless of CDN-managed response ETag", () => {
  assert.equal(resolveCompositionDocumentVersion(DOCUMENT_HASH), DOCUMENT_HASH);
});

test("rejects a missing or malformed persisted document hash", () => {
  assert.throws(() => resolveCompositionDocumentVersion(null));
  assert.throws(() => resolveCompositionDocumentVersion("not-a-hash"));
});
