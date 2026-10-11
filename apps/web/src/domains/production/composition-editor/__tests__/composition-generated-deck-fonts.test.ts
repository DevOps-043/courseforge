import assert from "node:assert/strict";
import test from "node:test";
import { generatedDeckFontFixture } from "../../slides/__tests__/generated-deck-font-fixture";
import { readGeneratedCourseDeckEditorial } from "../../slides/generation/course-deck-editorial-reader.server";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { generatedDeckInitialSource, instantiateGeneratedDeckDocument } from "../composition-generated-deck-import.server";
import { compositionFontReferences, compositionDeckFontReferencesSchema } from "../composition-font-references";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { assertCompiledConformanceFontBindings, buildDeclaredNativeFontUsageContract, conformanceFontPath } from "../composition-conformance-font-bindings";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { generatedDeckBootstrapCatalog } from "../composition-generated-deck-catalog.server";
import { hashCompositionDocument } from "../composition-document-hash";
import { prepareCompositionHtmlEditingPreviewFonts } from "../composition-html-editing-preview-fonts.server";
import { createHtmlSnapshotFontAcquirer } from "../composition-html-editing-snapshot-fonts.server";
import { assertHtmlReconstructionNativeResources } from "../composition-html-editing-reconstruction-native-resources.server";
import { prepareInitialHtmlEditingRevision } from "../html-editing/html-editing-bootstrap.server";
import { prepareHtmlEditingRevisionCommand } from "../html-editing/html-editing-revision.server";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";

async function scenario() {
  const fixture = generatedDeckFontFixture();
  const verified = (await readGeneratedCourseDeckEditorial({ ...fixture, supabase: fixture.client }))!;
  const document = instantiateGeneratedDeckDocument(createInitialCompositionDocument({ animatedDeck: generatedDeckInitialSource(verified),
    assets: [], plan: { title: "Fonts", subtitle: "Editorial", accentColor: "#00aabb", durationSeconds: 20 } }), verified);
  const manifest = [{ fontAssetId: fixture.fontId, family: fixture.family, checksumSha256: fixture.row.checksum_sha256,
    fileSizeBytes: fixture.bytes.length, mimeType: "font/woff2" as const }];
  const fonts = new Map([[fixture.fontId, { assetId: fixture.fontId, family: fixture.family, format: "woff2" as const,
    sourceUrl: conformanceFontPath(manifest[0]) }]]);
  return { ...fixture, verified, document, manifest, fonts };
}

test("generated uploaded fonts bind by tenant/ID/family without external CSS and cover both compiler targets", async () => {
  const f = await scenario();
  assert.deepEqual([...compositionFontReferences(f.document)], [[f.fontId, f.family]]);
  assert.deepEqual(compositionEditorDocumentSchema.parse(f.document), f.document);
  assert.equal(f.document.deckStyles, null);
  assert.ok(f.filters.some(filter => filter.table === "organization_slide_fonts" && filter.value === f.organizationId));
  assertCompiledConformanceFontBindings(f.document, f.manifest, f.fonts);
  for (const target of Object.values(COMPOSITION_COMPILATION_TARGETS)) {
    await assert.rejects(compileCompositionPreview({ document: f.document, assetUrls: new Map(), target }), /No se resolvió/);
    const html = await compileCompositionPreview({ document: f.document, assetUrls: new Map(), target, fontAssets: f.fonts });
    assert.ok(html.includes(`font-family: '${f.family}'`));
    assert.ok(html.includes(conformanceFontPath(f.manifest[0])));
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  }
  // Byte admission does not invent native DOM glyph identities for deck nodes.
  assert.deepEqual(buildDeclaredNativeFontUsageContract(f.document, f.manifest).bindings, []);
});

