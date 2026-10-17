import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { load } from "cheerio";
import { generatedDeckIntegrationFixture } from "../../slides/__tests__/generated-deck-integration-fixture";
import { readGeneratedCourseDeckEditorial } from "../../slides/generation/course-deck-editorial-reader.server";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { generatedDeckInitialSource, generatedDeckInitialNarrativeScenes, instantiateGeneratedDeckDocument } from "../composition-generated-deck-import.server";
import { generatedDeckBootstrapCatalog } from "../composition-generated-deck-catalog.server";
import { hashCompositionDocument } from "../composition-document-hash";
import { prepareInitialHtmlEditingRevision } from "../html-editing/html-editing-bootstrap.server";
import { prepareHtmlEditingRevisionCommand } from "../html-editing/html-editing-revision.server";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { compositionDeckImageAssetIds, resolveCompositionDeckImageAliases } from "../composition-deck-image-aliases.server";
import { buildSceneVisualCatalog } from "../composition-narrative-source.service";
import type { CompositionNarrativeScene } from "../composition-narrative.types";
import { CompositionHtmlEditingBootstrapHost } from "../composition-html-editing-bootstrap-host.server";
import { resolveCompositionPreviewAssetUrls } from "../composition-preview-assets.service";
import { readReferencedDeckDependencies } from "../composition-snapshot.service";

async function scenario(withImage = false) {
  const fixture = generatedDeckIntegrationFixture(withImage);
  const verified = (await readGeneratedCourseDeckEditorial({ ...fixture, supabase: fixture.client }))!;
  const initial = createInitialCompositionDocument({ animatedDeck: generatedDeckInitialSource(verified), assets: [],
    plan: { title: "Curso", subtitle: "Prueba", accentColor: "#00aabb", durationSeconds: 20 } });
  // The same slide may occur in multiple narrative scenes. IDs must be unique.
  initial.clips.push({ ...structuredClone(initial.clips[0]), id: "repeat-slide", hfId: "repeat-slide" });
  const document = instantiateGeneratedDeckDocument(initial, verified);
  return { ...fixture, verified, initial, document };
}

