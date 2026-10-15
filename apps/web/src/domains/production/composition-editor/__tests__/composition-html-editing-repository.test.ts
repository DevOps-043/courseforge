import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid,
  htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { hashCompositionDocument } from "../composition-document.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { compileCompositionPreview } from "../composition-preview-compiler.service";
import { compileCompositionHtmlEditingFragments, type CompositionHtmlEditingCompilation } from "../composition-html-editing-compilation.server";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { preservesCompositionHtmlRevisionReferences } from "../composition-html-editing-reference-policy";
import { SupabaseHtmlEditingRevisionRepository } from "../composition-html-editing-repository.service";
import { HtmlEditingTemplateCatalog } from "../html-editing/html-editing-template-catalog.server";
import { verifyHtmlEditingRevision, prepareHtmlEditingRevisionCommand } from "../html-editing/html-editing-revision.server";

function host() {
  const input = fixture();
  const calls: Array<{ name: string; args: any; signal?: AbortSignal }> = [];
  const state = { row: input.row, acknowledgement: { status: "COMMITTED", version: 2, sha256: input.next.sha256 } as unknown, error: false };
  const supabase = { rpc: (name: string, args: any) => ({ abortSignal: async (signal: AbortSignal) => {
    calls.push({ name, args, signal });
    return { error: state.error ? { message: "PRIVATE_BACKEND_TOKEN" } : null,
      data: name === "read_html_editing_revision" ? structuredClone(state.row) : state.acknowledgement };
  } }) } as unknown as SupabaseClient;
  const repository = new SupabaseHtmlEditingRevisionRepository(supabase);
  const append = { ...input.request, expected: { version: 1, sha256: input.current.sha256 },
    expectedCompositionDocumentHash: input.row.compositionDocumentHash, authoritativeBinding: input.authority.authoritativeBinding,
    revision: input.next.revision, sha256: input.next.sha256, operation: "COMMAND" as const };
  return { input, calls, state, repository, append };
}

function bootstrapHost() {
  const testHost = host();
  const binding = testHost.input.current.revision.manifest.binding;
  const { organizationId, documentId, revisionId, documentSha256, clipId } = binding;
  const registration = { ...testHost.input.request,
    authoritativeAnchor: { organizationId, documentId, revisionId, documentSha256, clipId },
    encodedTrustedTemplate: JSON.stringify({ format: "courseforge-html-editable-template-v1",
      templateId: binding.templateId, templateVersion: binding.templateVersion, sourceSha256: binding.sourceSha256,
      elements: testHost.input.current.revision.manifest.elements }),
    sourceHtml: testHost.input.current.revision.sourceHtml,
    grantedAssetIds: testHost.input.authority.grantedAssetIds, imageSources: testHost.input.authority.imageSources };
  testHost.state.acknowledgement = true;
  return { ...testHost, registration };
}

test("bootstrap registers exact host-prepared revision and confirms it with current authorized readback", async () => {
  for (const created of [true, false]) {
    const testHost = bootstrapHost(); testHost.state.acknowledgement = created;
    assert.deepEqual(await testHost.repository.registerInitial(testHost.registration), {
      status: "CONFIRMED", created, version: 1, sha256: testHost.input.current.sha256,
      compositionDocumentHash: testHost.input.row.compositionDocumentHash,
    });
    assert.deepEqual(testHost.calls.map(call => call.name), ["register_html_editing_template_v2", "read_html_editing_revision"]);
    const args = testHost.calls[0]!.args;
    assert.equal(args.p_expected_document_hash, testHost.input.row.compositionDocumentHash);
    assert.equal(args.p_revision_sha256, testHost.input.current.sha256);
    assert.deepEqual(args.p_used_asset_ids, [uuid]);
    assert.deepEqual(args.p_revision.state.overrides, []);
    assert.equal(args.p_actor_id, uuid);
  }
});

