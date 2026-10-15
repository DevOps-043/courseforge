import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { load } from "cheerio";
import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { diagnoseCompositionHtmlEditingSnapshotCompatibility, freezeCompositionHtmlEditingSnapshot, prepareCompositionHtmlEditingSnapshotRepublication, restoreCompositionHtmlEditingSnapshot, verifyCompositionHtmlEditingSnapshotContent } from "../composition-html-editing-snapshot-bundle.server";
import { HTML_EDITING_COMPILATION_PROFILE } from "../html-editing/html-editing-compilation-profile";
import { compileCompositionPreview } from "../composition-preview-compiler.service";
import { hashCompositionDocument } from "../composition-document.service";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

test("offline compatibility never promotes a matching profile to execution authority", () => {
  const { request } = fixture();
  const before = JSON.stringify(request);
  assert.deepEqual(diagnoseCompositionHtmlEditingSnapshotCompatibility(request), {
    scope: "OFFLINE_COMPATIBILITY_NOT_AUTHORIZATION", status: "CURRENT_PROFILE_REQUIRES_CONTENT_AND_AUTHORITY_CHECKS",
    revisionCount: 1, profileDifferences: [],
  });
  assert.equal(JSON.stringify(request), before);
});

test("offline inventory classifies strict V1 and each mismatched profile without executing historical content", () => {
  const { request } = fixture();
  for (const key of ["legacy", ...Object.keys(HTML_EDITING_COMPILATION_PROFILE)]) {
    const stored = JSON.parse(request.encodedBundle);
    if (key === "legacy") { delete stored.compilation; stored.schemaVersion = 1; stored.format = "courseforge-html-editable-snapshot-bundle-v1"; }
    else stored.compilation.profile[key] = "prior-version";
    const encodedBundle = JSON.stringify(stored);
    assert.deepEqual(diagnoseCompositionHtmlEditingSnapshotCompatibility({ ...request, encodedBundle, sha256: digest(encodedBundle) }), {
      scope: "OFFLINE_COMPATIBILITY_NOT_AUTHORIZATION", status: key === "legacy" ? "LEGACY_V1_REQUIRES_REVIEW" : "PROFILE_MISMATCH_REQUIRES_REVIEW",
      revisionCount: 1, profileDifferences: key === "legacy" ? [] : [key],
    });
  }
});

test("diagnosis checks independent bytes and scope before reporting compatibility", () => {
  const { request } = fixture();
  for (const [change, reason] of [
    [{ sha256: "f".repeat(64) }, "BYTE_INTEGRITY_MISMATCH"],
    [{ encodedBundle: request.encodedBundle + " " }, "BYTE_INTEGRITY_MISMATCH"],
    [{ scope: { organizationId: other, documentId: uuid } }, "SCOPE_MISMATCH"],
    [{ scope: { organizationId: uuid, documentId: other } }, "SCOPE_MISMATCH"],
    [{ documentHash: "f".repeat(64) }, "SCOPE_MISMATCH"],
  ] as const) assert.deepEqual(diagnoseCompositionHtmlEditingSnapshotCompatibility({ ...request, ...change }), {
    scope: "OFFLINE_COMPATIBILITY_NOT_AUTHORIZATION", status: "REJECTED", reason,
  });
});

test("malformed V1 envelopes and authority-bearing metadata are rejected, not offered migration", () => {
  const { request } = fixture();
  for (const change of ["missingRevision", "extraAuthority", "badVersion", "unknownFormat"]) {
    const stored = JSON.parse(request.encodedBundle);
    delete stored.compilation; stored.schemaVersion = 1; stored.format = "courseforge-html-editable-snapshot-bundle-v1";
    if (change === "missingRevision") stored.revisions = [];
    if (change === "extraAuthority") stored.grantedAssetIds = [uuid];
    if (change === "badVersion") stored.schemaVersion = 2;
    if (change === "unknownFormat") stored.format = "unknown";
    const encodedBundle = JSON.stringify(stored);
    const result = diagnoseCompositionHtmlEditingSnapshotCompatibility({ ...request, encodedBundle, sha256: digest(encodedBundle) });
    assert.deepEqual(result, { scope: "OFFLINE_COMPATIBILITY_NOT_AUTHORIZATION", status: "REJECTED", reason: "INVALID_BUNDLE" });
    assert.doesNotMatch(JSON.stringify(result), /sourceHtml|conformance-media|grantedAssetIds/);
  }
});
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

