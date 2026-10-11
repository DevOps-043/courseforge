import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatedDeckIntegrationFixture } from "../../slides/__tests__/generated-deck-integration-fixture";
import { generatedDeckFontFixture } from "../../slides/__tests__/generated-deck-font-fixture";
import { generatedGoogleDeckFontFixture } from "../../slides/__tests__/generated-google-deck-font-fixture";
import { readGeneratedCourseDeckEditorial } from "../../slides/generation/course-deck-editorial-reader.server";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { generatedDeckInitialSource, instantiateGeneratedDeckDocument } from "../composition-generated-deck-import.server";
import { hashCompositionDocument } from "../composition-document.service";
import { GeneratedDeckInitializationHost, computeGeneratedDeckInitializationRequestSha256, prepareGeneratedDeckInitializations } from "../composition-generated-deck-initialization.server";
import { generatedDeckInitializationRequestSchema, generatedDeckInitializationReceiptSchema } from "../composition-generated-deck-initialization.contract";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { prepareHtmlEditingRevisionCommand } from "../html-editing/html-editing-revision.server";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { readReferencedCompositionFonts, compiledCompositionFont } from "../composition-font-assets.service";

async function scenario(withImage = false) {
  const fixture = generatedDeckIntegrationFixture(withImage);
  const generated = (await readGeneratedCourseDeckEditorial({ componentId: fixture.componentId, organizationId: fixture.organizationId, supabase: fixture.client }))!;
  const initial = createInitialCompositionDocument({ animatedDeck: generatedDeckInitialSource(generated), assets: [],
    plan: { title: "Curso", subtitle: "Prueba", accentColor: "#00aabb", durationSeconds: 20 } });
  initial.clips.push({ ...structuredClone(initial.clips[0]), id: "repeat-slide", hfId: "repeat-slide" });
  const document = instantiateGeneratedDeckDocument(initial, generated);
  const owner = { actorId: fixture.organizationId, organizationId: fixture.organizationId, draftId: fixture.draftId };
  const context = { revisionId: fixture.compositionId, documentHash: hashCompositionDocument(document), grantedAssetIds: withImage ? [fixture.imageId] : [] };
  return { ...fixture, generated, document, owner, context };
}

