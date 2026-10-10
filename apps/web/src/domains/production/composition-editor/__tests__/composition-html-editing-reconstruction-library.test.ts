import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HTML_RECONSTRUCTION_LIBRARY_POLICY as policy, htmlReconstructionLibraryQuerySchema, htmlReconstructionLibraryPageSchema,
  type HtmlReconstructionLibraryPage, type HtmlReconstructionLibraryRequest } from "../composition-html-editing-reconstruction-library.contract";
import { readAuthorizedHtmlReconstructionLibrary, HtmlReconstructionLibraryConflict } from "../composition-html-editing-reconstruction-library.server";
import { createHtmlReconstructionLibraryHandler } from "../http/composition-html-editing-reconstruction-library-handler.server";
import { consultHtmlReconstructionLibrary, HtmlReconstructionLibraryReadError } from "../composition-html-editing-reconstruction-library.client";
import { initializeHtmlReconstructionLibrary, appendHtmlReconstructionLibraryPage } from "../composition-html-editing-reconstruction-library-selection";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const assetId = (index: number) => `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
const request: HtmlReconstructionLibraryRequest = {actorId: uuid, organizationId: uuid, draftId: other, query: {compositionId: other}};
function page(start = 1, count = 20, more = true): HtmlReconstructionLibraryPage {
  const assets = Array.from({length: count}, (_, index) => ({productionAssetId: assetId(start + index), checksum: "a".repeat(64),
    fileSizeBytes: 1024, mimeType: "image/png" as const, label: `Imagen ${start + index}`, durationSeconds: null, hasAudio: null,
    sourceWidth: 320, sourceHeight: 180, timelineRole: "MEDIA" as const, timelineVariant: null}));
  return {scope: "CURRENT_LINKED_RECONSTRUCTION_LIBRARY_NOT_RESOURCE_GRANT", organizationId: uuid, compositionId: other, draftId: other,
    currentDocumentHash: "b".repeat(64), currentVersion: 2, afterAssetId: start === 1 ? null : assetId(start - 1),
    assets, nextAssetId: more ? assets.at(-1)!.productionAssetId : null};
}
function backend() {
  const calls: Array<{name: string; parameters: Record<string, unknown>}> = [], state = {data: page() as unknown,
    error: null as null | {message: string}, allowed: true};
  const supabase = {rpc: (name: string, parameters: Record<string, unknown>) => ({abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted(); calls.push({name, parameters});
    if (name === "consume_api_rate_limit") return {data: [{allowed: state.allowed, reset_at: "2026-10-10T00:00:00Z"}], error: null};
    assert.equal(name, "read_html_reconstruction_library");
    return {data: structuredClone(state.data), error: state.error};
  }})} as unknown as SupabaseClient;
  return {supabase, state, calls};
}
function handler(f = backend(), enabled = true) {
  return {f, handle: createHtmlReconstructionLibraryHandler({enabled: () => enabled,
    authenticate: async () => ({actorId: uuid, tenant: {organizationId: uuid, userId: uuid, platformRole: "ADMIN"}}),
    serviceClient: () => f.supabase,
    read: (supabase, command, signal) => readAuthorizedHtmlReconstructionLibrary({supabase, request: command, signal})})};
}
const envelope = (data: unknown) => Response.json({success: true, requestId: uuid, correlationId: uuid, data});

test("library reader performs one bounded current-authority RPC and returns only the new linked metadata", async () => {
  const f = backend(); assert.deepEqual(await readAuthorizedHtmlReconstructionLibrary({supabase: f.supabase, request}), page());
  assert.deepEqual(f.calls, [{name: "read_html_reconstruction_library", parameters: {p_org: uuid, p_actor: uuid, p_composition: other,
    p_draft: other, p_after_asset: null, p_expected_hash: null, p_expected_version: null}}]);
  const encoded = JSON.stringify(f.state.data); assert.doesNotMatch(encoded, /storagePath|storageBucket|sourceHtml|signedUrl|sourceDraftId/);
});
test("cursor requests require paired exact native identity and preserve every RPC parameter", async () => {
  const f = backend(); f.state.data = page(21, 3, false);
  const query = {compositionId: other, afterAssetId: assetId(20), expectedDocumentHash: "b".repeat(64), expectedVersion: 2};
  assert.deepEqual(await readAuthorizedHtmlReconstructionLibrary({supabase: f.supabase, request: {...request, query}}), f.state.data);
  assert.equal(f.calls[0]!.parameters.p_expected_hash, query.expectedDocumentHash); assert.equal(f.calls[0]!.parameters.p_expected_version, 2);
  for (const malformed of [{compositionId: other, afterAssetId: assetId(20)}, {...query, expectedVersion: undefined},
    {compositionId: other, expectedVersion: 2, expectedDocumentHash: query.expectedDocumentHash}, {...query, actorId: uuid}])
    assert.equal(htmlReconstructionLibraryQuerySchema.safeParse(malformed).success, false);
});
test("reader rejects changed owner/cursor/identity, unknown fields, duplicates, unordered rows and impossible cursors", async () => {
  const first = page();
  for (const changed of [{organizationId: other}, {draftId: uuid}, {compositionId: uuid}, {afterAssetId: assetId(1)},
    {currentVersion: 0}, {storagePath: "PRIVATE"}, {nextAssetId: assetId(19)}, {assets: [...first.assets].reverse()},
    {assets: [first.assets[0], first.assets[0]]}, {assets: [{...first.assets[0], label: "x".repeat(201)}]},
    {assets: [{...first.assets[0], mimeType: "image/svg+xml"}]}, {assets: [...first.assets, first.assets[0]]}]) {
    const f = backend(); f.state.data = {...first, ...changed};
    await assert.rejects(readAuthorizedHtmlReconstructionLibrary({supabase: f.supabase, request}), /^Error: HTML_RECONSTRUCTION_LIBRARY_UNAVAILABLE$/);
  }
});
test("provider detail and oversized response cannot leak, cancellation performs no RPC and known conflict stays typed", async () => {
  const f = backend(); f.state.error = {message: "PRIVATE_DB_PATH_AND_TOKEN"};
  await assert.rejects(readAuthorizedHtmlReconstructionLibrary({supabase: f.supabase, request}), /^Error: HTML_RECONSTRUCTION_LIBRARY_UNAVAILABLE$/);
  f.state.error = {message: "HTML_RECONSTRUCTION_LIBRARY_BASE_CHANGED"};
  await assert.rejects(readAuthorizedHtmlReconstructionLibrary({supabase: f.supabase, request}), HtmlReconstructionLibraryConflict);
  f.state.error = null; f.state.data = "x".repeat(policy.responseBytes + 1);
  await assert.rejects(readAuthorizedHtmlReconstructionLibrary({supabase: f.supabase, request}), /UNAVAILABLE/);
  const cancelled = backend();
  await assert.rejects(readAuthorizedHtmlReconstructionLibrary({supabase: cancelled.supabase, request, signal: AbortSignal.abort()}));
  assert.deepEqual(cancelled.calls, []);
});
test("HTTP derives actor/tenant, enforces two quotas and private no-store, and makes no mutation calls", async () => {
  const {f, handle} = handler(); const response = await handle(new Request(`https://app.test/library?compositionId=${other}`), {draftId: other});
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(f.calls.map(call => call.name), ["consume_api_rate_limit", "consume_api_rate_limit", "read_html_reconstruction_library"]);
  assert.equal(f.calls.at(-1)!.parameters.p_actor, uuid); assert.equal(f.calls.at(-1)!.parameters.p_org, uuid);
  assert.deepEqual((await response.json()).data, page());
});
test("HTTP rejects foreign origin/method/query, disabled gate, quota exhaustion and returns controlled conflict", async () => {
  const {f, handle} = handler(), url = `https://app.test/library?compositionId=${other}`;
  for (const [req, status] of [[new Request(`${url}&actorId=${uuid}`), 400], [new Request(`${url}&compositionId=${other}`), 400],
    [new Request(`${url}&afterAssetId=${uuid}`), 400], [new Request(url, {method: "POST"}), 405],
    [new Request(url, {headers: {origin: "https://foreign.test"}}), 403]] as const)
    assert.equal((await handle(req, {draftId: other})).status, status);
  assert.deepEqual(f.calls, []);
  assert.equal((await handler(f, false).handle(new Request(url), {draftId: other})).status, 503);
  f.state.allowed = false; assert.equal((await handle(new Request(url), {draftId: other})).status, 429);
  assert.equal(f.calls.length, 1);
  f.state.allowed = true; f.state.error = {message: "HTML_RECONSTRUCTION_LIBRARY_BASE_CHANGED"};
  assert.equal((await handle(new Request(url), {draftId: other})).status, 409);
});
test("client sends one bounded GET with no actor/organization and checks target/base/correlation", async () => {
  const urls: string[] = [];
  const result = await consultHtmlReconstructionLibrary({request: {draftId: other, query: request.query}, signal: AbortSignal.timeout(10_000),
    fetcher: async (url, options) => {urls.push(String(url)); assert.equal(options?.credentials, "same-origin");
      assert.equal(options?.redirect, "error"); assert.equal(options?.method, "GET"); return envelope(page());}});
  assert.deepEqual(result, page()); assert.deepEqual(urls, [`/api/production/hyperframes/drafts/${other}/html-reconstruction-library?compositionId=${other}`]);
  for (const changed of [{draftId: uuid}, {compositionId: uuid}, {afterAssetId: uuid}, {sourceHtml: "PRIVATE"}])
    await assert.rejects(consultHtmlReconstructionLibrary({request: {draftId: other, query: request.query}, signal: AbortSignal.timeout(10_000),
      fetcher: async () => envelope({...page(), ...changed})}), HtmlReconstructionLibraryReadError);
});
test("client rejects redirects, oversized/malformed response and cancellation, conflict never retries", async () => {
  let calls = 0;
  const fetcher = async () => {calls++; return new Response("PRIVATE", {status: 409});};
  await assert.rejects(consultHtmlReconstructionLibrary({request: {draftId: other, query: request.query}, signal: AbortSignal.timeout(10_000), fetcher}),
    (error: unknown) => error instanceof HtmlReconstructionLibraryReadError && error.baseChanged);
  assert.equal(calls, 1);
  await assert.rejects(consultHtmlReconstructionLibrary({request: {draftId: other, query: request.query}, signal: AbortSignal.abort(), fetcher}));
  assert.equal(calls, 1);
  const redirected = envelope(page()); Object.defineProperty(redirected, "redirected", {value: true});
  for (const response of [redirected, Response.json({success: true, requestId: uuid, correlationId: other, data: page()}),
    Response.json({text: "x".repeat(policy.responseBytes + 1024)}), new Response("{}", {headers: {"content-type": "text/html"}})])
    await assert.rejects(consultHtmlReconstructionLibrary({request: {draftId: other, query: request.query}, signal: AbortSignal.timeout(10_000),
      fetcher: async () => response}), HtmlReconstructionLibraryReadError);
});
test("authenticated reader denies missing/cross-tenant/nonreviewer sessions before quotas or resource reads", async () => {
  const f = backend();
  for (const authentication of [{actorId: null, tenant: null}, {actorId: uuid, tenant: null},
    {actorId: uuid, tenant: {organizationId: uuid, userId: other, platformRole: "ADMIN"}},
    {actorId: uuid, tenant: {organizationId: uuid, userId: uuid, platformRole: "STUDENT"}}]) {
    const handle = createHtmlReconstructionLibraryHandler({enabled: () => true, authenticate: async () => authentication,
      serviceClient: () => f.supabase, read: async () => {throw new Error("MUST_NOT_READ");}});
    const response = await handle(new Request(`https://app.test/library?compositionId=${other}`), {draftId: other});
    assert.ok(response.status === 401 || response.status === 403);
  }
  assert.deepEqual(f.calls, []);
});
test("next-page client preserves cursor and base pins but rejects substituted current identity", async () => {
  const query = {compositionId: other, afterAssetId: assetId(20), expectedDocumentHash: "b".repeat(64), expectedVersion: 2};
  let calls = 0;
  assert.deepEqual(await consultHtmlReconstructionLibrary({request: {draftId: other, query}, signal: AbortSignal.timeout(10_000),
    fetcher: async (url) => {calls++; const parsed = new URL(String(url), "https://app.test");
      assert.equal(parsed.searchParams.get("afterAssetId"), assetId(20)); assert.equal(parsed.searchParams.get("expectedVersion"), "2");
      assert.equal(parsed.searchParams.get("expectedDocumentHash"), query.expectedDocumentHash);
      assert.equal(parsed.searchParams.get("actorId"), null); assert.equal(parsed.searchParams.get("organizationId"), null);
      return envelope(page(21, 3, false));}}), page(21, 3, false));
  assert.equal(calls, 1);
  for (const changed of [{currentDocumentHash: "c".repeat(64)}, {currentVersion: 3}])
    await assert.rejects(consultHtmlReconstructionLibrary({request: {draftId: other, query}, signal: AbortSignal.timeout(10_000),
      fetcher: async () => envelope({...page(21, 3, false), ...changed})}), HtmlReconstructionLibraryReadError);
});
test("selection appends disjoint authorized pages without modifying input or losing previously loaded metadata", () => {
  const first = page(), original = structuredClone(first), previous = initializeHtmlReconstructionLibrary(first);
  const next = page(21, 3, false), result = appendHtmlReconstructionLibraryPage({previous, next});
  assert.equal(result.assets.length, 23); assert.equal(result.page.nextAssetId, null);
  assert.deepEqual(first, original); assert.equal(previous.assets.length, 20);
  assert.throws(() => initializeHtmlReconstructionLibrary(next));
});
test("SQL Unicode code-point labels are admitted without exceeding the bounded response or native UTF-16 display budget", () => {
  const unicode = {...page(1, 1, false), assets: [{...page(1, 1, false).assets[0]!, label: "🙂".repeat(200)}]};
  assert.equal(htmlReconstructionLibraryPageSchema.safeParse(unicode).success, true);
  assert.equal(htmlReconstructionLibraryPageSchema.safeParse({...unicode, assets: [{...unicode.assets[0], label: "🙂".repeat(201)}]}).success, false);
  const projected = unicode.assets[0]!.label.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, "");
  assert.equal(projected.length, 200); assert.equal([...projected].length, 100);
});
test("selection rejects stale base/owner/cursor pages and never exceeds manifest asset budget", () => {
  const previous = initializeHtmlReconstructionLibrary(page());
  for (const changed of [{organizationId: other}, {draftId: uuid}, {compositionId: uuid}, {currentDocumentHash: "c".repeat(64)},
    {currentVersion: 3}, {afterAssetId: assetId(19)}])
    assert.throws(() => appendHtmlReconstructionLibraryPage({previous, next: {...page(21, 3, false), ...changed}}));
  let collection = previous;
  for (let start = 21; start <= 221; start += 20) collection = appendHtmlReconstructionLibraryPage({previous: collection, next: page(start)});
  assert.equal(collection.assets.length, 240);
  assert.throws(() => appendHtmlReconstructionLibraryPage({previous: collection, next: page(241)}));
  assert.equal(collection.assets.length, 240);
});
test("SQL library uses new linked identities, current authorization, keyset/index bounds and no Storage/source export or writes", async () => {
  const sql = await readFile("../../supabase/migrations/20261010140000_read_html_reconstruction_library.sql", "utf8");
  const body = sql.replace(/^[\t ]*--.*$/gm, "");
  assert.match(body, /public\.read_html_reconstruction_opening\(p_org,p_actor,p_composition,p_draft\)/);
  assert.match(body, /l\.organization_id = p_org AND l\.draft_id = p_draft AND a\.organization_id = p_org/);
  assert.match(body, /a\.organization_id = l\.organization_id/); assert.match(body, /l\.production_asset_id > p_after_asset/);
  assert.match(body, /ORDER BY l\.production_asset_id LIMIT 21/); assert.match(body, /ORDER BY id LIMIT 20/);
  assert.match(body, /HTML_RECONSTRUCTION_LIBRARY_BASE_CHANGED/); assert.match(body, /SET lock_timeout = '2s'/);
  assert.match(body, /FROM PUBLIC,anon,authenticated/); assert.match(body, /TO service_role/);
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|UPSERT)\b|sourceHtml|material_component_id|storagePath|storageBucket|signedUrl|OFFSET/i);
  assert.equal(htmlReconstructionLibraryPageSchema.safeParse(page(1, 0, false)).success, true);
});
test("page loads authorized library and studio renders existing selector under independent identity, not original catalogue", async () => {
  const source = await readFile("src/app/admin/assembly/reconstruction/[draftId]/page.tsx", "utf8");
  assert.match(source, /readAuthorizedHtmlReconstructionLibrary/); assert.match(source, /initialLibrary=\{library\}/);
  assert.match(source, /draftId: route\.data\.draftId/);
  const studio = await readFile("src/domains/materials/components/composition-editor/CompositionHtmlReconstructionEditor.tsx", "utf8");
  assert.match(studio, /assets=\{assets\} componentId=\{null\}/); assert.match(studio, /appendHtmlReconstructionLibraryPage/);
  assert.match(studio, /inFlight\.current\?\.abort\(\)/); assert.match(studio, /controller\.signal\.throwIfAborted\(\)/);
  assert.match(studio, /previewUrl: null/);
  assert.doesNotMatch(studio, /getOrCreate|initializeHyperframesDraft|sourceDraftId|readStandaloneHtmlLibrary/);
});
