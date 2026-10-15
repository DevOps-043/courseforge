import assert from "node:assert/strict";
import test from "node:test";
import { prepareHtmlHistoricalReconstruction, readHtmlHistoricalReconstructionOrigin } from "../composition-html-editing-historical-reconstruction.server";
import { HtmlEditingTemplateCatalog } from "../html-editing/html-editing-template-catalog.server";
import { hashCompositionDocument } from "../composition-document.service";
import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { createHistoricalCandidatePreparationFixture } from "./composition-html-editing-historical-candidate-fixtures";

import { createHtmlReconstructionFixture as fixture, createMultipageHtmlReconstructionFixture as multipageFixture } from "./composition-html-editing-reconstruction-fixtures";

test("reconstruction origin is independently authorized without compiling historical native or inheriting grants", async () => {
  const f = await createHistoricalCandidatePreparationFixture(); f.state.revokeImages = true;
  const origin = await readHtmlHistoricalReconstructionOrigin({request: f.input.request, supabase: f.configuration.supabase,
    storageOrigin: f.configuration.supabaseUrl, fetchResource: f.configuration.fetchImpl});
  assert.equal(origin.projectHash, f.identity.projectHash); assert.equal(f.state.exactReads, 0);
  assert.equal(f.state.archiveReads, 2); assert.equal("grantedAssetIds" in origin || "sourceHtml" in origin, false);
});

test("new reconstructed candidate uses installed current template and separate scope without modifying inputs", () => {
  const f = fixture(), before = JSON.stringify([f.document, f.origin]);
  const candidate = prepareHtmlHistoricalReconstruction(f);
  assert.equal(candidate.scope, "PREPARED_NEW_CONTENT_NOT_HISTORICAL_REPUBLICATION_OR_APPROVAL");
  assert.equal(candidate.initialRevisions[0].revision.manifest.binding.documentId, other);
  assert.equal(candidate.initialRevisions[0].revision.manifest.binding.revisionId, other);
  assert.equal(candidate.document.htmlEditing?.items.length, 1);
  assert.equal(candidate.documentHash, hashCompositionDocument(candidate.document));
  assert.equal(candidate.initialRevisions[0].revision.version, 1); assert.notEqual(candidate.documentHash, f.origin.documentHash);
  assert.deepEqual(candidate.usedAssetIds, [uuid]);
  assert.equal(JSON.stringify([f.document, f.origin]), before);
  assert.equal("approved" in candidate || "activeRevisionId" in candidate, false);
});

test("multipage reconstruction binds every installed slide to the new base and final hash deterministically", () => {
  const f = multipageFixture(), before = JSON.stringify(f.document);
  const candidate = prepareHtmlHistoricalReconstruction(f);
  assert.equal(candidate.initialRevisions.length, 3);
  assert.deepEqual(candidate.document.htmlEditing?.items.map(item => item.clipId), ["page-0", "page-1", "page-2"]);
  for (const initial of candidate.initialRevisions) {
    assert.equal(initial.revision.version, 1);
    assert.equal(initial.revision.manifest.binding.documentSha256, f.expectedDocumentHash);
    assert.equal(initial.revision.manifest.binding.documentId, other);
    assert.equal(initial.revision.manifest.binding.clipId, initial.clipId);
  }
  assert.deepEqual(candidate.usedAssetIds, [uuid]);
  assert.equal(candidate.documentHash, hashCompositionDocument(candidate.document));
  f.target.slides.reverse();
  assert.equal(prepareHtmlHistoricalReconstruction(f).documentHash, candidate.documentHash);
  assert.equal(JSON.stringify(f.document), before);
});

