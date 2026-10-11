import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatedGoogleDeckFontFixture } from "../../slides/__tests__/generated-google-deck-font-fixture";
import { readGeneratedCourseDeckEditorial } from "../../slides/generation/course-deck-editorial-reader.server";
import { assertCourseDeckEditorialFontReady } from "../../slides/generation/course-deck-editorial-fonts.server";
import { storeGeneratedCourseDeckEditorial } from "../../slides/generation/course-deck-editorial-preparation.server";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { generatedDeckInitialSource, instantiateGeneratedDeckDocument } from "../composition-generated-deck-import.server";
import { generatedDeckBootstrapCatalog } from "../composition-generated-deck-catalog.server";
import { readReferencedCompositionFonts, compositionFontManifestBinding, compiledManifestFont } from "../composition-font-assets.service";
import { assertDocumentConformanceFontBindings, assertCompiledConformanceFontBindings, conformanceFontManifestHash, conformanceFontPath } from "../composition-conformance-font-bindings";
import { compositionFontReferenceDetails } from "../composition-font-references";
import { hashCompositionDocument } from "../composition-document-hash";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { createHtmlSnapshotFontAcquirer, revalidateHtmlSnapshotFontAuthority } from "../composition-html-editing-snapshot-fonts.server";
import { prepareCompositionHtmlEditingPreviewFonts } from "../composition-html-editing-preview-fonts.server";
import { assertHtmlReconstructionNativeResources } from "../composition-html-editing-reconstruction-native-resources.server";
import { buildCompositionHtmlEditingPreviewInventory } from "../composition-html-editing-preview-inventory.server";
import { prepareInitialHtmlEditingRevision } from "../html-editing/html-editing-bootstrap.server";
import { prepareHtmlEditingRevisionCommand } from "../html-editing/html-editing-revision.server";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { snapshotCompositionDocument } from "../composition-snapshot.service";
import { getHyperframesRenderProfile } from "../../hyperframes/hyperframes-render-profiles";
import { assertPublishedHtmlPreviewPortfolio } from "../composition-html-editing-published-preview.server";
import { assembleAcquiredCompositionHtmlEditingSnapshotArchive } from "../composition-html-editing-snapshot-archive.server";
import { freezeCompositionHtmlEditingSnapshot } from "../composition-html-editing-snapshot-bundle.server";
import { createPreparedHtmlArchiveFixture } from "./composition-html-editing-snapshot-archive-fixtures";

async function scenario() {
  const f = generatedGoogleDeckFontFixture();
  const verified = (await readGeneratedCourseDeckEditorial({ ...f, supabase: f.client }))!;
  const document = instantiateGeneratedDeckDocument(createInitialCompositionDocument({ animatedDeck: generatedDeckInitialSource(verified),
    assets: [], plan: { title: "Google fonts", subtitle: "Pinned", accentColor: "#00aabb", durationSeconds: 20 } }), verified);
  const records = await readReferencedCompositionFonts({ document, organizationId: f.organizationId, supabase: f.client });
  const manifest = records.map(compositionFontManifestBinding);
  const compiled = new Map(manifest.map(font => [font.fontAssetId, compiledManifestFont(font, conformanceFontPath(font))]));
  return { ...f, verified, document, records, manifest, compiled };
}

test("a generated Google deck imports every pinned face and compiles descriptors in both native targets", async () => {
  const f = await scenario();
  assert.equal(f.records.length, 2); assert.equal(compositionFontReferenceDetails(f.document).size, 2);
  assert.equal(f.verified.artifact.fontRequirements[0].googleNativePin?.bundleId, f.pin.bundleId);
  assertCompiledConformanceFontBindings(f.document, f.manifest, f.compiled);
  for (const target of Object.values(COMPOSITION_COMPILATION_TARGETS)) {
    const html = await compileCompositionPreview({ document: f.document, assetUrls: new Map(), target, fontAssets: f.compiled });
    assert.match(html, /font-weight: 400;/); assert.match(html, /font-weight: 700;/); assert.match(html, /unicode-range: U\+0000-00FF;/);
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  }
  assert.ok(f.records.every(record => record.googleFace?.fontId === f.fontId && record.id !== f.fontId));
});

