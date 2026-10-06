import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { load } from "cheerio";
import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { freezeCompositionHtmlEditingSnapshot, restoreCompositionHtmlEditingSnapshot } from "../composition-html-editing-snapshot-bundle.server";
import { compileCompositionPreview } from "../composition-preview-compiler.service";
import { hashCompositionDocument } from "../composition-document.service";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function fixture() {
  const input = createHtmlEditingRevisionFixture();
  const native = bindHtmlEditingRevisionToComposition({ ...input.authority, document: input.document,
    revision: input.next.revision, revisionSha256: input.next.sha256 });
  const context = { organizationId: uuid, documentId: uuid, documentHash: native.documentHash,
    revisions: [{ ...input.authority, encodedRevision: JSON.stringify(input.next.revision) }] };
  const bundle = freezeCompositionHtmlEditingSnapshot({ document: native.document, context });
  const request = { ...bundle, document: native.document, documentHash: native.documentHash,
    scope: { organizationId: uuid, documentId: uuid }, authorities: [input.authority] };
  return { input, native, context, bundle, request };
}

test("bundle freezes exact content and identity, excluding grants and temporary delivery URLs", () => {
  const { bundle, context, native } = fixture();
  const before = JSON.stringify({ context, document: native.document });
  assert.equal(bundle.archivePath, "html-editing-revisions.json");
  assert.equal(bundle.sha256, digest(bundle.encodedBundle));
  const stored = JSON.parse(bundle.encodedBundle);
  assert.equal(stored.documentHash, native.documentHash);
  assert.equal(stored.revisions[0].version, 2);
  assert.deepEqual(Object.keys(stored).sort(), ["documentHash", "documentId", "format", "organizationId", "revisions", "schemaVersion"]);
  assert.doesNotMatch(bundle.encodedBundle, /grantedAssetIds|imageSources|authorities|https:\/\//);
  assert.deepEqual(freezeCompositionHtmlEditingSnapshot({ document: native.document, context }), bundle);
  assert.equal(JSON.stringify({ context, document: native.document }), before);
});

test("freeze rejects source drift, selected hash mismatch and a revoked default", () => {
  for (const change of ["source", "hash", "grants"] as const) {
    const { native, context } = fixture();
    if (change === "source") {
      const clip = native.document.clips[0]!;
      assert.ok(clip.source.type === "DECK_SLIDE"); clip.source.html += " ";
    } else if (change === "hash") context.documentHash = "f".repeat(64);
    else context.revisions[0]!.grantedAssetIds = [];
    assert.throws(() => freezeCompositionHtmlEditingSnapshot({ document: native.document, context }), /INVALID_BUNDLE/);
  }
});

test("restore requires current authority and rechecks grants, never using archived permissions", () => {
  const { request } = fixture();
  const restored = restoreCompositionHtmlEditingSnapshot(request);
  assert.equal(restored.revisions[0]!.grantedAssetIds[0], uuid);
  assert.throws(() => restoreCompositionHtmlEditingSnapshot({ ...request,
    authorities: [{ ...request.authorities[0]!, grantedAssetIds: [] }] }), /INVALID_BUNDLE/);
  assert.throws(() => restoreCompositionHtmlEditingSnapshot({ ...request, authorities: [] }), /AUTHORITY_SET_MISMATCH/);
  assert.throws(() => restoreCompositionHtmlEditingSnapshot({ ...request,
    authorities: [...request.authorities, ...request.authorities] }), /AUTHORITY_SET_MISMATCH/);
});

test("archive byte integrity is pinned independently of semantic revision identity", () => {
  const { request } = fixture();
  assert.throws(() => restoreCompositionHtmlEditingSnapshot({ ...request,
    encodedBundle: request.encodedBundle + " " }), /BYTE_INTEGRITY_MISMATCH/);
  assert.throws(() => restoreCompositionHtmlEditingSnapshot({ ...request, sha256: "f".repeat(64) }), /BYTE_INTEGRITY_MISMATCH/);
});

test("recomputed bundle checksum cannot authorize substituted revision content", () => {
  const { request, input } = fixture();
  const stored = JSON.parse(request.encodedBundle);
  stored.revisions = [input.current.revision];
  const encodedBundle = JSON.stringify(stored);
  assert.throws(() => restoreCompositionHtmlEditingSnapshot({ ...request, encodedBundle, sha256: digest(encodedBundle) }), /INVALID_BUNDLE/);
});

test("wrong scope, document hash and independent template binding reject a valid byte bundle", () => {
  const { request } = fixture();
  for (const scope of [{ organizationId: other, documentId: uuid }, { organizationId: uuid, documentId: other }]) {
    assert.throws(() => restoreCompositionHtmlEditingSnapshot({ ...request, scope }), /SCOPE_MISMATCH/);
  }
  assert.throws(() => restoreCompositionHtmlEditingSnapshot({ ...request, documentHash: "f".repeat(64) }), /SCOPE_MISMATCH/);
  assert.throws(() => restoreCompositionHtmlEditingSnapshot({ ...request, authorities: [{ ...request.authorities[0]!,
    authoritativeBinding: { ...request.authorities[0]!.authoritativeBinding, templateVersion: 2 } }] }), /INVALID_BUNDLE/);
});

test("strict bounded decoding rejects malformed, extra-field and wrong-path archives", () => {
  const { request } = fixture();
  for (const encodedBundle of ["{", JSON.stringify({ ...JSON.parse(request.encodedBundle), grantedAssetIds: [uuid] }),
    "x".repeat(16 * 1024 * 1024 + 1)]) {
    assert.throws(() => restoreCompositionHtmlEditingSnapshot({ ...request, encodedBundle, sha256: digest(encodedBundle) }), /INVALID_BUNDLE/);
  }
  assert.throws(() => restoreCompositionHtmlEditingSnapshot({ ...request, archivePath: "../revision.json" as never }), /INVALID_BUNDLE/);
});

test("duplicate frozen revisions and mismatched authority clip cannot hide missing coverage", () => {
  const { request } = fixture();
  const stored = JSON.parse(request.encodedBundle);
  stored.revisions.push(stored.revisions[0]);
  const encodedBundle = JSON.stringify(stored);
  assert.throws(() => restoreCompositionHtmlEditingSnapshot({ ...request, encodedBundle, sha256: digest(encodedBundle) }), /INVALID_BUNDLE/);
  assert.throws(() => restoreCompositionHtmlEditingSnapshot({ ...request, authorities: [{ ...request.authorities[0]!,
    authoritativeBinding: { ...request.authorities[0]!.authoritativeBinding, clipId: "unrelated" } }] }), /AUTHORITY_SET_MISMATCH/);
});

test("both compiler targets derive the same edited fragment directly from frozen bytes and fresh authority", async () => {
  const { request, native } = fixture();
  const sourceBefore = JSON.stringify(native.document);
  const fragments: string[] = [];
  for (const target of ["INTERACTIVE_PREVIEW", "HYPERFRAMES_RENDER"] as const) {
    const html = await compileCompositionPreview({ document: native.document, documentHash: native.documentHash,
      htmlEditingSnapshot: request, target, assetUrls: new Map([[uuid, `conformance-media/${uuid}`],
        ["40000000-0000-4000-8000-000000000002", "conformance-media/40000000-0000-4000-8000-000000000002"]]) });
    const page = load(html);
    assert.equal(page("#title").text(), "Changed");
    fragments.push(page(".deck-stage > section").html()!);
  }
  assert.equal(fragments[0], fragments[1]);
  assert.equal(JSON.stringify(native.document), sourceBefore);
  assert.equal(hashCompositionDocument(native.document), native.documentHash);
});

test("compiler refuses ambiguous live and frozen revision inputs rather than choosing one", async () => {
  const { request, context, native } = fixture();
  await assert.rejects(compileCompositionPreview({ document: native.document, documentHash: native.documentHash,
    htmlEditingSnapshot: request, htmlEditingCompilation: context, assetUrls: new Map(), target: "HYPERFRAMES_RENDER" }), /INVALID_BUNDLE/);
});
