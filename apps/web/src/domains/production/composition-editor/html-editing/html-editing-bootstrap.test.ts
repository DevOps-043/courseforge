import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { HTML_EDITING_LIMITS } from "./html-editing.contract";
import { prepareInitialHtmlEditingRevision } from "./html-editing-bootstrap.server";
import { verifyHtmlEditingRevision } from "./html-editing-revision.server";

const assetId = "11111111-1111-4111-8111-111111111111";
function fixture(sourceHtml = '<section><h1 id="title">Original</h1></section>') {
  const template = { format: "courseforge-html-editable-template-v1", templateId: "intro", templateVersion: 1,
    sourceSha256: createHash("sha256").update(sourceHtml).digest("hex"),
    elements: [{ kind: "TEXT", elementId: "title", label: "Title", maxCharacters: 100, multiline: false }] };
  const params = { authoritativeAnchor: { organizationId: assetId, documentId: assetId,
    revisionId: assetId, documentSha256: "a".repeat(64), clipId: "intro" },
    encodedTrustedTemplate: JSON.stringify(template), sourceHtml,
    grantedAssetIds: [] as string[], imageSources: new Map<string, string>() };
  return { params, template };
}

test("bootstrap derives a verified empty first revision without changing saved source or anchor", () => {
  const { params } = fixture();
  const unchanged = JSON.stringify(params);
  const result = prepareInitialHtmlEditingRevision(params);
  assert.equal(result.revision.version, 1);
  assert.equal(result.revision.sourceHtml, params.sourceHtml);
  assert.equal(result.revision.manifest.binding.documentSha256, params.authoritativeAnchor.documentSha256);
  assert.deepEqual(result.revision.state.overrides, []);
  assert.deepEqual(result.revision.state.binding, result.revision.manifest.binding);
  assert.equal(JSON.stringify(params), unchanged);
  assert.equal(verifyHtmlEditingRevision({ authoritativeBinding: result.revision.manifest.binding,
    grantedAssetIds: [], imageSources: params.imageSources, encodedRevision: JSON.stringify(result.revision) }).sha256, result.sha256);
});

test("template formatting is immaterial but changing the saved anchor changes the digest", () => {
  const { params, template } = fixture();
  const result = prepareInitialHtmlEditingRevision(params);
  assert.equal(prepareInitialHtmlEditingRevision({ ...params, encodedTrustedTemplate: JSON.stringify(template, null, 2) }).sha256, result.sha256);
  assert.notEqual(prepareInitialHtmlEditingRevision({ ...params,
    authoritativeAnchor: { ...params.authoritativeAnchor, documentSha256: "b".repeat(64) } }).sha256, result.sha256);
});

test("bootstrap rejects substituted source, scope fields, overrides and authority inside declarations", () => {
  const { params, template } = fixture();
  assert.throws(() => prepareInitialHtmlEditingRevision({ ...params, sourceHtml: params.sourceHtml + " " }), /SOURCE_DIGEST_MISMATCH/);
  for (const extra of [{ binding: params.authoritativeAnchor }, { overrides: [] }, { grantedAssetIds: [assetId] }]) {
    assert.throws(() => prepareInitialHtmlEditingRevision({ ...params,
      encodedTrustedTemplate: JSON.stringify({ ...template, ...extra }) }), /INVALID_MANIFEST/);
  }
  assert.throws(() => prepareInitialHtmlEditingRevision({ ...params,
    authoritativeAnchor: { ...params.authoritativeAnchor, documentId: "invalid" } }), /INVALID_MANIFEST/);
});

test("bootstrap validates unique compatible targets and refuses active HTML", () => {
  for (const source of ['<section><p>No target</p></section>', '<h1 id="title">A</h1><h1 id="title">B</h1>',
    '<h1 id="title">A</h1><script>alert(1)</script>']) {
    assert.throws(() => prepareInitialHtmlEditingRevision(fixture(source).params));
  }
  const { params, template } = fixture();
  assert.throws(() => prepareInitialHtmlEditingRevision({ ...params,
    encodedTrustedTemplate: JSON.stringify({ ...template, elements: [...template.elements, ...template.elements] }) }), /INVALID_MANIFEST/);
});

test("bootstrap initial images still require independently supplied current grants and local sources", () => {
  const { params, template } = fixture(`<h1 id="title">A</h1><img id="image" src="conformance-media/${assetId}">`);
  const encodedTrustedTemplate = JSON.stringify({ ...template, elements: [...template.elements,
    { kind: "IMAGE", elementId: "image", label: "Image", allowedAssetIds: [assetId], allowedFits: ["COVER"] }] });
  const images = { ...params, encodedTrustedTemplate, imageSources: new Map([[assetId, `conformance-media/${assetId}`]]) };
  // An unauthorized source resource is rejected by the shared local-resource
  // policy before override validation; it is not an override-specific error.
  assert.throws(() => prepareInitialHtmlEditingRevision(images), /INVALID_SOURCE/);
  const result = prepareInitialHtmlEditingRevision({ ...images, grantedAssetIds: [assetId] });
  assert.equal(result.revision.state.overrides.length, 0);
});

test("bootstrap bounds declaration and source UTF-8 bytes before hashing and compiling", () => {
  const { params } = fixture();
  assert.throws(() => prepareInitialHtmlEditingRevision({ ...params,
    encodedTrustedTemplate: " ".repeat(HTML_EDITING_LIMITS.manifestBytes + 1) }), /PAYLOAD_LIMIT/);
  assert.throws(() => prepareInitialHtmlEditingRevision({ ...params,
    sourceHtml: "é".repeat(HTML_EDITING_LIMITS.sourceBytes / 2 + 1) }), /PAYLOAD_LIMIT/);
});