describe("atomic generated-deck preparation", () => {
  it("whole-deck initial binding retains uploaded and every pinned Google face in both compiler targets", async () => {
    for (const fixture of [generatedDeckFontFixture(), generatedGoogleDeckFontFixture()]) {
      const generated = (await readGeneratedCourseDeckEditorial({ componentId: fixture.componentId, organizationId: fixture.organizationId, supabase: fixture.client }))!;
      const initial = createInitialCompositionDocument({ animatedDeck: generatedDeckInitialSource(generated), assets: [],
        plan: { title: "Curso", subtitle: "Prueba", accentColor: "#00aabb", durationSeconds: 20 } });
      initial.clips.push({ ...structuredClone(initial.clips[0]), id: "repeat-slide", hfId: "repeat-slide" });
      const document = instantiateGeneratedDeckDocument(initial, generated);
      const prepared = prepareGeneratedDeckInitializations({ document, generated,
        owner: { actorId: fixture.organizationId, organizationId: fixture.organizationId, draftId: fixture.draftId },
        context: { revisionId: fixture.compositionId, documentHash: hashCompositionDocument(document), grantedAssetIds: [] } });
      const fonts = await readReferencedCompositionFonts({ document: prepared.document, organizationId: fixture.organizationId, supabase: fixture.client });
      assert.equal(fonts.length, "nativeState" in fixture ? 2 : 1);
      for (const target of Object.values(COMPOSITION_COMPILATION_TARGETS)) {
        const html = await compileCompositionPreview({ document: prepared.document, documentHash: prepared.documentHash, target, assetUrls: new Map(),
          fontAssets: new Map(fonts.map(font => [font.id, compiledCompositionFont(font, `assets/fonts/${font.checksumSha256}.woff2`)])),
          htmlEditingCompilation: { organizationId: fixture.organizationId, documentId: fixture.draftId, documentHash: prepared.documentHash, revisions: prepared.revisions } });
        for (const font of fonts) assert.ok(html.includes(`assets/fonts/${font.checksumSha256}.woff2`));
        assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
      }
      assert.deepEqual(prepared.document.clips, document.clips);
    }
  });

  it("binds initial v1 for every clip, including repeated slide instances, without changing source/timing/layout", async () => {
    const fixture = await scenario(true), before = JSON.stringify(fixture.document);
    const prepared = prepareGeneratedDeckInitializations(fixture);
    assert.equal(prepared.registrations.length, fixture.document.clips.length);
    assert.ok(prepared.references.every(reference => reference.revisionVersion === 1));
    assert.equal(new Set(prepared.references.map(reference => reference.sourceSha256)).size, prepared.references.length);
    assert.equal(prepared.document.format, "courseforge-composition-v4");
    assert.deepEqual(prepared.document.clips, fixture.document.clips);
    assert.equal(JSON.stringify(fixture.document), before);
    for (const target of Object.values(COMPOSITION_COMPILATION_TARGETS)) {
      const html = await compileCompositionPreview({ document: prepared.document, documentHash: prepared.documentHash, target,
        assetUrls: new Map([[fixture.imageId, `conformance-media/${fixture.imageId}`]]),
        htmlEditingCompilation: { organizationId: fixture.organizationId, documentId: fixture.draftId,
          documentHash: prepared.documentHash, revisions: prepared.revisions } });
      assert.match(html, /conformance-media\//);
    }
  });

  it("preserves an edited neighbour and prepares only remaining exact generated clips", async () => {
    const fixture = await scenario(), prepared = prepareGeneratedDeckInitializations(fixture);
    const current = prepared.registrations[0], authority = prepared.revisions[0];
    const field = current.revision.manifest.elements.find(element => element.kind === "TEXT")!;
    const next = prepareHtmlEditingRevisionCommand({ ...authority, expected: { version: 1, sha256: current.revisionSha256 },
      encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1", binding: authority.authoritativeBinding,
        overrides: [{ operation: "SET_TEXT", elementId: field.elementId, value: "Ya editado" }] }) }).next;
    const bound = bindHtmlEditingRevisionToComposition({ ...authority, document: fixture.document, revision: next.revision, revisionSha256: next.sha256 });
    const remaining = prepareGeneratedDeckInitializations({ ...fixture, document: bound.document, context: { ...fixture.context, documentHash: bound.documentHash } });
    assert.equal(remaining.references.length, fixture.document.clips.length - 1);
    assert.deepEqual(remaining.document.htmlEditing!.items.find(item => item.clipId === current.clipId), bound.document.htmlEditing!.items[0]);
    assert.ok(!remaining.registrations.some(item => item.clipId === current.clipId));
  });

  it("fails the whole preparation on source drift, external HTML, stale hash, revoked images or unresolved font declarations", async () => {
    const fixture = await scenario(true);
    const changed = structuredClone(fixture.document);
    const clip = changed.clips.at(-1)!;
    if (clip.source.type !== "DECK_SLIDE") throw new Error();
    clip.source.html += "<p>Changed</p>";
    assert.throws(() => prepareGeneratedDeckInitializations({ ...fixture, document: changed, context: { ...fixture.context, documentHash: hashCompositionDocument(changed) } }), /INTEGRITY_MISMATCH/);
    clip.source.htmlAssetId = fixture.imageId;
    assert.throws(() => prepareGeneratedDeckInitializations({ ...fixture, document: changed, context: { ...fixture.context, documentHash: hashCompositionDocument(changed) } }), /INTEGRITY_MISMATCH/);
    assert.throws(() => prepareGeneratedDeckInitializations({ ...fixture, context: { ...fixture.context, documentHash: "a".repeat(64) } }), /REVISION_CONFLICT/);
    assert.throws(() => prepareGeneratedDeckInitializations({ ...fixture, context: { ...fixture.context, grantedAssetIds: [] } }));
    fixture.generated.fontBindings = [{ fontAssetId: fixture.imageId, fontFamily: "Unknown Font" }];
    assert.throws(() => prepareGeneratedDeckInitializations(fixture), /FONT_BINDING_REQUIRED/);
  });

  it("accepts only identity/CAS, refuses empty/already-complete decks and forged receipts", async () => {
    const fixture = await scenario();
    const expectedDocumentHash = fixture.context.documentHash;
    const request = { operationId: fixture.compositionId, expectedDocumentHash, requestSha256: computeGeneratedDeckInitializationRequestSha256(expectedDocumentHash) };
    assert.ok(generatedDeckInitializationRequestSchema.safeParse(request).success);
    assert.equal(generatedDeckInitializationRequestSchema.safeParse({ ...request, templates: [] }).success, false);
    assert.throws(() => prepareGeneratedDeckInitializations({ ...fixture, document: { ...fixture.document, clips: [] },
      context: { ...fixture.context, documentHash: hashCompositionDocument({ ...fixture.document, clips: [] }) } }));
    const prepared = prepareGeneratedDeckInitializations(fixture);
    assert.throws(() => prepareGeneratedDeckInitializations({ ...fixture, document: prepared.document, context: { ...fixture.context, documentHash: prepared.documentHash } }));
    assert.equal(generatedDeckInitializationReceiptSchema.safeParse({ scope: "READY", ...request }).success, false);
  });

  it("authorizes before reading material, prepares once, sends one commit and never retries an uncertain write", async () => {
    const fixture = await scenario(true), calls: string[] = [];
    let failCommit = false, receipt: unknown = null;
    const client = { from: fixture.client.from.bind(fixture.client), rpc: (name: string, args: Record<string, unknown>) => ({
      abortSignal: async () => {
        calls.push(name);
        if (name === "read_generated_deck_initialization_operation") return { error: null, data: receipt ? { status: "RECORDED", receipt } : { status: "NOT_FOUND" } };
        if (name === "read_generated_deck_initialization_context") return { error: null, data: { ...fixture.context,
          organizationId: fixture.organizationId, documentId: fixture.draftId, clipId: fixture.document.clips[0].id,
          document: fixture.document, componentId: fixture.componentId, documentVersion: 1 } };
        if (name !== "commit_generated_deck_initialization") throw new Error("Unexpected RPC");
        const prepared = prepareGeneratedDeckInitializations(fixture);
        assert.deepEqual(args.p_document, prepared.document);
        assert.deepEqual(args.p_registrations, prepared.registrations);
        receipt = { scope: "GENERATED_DECK_INITIALIZATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED", owner: fixture.owner,
          operationId: args.p_operation, requestSha256: args.p_request_sha256, expectedDocumentHash: args.p_expected_hash,
          documentHash: prepared.documentHash, documentVersion: 2, items: prepared.references.map(item => ({ ...item, created: true })) };
        return { error: failCommit ? { message: "PRIVATE SQL ERROR" } : null, data: failCommit ? null : receipt };
      },
    }) } as unknown as SupabaseClient;
    const host = new GeneratedDeckInitializationHost(client), request = { operationId: fixture.compositionId,
      expectedDocumentHash: fixture.context.documentHash, requestSha256: computeGeneratedDeckInitializationRequestSha256(fixture.context.documentHash) };
    failCommit = true;
    await assert.rejects(host.initialize(fixture.owner, request), /COMMIT_UNCONFIRMED/);
    assert.equal(calls.filter(name => name === "commit_generated_deck_initialization").length, 1);
    const previousCalls = calls.length;
    const recovered = await host.readOperation(fixture.owner, { operationId: request.operationId, requestSha256: request.requestSha256 });
    assert.equal(recovered.status, "RECORDED");
    assert.deepEqual(calls.slice(previousCalls), ["read_generated_deck_initialization_operation"]);
    fixture.state.component = null; // Historical replay must not reprepare current material.
    const replay = await host.initialize(fixture.owner, request);
    assert.deepEqual(replay, receipt);
    assert.equal(calls.filter(name => name === "commit_generated_deck_initialization").length, 1);
  });

  it("does not read material or write after denied native authorization, digest mismatch or pre-abort", async () => {
    const fixture = await scenario();
    let materialRead = false, writes = 0;
    const client = { from: () => { materialRead = true; throw new Error(); }, rpc: (name: string) => ({ abortSignal: async () => {
      if (name.startsWith("commit")) writes++;
      return { error: name.endsWith("context") ? { message: "SECRET" } : null, data: { status: "NOT_FOUND" } };
    } }) } as unknown as SupabaseClient;
    const host = new GeneratedDeckInitializationHost(client), request = { operationId: fixture.compositionId,
      expectedDocumentHash: fixture.context.documentHash, requestSha256: computeGeneratedDeckInitializationRequestSha256(fixture.context.documentHash) };
    await assert.rejects(host.initialize(fixture.owner, request), /READ_UNAVAILABLE/);
    await assert.rejects(host.initialize(fixture.owner, { ...request, requestSha256: "b".repeat(64) }), /INVALID_REVISION/);
    await assert.rejects(host.initialize(fixture.owner, request, AbortSignal.abort()), /READ_UNAVAILABLE/);
    assert.equal(materialRead, false); assert.equal(writes, 0);
  });
});