function historicalRequest(legacy = false) {
  const { request } = fixture();
  const stored = JSON.parse(request.encodedBundle);
  if (legacy) {
    delete stored.compilation;
    stored.format = "courseforge-html-editable-snapshot-bundle-v1";
    stored.schemaVersion = 1;
  } else stored.compilation.profile.geometryVersion = "prior-version";
  const encodedBundle = JSON.stringify(stored);
  return { ...request, encodedBundle, sha256: digest(encodedBundle) };
}

test("historical republication prepares a separate current candidate without restoring the original", () => {
  for (const legacy of [false, true]) {
    const request = historicalRequest(legacy);
    const before = JSON.stringify(request);
    const prepared = prepareCompositionHtmlEditingSnapshotRepublication(request);
    assert.equal(prepared.scope, "PREPARED_REPUBLICATION_NOT_COMMITTED");
    assert.equal(prepared.originalBundleSha256, request.sha256);
    assert.notEqual(prepared.candidate.sha256, request.sha256);
    assert.deepEqual(prepared.candidateCompilationProfile, HTML_EDITING_COMPILATION_PROFILE);
    assert.equal(prepared.comparisons[0]!.status, legacy ? "NO_PRIOR_OUTPUT_PIN" : "OUTPUT_PIN_EQUAL");
    assert.deepEqual(prepared.unmatchedPriorClipIds, []);
    assert.deepEqual(prepared.requiredReviews,
      ["HISTORICAL_VISUAL_COMPARISON", "CURRENT_CONTENT_AND_ACCESSIBILITY", "AUTHORIZED_REPUBLICATION"]);
    assert.deepEqual(JSON.parse(prepared.candidate.encodedBundle).revisions, JSON.parse(request.encodedBundle).revisions);
    assert.equal(JSON.stringify(request), before);
    assert.throws(() => restoreCompositionHtmlEditingSnapshot(request), /COMPILATION_VERSION_MISMATCH/);
    assert.equal(restoreCompositionHtmlEditingSnapshot({ ...request, ...prepared.candidate }).documentHash, request.documentHash);
    assert.deepEqual(prepareCompositionHtmlEditingSnapshotRepublication(request), prepared);
  }
});

test("historical output differences and missing/extra pins are never silently reported as equality", () => {
  for (const change of ["changed", "missing"] as const) {
    const request = historicalRequest();
    const stored = JSON.parse(request.encodedBundle);
    if (change === "changed") stored.compilation.fragments[0].sha256 = "f".repeat(64);
    else stored.compilation.fragments[0].clipId = "another-clip";
    const encodedBundle = JSON.stringify(stored);
    const prepared = prepareCompositionHtmlEditingSnapshotRepublication({ ...request, encodedBundle, sha256: digest(encodedBundle) });
    assert.equal(prepared.comparisons[0]!.status, change === "changed" ? "OUTPUT_PIN_CHANGED" : "NO_PRIOR_OUTPUT_PIN");
    assert.deepEqual(prepared.unmatchedPriorClipIds, change === "missing" ? ["another-clip"] : []);
    assert.ok(prepared.requiredReviews.includes("HISTORICAL_VISUAL_COMPARISON"));
  }
});

