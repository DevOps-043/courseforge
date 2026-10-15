import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { createHtmlHistoricalReconstructionArchivePreparer } from "../composition-html-editing-reconstruction-archive.server";
import { createMultipageHtmlReconstructionFixture } from "./composition-html-editing-reconstruction-fixtures";
import { createHistoricalCandidatePreparationFixture } from "./composition-html-editing-historical-candidate-fixtures";
import { HtmlEditingTemplateCatalog } from "../html-editing/html-editing-template-catalog.server";
import { verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { HTML_HISTORICAL_PUBLICATION_POLICY } from "../composition-html-editing-historical-publication.contract";
import { createHtmlReconstructionSlideResourceAcquirer, createHtmlReconstructionCompositionResourceAcquirer } from "../composition-html-editing-reconstruction-resources.server";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { hashCompositionDocument } from "../composition-document.service";

type AcquiredResources = Awaited<ReturnType<Parameters<typeof createHtmlHistoricalReconstructionArchivePreparer>[0]["acquireResources"]>>;

async function fixture(withNative = false, withStyles = false) {
  const historical = await createHistoricalCandidatePreparationFixture("v1", withNative), reconstruction = createMultipageHtmlReconstructionFixture();
  if (withNative) {
    const document = reconstruction.document;
    document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
    const video = historical.original.compilation.document.clips.find(clip => clip.source.type === "PRODUCTION_ASSET");
    if (!video) throw new Error();
    document.clips.push({...structuredClone(video), id: "reconstructed-video", hfId: "reconstructed-video",
      trackId: document.clips[0].trackId, startSeconds: 0, durationSeconds: 4});
    for (const kind of ["TEXT", "CAPTION"] as const) {
      const {clip, track} = createCompositionNativeOverlay({document, id: `reconstructed-${kind.toLowerCase()}`, kind, playheadSeconds: 0});
      if (clip.source.type !== "NATIVE_TEXT" && clip.source.type !== "NATIVE_CAPTIONS") throw new Error();
      clip.source.style.fontAssetId = historical.font.id;
      clip.source.style.fontFamily = historical.font.family;
      if (track) document.tracks.push(track);
      document.clips.push(clip);
    }
    reconstruction.expectedDocumentHash = hashCompositionDocument(document);
  }
  const asset = historical.original.image;
  if (withStyles) {
    reconstruction.document.deckStyles = {css: "@layer deck { #title-0 {color:red;font-size:24px} }", fontUrls: []};
    reconstruction.expectedDocumentHash = hashCompositionDocument(reconstruction.document);
  }
  const resources: AcquiredResources = {grantedAssetIds: reconstruction.grantedAssetIds, imageSources: reconstruction.imageSources,
    imageAssets: [{productionAssetId: asset.id, checksum: asset.checksum, fileSizeBytes: asset.file_size_bytes,
      mimeType: "image/png", storageBucket: asset.storage_bucket, storagePath: asset.storage_path}], packagedFonts: []};
  const state = {resourceReads: 0, catalogReads: 0, beforeAcquire: undefined as ((count: number) => Promise<void> | void) | undefined};
  const configuration = {supabase: historical.configuration.supabase, storageOrigin: historical.configuration.supabaseUrl,
    fetchResource: historical.configuration.fetchImpl,
    readCatalog: () => {state.catalogReads++; return reconstruction.catalog;},
    acquireResources: async () => {state.resourceReads++; await state.beforeAcquire?.(state.resourceReads); return resources;}};
  const input = {request: historical.input.request,
    reconstruction: {target: reconstruction.target, document: reconstruction.document, expectedDocumentHash: reconstruction.expectedDocumentHash},
    renderProfile: historical.input.renderProfile, renderExecution: historical.input.renderExecution,
    animationRuntimeSha256: historical.input.animationRuntimeSha256};
  return {historical, reconstruction, resources, state, configuration, input};
}

test("contextual deck CSS is scoped identically in preview/render/archive without altering the approved source", async () => {
  const f = await fixture(false, true), original = JSON.stringify(f.input.reconstruction.document);
  const result = await createHtmlHistoricalReconstructionArchivePreparer(f.configuration)(f.input);
  const zip = await JSZip.loadAsync(result.prepared.archiveBytes);
  const preview = await zip.file("conformance-preview.html")!.async("string"), render = await zip.file("index.html")!.async("string");
  const selectorPattern = /:where\(\[data-courseforge-html-scope="[a-f0-9]{64}"\]\) :is\(#title-0\)/g;
  const previewSelectors = [...preview.matchAll(selectorPattern)].map(match => match[0]);
  assert.equal(previewSelectors.length, 3);
  assert.deepEqual([...render.matchAll(selectorPattern)].map(match => match[0]), previewSelectors);
  assert.match(preview, /@layer cf_[a-f0-9]{64}\.deck/);
  assert.doesNotMatch(preview, /@layer deck\s*\{/);
  assert.equal(JSON.stringify(f.input.reconstruction.document), original);
  assert.equal(result.candidate.document.deckStyles?.css, f.input.reconstruction.document.deckStyles?.css);
  assert.equal(result.candidate.initialRevisions[0].revision.sourceHtml, f.input.reconstruction.document.clips[0].source.type === "DECK_SLIDE"
    ? f.input.reconstruction.document.clips[0].source.html : undefined);
  const verified = verifyConformanceReferenceSource({previewHtml: preview,
    documentJson: await zip.file("composition-document.json")!.async("string"),
    metadata: JSON.parse(await zip.file("conformance-reference.json")!.async("string")),
    contractJson: await zip.file("conformance-contract.json")!.async("string"), fontManifest: [], htmlEditingBundle: result.prepared.bundle});
  assert.equal(verified.contract.schemaVersion, 4);
  assert.equal(f.historical.state.exactReads, 0);
});

test("new reconstructed multipage archive passes the complete shared reference verifier without reading or writing a new draft", async () => {
  const f = await fixture(), before = JSON.stringify(f.input.reconstruction.document);
  const result = await createHtmlHistoricalReconstructionArchivePreparer(f.configuration)(f.input);
  assert.equal(result.scope, "PREPARED_RECONSTRUCTED_ARCHIVE_NOT_APPROVED_CREATED_OR_PUBLISHED");
  assert.equal(result.candidate.document.htmlEditing?.items.length, 3);
  assert.equal(result.candidate.origin.projectHash, f.historical.identity.projectHash);
  assert.equal(result.prepared.projectHash, createHash("sha256").update(result.prepared.archiveBytes).digest("hex"));
  const zip = await JSZip.loadAsync(result.prepared.archiveBytes);
  const previewHtml = await zip.file("conformance-preview.html")!.async("string");
  const verified = verifyConformanceReferenceSource({previewHtml,
    documentJson: await zip.file("composition-document.json")!.async("string"),
    metadata: JSON.parse(await zip.file("conformance-reference.json")!.async("string")),
    contractJson: await zip.file("conformance-contract.json")!.async("string"),
    fontManifest: [], htmlEditingBundle: result.prepared.bundle});
  assert.equal(verified.contract.schemaVersion, 4);
  const renderHtml = await zip.file("index.html")!.async("string");
  for (const id of ["title-0", "title-1", "title-2"]) {
    assert.ok(renderHtml.includes(`id="${id}"`)); assert.ok(previewHtml.includes(`id="${id}"`));
  }
  assert.equal(zip.file(HTML_HISTORICAL_PUBLICATION_POLICY.provenancePath), null);
  assert.equal(result.prepared.assets.length, 1);
  assert.equal(f.state.resourceReads, 2); assert.equal(f.state.catalogReads, 2);
  assert.equal(f.historical.state.archiveReads, 4); assert.equal(f.historical.state.exactReads, 0);
  assert.equal(JSON.stringify(f.input.reconstruction.document), before);
  assert.doesNotMatch(result.prepared.bundle.encodedBundle, /grantedAssetIds|imageSources/);
});

test("concrete resource adapter uses current source-draft links and image identities during new archive preparation", async () => {
  const f = await fixture();
  const prepare = createHtmlHistoricalReconstructionArchivePreparer({...f.configuration,
    acquireResources: createHtmlReconstructionSlideResourceAcquirer(f.historical.configuration.supabase)});
  const result = await prepare(f.input);
  assert.deepEqual(result.candidate.usedAssetIds, [uuid]);
  assert.equal(f.historical.state.queries.filter(table => table === "production_assets").length, 2);
  f.historical.state.beforeArchiveRead = count => {if (count === 7) f.historical.state.revokeMedia = true;};
  await assert.rejects(prepare(f.input), /RECONSTRUCTION_ARCHIVE_UNAVAILABLE/);
});

test("reconstruction compiles native video, text and captions with currently authorized fonts in both targets", async () => {
  const f = await fixture(true);
  const prepare = createHtmlHistoricalReconstructionArchivePreparer({...f.configuration,
    acquireResources: createHtmlReconstructionCompositionResourceAcquirer(f.historical.configuration)});
  const result = await prepare(f.input);
  assert.equal(result.candidate.document.clips.length, 6);
  assert.equal(result.candidate.initialRevisions.length, 3);
  assert.equal(result.prepared.assets.length, 2);
  assert.equal(result.candidate.nativeResources.assets.length, 1);
  assert.equal(result.prepared.fontManifest.length, 1);
  assert.equal(f.historical.state.fontFetches, 1);
  assert.equal(f.historical.state.fontReads, 2);
  const zip = await JSZip.loadAsync(result.prepared.archiveBytes);
  const previewHtml = await zip.file("conformance-preview.html")!.async("string");
  const renderHtml = await zip.file("index.html")!.async("string");
  for (const id of ["reconstructed-video", "reconstructed-text", "reconstructed-caption"]) {
    assert.ok(previewHtml.includes(id)); assert.ok(renderHtml.includes(id));
  }
  verifyConformanceReferenceSource({previewHtml, documentJson: await zip.file("composition-document.json")!.async("string"),
    metadata: JSON.parse(await zip.file("conformance-reference.json")!.async("string")),
    contractJson: await zip.file("conformance-contract.json")!.async("string"),
    fontManifest: result.prepared.fontManifest, htmlEditingBundle: result.prepared.bundle});
  assert.deepEqual(await zip.file(`assets/fonts/${f.historical.font.checksum_sha256}.woff2`)!.async("nodebuffer"), f.historical.fontBytes);
});

test("native media unlink and font revocation, corrupt bytes or wrong MIME reject the whole reconstructed archive", async () => {
  for (const failure of ["media", "font", "bytes", "mime"] as const) {
    const f = await fixture(true);
    if (failure === "bytes") f.historical.state.corruptFont = true;
    if (failure === "mime") f.historical.state.wrongFontMime = true;
    f.historical.state.beforeArchiveRead = count => {
      if (count !== 3) return;
      if (failure === "media") {
        const video = f.reconstruction.document.clips.find(clip => clip.source.type === "PRODUCTION_ASSET");
        if (video?.source.type !== "PRODUCTION_ASSET") throw new Error();
        f.historical.state.unlinkedProductionIds.add(video.source.productionAssetId);
      }
      if (failure === "font") f.historical.state.revokeFont = true;
    };
    await assert.rejects(createHtmlHistoricalReconstructionArchivePreparer({...f.configuration,
      acquireResources: createHtmlReconstructionCompositionResourceAcquirer(f.historical.configuration)})(f.input), /RECONSTRUCTION_ARCHIVE_UNAVAILABLE/);
  }
});

test("resource adapter distinguishes resource references from text and rejects remote/active content before DB reads", async () => {
  const f = await fixture(), acquire = createHtmlReconstructionSlideResourceAcquirer(f.historical.configuration.supabase);
  const document = structuredClone(f.reconstruction.document);
  if (document.clips[0].source.type !== "DECK_SLIDE") throw new Error();
  document.clips[0].source.html += `<p>Not a resource: conformance-media/${other}</p>`;
  const result = await acquire({origin: f.reconstruction.origin, document, signal: new AbortController().signal});
  assert.deepEqual(result.grantedAssetIds, [uuid]);
  for (const fragment of ['<img src="https://example.com/image.png">', '<script>unsafe()</script>']) {
    const before = f.historical.state.queries.length;
    document.clips[0].source.html += fragment;
    await assert.rejects(acquire({origin: f.reconstruction.origin, document, signal: new AbortController().signal}), /RESOURCES_UNAVAILABLE/);
    assert.equal(f.historical.state.queries.length, before);
  }
});

test("revoked grants, replaced image identity or revoked installed template discard a reconstructed archive", async () => {
  for (const change of ["grants", "identity", "catalog"] as const) {
    const f = await fixture();
    f.state.beforeAcquire = count => {
      if (count !== 2) return;
      if (change === "grants") f.resources.grantedAssetIds = [];
      if (change === "identity") f.resources.imageAssets[0].checksum = "f".repeat(64);
      if (change === "catalog") f.reconstruction.catalog = new HtmlEditingTemplateCatalog(JSON.stringify({
        format: "courseforge-html-editable-catalog-v1", organizationId: uuid, templates: []}));
    };
    await assert.rejects(createHtmlHistoricalReconstructionArchivePreparer(f.configuration)(f.input), /^Error: HTML_RECONSTRUCTION_ARCHIVE_UNAVAILABLE$/);
    assert.equal(f.state.resourceReads, 2);
  }
});

test("original authority drift, extra or missing image records cannot issue reconstructed bytes", async () => {
  for (const change of ["origin", "missing", "extra"] as const) {
    const f = await fixture();
    if (change === "origin") f.historical.state.beforeArchiveRead = count => {
      if (count === 3) f.historical.identity.documentHash = "f".repeat(64);
    };
    if (change === "missing") f.resources.imageAssets = [];
    if (change === "extra") f.resources.imageAssets.push({...f.resources.imageAssets[0], productionAssetId: other});
    await assert.rejects(createHtmlHistoricalReconstructionArchivePreparer(f.configuration)(f.input), /RECONSTRUCTION_ARCHIVE_UNAVAILABLE/);
  }
});

test("new archive workflow captures input and resources across awaits instead of borrowing mutable host references", async () => {
  const f = await fixture(), originalHash = f.input.reconstruction.expectedDocumentHash;
  f.historical.state.beforeArchiveRead = count => {
    if (count === 1) {
      f.input.reconstruction.target.documentId = uuid;
      f.input.reconstruction.document.clips = [];
      f.input.animationRuntimeSha256 = "f".repeat(64);
    }
  };
  f.state.beforeAcquire = count => {
    if (count === 2) f.resources.grantedAssetIds = [...f.resources.grantedAssetIds].reverse();
  };
  const result = await createHtmlHistoricalReconstructionArchivePreparer(f.configuration)(f.input);
  assert.equal(result.candidate.target.documentId, other);
  assert.equal(result.candidate.initialRevisions[0].revision.manifest.binding.documentSha256, originalHash);
  assert.equal(result.candidate.document.clips.length, 3);
});

test("cancellation and admission are bounded, release after failure and perform no work for pre-aborted inputs", async () => {
  const f = await fixture(), controller = new AbortController();
  controller.abort();
  const prepare = createHtmlHistoricalReconstructionArchivePreparer(f.configuration);
  await assert.rejects(prepare({...f.input, signal: controller.signal}));
  assert.equal(f.historical.state.archiveReads, 0);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;}), ready = new Promise<void>(resolve => {entered = resolve;});
  f.state.beforeAcquire = async count => {if (count === 1) {entered(); await gate;}};
  const pending = prepare(f.input); await ready;
  try {await assert.rejects(prepare(f.input), /ARCHIVE_BUSY/);} finally {release();}
  assert.equal((await pending).candidate.document.clips.length, 3);
  f.state.beforeAcquire = undefined;
  assert.equal((await prepare(f.input)).candidate.document.clips.length, 3);
});