test("catalog admission independently rechecks current uploaded font identity and saved clip dependencies", async () => {
  const f = await scenario(), clip = f.document.clips[0];
  if (clip.source.type !== "DECK_SLIDE") throw new Error();
  const scope = { organizationId: f.organizationId, documentId: f.draftId, actorId: f.organizationId,
    expectedDocumentHash: hashCompositionDocument(f.document), clipId: clip.id, slideIndex: clip.source.slideIndex,
    sourceHtml: clip.source.html, fontBindings: clip.source.fontBindings };
  const catalog = await generatedDeckBootstrapCatalog(f.client, "")(scope);
  const template = f.verified.instance(clip.id, clip.source.slideIndex).template;
  assert.equal(catalog.listSourceMatches({ organizationId: f.organizationId, sourceSha256: template.sourceSha256 }).length, 1);
  await assert.rejects(generatedDeckBootstrapCatalog(f.client, "")({ ...scope, fontBindings: undefined }), /FONT_BINDING_REQUIRED/);
  await assert.rejects(generatedDeckBootstrapCatalog(f.client, "")({ ...scope,
    fontBindings: [{ fontAssetId: f.fontId, fontFamily: "Other Font" }] }), /FONT_BINDING_REQUIRED/);
  f.row.status = "REJECTED";
  await assert.rejects(generatedDeckBootstrapCatalog(f.client, "")(scope), /FONT_BINDING_REQUIRED/);
});

test("first real text save retains font dependencies on edited and neighboring slides", async () => {
  const f = await scenario(), clip = f.document.clips[0];
  if (clip.source.type !== "DECK_SLIDE") throw new Error();
  const template = f.verified.instance(clip.id, clip.source.slideIndex).template;
  const current = prepareInitialHtmlEditingRevision({ sourceHtml: clip.source.html, encodedTrustedTemplate: JSON.stringify(template),
    authoritativeAnchor: { organizationId: f.organizationId, documentId: f.draftId, revisionId: f.compositionId,
      clipId: clip.id, documentSha256: hashCompositionDocument(f.document) }, grantedAssetIds: [], imageSources: new Map() });
  const authority = { authoritativeBinding: current.revision.manifest.binding, grantedAssetIds: [], imageSources: new Map<string, string>() };
  const field = template.elements.find(element => element.kind === "TEXT")!;
  const next = prepareHtmlEditingRevisionCommand({ ...authority, encodedRevision: JSON.stringify(current.revision),
    expected: { version: 1, sha256: current.sha256 }, encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1",
      binding: authority.authoritativeBinding, overrides: [{ operation: "SET_TEXT", elementId: field.elementId, value: "Texto con fuente" }] }) }).next;
  const bound = bindHtmlEditingRevisionToComposition({ ...authority, document: f.document, revision: next.revision, revisionSha256: next.sha256 });
  assert.deepEqual(bound.document.clips.map(candidate => candidate.source), f.document.clips.map(candidate => candidate.source));
  for (const target of Object.values(COMPOSITION_COMPILATION_TARGETS)) {
    const html = await compileCompositionPreview({ document: bound.document, documentHash: bound.documentHash, assetUrls: new Map(), target, fontAssets: f.fonts,
      htmlEditingCompilation: { organizationId: f.organizationId, documentId: f.draftId, documentHash: bound.documentHash,
        revisions: [{ ...authority, encodedRevision: JSON.stringify(next.revision) }] } });
    assert.match(html, /Texto con fuente/);
    assert.ok(html.includes(conformanceFontPath(f.manifest[0])));
  }
});

test("font registry rejects foreign tenant, revoked, mismatched family and invalid byte metadata before import", async () => {
  for (const mutation of [
    { organization_id: "00000000-0000-4000-8000-000000000099" }, { status: "REJECTED" }, { family: "Other Font" },
    { checksum_sha256: "invalid" }, { file_size_bytes: 51 * 1024 * 1024 }, { mime_type: "text/html" },
    { storage_bucket: "private-secrets" }, { storage_path: "../escape" }, { source: "google" },
  ]) {
    const f = generatedDeckFontFixture(); Object.assign(f.row, mutation);
    await assert.rejects(async () => {
      const verified = (await readGeneratedCourseDeckEditorial({ ...f, supabase: f.client }))!;
      generatedDeckInitialSource(verified);
    }, /FONT_BINDING_REQUIRED/);
  }
  const missing = generatedDeckFontFixture(); missing.state.fontRows = [];
  await assert.rejects(readGeneratedCourseDeckEditorial({ ...missing, supabase: missing.client }), /FONT_BINDING_REQUIRED/);
  const google = generatedDeckFontFixture("google");
  const verified = (await readGeneratedCourseDeckEditorial({ ...google, supabase: google.client }))!;
  assert.throws(() => generatedDeckInitialSource(verified), /FONT_BINDING_REQUIRED/);
  assert.ok(!google.filters.some(filter => filter.table === "organization_slide_fonts"));
});