test("historical preparation requires independent scope, exact native pointers and current grants", () => {
  const request = historicalRequest();
  assert.throws(() => prepareCompositionHtmlEditingSnapshotRepublication({ ...request, sha256: "f".repeat(64) }), /BYTE_INTEGRITY_MISMATCH/);
  assert.throws(() => prepareCompositionHtmlEditingSnapshotRepublication({ ...request, scope: { organizationId: other, documentId: uuid } }), /SCOPE_MISMATCH/);
  assert.throws(() => prepareCompositionHtmlEditingSnapshotRepublication({ ...request, documentHash: "f".repeat(64) }), /SCOPE_MISMATCH/);
  assert.throws(() => prepareCompositionHtmlEditingSnapshotRepublication({ ...request, authorities: [] }), /AUTHORITY_SET_MISMATCH/);
  assert.throws(() => prepareCompositionHtmlEditingSnapshotRepublication({ ...request,
    authorities: [{ ...request.authorities[0]!, grantedAssetIds: [] }] }), /INVALID_BUNDLE/);
  assert.throws(() => prepareCompositionHtmlEditingSnapshotRepublication({ ...request,
    authorities: [{ ...request.authorities[0]!, authoritativeBinding: { ...request.authorities[0]!.authoritativeBinding, templateVersion: 5 } }] }), /INVALID_BUNDLE/);
  const document = structuredClone(request.document);
  document.htmlEditing!.items[0]!.revisionSha256 = "f".repeat(64);
  assert.throws(() => prepareCompositionHtmlEditingSnapshotRepublication({ ...request, document,
    documentHash: hashCompositionDocument(document) }), /SCOPE_MISMATCH/);
  for (const change of ["state", "source", "version"] as const) {
    const stored = JSON.parse(request.encodedBundle);
    if (change === "state") stored.revisions[0].state.overrides[0].value = "Substituted";
    else if (change === "source") stored.revisions[0].sourceHtml += " ";
    else stored.revisions[0].version += 1;
    const encodedBundle = JSON.stringify(stored);
    assert.throws(() => prepareCompositionHtmlEditingSnapshotRepublication({ ...request, encodedBundle, sha256: digest(encodedBundle) }), /INVALID_BUNDLE/);
  }
});

test("republication is not a general current-profile or malformed-bundle bypass", () => {
  assert.throws(() => prepareCompositionHtmlEditingSnapshotRepublication(fixture().request), /COMPILATION_VERSION_MISMATCH/);
  const request = historicalRequest();
  for (const change of ["extra", "badVersion", "duplicate"] as const) {
    const stored = JSON.parse(request.encodedBundle);
    if (change === "extra") stored.authorities = request.authorities;
    else if (change === "badVersion") stored.schemaVersion = 3;
    else stored.revisions.push(stored.revisions[0]);
    const encodedBundle = JSON.stringify(stored);
    assert.throws(() => prepareCompositionHtmlEditingSnapshotRepublication({ ...request, encodedBundle, sha256: digest(encodedBundle) }), /INVALID_BUNDLE/);
  }
});