function editFirstSlide(f: Awaited<ReturnType<typeof scenario>>) {
  const clip = f.document.clips[0];
  if (clip.source.type !== "DECK_SLIDE") throw new Error("expected generated slide");
  const template = f.verified.instance(clip.id, clip.source.slideIndex).template;
  const current = prepareInitialHtmlEditingRevision({ sourceHtml: clip.source.html, encodedTrustedTemplate: JSON.stringify(template),
    authoritativeAnchor: { organizationId: f.organizationId, documentId: f.draftId, revisionId: f.compositionId,
      clipId: clip.id, documentSha256: hashCompositionDocument(f.document) }, grantedAssetIds: [], imageSources: new Map() });
  const authority = { authoritativeBinding: current.revision.manifest.binding, grantedAssetIds: [], imageSources: new Map<string, string>() };
  const field = template.elements.find(element => element.kind === "TEXT")!;
  const next = prepareHtmlEditingRevisionCommand({ ...authority, encodedRevision: JSON.stringify(current.revision),
    expected: { version: 1, sha256: current.sha256 }, encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1",
      binding: authority.authoritativeBinding, overrides: [{ operation: "SET_TEXT", elementId: field.elementId, value: "Edición con variantes Google" }] }) }).next;
  const bound = bindHtmlEditingRevisionToComposition({ ...authority, document: f.document, revision: next.revision, revisionSha256: next.sha256 });
  return { clip, template, bound, authority, next };
}

test("first real field save preserves all pinned Google dependencies and catalog cannot adopt another bundle", async () => {
  const f = await scenario(), { clip, template, bound, authority, next } = editFirstSlide(f);
  if (clip.source.type !== "DECK_SLIDE") throw new Error("expected generated slide");
  const scope = { organizationId: f.organizationId, documentId: f.draftId, actorId: f.organizationId,
    expectedDocumentHash: hashCompositionDocument(f.document), clipId: clip.id, slideIndex: clip.source.slideIndex,
    sourceHtml: clip.source.html, fontBindings: clip.source.fontBindings };
  assert.equal((await generatedDeckBootstrapCatalog(f.client, "")(scope)).listSourceMatches({ organizationId: f.organizationId, sourceSha256: template.sourceSha256 }).length, 1);
  assert.deepEqual(bound.document.clips.map(candidate => candidate.source), f.document.clips.map(candidate => candidate.source));
  for (const target of Object.values(COMPOSITION_COMPILATION_TARGETS)) {
    const html = await compileCompositionPreview({ document: bound.document, documentHash: bound.documentHash, assetUrls: new Map(), target, fontAssets: f.compiled,
      htmlEditingCompilation: { organizationId: f.organizationId, documentId: f.draftId, documentHash: bound.documentHash,
        revisions: [{ ...authority, encodedRevision: JSON.stringify(next.revision) }] } });
    assert.match(html, /Edición con variantes Google/); assert.match(html, /font-weight: 700;/);
  }
  f.nativeState.faces[0].pin = { ...f.pin, bundleId: f.compositionId };
  await assert.rejects(generatedDeckBootstrapCatalog(f.client, "")(scope), /FONT_BINDING_REQUIRED/);
});

test("Google preview, frozen inventory, snapshot acquisition and reconstruction retain exact descriptors and bytes", async () => {
  const f = await scenario();
  const fetchResource = (async (url: string | URL | Request) => {
    const entry = f.files.find(file => String(url).includes(file.file.checksumSha256));
    assert.ok(entry); return new Response(entry.bytes, { headers: { "content-type": "font/woff2", "content-length": String(entry.bytes.length) } });
  }) as typeof fetch;
  const preview = await prepareCompositionHtmlEditingPreviewFonts({ document: f.document, organizationId: f.organizationId,
    supabase: f.client, storageOrigin: "https://storage.example.test", fetchResource });
  assert.deepEqual(preview.fonts, f.compiled);
  const inventory = buildCompositionHtmlEditingPreviewInventory({ document: f.document, htmlImages: [], nativeAssets: [],
    nativeDeckPublicUrls: new Map(), fonts: f.records });
  assert.deepEqual(inventory.fonts, f.compiled); assert.equal(inventory.entries.length, 2);
  const acquire = createHtmlSnapshotFontAcquirer({ supabase: f.client, supabaseUrl: "https://storage.example.test", serviceRoleKey: "test-only", fetchImpl: fetchResource });
  const packaged = await acquire({ document: f.document, organizationId: f.organizationId });
  assert.equal(conformanceFontManifestHash(packaged.map(font => font.binding)), conformanceFontManifestHash(f.manifest));
  assert.deepEqual(assertHtmlReconstructionNativeResources(f.document, { assets: [], fontManifest: f.manifest }).fontManifest, f.manifest);
  await revalidateHtmlSnapshotFontAuthority(f.client, { organizationId: f.organizationId, manifest: f.manifest, signal: new AbortController().signal });
  f.nativeState.unavailable = true;
  await assert.rejects(acquire({ document: f.document, organizationId: f.organizationId }), /FONTS_UNAVAILABLE/);
});