test("DECK font acquisition uses bounded verified bytes for HTML preview and snapshots; reconstruction preserves dependencies", async () => {
  const f = await scenario();
  let downloads = 0;
  const fetchResource = (async () => { downloads++; return new Response(f.bytes,
    { headers: { "content-type": "font/woff2", "content-length": String(f.bytes.length) } }); }) as typeof fetch;
  const supabase = Object.assign({}, f.client, { storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string) =>
    ({ data: { signedUrl: `https://storage.example.test/storage/v1/object/sign/${bucket}/${path}?token=private` }, error: null }) }) } });
  const preview = await prepareCompositionHtmlEditingPreviewFonts({ document: f.document, organizationId: f.organizationId,
    supabase, storageOrigin: "https://storage.example.test", fetchResource });
  assert.deepEqual(preview.resources.get(conformanceFontPath(f.manifest[0]))?.bytes, f.bytes);
  assert.deepEqual(preview.fonts, f.fonts);
  const acquire = createHtmlSnapshotFontAcquirer({ supabase, supabaseUrl: "https://storage.example.test",
    serviceRoleKey: "test-only-not-a-secret", fetchImpl: fetchResource });
  const packaged = await acquire({ document: f.document, organizationId: f.organizationId });
  assert.deepEqual(packaged, [{ binding: f.manifest[0], bytes: f.bytes }]);
  assert.equal(downloads, 2);
  assert.deepEqual(assertHtmlReconstructionNativeResources(f.document, { assets: [], fontManifest: f.manifest }).fontManifest, f.manifest);
  assert.throws(() => assertHtmlReconstructionNativeResources(f.document, { assets: [], fontManifest: [] }), /RESOURCE_SET_MISMATCH/);
  const invalidAcquire = createHtmlSnapshotFontAcquirer({ supabase, supabaseUrl: "https://storage.example.test", serviceRoleKey: "test-only",
    fetchImpl: (async () => new Response(new Uint8Array([4, 3, 2, 1]), { headers: { "content-type": "font/woff2" } })) as typeof fetch });
  await assert.rejects(invalidAcquire({ document: f.document, organizationId: f.organizationId }), /FONTS_UNAVAILABLE/);
});

test("font dependency schema is optional for legacy documents and rejects duplicate or invalid references", async () => {
  const f = await scenario(), reference = { fontAssetId: f.fontId, fontFamily: f.family };
  assert.throws(() => compositionDeckFontReferencesSchema.parse([reference, reference]));
  assert.throws(() => compositionDeckFontReferencesSchema.parse([{ ...reference, url: "https://example.invalid/font" }]));
  assert.throws(() => compositionDeckFontReferencesSchema.parse([{ ...reference, fontFamily: "</style>" }]));
  const conflict = structuredClone(f.document);
  const other = structuredClone(conflict.clips[0]); other.id = "other-font-clip"; other.hfId = other.id;
  if (other.source.type !== "DECK_SLIDE") throw new Error();
  other.source.fontBindings = [{ ...reference, fontFamily: "Other Font" }]; conflict.clips.push(other);
  assert.throws(() => compositionFontReferences(conflict), /FAMILY_CONFLICT/);
  const legacy = structuredClone(f.document);
  for (const clip of legacy.clips) if (clip.source.type === "DECK_SLIDE") delete clip.source.fontBindings;
  assert.deepEqual(compositionEditorDocumentSchema.parse(legacy), legacy);
});
