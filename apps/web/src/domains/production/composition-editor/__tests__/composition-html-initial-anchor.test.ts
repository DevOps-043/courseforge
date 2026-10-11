import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readHtmlInitialAnchor, prepareHtmlInitialAnchor, type InitialHtmlAnchorFreezer } from "../composition-html-initial-anchor.server";
import { requestHtmlInitialAnchor } from "../composition-html-initial-anchor.client";
import { createHtmlInitialAnchorHandler } from "../http/composition-html-initial-anchor-handler.server";
import type { HtmlInitialAnchorCommand } from "../composition-html-initial-anchor.contract";
import { snapshotCompositionDocument } from "../composition-snapshot.service";
import JSZip from "jszip";
import { generatedDeckIntegrationFixture } from "../../slides/__tests__/generated-deck-integration-fixture";
import { generatedDeckFontFixture } from "../../slides/__tests__/generated-deck-font-fixture";
import { readGeneratedCourseDeckEditorial } from "../../slides/generation/course-deck-editorial-reader.server";
import { generatedDeckInitialSource, instantiateGeneratedDeckDocument } from "../composition-generated-deck-import.server";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document-hash";
import { getHyperframesRenderProfile } from "../../hyperframes/hyperframes-render-profiles";

const uuid = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
function scenario() {
  const command: HtmlInitialAnchorCommand = { organizationId: uuid, actorId: uuid, documentId: uuid, expectedDocumentHash: "a".repeat(64) };
  const state = { view: { documentId: uuid, compositionId: other, documentHash: command.expectedDocumentHash, activeRevisionId: null as string | null },
    enabled: true, authenticated: true, role: "ADMIN", allowed: true, failure: "", freezeCalls: 0, readOverride: undefined as unknown };
  const calls: Array<{ name: string; args: Record<string,unknown> }> = [];
  const client = { rpc: (name: string, args: Record<string,unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted(); calls.push({ name, args });
    if (name === "consume_api_rate_limit") return { data: [{ allowed: state.allowed }], error: null };
    if (state.failure === name) return { data: null, error: { message: "PRIVATE_PROVIDER_PAYLOAD" } };
    if (name === "activate_initial_html_editing_anchor") { state.view.activeRevisionId = uuid; return { data: null, error: null }; }
    return { data: state.readOverride ?? structuredClone(state.view), error: null };
  } }) } as unknown as SupabaseClient;
  const freeze: InitialHtmlAnchorFreezer = async (params) => {
    state.freezeCalls++;
    assert.equal(params.compositionId, other); assert.equal(params.organizationId, uuid); assert.equal(params.userId, uuid);
    assert.deepEqual(params.initialEditorialAnchor, { expectedDocumentHash: command.expectedDocumentHash });
    return { id: uuid, documentHash: command.expectedDocumentHash };
  };
  const handler = createHtmlInitialAnchorHandler({ enabled: () => state.enabled,
    authenticate: async () => ({ actorId: state.authenticated ? uuid : null, tenant: { userId: uuid, organizationId: uuid, platformRole: state.role } }),
    serviceClient: () => client, read: readHtmlInitialAnchor,
    prepare: (provided, input, signal) => prepareHtmlInitialAnchor(provided, input, signal, freeze),
    logFailure: () => { throw new Error("PRIVATE_LOGGING_PAYLOAD"); },
  });
  const request = (method = "GET", body: unknown = { expectedDocumentHash: command.expectedDocumentHash }, origin = "https://app.example") =>
    new Request(`https://app.example/anchor${method === "GET" ? `?expectedDocumentHash=${command.expectedDocumentHash}` : ""}`, {
      method, headers: { origin, "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
  return { command, state, calls, client, freeze, handler, request, signal: new AbortController().signal };
}

test("GET only reads authorized availability: never freezes, registers, activates or claims a receipt", async () => {
  const f = scenario(), response = await f.handler(f.request(), { draftId: uuid });
  assert.equal(response.status, 200); assert.equal(f.state.freezeCalls, 0);
  assert.deepEqual(f.calls.map(call => call.name), ["consume_api_rate_limit", "consume_api_rate_limit", "read_initial_html_editing_anchor"]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const encoded = await response.text();
  for (const forbidden of ["sourceHtml", "storagePath", "templateId", "receipt", "grantedAssetIds"]) assert.ok(!encoded.includes(forbidden));
});

test("POST freezes exactly the saved hash then activates only through draft-locked authority", async () => {
  const f = scenario(), response = await f.handler(f.request("POST"), { draftId: uuid });
  assert.equal(response.status, 200); assert.equal(f.state.freezeCalls, 1);
  assert.deepEqual(f.calls.slice(2).map(call => call.name), ["read_initial_html_editing_anchor", "activate_initial_html_editing_anchor", "read_initial_html_editing_anchor"]);
  assert.deepEqual(f.calls[3].args, { p_org: uuid, p_actor: uuid, p_draft: uuid, p_expected_hash: f.command.expectedDocumentHash, p_revision: uuid });
  assert.equal((await response.json()).data.activeRevisionId, uuid);
});

test("an existing real anchor is availability, never reactivated or replaced", async () => {
  const f = scenario(); f.state.view.activeRevisionId = other;
  const view = await prepareHtmlInitialAnchor(f.client, f.command, f.signal, f.freeze);
  assert.equal(view.activeRevisionId, other); assert.equal(f.state.freezeCalls, 0);
  assert.deepEqual(f.calls.map(call => call.name), ["read_initial_html_editing_anchor"]);
});

test("authorization, feature gate, cross-origin and quota prevent expensive work", async () => {
  for (const mode of ["disabled", "unauthenticated", "role", "origin", "quota"] as const) {
    const f = scenario();
    if (mode === "disabled") f.state.enabled = false;
    if (mode === "unauthenticated") f.state.authenticated = false;
    if (mode === "role") f.state.role = "STUDENT";
    if (mode === "quota") f.state.allowed = false;
    const response = await f.handler(f.request("POST", undefined, mode === "origin" ? "https://evil.example" : undefined), { draftId: uuid });
    assert.equal(response.status, { disabled: 503, unauthenticated: 401, role: 403, origin: 403, quota: 429 }[mode]);
    assert.equal(f.state.freezeCalls, 0); assert.ok(!f.calls.some(call => call.name !== "consume_api_rate_limit"));
  }
});

test("client authority extras, duplicate query and excessive JSON are rejected", async () => {
  for (const extra of [{ organizationId: other }, { revisionId: other }, { sourceHtml: "forged" }]) {
    const f = scenario(); assert.equal((await f.handler(f.request("POST", { expectedDocumentHash: f.command.expectedDocumentHash, ...extra }), { draftId: uuid })).status, 400);
    assert.equal(f.state.freezeCalls, 0);
  }
  const f = scenario();
  const repeated = new Request(`${f.request().url}&expectedDocumentHash=${f.command.expectedDocumentHash}`);
  assert.equal((await f.handler(repeated, { draftId: uuid })).status, 400);
  assert.equal((await f.handler(f.request("POST", { padding: "x".repeat(1025) }), { draftId: uuid })).status, 413);
});

test("RPC failures and stale/foreign results fail closed without fallback freeze", async () => {
  for (const mode of ["failure", "document", "hash", "oversized"] as const) {
    const f = scenario();
    if (mode === "failure") f.state.failure = "read_initial_html_editing_anchor";
    else f.state.readOverride = { ...f.state.view, ...(mode === "document" ? { documentId: other }
      : mode === "hash" ? { documentHash: "b".repeat(64) } : { secret: "x".repeat(3000) }) };
    await assert.rejects(prepareHtmlInitialAnchor(f.client, f.command, f.signal, f.freeze));
    assert.equal(f.state.freezeCalls, 0);
  }
});

test("unknown activation has no automatic retry and GET reconciliation is prerequisite availability only", async () => {
  const f = scenario(); f.state.failure = "activate_initial_html_editing_anchor";
  const response = await f.handler(f.request("POST"), { draftId: uuid });
  assert.equal(response.status, 503); assert.equal(f.state.freezeCalls, 1);
  assert.equal(f.calls.filter(call => call.name === "activate_initial_html_editing_anchor").length, 1);
  assert.ok(!(await response.text()).includes("PRIVATE"));
  f.state.failure = ""; f.state.view.activeRevisionId = other;
  assert.equal((await f.handler(f.request(), { draftId: uuid })).status, 200);
  assert.equal(f.state.freezeCalls, 1);
});

test("abort after freeze never issues an activation", async () => {
  const f = scenario(), controller = new AbortController();
  const freeze: InitialHtmlAnchorFreezer = async () => { controller.abort(); return { id: uuid, documentHash: f.command.expectedDocumentHash }; };
  await assert.rejects(prepareHtmlInitialAnchor(f.client, f.command, controller.signal, freeze));
  assert.deepEqual(f.calls.map(call => call.name), ["read_initial_html_editing_anchor"]);
});

test("browser transport uses one bounded request with exact owner/hash and never retries writes", async () => {
  for (const action of ["CONSULT", "PREPARE"] as const) {
    const f = scenario(); let requests = 0;
    const view = await requestHtmlInitialAnchor({ documentId: uuid, expectedDocumentHash: f.command.expectedDocumentHash, action, signal: f.signal,
      fetcher: async (_url, options) => {
        requests++; assert.equal(options?.method, action === "CONSULT" ? "GET" : "POST");
        assert.ok(String(_url).includes(`/drafts/${uuid}/html-editing-initial-anchor`));
        assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store");
        return Response.json({ success: true, requestId: uuid, correlationId: uuid, data: f.state.view });
      } });
    assert.deepEqual(view, f.state.view); assert.equal(requests, 1);
  }
  const f = scenario(); let requests = 0;
  await assert.rejects(requestHtmlInitialAnchor({ documentId: uuid, expectedDocumentHash: f.command.expectedDocumentHash, action: "PREPARE", signal: f.signal,
    fetcher: async () => { requests++; throw new Error("network uncertain"); } }));
  assert.equal(requests, 1);
  await assert.rejects(requestHtmlInitialAnchor({ documentId: uuid, expectedDocumentHash: f.command.expectedDocumentHash, action: "CONSULT", signal: f.signal,
    fetcher: async () => Response.json({ success: true, requestId: uuid, correlationId: other, data: f.state.view }) }));
});

test("prepared SQL retains tenant/actor/CAS, current resource validation and first-only activation", () => {
  const sql = readFileSync(resolve("../../supabase/migrations/20261010200000_initial_html_editing_anchor.sql"), "utf8");
  assert.match(sql, /private\.assert_html_editing_actor\(p_org,p_actor\)/);
  assert.match(sql, /FOR UPDATE NOWAIT/);
  assert.match(sql, /native\.document_hash IS DISTINCT FROM p_expected_hash/);
  assert.match(sql, /IF composition\.active_revision_id IS NOT NULL THEN RAISE EXCEPTION/);
  assert.match(sql, /private\.html_snapshot_resource_bindings/);
  assert.match(sql, /FROM PUBLIC,anon,authenticated/);
  assert.doesNotMatch(sql, /UPDATE public\.video_composition_draft_documents|DELETE |DROP /);
});

for (const withFont of [false, true]) test(`real snapshot freezer packages generated slides${withFont ? " with uploaded font bytes" : ""}, without activating or reusing a partial legacy row`, async () => {
  const fontFixture = withFont ? generatedDeckFontFixture() : null;
  const fixture = fontFixture ?? generatedDeckIntegrationFixture();
  const verified = (await readGeneratedCourseDeckEditorial({ ...fixture, supabase: fixture.client }))!;
  const document = instantiateGeneratedDeckDocument(createInitialCompositionDocument({ animatedDeck: generatedDeckInitialSource(verified),
    assets: [], plan: { title: "Primer ensamble", subtitle: "Prueba", accentColor: "#00aabb", durationSeconds: 20 } }), verified);
  document.canvas.durationMode = "USER_EDITED";
  const documentHash = hashCompositionDocument(document);
  let archive: Uint8Array | null = null, registered: Record<string,unknown> | null = null, updates = 0, revisionReads = 0;
  const client = { from: (table: string) => {
    let inserted = false;
    const result = () => ({ error: null, data: table === "video_compositions" ? { id: fixture.compositionId, status: "DRAFT" }
      : table === "video_composition_drafts" ? { id: fixture.draftId, composition_id: fixture.compositionId, state: "ACTIVE" }
        : table === "video_composition_draft_documents" ? { document, document_hash: documentHash, version: 1 }
          : table === "profiles" ? { id: uuid } : table === "video_composition_revisions" ? inserted
            ? { id: uuid, revision_number: 1, project_hash: "b".repeat(64), project_archive_size_bytes: 1000 } : null
              : table === "organization_slide_fonts" && fontFixture ? [fontFixture.row] : [] });
    const query = { select: () => query, eq: () => query, in: () => query, contains: () => query, is: () => query, order: () => query, limit: () => query,
      insert: (row: Record<string,unknown>) => { inserted = true; registered = row; return query; },
      update: () => { updates++; throw new Error("Deferred freeze must not activate"); },
      maybeSingle: async () => { if (table === "video_composition_revisions") revisionReads++; return result(); }, single: async () => result(),
      then: (accept: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(accept(result())) };
    return query;
  }, storage: { from: (bucket: string) => ({ upload: async (_path: string, bytes: Uint8Array) => { archive = bytes; return { error: null }; },
    download: async (path: string) => {
      assert.ok(fontFixture); assert.equal(bucket, "organization-fonts"); assert.equal(path, fontFixture.row.storage_path);
      return { data: new Blob([fontFixture.bytes]), error: null };
    } }) } } as unknown as SupabaseClient;
  const params = { compositionId: fixture.compositionId, draftId: fixture.draftId, organizationId: fixture.organizationId,
    userId: uuid, renderProfile: getHyperframesRenderProfile("balanced"), supabase: client, initialEditorialAnchor: { expectedDocumentHash: documentHash } };
  await assert.rejects(snapshotCompositionDocument({ ...params, initialEditorialAnchor: { expectedDocumentHash: "f".repeat(64) } }), /borrador cambió/);
  assert.equal(archive, null);
  const frozen = await snapshotCompositionDocument(params);
  assert.equal(frozen.documentHash, documentHash); assert.equal(updates, 0); assert.equal(revisionReads, 1);
  assert.ok(archive); assert.ok(registered);
  const zip = await JSZip.loadAsync(archive);
  assert.deepEqual(JSON.parse(await zip.file("composition-document.json")!.async("string")), document);
  const html = await zip.file("index.html")!.async("string");
  assert.match(html, /deck-slide/); assert.equal(document.htmlEditing?.items.length ?? 0, 0);
  if (fontFixture) {
    const path = `assets/fonts/${fontFixture.row.checksum_sha256}.woff2`;
    assert.deepEqual(await zip.file(path)!.async("uint8array"), fontFixture.bytes);
    assert.ok(html.includes(path)); assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
    const fontManifest = JSON.parse(await zip.file("font-manifest.json")!.async("string"));
    assert.equal(fontManifest[0].fontAssetId, fontFixture.fontId);
    assert.equal(fontManifest[0].checksumSha256, fontFixture.row.checksum_sha256);
  }
});
