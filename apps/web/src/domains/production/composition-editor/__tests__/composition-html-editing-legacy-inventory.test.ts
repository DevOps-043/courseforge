import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HTML_LEGACY_INVENTORY_POLICY as policy, htmlLegacyInventoryPageSchema, htmlLegacyInventoryQuerySchema,
  htmlLegacyInventoryEnabled, type HtmlLegacyInventoryPage, type HtmlLegacyInventoryRequest } from "../composition-html-editing-legacy-inventory.contract";
import { readAuthorizedHtmlLegacyInventory, HtmlLegacyInventoryError } from "../composition-html-editing-legacy-inventory.server";
import { createHtmlLegacyInventoryHandler } from "../http/composition-html-editing-legacy-inventory-handler.server";
import { consultHtmlLegacyInventory } from "../composition-html-editing-legacy-inventory.client";

const actor = "11111111-1111-4111-8111-111111111111", draft = "22222222-2222-4222-8222-222222222222";
const composition = "33333333-3333-4333-8333-333333333333", hash = "a".repeat(64);
const request: HtmlLegacyInventoryRequest = {actorId: actor, organizationId: actor, draftId: draft, query: {compositionId: composition}};
const page: HtmlLegacyInventoryPage = {scope: "CURRENT_HTML_LEGACY_INVENTORY_NOT_ADMISSION_APPROVAL_OR_GRANT",
  organizationId: actor, compositionId: composition, draftId: draft, documentHash: hash, nativeVersion: 3,
  issuanceRevisionId: null, afterOrdinal: null, nextOrdinal: null,
  entries: [{ordinal: 2, clipId: "slide-intro", sourceSha256: "b".repeat(64), sourceBytes: 1024,
    nativePointerPresent: false, registeredTemplatePresent: false, template: null}]};
function fixture() {
  const calls: Array<{name: string; parameters: Record<string, unknown>}> = [], requests: Array<{url: string; options?: RequestInit}> = [];
  const state = {page: structuredClone(page) as unknown, error: null as {message: string} | null, authenticated: true, role: "ADMIN",
    allowed: true, enabled: true, tenant: actor, correlationMismatch: false};
  const supabase = {rpc: (name: string, parameters: Record<string, unknown>) => ({abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted(); calls.push({name, parameters});
    return name === "consume_api_rate_limit" ? {data: [{allowed: state.allowed, reset_at: "2026-10-10T00:00:00Z"}], error: null}
      : {data: state.page, error: state.error};
  }})} as unknown as SupabaseClient;
  const handler = createHtmlLegacyInventoryHandler({enabled: () => state.enabled, serviceClient: () => supabase,
    authenticate: async () => ({actorId: state.authenticated ? actor : null,
      tenant: state.authenticated ? {userId: actor, organizationId: state.tenant, platformRole: state.role} : null})});
  const fetcher: typeof fetch = async (url, options) => {
    requests.push({url: String(url), options});
    const response = await handler(new Request(new URL(String(url), "https://app.test"), options), {draftId: draft});
    if (!state.correlationMismatch) return response;
    const payload = await response.json(); return Response.json({...payload, correlationId: composition});
  };
  return {state, calls, requests, supabase, handler, fetcher};
}
const signal = () => AbortSignal.timeout(10_000);

