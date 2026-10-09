import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readPublishedHtmlPreviewPin } from "../composition-html-editing-published-preview.server";
import { buildHtmlEditingPreviewPageUrl } from "../composition-html-editing-preview-url";
import { conformanceFontManifestHash } from "../composition-conformance-font-bindings";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const documentHash = "a".repeat(64), bundleSha256 = "b".repeat(64);
function fixture() {
  const pin = { schemaVersion: 1, path: "html-editing-revisions.json", sha256: bundleSha256 };
  const row = { id: other, organization_id: uuid, manifest: { snapshot: true, draft_document_id: uuid,
    draft_document_hash: documentHash, html_editing_snapshot: { ...pin },
    font_manifest: [], conformance_reference: { schemaVersion: 1, documentHash, htmlEditingSnapshot: { ...pin },
      previewPath: "conformance-preview.html", previewSha256: documentHash, nativeDocumentSha256: documentHash,
      contractSha256: documentHash, mediaState: "REQUIRES_VERIFIED_MATERIALIZATION", audioState: "REFERENCE_NOT_CAPTURED",
      bindings: [], fontManifestSha256: conformanceFontManifestHash([]) } } };
  const state = { calls: 0, error: null as unknown };
  const query = { select: (columns: string) => { assert.equal(columns, "id,organization_id,manifest"); return query; },
    eq: (column: string, value: string) => { assert.equal(value, column === "id" ? other : uuid); return query; },
    abortSignal: (signal: AbortSignal) => { signal.throwIfAborted(); return query; },
    maybeSingle: async () => { state.calls++; return { data: row, error: state.error }; } };
  const supabase = { from: (table: string) => { assert.equal(table, "video_composition_revisions"); return query; } } as unknown as SupabaseClient;
  return { row, state, input: { organizationId: uuid, documentId: uuid, documentHash, revisionId: other, supabase } };
}

test("published preview reads exact tenant revision and both frozen metadata pins", async () => {
  const f = fixture(), before = JSON.stringify(f.row);
  assert.deepEqual(await readPublishedHtmlPreviewPin(f.input), { expectedFrozenBundleSha256: bundleSha256, mediaBindings: [], fontManifest: [] });
  assert.equal(f.state.calls, 1); assert.equal(JSON.stringify(f.row), before);
});

test("published preview rejects foreign row/document and inconsistent frozen metadata", async () => {
  for (const change of ["revision", "tenant", "draft", "hash", "referenceHash", "pin", "path", "snapshot", "legacy"] as const) {
    const f = fixture();
    if (change === "revision") f.row.id = uuid;
    else if (change === "tenant") f.row.organization_id = other;
    else if (change === "draft") f.row.manifest.draft_document_id = other;
    else if (change === "hash") f.row.manifest.draft_document_hash = bundleSha256;
    else if (change === "referenceHash") f.row.manifest.conformance_reference.documentHash = bundleSha256;
    else if (change === "pin") f.row.manifest.conformance_reference.htmlEditingSnapshot.sha256 = documentHash;
    else if (change === "path") f.row.manifest.html_editing_snapshot.path = "another.json";
    else if (change === "snapshot") f.row.manifest.snapshot = false;
    else Reflect.deleteProperty(f.row.manifest, "html_editing_snapshot");
    await assert.rejects(readPublishedHtmlPreviewPin(f.input), /^Error: HTML_PUBLISHED_PREVIEW_UNAVAILABLE$/);
  }
});

test("published preview rejects unavailable, oversized and aborted reads without disclosing content", async () => {
  const failed = fixture(); failed.state.error = new Error("private source URL");
  await assert.rejects(readPublishedHtmlPreviewPin(failed.input), /^Error: HTML_PUBLISHED_PREVIEW_UNAVAILABLE$/);
  const oversized = fixture(); Object.assign(oversized.row.manifest, { privateContent: "private".repeat(3_000_000) });
  await assert.rejects(readPublishedHtmlPreviewPin(oversized.input), /^Error: HTML_PUBLISHED_PREVIEW_UNAVAILABLE$/);
  const aborted = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(readPublishedHtmlPreviewPin({ ...aborted.input, signal: controller.signal }), /HTML_PUBLISHED_PREVIEW_UNAVAILABLE/);
  assert.equal(aborted.state.calls, 0);
});

test("historical page URL carries revision identity without client-supplied authority", () => {
  const session = { version: 1 as const, nonce: "c".repeat(64), documentHash, previewGeneration: 1 };
  const url = new URL(buildHtmlEditingPreviewPageUrl(uuid, session, other), "https://app.test");
  assert.equal(url.searchParams.get("revisionId"), other);
  assert.equal(url.searchParams.size, 4);
  assert.throws(() => buildHtmlEditingPreviewPageUrl(uuid, session, "../forged"), /REVISION_INVALID/);
});