test("same-bundle Google variants do not weaken family ambiguity, pin or compiled-descriptor checks", async () => {
  const f = await scenario();
  const changed = structuredClone(f.manifest); changed[1].googleFace!.weight = { minimum: 400, maximum: 400 };
  assert.throws(() => assertDocumentConformanceFontBindings(f.document, changed), /FAMILY_AMBIGUOUS/);
  const different = structuredClone(f.manifest); different[1].googleFace!.bundleId = f.compositionId;
  assert.throws(() => assertDocumentConformanceFontBindings(f.document, different), /FAMILY_AMBIGUOUS/);
  const stripped = structuredClone(f.manifest);
  stripped.forEach(font => { delete font.googleFace; });
  assert.throws(() => assertDocumentConformanceFontBindings(f.document, stripped));
  const compiled = new Map(f.compiled); const first = compiled.get(f.manifest[0].fontAssetId)!;
  compiled.set(first.assetId, { ...first, googleFace: { ...first.googleFace!, style: "italic" } });
  assert.throws(() => assertCompiledConformanceFontBindings(f.document, f.manifest, compiled), /COMPILED_BINDING_MISMATCH/);
  assert.notEqual(conformanceFontManifestHash(f.manifest), conformanceFontManifestHash(changed));
});

test("preparation rejects an unpinned or revoked Google choice, without provider acquisition", async () => {
  const f = generatedGoogleDeckFontFixture();
  const input = { font: f.deck.designSystem.font, organizationId: f.organizationId, supabase: f.client };
  await assertCourseDeckEditorialFontReady(input);
  const unpinned = { ...f.deck.designSystem.font!, googleNativePin: undefined };
  await assert.rejects(assertCourseDeckEditorialFontReady({ ...input, font: unpinned }), /FONT_BINDING_REQUIRED/);
  f.nativeState.unavailable = true;
  await assert.rejects(assertCourseDeckEditorialFontReady(input));
});