describe("generated material to native editing integration", () => {
  it("preserves approved narrative associations only for the exact current presentation, not stale slide indexes", async () => {
    const fixture = await scenario();
    const source = buildSceneVisualCatalog(fixture.verified.presentationSource())!;
    const scriptHash = "a".repeat(64);
    const scene: CompositionNarrativeScene = { id: "scene-one", order: 1, scriptText: "Narración", scriptHash,
      label: "Escena", needsReview: false, visualPlan: { deckRevision: source.deckRevision, scriptHash,
        slides: [{ key: source.slides[0].key, label: source.slides[0].label, weight: 2 }] } };
    const remapped = generatedDeckInitialNarrativeScenes([scene], fixture.verified)!;
    const expected = buildSceneVisualCatalog(generatedDeckInitialSource(fixture.verified))!;
    assert.equal(remapped[0].needsReview, false);
    assert.equal(remapped[0].visualPlan!.deckRevision, expected.deckRevision);
    assert.equal(remapped[0].visualPlan!.slides[0].key, expected.slides[0].key);
    assert.equal(remapped[0].visualPlan!.slides[0].weight, 2);
    assert.equal(scene.visualPlan!.deckRevision, source.deckRevision);
    const stale = { ...scene, visualPlan: { ...scene.visualPlan!, deckRevision: "b".repeat(64) } };
    assert.equal(generatedDeckInitialNarrativeScenes([stale], fixture.verified)![0].needsReview, true);
  });
  it("does not resolve generated catalogs until current actor/source/CAS authorization succeeds", async () => {
    const fixture = await scenario();
    let resolved = false;
    const client = { rpc: () => ({ abortSignal: async () => ({ error: { message: "PRIVATE" }, data: null }) }) } as unknown as typeof fixture.client;
    const host = new CompositionHtmlEditingBootstrapHost(client, async () => { resolved = true; throw new Error(); });
    await assert.rejects(host.listTemplateChoices({ organizationId: fixture.organizationId, documentId: fixture.draftId,
      actorId: fixture.organizationId, clipId: fixture.document.clips[0].id, expectedDocumentHash: hashCompositionDocument(fixture.document) }), /READ_UNAVAILABLE/);
    assert.equal(resolved, false);
  });
  it("imports self-contained sources and namespaces repeated clips without changing timing/layout or the producer artifact", async () => {
    const fixture = await scenario();
    assert.equal(fixture.document.deckStyles, null);
    assert.equal(fixture.document.htmlEditing, undefined);
    const ids = fixture.document.clips.flatMap(clip => {
      assert.equal(clip.source.type, "DECK_SLIDE");
      const fragment = load(clip.source.type === "DECK_SLIDE" ? clip.source.html : "", {}, false);
      return fragment("[id]").toArray().map(node => fragment(node).attr("id"));
    });
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(fixture.document.clips.map(clip => [clip.layout, clip.durationSeconds, clip.startSeconds]),
      fixture.initial.clips.map(clip => [clip.layout, clip.durationSeconds, clip.startSeconds]));
    assert.deepEqual(fixture.verified.artifact, fixture.artifact);
  });
  it("offers only the server-reconstructed template for the exact saved clip/source with no growing env catalog", async () => {
    const fixture = await scenario(true), clip = fixture.document.clips[0];
    assert.equal(clip.source.type, "DECK_SLIDE");
    if (clip.source.type !== "DECK_SLIDE") throw new Error();
    const scope = { organizationId: fixture.organizationId, documentId: fixture.draftId, actorId: fixture.organizationId,
      expectedDocumentHash: hashCompositionDocument(fixture.document), clipId: clip.id,
      slideIndex: clip.source.slideIndex, sourceHtml: clip.source.html };
    const catalog = await generatedDeckBootstrapCatalog(fixture.client, "")(scope);
    const template = fixture.verified.instance(clip.id, clip.source.slideIndex).template;
    assert.equal(catalog.listSourceMatches({ organizationId: fixture.organizationId, sourceSha256: template.sourceSha256 }).length, 1);
    assert.equal(JSON.parse(catalog.resolve({ organizationId: fixture.organizationId, ...template })).templateId, template.templateId);
    await assert.rejects(generatedDeckBootstrapCatalog(fixture.client, "")({ ...scope, sourceHtml: `${scope.sourceHtml}<!--changed-->` }));
  });
  it("supports first preview, real text reduction, native binding and both compiler targets while neighbours remain unedited", async () => {
    const fixture = await scenario(true), clip = fixture.document.clips[0];
    if (clip.source.type !== "DECK_SLIDE") throw new Error();
    const assetUrls = new Map([[fixture.imageId, `conformance-media/${fixture.imageId}`]]);
    assert.deepEqual(compositionDeckImageAssetIds(fixture.document), [fixture.imageId]);
    const before = await compileCompositionPreview({ document: fixture.document, assetUrls, target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER });
    assert.match(before, /conformance-media\//);
    const template = fixture.verified.instance(clip.id, clip.source.slideIndex).template;
    const current = prepareInitialHtmlEditingRevision({ sourceHtml: clip.source.html, encodedTrustedTemplate: JSON.stringify(template),
      authoritativeAnchor: { organizationId: fixture.organizationId, documentId: fixture.draftId,
        revisionId: fixture.compositionId, clipId: clip.id, documentSha256: hashCompositionDocument(fixture.document) },
      grantedAssetIds: [fixture.imageId], imageSources: assetUrls });
    const authority = { authoritativeBinding: current.revision.manifest.binding, grantedAssetIds: [fixture.imageId], imageSources: assetUrls };
    const field = template.elements.find(element => element.kind === "TEXT")!;
    const next = prepareHtmlEditingRevisionCommand({ ...authority, encodedRevision: JSON.stringify(current.revision),
      expected: { version: 1, sha256: current.sha256 }, encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1",
        binding: authority.authoritativeBinding, overrides: [{ operation: "SET_TEXT", elementId: field.elementId, value: "Título modificado" }] }) }).next;
    const bound = bindHtmlEditingRevisionToComposition({ ...authority, document: fixture.document, revision: next.revision, revisionSha256: next.sha256 });
    for (const target of Object.values(COMPOSITION_COMPILATION_TARGETS)) {
      const html = await compileCompositionPreview({ document: bound.document, documentHash: bound.documentHash, assetUrls, target,
        htmlEditingCompilation: { organizationId: fixture.organizationId, documentId: fixture.draftId, documentHash: bound.documentHash,
          revisions: [{ ...authority, encodedRevision: JSON.stringify(next.revision) }] } });
      assert.match(html, /Título modificado/);
      assert.equal(load(html)(`#${field.elementId}`).length, 1);
    }
    assert.equal(fixture.document.htmlEditing, undefined);
    const boundSource = bound.document.clips[0].source;
    assert.equal(boundSource.type === "DECK_SLIDE" ? boundSource.html : "", clip.source.html);
  });
  it("never grants an image merely because a local alias exists", async () => {
    const fixture = await scenario(true), clip = fixture.document.clips[0];
    if (clip.source.type !== "DECK_SLIDE") throw new Error();
    const sourceHtml = clip.source.html;
    assert.throws(() => resolveCompositionDeckImageAliases(sourceHtml, new Map()), /UNAVAILABLE/);
    const resolved = resolveCompositionDeckImageAliases(sourceHtml, new Map([[fixture.imageId, "https://storage.example.test/image.png?a=1&b=2"]]));
    assert.match(resolved, /image\.png/);
    assert.equal(resolveCompositionDeckImageAliases("<h1>Sin imagen</h1>", new Map()), "<h1>Sin imagen</h1>");
  });
  it("resolves alias images through current draft links for first preview and snapshot, even without a public URL", async () => {
    const fixture = await scenario(true);
    const state = { linked: true, status: "APPROVED", mime: "image/png" };
    const row = () => ({ id: fixture.imageId, checksum: "a".repeat(64), storage_bucket: "production-assets", storage_path: "image.png",
      file_size_bytes: 3, metadata: null, public_url: null, mime_type: state.mime, qa_status: state.status });
    const client = { from: (table: string) => {
      const result = () => ({ error: null, data: table === "video_composition_draft_assets"
        ? state.linked ? [{ production_asset_id: fixture.imageId }] : [] : [row()] });
      const query = { select: () => query, eq: () => query, in: () => query,
        then: <T>(resolve: (value: ReturnType<typeof result>) => T) => Promise.resolve(result()).then(resolve) };
      return query;
    }, storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "https://storage.example.test/image.png" } }) }) } } as unknown as typeof fixture.client;
    const input = { organizationId: fixture.organizationId, draftId: fixture.draftId, document: fixture.document, supabase: client };
    assert.ok((await resolveCompositionPreviewAssetUrls(input)).get(fixture.imageId));
    assert.equal((await readReferencedDeckDependencies(input, fixture.document))[0].id, fixture.imageId);
    state.linked = false;
    await assert.rejects(resolveCompositionPreviewAssetUrls(input), /no pertenecen/);
    await assert.rejects(readReferencedDeckDependencies(input, fixture.document), /no está vinculada/);
    state.linked = true; state.status = "ARCHIVED";
    await assert.rejects(resolveCompositionPreviewAssetUrls(input), /no está disponible/);
    await assert.rejects(readReferencedDeckDependencies(input, fixture.document), /no está disponible/);
    state.status = "APPROVED"; state.mime = "image/svg+xml";
    await assert.rejects(resolveCompositionPreviewAssetUrls(input), /no está disponible/);
  });
  it("does not pretend an unresolved custom font is supported or replace authored source", async () => {
    const fixture = await scenario();
    fixture.verified.artifact.fontRequirements.push({ family: "Custom Font", source: "uploaded", fontAssetId: fixture.imageId });
    assert.throws(() => generatedDeckInitialSource(fixture.verified), /FONT_BINDING_REQUIRED/);
    fixture.verified.artifact.fontRequirements.length = 0;
    const changed = structuredClone(fixture.initial);
    if (changed.clips[0].source.type === "DECK_SLIDE") changed.clips[0].source.html += "<p>Autoría</p>";
    assert.throws(() => instantiateGeneratedDeckDocument(changed, fixture.verified), /INTEGRITY_MISMATCH/);
  });
});
