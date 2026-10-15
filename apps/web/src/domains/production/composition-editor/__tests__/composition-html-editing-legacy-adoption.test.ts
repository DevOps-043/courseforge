import assert from "node:assert/strict";
import test from "node:test";
import { createHtmlEditingRevisionFixture } from "./composition-html-editing-test-fixtures";
import { prepareHtmlEditingLegacyAdoption } from "../composition-html-editing-legacy-adoption.server";
import { prepareLegacyHtmlEditingPilot } from "../html-editing/html-editing-legacy-instrumentation.server";
import { HtmlEditingTemplateCatalog } from "../html-editing/html-editing-template-catalog.server";
import { hashCompositionDocument } from "../composition-document.service";

function fixture() {
  const input = createHtmlEditingRevisionFixture();
  const binding = input.authority.authoritativeBinding;
  const anchor = { organizationId: binding.organizationId, documentId: binding.documentId,
    revisionId: binding.revisionId, clipId: binding.clipId };
  const pilot = prepareLegacyHtmlEditingPilot({ sourceHtml: input.current.revision.sourceHtml,
    authoritativeAnchor: { ...anchor, documentSha256: binding.documentSha256 }, templateId: "legacy_intro", templateVersion: 1,
    grantedAssetIds: input.authority.grantedAssetIds, imageSources: input.authority.imageSources });
  const catalog = new HtmlEditingTemplateCatalog(JSON.stringify({ format: "courseforge-html-editable-catalog-v1",
    organizationId: anchor.organizationId, templates: [pilot.candidate.template] }));
  const request = { document: input.document, expectedDocumentHash: hashCompositionDocument(input.document), anchor,
    templateId: "legacy_intro", templateVersion: 1, encodedPilot: JSON.stringify(pilot), expectedProvenanceSha256: pilot.provenanceSha256,
    catalog, grantedAssetIds: input.authority.grantedAssetIds, imageSources: input.authority.imageSources };
  return { input, pilot, request };
}

test("adoption prepares one immutable native proposal with exact initial HTML reference", () => {
  const { request, pilot } = fixture(), before = JSON.stringify(request.document);
  const result = prepareHtmlEditingLegacyAdoption(request);
  assert.equal(result.scope, "PREPARED_LEGACY_ADOPTION_NOT_COMMITTED");
  assert.equal(JSON.stringify(request.document), before);
  assert.equal(result.expectedDocumentHash, request.expectedDocumentHash);
  assert.equal(result.documentHash, hashCompositionDocument(result.document));
  assert.notEqual(result.documentHash, request.expectedDocumentHash);
  assert.equal(result.initialRevision.sourceHtml, pilot.candidate.sourceHtml);
  assert.equal(result.initialRevision.manifest.binding.documentSha256, request.expectedDocumentHash);
  const target = result.document.clips.find(clip => clip.id === request.anchor.clipId)!;
  assert.equal(target.source.type, "DECK_SLIDE");
  assert.ok(target.source.type === "DECK_SLIDE"); assert.equal(target.source.html, pilot.candidate.sourceHtml);
  assert.equal(result.document.htmlEditing?.items[0]?.revisionSha256, result.initialRevisionSha256);
  const original = request.document.clips.find(clip => clip.id === request.anchor.clipId)!;
  assert.deepEqual({ ...target, source: original.source }, original);
  assert.deepEqual(result.document.clips.filter(clip => clip.id !== target.id), request.document.clips.filter(clip => clip.id !== target.id));
  assert.deepEqual(result.document.canvas, request.document.canvas);
  assert.deepEqual(result.requiredReviews, pilot.requiredReviews);
  assert.deepEqual(prepareHtmlEditingLegacyAdoption(request), result);
});

test("stale base, missing clip and an existing editable reference cannot become adoption", () => {
  const { request } = fixture();
  assert.throws(() => prepareHtmlEditingLegacyAdoption({ ...request, expectedDocumentHash: "f".repeat(64) }), /BASE_CONFLICT/);
  assert.throws(() => prepareHtmlEditingLegacyAdoption({ ...request, anchor: { ...request.anchor, clipId: "missing" } }), /CLIP_UNAVAILABLE/);
  const proposed = prepareHtmlEditingLegacyAdoption(request);
  assert.throws(() => prepareHtmlEditingLegacyAdoption({ ...request, document: proposed.document,
    expectedDocumentHash: proposed.documentHash }), /ALREADY_EDITABLE/);
});

test("operator catalogue remains independent of the package and rejects changed declarations", () => {
  const { request, pilot } = fixture();
  const catalog = (templates: unknown[], organizationId = request.anchor.organizationId) => new HtmlEditingTemplateCatalog(JSON.stringify({
    format: "courseforge-html-editable-catalog-v1", organizationId, templates }));
  assert.throws(() => prepareHtmlEditingLegacyAdoption({ ...request, catalog: catalog([]) }), /TEMPLATE_UNAVAILABLE/);
  assert.throws(() => prepareHtmlEditingLegacyAdoption({ ...request,
    catalog: catalog([pilot.candidate.template], "22222222-2222-4222-8222-222222222222") }), /TEMPLATE_UNAVAILABLE/);
  const altered = { ...pilot.candidate.template, elements: pilot.candidate.template.elements.map(element => ({ ...element, label: "Changed" })) };
  assert.throws(() => prepareHtmlEditingLegacyAdoption({ ...request, catalog: catalog([altered]) }), /CANDIDATE_UNAVAILABLE/);
});

test("revoked assets and foreign provenance reject before returning a writable proposal", () => {
  const { request } = fixture();
  assert.throws(() => prepareHtmlEditingLegacyAdoption({ ...request, grantedAssetIds: [] }), /INVALID_SOURCE/);
  assert.throws(() => prepareHtmlEditingLegacyAdoption({ ...request, expectedProvenanceSha256: "f".repeat(64) }), /INVALID_SOURCE/);
});