test("inventory query ties ordinal cursor to exact saved hash/version without owner authority fields", () => {
  assert.equal(htmlLegacyInventoryQuerySchema.safeParse({compositionId: composition}).success, true);
  assert.equal(htmlLegacyInventoryQuerySchema.safeParse({compositionId: composition, afterOrdinal: "2", expectedDocumentHash: hash, expectedVersion: "3"}).success, true);
  for (const query of [{afterOrdinal: 2}, {expectedVersion: 3}, {expectedDocumentHash: hash}, {organizationId: actor},
    {afterOrdinal: 0, expectedDocumentHash: hash, expectedVersion: 3}, {afterOrdinal: 501, expectedDocumentHash: hash, expectedVersion: 3}])
    assert.equal(htmlLegacyInventoryQuerySchema.safeParse({compositionId: composition, ...query}).success, false);
  assert.equal(htmlLegacyInventoryEnabled({}), false);
  assert.equal(htmlLegacyInventoryEnabled({COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED: "true", COMPOSITION_HTML_LEGACY_INVENTORY_ENABLED: "true"}), true);
});
test("one metadata RPC derives explicit owner and does not acquire source or modify native", async () => {
  const f = fixture(); assert.deepEqual(await readAuthorizedHtmlLegacyInventory({supabase: f.supabase, request, signal: signal()}), page);
  assert.deepEqual(f.calls, [{name: "read_html_editing_legacy_inventory", parameters: {p_org: actor, p_actor: actor,
    p_composition: composition, p_draft: draft, p_after_ordinal: null, p_expected_hash: null, p_expected_version: null}}]);
  assert.doesNotMatch(JSON.stringify(page), /sourceHtml|storagePath|grantedAsset|encodedPilot|signedUrl/);
});
test("unregistered, revoked and mismatched source metadata remain visible without becoming compatible or approved", () => {
  const rows = [page.entries[0]!, {...page.entries[0]!, ordinal: 3, clipId: "other", registeredTemplatePresent: true,
    template: {templateId: "intro", templateVersion: 2, sourceSha256: "c".repeat(64), revoked: true}}];
  const parsed = htmlLegacyInventoryPageSchema.parse({...page, entries: rows});
  assert.equal(parsed.entries[0]!.template, null); assert.equal(parsed.entries[1]!.template!.revoked, true);
  assert.notEqual(parsed.entries[1]!.sourceSha256, parsed.entries[1]!.template!.sourceSha256);
});
test("schema rejects unknown source/approval fields, dishonest templates, duplicate IDs and unbounded pages/cursors", () => {
  for (const changed of [{sourceHtml: "PRIVATE"}, {approval: true}, {entries: [{...page.entries[0]!, registeredTemplatePresent: true}]},
    {entries: [page.entries[0]!, {...page.entries[0]!, ordinal: 3}]}, {entries: Array(21).fill(page.entries[0])}, {nextOrdinal: 2}])
    assert.equal(htmlLegacyInventoryPageSchema.safeParse({...page, ...changed}).success, false);
  assert.equal(htmlLegacyInventoryPageSchema.safeParse({...page, entries: [{...page.entries[0]!, sourceHtml: "PRIVATE"}]}).success, false);
});
test("repository rejects wrong owner/base/cursor and safely masks provider errors or oversized payloads", async () => {
  for (const changed of [{organizationId: draft}, {compositionId: actor}, {draftId: actor}, {afterOrdinal: 1},
    {privateError: "PRIVATE_TOKEN"}, {entries: Array(21).fill(page.entries[0])}]) {
    const f = fixture(); f.state.page = {...page, ...changed};
    await assert.rejects(readAuthorizedHtmlLegacyInventory({supabase: f.supabase, request, signal: signal()}), /HTML_LEGACY_INVENTORY_UNAVAILABLE/);
  }
  const f = fixture(); f.state.error = {message: "PRIVATE_SQL_SECRET"};
  await assert.rejects(readAuthorizedHtmlLegacyInventory({supabase: f.supabase, request, signal: signal()}), /HTML_LEGACY_INVENTORY_UNAVAILABLE/);
  f.state.error = {message: "HTML_LEGACY_INVENTORY_BASE_CHANGED"};
  await assert.rejects(readAuthorizedHtmlLegacyInventory({supabase: f.supabase, request, signal: signal()}), error => error instanceof HtmlLegacyInventoryError && error.baseChanged);
  const next = {...request, query: {...request.query, afterOrdinal: 2, expectedDocumentHash: hash, expectedVersion: 3}};
  f.state.error = null; f.state.page = {...page, afterOrdinal: 2, nativeVersion: 4, entries: []};
  await assert.rejects(readAuthorizedHtmlLegacyInventory({supabase: f.supabase, request: next, signal: signal()}));
});
test("concrete HTTP+client make one bounded no-store GET and never serialize actor/tenant or retry", async () => {
  const f = fixture(); assert.deepEqual(await consultHtmlLegacyInventory({request, signal: signal(), fetcher: f.fetcher}), page);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0]!.options!.method, "GET");
  assert.equal(f.requests[0]!.options!.cache, "no-store"); assert.equal(f.requests[0]!.options!.redirect, "error");
  assert.doesNotMatch(f.requests[0]!.url, /actorId|organizationId/);
  const response = await f.handler(new Request(`https://app.test/inventory?compositionId=${composition}`), {draftId: draft});
  assert.match(response.headers.get("Cache-Control")!, /no-store/);
  f.state.correlationMismatch = true;
  await assert.rejects(consultHtmlLegacyInventory({request, signal: signal(), fetcher: f.fetcher}));
  assert.equal(f.requests.length, 2);
});
test("HTTP security rejects missing auth, role, owner queries, duplicates, cross-origin and quota before inventory RPC", async () => {
  const f = fixture(), base = `https://app.test/inventory?compositionId=${composition}`;
  const read = (url = base, headers?: HeadersInit) => f.handler(new Request(url, {headers}), {draftId: draft});
  f.state.authenticated = false; assert.equal((await read()).status, 401); f.state.authenticated = true;
  f.state.role = "VIEWER"; assert.equal((await read()).status, 403); f.state.role = "ADMIN";
  assert.equal((await read(`${base}&actorId=${actor}`)).status, 400);
  assert.equal((await read(`${base}&compositionId=${composition}`)).status, 400);
  assert.equal((await read(base, {origin: "https://foreign.test"})).status, 403);
  f.state.allowed = false; assert.equal((await read()).status, 429);
  f.state.enabled = false; assert.equal((await read()).status, 503);
  assert.equal(f.calls.filter(call => call.name === "read_html_editing_legacy_inventory").length, 0);
});
test("stale pages and revoked tenant cannot return cached success or make a second inventory read", async () => {
  const f = fixture(); f.state.error = {message: "HTML_LEGACY_INVENTORY_BASE_CHANGED"};
  await assert.rejects(consultHtmlLegacyInventory({request: {...request, query: {...request.query, afterOrdinal: 2,
    expectedDocumentHash: hash, expectedVersion: 3}}, signal: signal(), fetcher: f.fetcher}), /Reinicia el inventario/);
  assert.equal(f.calls.filter(call => call.name === "read_html_editing_legacy_inventory").length, 1);
  const count = f.calls.length; f.state.authenticated = false;
  await assert.rejects(consultHtmlLegacyInventory({request, signal: signal(), fetcher: f.fetcher}));
  assert.equal(f.calls.length, count);
});
test("empty inventory is explicit, abort prevents all HTTP, and unknown/malformed responses never execute HTML", async () => {
  const f = fixture(); f.state.page = {...page, entries: []};
  assert.equal((await consultHtmlLegacyInventory({request, signal: signal(), fetcher: f.fetcher})).entries.length, 0);
  const count = f.requests.length;
  await assert.rejects(consultHtmlLegacyInventory({request, signal: AbortSignal.abort(), fetcher: f.fetcher})); assert.equal(f.requests.length, count);
  f.state.page = "<script>PRIVATE()</script>";
  await assert.rejects(consultHtmlLegacyInventory({request, signal: signal(), fetcher: f.fetcher}), /No se pudo consultar/);
});
test("SQL locks current authorized lineage, bounds native scan/page and never exports HTML or writes", async () => {
  const sql = (await readFile("../../supabase/migrations/20261010170000_read_html_editing_legacy_inventory.sql", "utf8")).replace(/^\s*--.*$/gm, "");
  assert.match(sql, /private\.assert_html_editing_actor\(p_org,p_actor\)/); assert.match(sql, /composition_id = p_composition AND state = 'ACTIVE' FOR SHARE/);
  assert.match(sql, /organization_id = p_org AND status <> 'ARCHIVED' FOR SHARE/);
  assert.match(sql, /saved\.version IS DISTINCT FROM current_version/); assert.match(sql, /HTML_LEGACY_INVENTORY_BASE_CHANGED/);
  assert.match(sql, /ORDER BY c\.ordinal LIMIT 21/); assert.match(sql, /ORDER BY a\.ordinal LIMIT 20/);
  assert.match(sql, /LEFT JOIN private\.composition_html_templates/); assert.match(sql, /t\.organization_id = p_org/);
  assert.match(sql, /pg_catalog\.sha256/); assert.match(sql, /FROM PUBLIC,anon,authenticated/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|UPSERT)\b|'sourceHtml'|encodedPilot|signedUrl|GRANT .*authenticated/);
  assert.equal(policy.pageSize, 20);
});
test("inventory panel is mounted in current scoped recovery, aborts on unmount and never adopts or executes source", async () => {
  const root = "src/domains/materials/components/composition-editor/";
  const panel = await readFile(`${root}CompositionHtmlLegacyInventoryPanel.tsx`, "utf8"), center = await readFile(`${root}CompositionHtmlRecoveryCenter.tsx`, "utf8");
  assert.match(center, /legacy-inventory:\$\{context\.key\}:\$\{compositionId\}/);
  assert.match(panel, /requestRef\.current\?\.abort\(\)/); assert.match(panel, /expectedDocumentHash: page\.documentHash/);
  assert.match(panel, /setPage\(null\)/);
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML|srcDoc|<iframe|encodedPilot|window\.confirm|savePatch|initialize|getOrCreate/);
});