test("multipage reconstruction rejects missing, extra, duplicate, uninstalled or wrongly pinned slide declarations", () => {
  for (const failure of ["missing", "extra", "duplicate", "unknown", "version", "source", "native"] as const) {
    const f = multipageFixture();
    if (failure === "missing") f.target.slides.pop();
    if (failure === "extra") f.target.slides.push({...f.target.slides[0], clipId: "missing-clip"});
    if (failure === "duplicate") f.target.slides[1] = {...f.target.slides[0]};
    if (failure === "unknown") f.target.slides[1].templateId = "not-installed";
    if (failure === "version") f.target.slides[1].templateVersion = 2;
    if (failure === "source" && f.document.clips[1].source.type === "DECK_SLIDE") f.document.clips[1].source.html += "<p>changed</p>";
    if (failure === "native") f.document.clips[1] = createHtmlEditingRevisionFixture().document.clips[1];
    f.expectedDocumentHash = hashCompositionDocument(f.document);
    assert.throws(() => prepareHtmlHistoricalReconstruction(f), /RECONSTRUCTION_UNAVAILABLE/, failure);
  }
});

test("individually admitted pages cannot reconstruct a shared DOM with colliding IDs", () => {
  assert.throws(() => prepareHtmlHistoricalReconstruction(multipageFixture(true)), /RECONSTRUCTION_UNAVAILABLE/);
});

test("an installed source pin does not bypass current compiler admission on any page", () => {
  assert.throws(() => prepareHtmlHistoricalReconstruction(multipageFixture(false, true)), /RECONSTRUCTION_UNAVAILABLE/);
});

test("multipage candidates require exact local image aliases and current grants for every page", () => {
  for (const failure of ["remote", "wrong-alias", "revoked"] as const) {
    const f = multipageFixture();
    if (failure === "remote") f.imageSources.set(uuid, "https://example.com/image.png");
    if (failure === "wrong-alias") f.imageSources.set(uuid, `conformance-media/${other}`);
    if (failure === "revoked") f.grantedAssetIds = [];
    assert.throws(() => prepareHtmlHistoricalReconstruction(f), /RECONSTRUCTION_UNAVAILABLE/, failure);
  }
});

test("reconstruction rejects original scope, stale base, pointers and unchecked neighbouring content", () => {
  for (const failure of ["composition", "document", "revision", "hash", "neighbour", "styles", "pointers"] as const) {
    const f = fixture();
    if (failure === "composition") f.target.compositionId = uuid;
    if (failure === "document") f.target.documentId = uuid;
    if (failure === "revision") f.target.revisionId = uuid;
    if (failure === "hash") f.expectedDocumentHash = "f".repeat(64);
    if (failure === "neighbour") f.document.clips.push({...f.document.clips[0], id: "unchecked-neighbour", hfId: "unchecked-neighbour"});
    if (failure === "styles") f.document.deckStyles = {appearance: "light", sourceWidth: 1920, sourceHeight: 1080, css: "body{color:red}", fontUrls: []};
    if (failure === "pointers") f.document = prepareHtmlHistoricalReconstruction(f).document;
    if (["neighbour", "styles", "pointers"].includes(failure)) f.expectedDocumentHash = hashCompositionDocument(f.document);
    assert.throws(() => prepareHtmlHistoricalReconstruction(f), /^Error: HTML_HISTORICAL_RECONSTRUCTION_UNAVAILABLE$/);
  }
});

test("changed/uninstalled source, foreign catalog and missing current grants cannot become reconstructed candidates", () => {
  for (const failure of ["source", "catalog", "grants"] as const) {
    const f = fixture();
    if (failure === "source" && f.document.clips[0].source.type === "DECK_SLIDE") f.document.clips[0].source.html += "<script>unsafe()</script>";
    if (failure === "catalog") f.catalog = new HtmlEditingTemplateCatalog(JSON.stringify({format: "courseforge-html-editable-catalog-v1", organizationId: other, templates: []}));
    if (failure === "grants") f.grantedAssetIds = [];
    f.expectedDocumentHash = hashCompositionDocument(f.document);
    assert.throws(() => prepareHtmlHistoricalReconstruction(f), /RECONSTRUCTION_UNAVAILABLE/);
  }
});