test("bundle freezes exact content and identity, excluding grants and temporary delivery URLs", () => {
  const { bundle, context, native } = fixture();
  const before = JSON.stringify({ context, document: native.document });
  assert.equal(bundle.archivePath, "html-editing-revisions.json");
  assert.equal(bundle.sha256, digest(bundle.encodedBundle));
  const stored = JSON.parse(bundle.encodedBundle);
  assert.equal(stored.documentHash, native.documentHash);
  assert.equal(stored.revisions[0].version, 2);
  assert.deepEqual(Object.keys(stored).sort(), ["compilation", "documentHash", "documentId", "format", "organizationId", "revisions", "schemaVersion"]);
  assert.equal(stored.format, "courseforge-html-editable-snapshot-bundle-v2");
  assert.equal(stored.schemaVersion, 2);
  assert.deepEqual(stored.compilation.profile, HTML_EDITING_COMPILATION_PROFILE);
  const content = verifyCompositionHtmlEditingSnapshotContent({ ...bundle, document: native.document, documentHash: native.documentHash });
  assert.deepEqual(stored.compilation.fragments, [...content.fragments].map(([clipId, html]) => ({ clipId, sha256: digest(html) })));
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

test("legacy unversioned compilation bundles are never automatically upgraded for restore or offline execution", () => {
  const { request } = fixture();
  const stored = JSON.parse(request.encodedBundle);
  delete stored.compilation;
  stored.format = "courseforge-html-editable-snapshot-bundle-v1";
  stored.schemaVersion = 1;
  const encodedBundle = JSON.stringify(stored), legacy = { ...request, encodedBundle, sha256: digest(encodedBundle) };
  assert.throws(() => restoreCompositionHtmlEditingSnapshot(legacy), /COMPILATION_VERSION_MISMATCH/);
  assert.throws(() => verifyCompositionHtmlEditingSnapshotContent(legacy), /COMPILATION_VERSION_MISMATCH/);
});

test("all compiler profile fields are exact pins, not merely advisory metadata", () => {
  const { request } = fixture();
  for (const key of Object.keys(HTML_EDITING_COMPILATION_PROFILE)) {
    const stored = JSON.parse(request.encodedBundle);
    stored.compilation.profile[key] = "future-or-legacy-version";
    const encodedBundle = JSON.stringify(stored), altered = { ...request, encodedBundle, sha256: digest(encodedBundle) };
    assert.throws(() => restoreCompositionHtmlEditingSnapshot(altered), /COMPILATION_VERSION_MISMATCH/);
    assert.throws(() => verifyCompositionHtmlEditingSnapshotContent(altered), /COMPILATION_VERSION_MISMATCH/);
  }
});

test("same-version output drift and a foreign clip pin fail even with a valid envelope checksum", () => {
  const { request } = fixture();
  for (const change of ["sha256", "clipId"] as const) {
    const stored = JSON.parse(request.encodedBundle);
    stored.compilation.fragments[0][change] = change === "sha256" ? "f".repeat(64) : "foreign_clip";
    const encodedBundle = JSON.stringify(stored), altered = { ...request, encodedBundle, sha256: digest(encodedBundle) };
    assert.throws(() => restoreCompositionHtmlEditingSnapshot(altered), /COMPILATION_OUTPUT_MISMATCH/);
    assert.throws(() => verifyCompositionHtmlEditingSnapshotContent(altered), /COMPILATION_OUTPUT_MISMATCH/);
  }
});

test("missing, duplicate or authority-bearing compilation descriptors cannot become output pins", () => {
  const { request } = fixture();
  for (const change of ["missing", "duplicate", "extra", "invalidSha"] as const) {
    const stored = JSON.parse(request.encodedBundle);
    if (change === "missing") delete stored.compilation;
    else if (change === "duplicate") stored.compilation.fragments.push(stored.compilation.fragments[0]);
    else if (change === "extra") stored.compilation.profile.grantedAssetIds = [uuid];
    else stored.compilation.fragments[0].sha256 = "not-a-digest";
    const encodedBundle = JSON.stringify(stored), altered = { ...request, encodedBundle, sha256: digest(encodedBundle) };
    assert.throws(() => restoreCompositionHtmlEditingSnapshot(altered), /INVALID_BUNDLE/);
    assert.throws(() => verifyCompositionHtmlEditingSnapshotContent(altered), /INVALID_BUNDLE/);
  }
});

test("both actual compiler entry targets reject pinned-output drift before delivering a page", async () => {
  const { request, native } = fixture();
  const stored = JSON.parse(request.encodedBundle);
  stored.compilation.fragments[0].sha256 = "f".repeat(64);
  const encodedBundle = JSON.stringify(stored);
  for (const target of ["INTERACTIVE_PREVIEW", "HYPERFRAMES_RENDER"] as const) {
    await assert.rejects(compileCompositionPreview({ document: native.document,
      documentHash: native.documentHash, target,
      htmlEditingSnapshot: { ...request, encodedBundle, sha256: digest(encodedBundle) },
      assetUrls: new Map([[uuid, `conformance-media/${uuid}`]]) }), /COMPILATION_OUTPUT_MISMATCH/);
  }
});