test("installed bootstrap resolves catalog independently and rejects a foreign catalog before RPC", async () => {
  for (const organizationId of [uuid, other]) {
    const testHost = bootstrapHost();
    const { encodedTrustedTemplate, ...registration } = testHost.registration;
    const catalog = new HtmlEditingTemplateCatalog(JSON.stringify({ format: "courseforge-html-editable-catalog-v1",
      organizationId, templates: [JSON.parse(encodedTrustedTemplate)] }));
    const request = { ...registration, catalog, templateId: "intro", templateVersion: 1 };
    if (organizationId === uuid) assert.equal((await testHost.repository.registerInstalled(request)).status, "CONFIRMED");
    else {
      await assert.rejects(testHost.repository.registerInstalled(request), /TEMPLATE_UNAVAILABLE/);
      assert.equal(testHost.calls.length, 0);
    }
  }
});

test("bootstrap scope substitution, invalid source and pre-cancellation never register", async () => {
  const testHost = bootstrapHost();
  await assert.rejects(testHost.repository.registerInitial({ ...testHost.registration,
    scope: { ...testHost.registration.scope, organizationId: other } }), /INVALID_REVISION/);
  await assert.rejects(testHost.repository.registerInitial({ ...testHost.registration,
    sourceHtml: testHost.registration.sourceHtml + " " }), /SOURCE_DIGEST_MISMATCH/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(testHost.repository.registerInitial({ ...testHost.registration, signal: controller.signal }));
  assert.equal(testHost.calls.length, 0);
});

test("bootstrap malformed ACK and lost transport response never trigger retry or false success", async () => {
  for (const acknowledgement of [null, "true", {}, { created: true }]) {
    const testHost = bootstrapHost(); testHost.state.acknowledgement = acknowledgement;
    await assert.rejects(testHost.repository.registerInitial(testHost.registration), /COMMIT_UNCONFIRMED/);
    assert.equal(testHost.calls.length, 1);
  }
  const testHost = bootstrapHost(); testHost.state.error = true;
  await assert.rejects(testHost.repository.registerInitial(testHost.registration), /COMMIT_UNCONFIRMED/);
  assert.equal(testHost.calls.length, 1);
});

test("bootstrap readback cannot confirm substituted revision or changed native document", async () => {
  for (const mode of ["revision", "native"] as const) {
    const testHost = bootstrapHost();
    if (mode === "revision") testHost.state.row.revisionSha256 = "f".repeat(64);
    else testHost.state.row.compositionDocumentHash = "f".repeat(64);
    await assert.rejects(testHost.repository.registerInitial(testHost.registration), /COMMIT_UNCONFIRMED/);
    assert.equal(testHost.calls.length, 2);
  }
});

test("bootstrap fresh revocation after registration is uncertain, not success or rollback", async () => {
  const testHost = bootstrapHost(); testHost.state.row.grantedAssetIds = [other];
  await assert.rejects(testHost.repository.registerInitial(testHost.registration), /COMMIT_UNCONFIRMED/);
  assert.equal(testHost.calls.length, 2);
});

test("bootstrap cancellation during a noncooperative write remains unconfirmed even if an ACK arrives", async () => {
  const testHost = bootstrapHost();
  const controller = new AbortController();
  let calls = 0;
  const repository = new SupabaseHtmlEditingRevisionRepository({ rpc: () => ({ abortSignal: async () => {
    calls++; controller.abort(); return { data: true, error: null };
  } }) } as unknown as SupabaseClient);
  await assert.rejects(repository.registerInitial({ ...testHost.registration, signal: controller.signal }), /COMMIT_UNCONFIRMED/);
  assert.equal(calls, 1);
});

test("native V4 reference binds exact immutable source and complete revision into document hash", () => {
  const input = fixture();
  const before = JSON.stringify(input.document);
  const bound = bindHtmlEditingRevisionToComposition({ ...input.authority, document: input.document,
    revision: input.next.revision, revisionSha256: input.next.sha256 });
  assert.equal(bound.document.format, "courseforge-composition-v4");
  assert.equal(bound.document.htmlEditing!.items[0]!.revisionSha256, input.next.sha256);
  assert.notEqual(bound.documentHash, input.row.compositionDocumentHash);
  assert.deepEqual(bound.document.clips, input.document.clips);
  assert.equal(JSON.stringify(input.document), before);
  assert.equal(bound.documentHash, hashCompositionDocument(bound.document));
});

test("source drift or wrong revision digest cannot be rebound into a native document", () => {
  const input = fixture();
  assert.throws(() => bindHtmlEditingRevisionToComposition({ ...input.authority, document: input.document,
    revision: input.next.revision, revisionSha256: "f".repeat(64) }), /REVISION_CONFLICT/);
  const changed = structuredClone(input.document);
  assert.ok(changed.clips[0]!.source.type === "DECK_SLIDE"); changed.clips[0]!.source.html += " ";
  assert.throws(() => bindHtmlEditingRevisionToComposition({ ...input.authority, document: changed,
    revision: input.next.revision, revisionSha256: input.next.sha256 }), /RESTORE_SOURCE_MISMATCH/);
});

test("legacy contracts reject HTML pointers, duplicate refs and references to non-deck targets", () => {
  const input = fixture();
  const bound = bindHtmlEditingRevisionToComposition({ ...input.authority, document: input.document,
    revision: input.next.revision, revisionSha256: input.next.sha256 }).document;
  assert.equal(compositionEditorDocumentSchema.safeParse({ ...bound, format: "courseforge-composition-v2" }).success, false);
  const reference = bound.htmlEditing!.items[0]!;
  assert.equal(compositionEditorDocumentSchema.safeParse({ ...bound, htmlEditing: { ...bound.htmlEditing, items: [reference, reference] } }).success, false);
  assert.equal(compositionEditorDocumentSchema.safeParse({ ...bound, htmlEditing: { ...bound.htmlEditing,
    items: [{ ...reference, clipId: bound.clips[1]!.id }] } }).success, false);
});

test("ordinary timeline edits retain V4 references and clip deletion removes only its pointer", () => {
  const input = fixture();
  const bound = bindHtmlEditingRevisionToComposition({ ...input.authority, document: input.document,
    revision: input.next.revision, revisionSha256: input.next.sha256 }).document;
  const edited = applyCompositionEditorPatches(bound, [{ type: "clip.layout", clipId: bound.clips[0]!.id, layout: { x: 15 } }]);
  assert.equal(edited.format, "courseforge-composition-v4");
  assert.deepEqual(edited.htmlEditing, bound.htmlEditing);
  const deleted = applyCompositionEditorPatches(bound, [{ type: "clip.remove", clipId: bound.clips[0]!.id }]);
  assert.equal(deleted.htmlEditing, undefined);
  assert.equal(deleted.format, "courseforge-composition-v2");
  assert.equal(bound.clips.length, 2);
});

test("both compiler targets fail closed rather than silently emitting the unedited original", async () => {
  const input = fixture();
  const bound = bindHtmlEditingRevisionToComposition({ ...input.authority, document: input.document,
    revision: input.next.revision, revisionSha256: input.next.sha256 }).document;
  for (const target of ["INTERACTIVE_PREVIEW", "HYPERFRAMES_RENDER"] as const) {
    await assert.rejects(compileCompositionPreview({ document: bound, assetUrls: new Map(), target }), /CONTEXT_REQUIRED/);
  }
});

function compilationFixture(sourceHtml?: string) {
  const input = fixture(sourceHtml);
  const bound = bindHtmlEditingRevisionToComposition({ ...input.authority, document: input.document,
    revision: input.next.revision, revisionSha256: input.next.sha256 });
  const context: CompositionHtmlEditingCompilation = { organizationId: uuid, documentId: uuid,
    documentHash: bound.documentHash, revisions: [{ ...input.authority, encodedRevision: JSON.stringify(input.next.revision) }] };
  return { input, bound, context, params: { document: bound.document, documentHash: bound.documentHash,
    context, assetUrls: new Map([[uuid, `conformance-media/${uuid}`],
      ["40000000-0000-4000-8000-000000000002", "conformance-media/40000000-0000-4000-8000-000000000002"]]) } };
}

test("exact HTML revision is compiled identically into both targets without modifying native source or hash", async () => {
  const { params, context } = compilationFixture();
  const before = JSON.stringify(params.document);
  const fragments: string[] = [];
  for (const target of ["INTERACTIVE_PREVIEW", "HYPERFRAMES_RENDER"] as const) {
    const html = await compileCompositionPreview({ ...params, htmlEditingCompilation: context, target });
    const page = load(html);
    assert.equal(page("#title").text(), "Changed");
    assert.equal(page("#photo").attr("src"), `conformance-media/${uuid}`);
    fragments.push(page(".deck-stage > section").html()!);
  }
  assert.equal(fragments[0], fragments[1]);
  assert.equal(JSON.stringify(params.document), before);
  assert.equal(hashCompositionDocument(params.document), params.documentHash);
  const clip = params.document.clips[0]!;
  assert.ok(clip.source.type === "DECK_SLIDE");
  assert.match(clip.source.html, /Original/);
});

test("a historical pointer cannot consume a newer revision even with the same source and valid authority", () => {
  const { params, input } = compilationFixture();
  const newer = prepareHtmlEditingRevisionCommand({ ...input.authority, encodedRevision: JSON.stringify(input.next.revision),
    expected: { version: 2, sha256: input.next.sha256 }, encodedCommand: JSON.stringify({
      format: "courseforge-html-editable-command-v1", binding: input.authority.authoritativeBinding,
      overrides: [{ operation: "SET_TEXT", elementId: "title", value: "Latest, not selected" }],
    }) }).next;
  params.context.revisions = [{ ...input.authority, encodedRevision: JSON.stringify(newer.revision) }];
  assert.throws(() => compileCompositionHtmlEditingFragments(params), /REVISION_MISMATCH/);
});

test("native hash and context hash must both identify the selected document", () => {
  const { params } = compilationFixture();
  assert.throws(() => compileCompositionHtmlEditingFragments({ ...params, documentHash: undefined }), /DOCUMENT_MISMATCH/);
  assert.throws(() => compileCompositionHtmlEditingFragments({ ...params, documentHash: "f".repeat(64) }), /DOCUMENT_MISMATCH/);
  assert.throws(() => compileCompositionHtmlEditingFragments({ ...params,
    context: { ...params.context, documentHash: "f".repeat(64) } }), /DOCUMENT_MISMATCH/);
});

test("missing, extra and duplicate revision entries are rejected rather than falling back", () => {
  const { params } = compilationFixture();
  for (const revisions of [[], [...params.context.revisions, ...params.context.revisions]]) {
    assert.throws(() => compileCompositionHtmlEditingFragments({ ...params,
      context: { ...params.context, revisions } }), /REVISION_SET_MISMATCH/);
  }
});

test("cross-organization, cross-document and wrong-clip authorities cannot supply a revision", () => {
  const { params } = compilationFixture();
  for (const replacement of [{ organizationId: other }, { documentId: other }, { clipId: "unknown" }]) {
    const entry = params.context.revisions[0]!;
    assert.throws(() => compileCompositionHtmlEditingFragments({ ...params, context: { ...params.context,
      revisions: [{ ...entry, authoritativeBinding: { ...entry.authoritativeBinding, ...replacement } }] } }), /REVISION_SET_MISMATCH/);
  }
});

test("every native reference field is checked, not only revision SHA", () => {
  const { params } = compilationFixture();
  for (const replacement of [{ revisionVersion: 3 }, { templateId: "different" }, { templateVersion: 2 },
    { sourceSha256: "f".repeat(64) }, { manifestSha256: "f".repeat(64) }]) {
    const document = structuredClone(params.document);
    Object.assign(document.htmlEditing!.items[0]!, replacement);
    const documentHash = hashCompositionDocument(document);
    assert.throws(() => compileCompositionHtmlEditingFragments({ ...params, document, documentHash,
      context: { ...params.context, documentHash } }), /REVISION_MISMATCH/);
  }
});

test("image grants are rechecked at compilation and aliases alone do not authorize output", () => {
  const { params } = compilationFixture();
  const entry = params.context.revisions[0]!;
  assert.throws(() => compileCompositionHtmlEditingFragments({ ...params,
    context: { ...params.context, revisions: [{ ...entry, grantedAssetIds: [] }] } }));
  for (const assetUrls of [new Map<string, string>(), new Map([[uuid, "https://example.test/photo.png"]]),
    new Map([[uuid, `conformance-media/${other}`]])]) {
    assert.throws(() => compileCompositionHtmlEditingFragments({ ...params, assetUrls }), /LOCAL_RESOURCE_REQUIRED/);
  }
});

test("global reserved IDs are rejected only after full assembly in both targets", async () => {
  const { params, context } = compilationFixture(`<section id="composition-root"><h1 id="title">Original</h1><img id="photo" src="conformance-media/${uuid}"></section>`);
  for (const target of ["INTERACTIVE_PREVIEW", "HYPERFRAMES_RENDER"] as const) {
    await assert.rejects(compileCompositionPreview({ ...params, htmlEditingCompilation: context, target }), /IDs duplicados/);
  }
});

test("IDs shared with an unedited deck cannot silently interfere with revised elements", async () => {
  const { params, context } = compilationFixture();
  const clip = params.document.clips[1]!;
  clip.kind = "DECK_SLIDE";
  clip.source = { type: "DECK_SLIDE", html: '<p id="title">Another slide</p>', classes: "slide", slideIndex: 1 };
  params.documentHash = hashCompositionDocument(params.document);
  context.documentHash = params.documentHash;
  await assert.rejects(compileCompositionPreview({ ...params, htmlEditingCompilation: context, target: "HYPERFRAMES_RENDER" }), /IDs duplicados/);
});

test("compilation budget is enforced before decoding a revision", () => {
  const { params } = compilationFixture();
  const entry = params.context.revisions[0]!;
  assert.throws(() => compileCompositionHtmlEditingFragments({ ...params, context: { ...params.context,
    revisions: [{ ...entry, encodedRevision: " ".repeat(1024 * 1024 + 1) }] } }), /PAYLOAD_LIMIT/);
});

test("neighbouring decks cannot introduce active content or remote resources", async () => {
  for (const html of ['<script>alert(1)</script>', '<img src="https://example.test/remote.png">',
    '<style>@import "https://example.test/remote.css";</style>']) {
    const { params, context } = compilationFixture();
    const clip = params.document.clips[1]!;
    clip.kind = "DECK_SLIDE";
    clip.source = { type: "DECK_SLIDE", html, classes: "slide", slideIndex: 1 };
    params.documentHash = hashCompositionDocument(params.document);
    context.documentHash = params.documentHash;
    await assert.rejects(compileCompositionPreview({ ...params, htmlEditingCompilation: context,
      target: "HYPERFRAMES_RENDER" }), /recursos locales/);
  }
});

test("global deck CSS cannot introduce a network dependency beside a local edited fragment", async () => {
  const { params, context } = compilationFixture();
  params.document.deckStyles = { css: '.slide { background: url("https://example.test/remote.png"); }',
    fontUrls: [], appearance: "dark" };
  params.documentHash = hashCompositionDocument(params.document);
  context.documentHash = params.documentHash;
  await assert.rejects(compileCompositionPreview({ ...params, htmlEditingCompilation: context,
    target: "HYPERFRAMES_RENDER" }), /recursos locales/);
});

test("legacy documents need no HTML context and cannot accept unrelated revision payloads", () => {
  const { input, context } = compilationFixture();
  assert.equal(compileCompositionHtmlEditingFragments({ document: input.document, assetUrls: new Map() }).size, 0);
  const documentHash = hashCompositionDocument(input.document);
  assert.throws(() => compileCompositionHtmlEditingFragments({ document: input.document, documentHash,
    assetUrls: new Map(), context: { ...context, documentHash } }), /REVISION_SET_MISMATCH/);
});

test("generic save/history cannot add, retarget or drop HTML references on a retained clip", () => {
  const input = fixture();
  const bound = bindHtmlEditingRevisionToComposition({ ...input.authority, document: input.document,
    revision: input.next.revision, revisionSha256: input.next.sha256 }).document;
  assert.equal(preservesCompositionHtmlRevisionReferences(input.document, bound), false);
  assert.equal(preservesCompositionHtmlRevisionReferences(bound, input.document), false);
  const changed = structuredClone(bound);
  changed.htmlEditing!.items[0]!.revisionSha256 = "f".repeat(64);
  assert.equal(preservesCompositionHtmlRevisionReferences(bound, changed), false);
  const moved = structuredClone(bound); moved.clips[0]!.layout.x += 5;
  assert.equal(preservesCompositionHtmlRevisionReferences(bound, moved), true);
  const deleted = applyCompositionEditorPatches(bound, [{ type: "clip.remove", clipId: bound.clips[0]!.id }]);
  assert.equal(preservesCompositionHtmlRevisionReferences(bound, deleted), true);
});

test("repository uses scoped read RPC with bounded signal and server grants", async () => {
  const testHost = host();
  const result = await testHost.repository.readAuthorized(testHost.input.request);
  assert.deepEqual(result.grantedAssetIds, [uuid, other]);
  assert.deepEqual(testHost.calls[0]!.args, { p_actor_id: uuid, p_organization_id: uuid,
    p_draft_id: uuid, p_clip_id: testHost.input.request.scope.clipId });
  assert.ok(testHost.calls[0]!.signal instanceof AbortSignal);
});

test("one append RPC carries exact native document, revision, CAS and all actually used resources", async () => {
  const testHost = host();
  assert.deepEqual(await testHost.repository.appendCompareAndSwap(testHost.append), testHost.state.acknowledgement);
  assert.deepEqual(testHost.calls.map(call => call.name), ["read_html_editing_revision", "append_html_editing_revision"]);
  const args = testHost.calls[1]!.args;
  assert.equal(args.p_document.format, "courseforge-composition-v4");
  assert.equal(args.p_document_hash, hashCompositionDocument(args.p_document));
  assert.equal(args.p_revision_sha256, testHost.input.next.sha256);
  assert.equal(args.p_document.htmlEditing.items[0].revisionSha256, args.p_revision_sha256);
  assert.deepEqual(args.p_used_asset_ids, [uuid]);
  assert.equal(args.p_expected_document_hash, testHost.input.row.compositionDocumentHash);
  assert.equal(args.p_revision.sourceHtml, testHost.input.current.revision.sourceHtml);
});

test("repository re-read conflicts reject before native append", async () => {
  const testHost = host();
  assert.deepEqual(await testHost.repository.appendCompareAndSwap({ ...testHost.append,
    expectedCompositionDocumentHash: "f".repeat(64) }), { status: "CONFLICT" });
  assert.equal(testHost.calls.length, 1);
});

test("stored content/hash, tenant, foreign grants and native hash mismatch fail closed", async () => {
  for (const mode of ["revision", "tenant", "grants", "native", "source"] as const) {
    const testHost = host();
    if (mode === "revision") testHost.state.row.revisionSha256 = "f".repeat(64);
    if (mode === "tenant") testHost.state.row.revision.manifest.binding.organizationId = other;
    if (mode === "grants") testHost.state.row.grantedAssetIds.push("33333333-3333-4333-8333-333333333333");
    if (mode === "native") testHost.state.row.compositionDocumentHash = "f".repeat(64);
    if (mode === "source") testHost.state.row.revision.sourceHtml += " ";
    await assert.rejects(testHost.repository.readAuthorized(testHost.input.request));
    assert.equal(testHost.calls.some(call => call.name === "append_html_editing_revision"), false);
  }
});

test("revocation between preparation and append prevents publishing an unauthorized new image", async () => {
  const testHost = host();
  const revision = structuredClone(testHost.input.next.revision);
  revision.state.overrides = [{ operation: "SET_IMAGE", elementId: "photo", assetId: other, fit: "COVER" }];
  const verified = verifyHtmlEditingRevision({ ...testHost.input.authority, encodedRevision: JSON.stringify(revision) });
  testHost.state.row.grantedAssetIds = [uuid];
  await assert.rejects(testHost.repository.appendCompareAndSwap({ ...testHost.append,
    revision: verified.revision, sha256: verified.sha256 }), /ASSET_NOT_AUTHORIZED/);
  assert.equal(testHost.calls.length, 1);
});

test("bad commit acknowledgement and provider error are unconfirmed without automatic retries", async () => {
  for (const acknowledgement of [null, { status: "COMMITTED", version: 3, sha256: "f".repeat(64) }, { status: "UNKNOWN" }]) {
    const testHost = host(); testHost.state.acknowledgement = acknowledgement;
    await assert.rejects(testHost.repository.appendCompareAndSwap(testHost.append), /COMMIT_UNCONFIRMED/);
    assert.equal(testHost.calls.length, 2);
  }
  const testHost = host(); testHost.state.error = true;
  await assert.rejects(testHost.repository.readAuthorized(testHost.input.request), /READ_UNAVAILABLE/);
});

test("invalid actor/scope and pre-cancelled calls never reach the database", async () => {
  const testHost = host();
  await assert.rejects(testHost.repository.readAuthorized({ ...testHost.input.request, actorId: "bad" }), /INVALID_REVISION/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(testHost.repository.readAuthorized({ ...testHost.input.request, signal: controller.signal }));
  assert.equal(testHost.calls.length, 0);
});