test("native video requires an exact resource set and MIME matching its declared kind", () => {
  for (const failure of ["none", "missing", "extra", "duplicate", "mime"] as const) {
    const f = fixture(), native = createHtmlEditingRevisionFixture().document.clips[1];
    if (native.source.type !== "PRODUCTION_ASSET") throw new Error();
    f.document.clips.push(native);
    f.expectedDocumentHash = hashCompositionDocument(f.document);
    const asset = {productionAssetId: native.source.productionAssetId, checksum: "a".repeat(64), fileSizeBytes: 1024,
      mimeType: "video/mp4", storageBucket: "production-assets", storagePath: "reconstruction/native.mp4"};
    const resources = {assets: [asset], fontManifest: []};
    if (failure === "missing") resources.assets = [];
    if (failure === "extra") resources.assets.push({...asset, productionAssetId: other});
    if (failure === "duplicate") resources.assets.push({...asset});
    if (failure === "mime") resources.assets[0].mimeType = "image/png";
    if (failure === "none") {
      const candidate = prepareHtmlHistoricalReconstruction({...f, nativeResources: resources});
      assert.equal(candidate.document.clips.length, 2);
      assert.equal(candidate.initialRevisions.length, 1);
      assert.deepEqual(candidate.usedAssetIds, [uuid, asset.productionAssetId].sort());
    } else assert.throws(() => prepareHtmlHistoricalReconstruction({...f, nativeResources: resources}), /RECONSTRUCTION_UNAVAILABLE/);
  }
});

test("native images, audio, branding and sound effects keep explicit typed resource identities", () => {
  const f = fixture(), base = createHtmlEditingRevisionFixture().document.clips[1];
  const sources = [
    {kind: "IMAGE" as const, source: {type: "PRODUCTION_ASSET" as const, productionAssetId: other}, mimeType: "image/png", id: other},
    {kind: "AUDIO" as const, source: {type: "PRODUCTION_ASSET" as const, productionAssetId: "33333333-3333-4333-8333-333333333333"}, mimeType: "audio/mpeg", id: "33333333-3333-4333-8333-333333333333"},
    {kind: "VIDEO" as const, source: {type: "ASSEMBLY_BRAND_ASSET" as const, assemblyBrandAssetId: "44444444-4444-4444-8444-444444444444", placement: "INTRO" as const}, mimeType: "video/mp4", id: "44444444-4444-4444-8444-444444444444"},
    {kind: "AUDIO" as const, source: {type: "SOUND_EFFECT_ASSET" as const, soundEffectAssetId: "55555555-5555-4555-8555-555555555555"}, mimeType: "audio/mpeg", id: "55555555-5555-4555-8555-555555555555"},
  ];
  f.document.tracks.push({id: "reconstructed-audio", kind: "AUDIO", semanticRole: "SFX", label: "Audio", locked: false, order: 5});
  f.document.clips.push(...sources.map((item, index) => ({...base, id: `native-${index}`, hfId: `native-${index}`,
    kind: item.kind, source: item.source, trackId: item.kind === "AUDIO" ? "reconstructed-audio" : base.trackId})));
  f.expectedDocumentHash = hashCompositionDocument(f.document);
  const assets = sources.map(item => ({productionAssetId: item.id, checksum: "a".repeat(64), fileSizeBytes: 1024,
    mimeType: item.mimeType, storageBucket: "production-assets", storagePath: `reconstruction/${item.id}`}));
  const candidate = prepareHtmlHistoricalReconstruction({...f, nativeResources: {assets, fontManifest: []}});
  assert.equal(candidate.document.clips.length, 5);
  assert.equal(candidate.nativeResources.assets.length, 4);
  assert.equal(candidate.initialRevisions.length, 1);
});

test("the same UUID cannot stand for production media and branding even if its byte pins match", () => {
  const f = fixture(), base = createHtmlEditingRevisionFixture().document.clips[1];
  f.document.clips.push({...base, id: "production", hfId: "production", source: {type: "PRODUCTION_ASSET", productionAssetId: other}},
    {...base, id: "branding", hfId: "branding", source: {type: "ASSEMBLY_BRAND_ASSET", assemblyBrandAssetId: other, placement: "INTRO"}});
  f.expectedDocumentHash = hashCompositionDocument(f.document);
  assert.throws(() => prepareHtmlHistoricalReconstruction({...f, nativeResources: {assets: [{productionAssetId: other,
    checksum: "a".repeat(64), fileSizeBytes: 1024, mimeType: "video/mp4", storageBucket: "production-assets", storagePath: "shared.mp4"}],
    fontManifest: []}}), /RECONSTRUCTION_UNAVAILABLE/);
});
