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

test("rejects weak, unquoted, missing, and inconsistent document versions", () => {
  assert.equal(parseCompositionDocumentEtag(`W/"${DOCUMENT_HASH}"`), null);
  assert.equal(parseCompositionDocumentEtag(DOCUMENT_HASH), null);
  assert.throws(() => resolveCompositionDocumentVersion({ bodyDocumentHash: DOCUMENT_HASH, responseEtag: null }));
  assert.throws(() => resolveCompositionDocumentVersion({ bodyDocumentHash: DOCUMENT_HASH, responseEtag: `"${"b".repeat(64)}"` }));
});

test("accepts a consistent version returned by the document endpoint", () => {
  assert.equal(resolveCompositionDocumentVersion({ bodyDocumentHash: DOCUMENT_HASH, responseEtag: `"${DOCUMENT_HASH}"` }), DOCUMENT_HASH);
});