test("initial snapshot ZIP freezes every actual Google font file and its portable admission without activating", async () => {
  const f = await scenario();
  f.document.canvas.durationMode = "USER_EDITED";
  const documentHash = hashCompositionDocument(f.document);
  let uploadedArchive: Uint8Array | undefined;
  let registered: Record<string, unknown> | undefined;
  const client = {
    rpc: f.client.rpc.bind(f.client),
    from(table: string) {
      let inserted = false;
      const result = () => ({ error: null, data: table === "video_compositions" ? { id: f.compositionId, status: "DRAFT" }
        : table === "video_composition_drafts" ? { id: f.draftId, composition_id: f.compositionId, state: "ACTIVE" }
          : table === "video_composition_draft_documents" ? { document: f.document, document_hash: documentHash, version: 1 }
            : table === "profiles" ? { id: f.organizationId }
              : table === "video_composition_revisions" ? inserted ? { id: f.compositionId, revision_number: 1 } : null : [] });
      const query = { select: () => query, eq: () => query, in: () => query, contains: () => query, is: () => query,
        order: () => query, limit: () => query,
        insert: (row: Record<string, unknown>) => { inserted = true; registered = row; return query; },
        update: () => { throw new Error("Initial snapshot must not activate before transactional validation"); },
        maybeSingle: async () => result(), single: async () => result(),
        then: (accept: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(accept(result())) };
      return query;
    },
    storage: { from(bucket: string) { return {
      async upload(_path: string, archive: Uint8Array) { assert.equal(bucket, "production-assets"); uploadedArchive = archive; return { error: null }; },
      async download(path: string) {
        assert.equal(bucket, "organization-fonts");
        const font = f.files.find(file => path.includes(file.file.checksumSha256));
        assert.ok(font); return { data: new Blob([font.bytes]), error: null };
      },
    }; } },
  } as unknown as SupabaseClient;
  const snapshot = await snapshotCompositionDocument({ compositionId: f.compositionId, draftId: f.draftId,
    organizationId: f.organizationId, userId: f.organizationId, supabase: client, renderProfile: getHyperframesRenderProfile("balanced"),
    initialEditorialAnchor: { expectedDocumentHash: documentHash } });
  assert.equal(snapshot.documentHash, documentHash); assert.ok(uploadedArchive); assert.ok(registered);
  const archive = await JSZip.loadAsync(uploadedArchive);
  assert.deepEqual(JSON.parse(await archive.file("composition-document.json")!.async("string")), f.document);
  assert.deepEqual(JSON.parse(await archive.file("font-manifest.json")!.async("string")), f.manifest);
  const html = await archive.file("index.html")!.async("string");
  for (const font of f.manifest) {
    assert.deepEqual(await archive.file(conformanceFontPath(font))!.async("uint8array"), f.files.find(file => file.file.checksumSha256 === font.checksumSha256)!.bytes);
    assert.ok(html.includes(conformanceFontPath(font)));
  }
  assert.match(html, /font-weight: 400;/); assert.match(html, /font-weight: 700;/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test("published preview rejects descriptor or admission drift even when the font bytes are identical", async () => {
  const f = await scenario();
  const inventory = buildCompositionHtmlEditingPreviewInventory({ document: f.document, htmlImages: [], nativeAssets: [],
    nativeDeckPublicUrls: new Map(), fonts: f.records });
  const binding = { expectedFrozenBundleSha256: "a".repeat(64), mediaBindings: [], fontManifest: f.manifest };
  assertPublishedHtmlPreviewPortfolio(binding, inventory);
  for (const change of ["weight", "style", "unicodeRange", "admissionId"] as const) {
    const changed = structuredClone(binding);
    const face = changed.fontManifest[0].googleFace!;
    if (change === "weight") face.weight.minimum = 200;
    else if (change === "style") face.style = "italic";
    else if (change === "unicodeRange") face.unicodeRange = null;
    else face.admissionId = f.compositionId;
    assert.throws(() => assertPublishedHtmlPreviewPortfolio(changed, inventory), /PUBLISHED_PREVIEW_UNAVAILABLE/);
  }
});

test("new generation persists its exact chosen Google pin and refuses to upload after revocation", async () => {
  const f = generatedGoogleDeckFontFixture();
  const uploads: Buffer[] = [];
  const client = Object.assign({}, f.client, { storage: { from: () => ({ async upload(_path: string, bytes: Buffer) {
    uploads.push(bytes); return { error: null };
  } }) } }) as unknown as SupabaseClient;
  const input = { deck: f.deck, componentId: f.componentId, organizationId: f.organizationId, supabase: client };
  const saved = await storeGeneratedCourseDeckEditorial(input);
  assert.deepEqual(JSON.parse(uploads[0].toString("utf8")).fontRequirements[0].googleNativePin, f.pin);
  assert.equal(saved.source_spec_sha256, f.artifact.sourceSpecSha256);
  assert.equal(saved.sha256, f.reference.sha256);
  f.nativeState.unavailable = true;
  await assert.rejects(storeGeneratedCourseDeckEditorial(input));
  assert.equal(uploads.length, 1);
});

test("edited Google deck archive preserves text, all face descriptors and bytes in preview and render outputs", async () => {
  const f = await scenario(), { bound, authority, next } = editFirstSlide(f);
  const context = { organizationId: f.organizationId, documentId: f.draftId, documentHash: bound.documentHash,
    revisions: [{ ...authority, encodedRevision: JSON.stringify(next.revision) }] };
  const prepared = { document: bound.document, context,
    bundle: freezeCompositionHtmlEditingSnapshot({ document: bound.document, context }), imageAssets: [] };
  // Fixed execution/runtime policy from the existing archive fixture, not an execution attestation.
  const archiveFixture = await createPreparedHtmlArchiveFixture();
  const result = await assembleAcquiredCompositionHtmlEditingSnapshotArchive({
    organizationId: f.organizationId, documentId: f.draftId, documentHash: bound.documentHash, prepared,
    refresh: async () => prepared, otherAssets: [], renderProfile: archiveFixture.input.renderProfile,
    renderExecution: archiveFixture.input.renderExecution, animationRuntimeSha256: archiveFixture.input.animationRuntimeSha256,
    packagedFonts: f.manifest.map(binding => ({ binding, bytes: f.files.find(file => file.file.checksumSha256 === binding.checksumSha256)!.bytes })),
  });
  const archive = await JSZip.loadAsync(result.archiveBytes);
  assert.deepEqual(JSON.parse(await archive.file("font-manifest.json")!.async("string")), f.manifest);
  for (const path of ["index.html", "conformance-preview.html"]) {
    const html = await archive.file(path)!.async("string");
    assert.match(html, /Edición con variantes Google/);
    assert.match(html, /font-weight: 400;/); assert.match(html, /font-weight: 700;/);
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  }
  for (const binding of f.manifest) assert.deepEqual(await archive.file(conformanceFontPath(binding))!.async("uint8array"),
    f.files.find(file => file.file.checksumSha256 === binding.checksumSha256)!.bytes);
});
