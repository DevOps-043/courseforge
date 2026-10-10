import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAuthorizedHtmlReconstructionOpening } from "../composition-html-editing-reconstruction-opening.server";
import { consultHtmlReconstructionOpening } from "../composition-html-editing-reconstruction-opening.client";
import { createHtmlReconstructionOpeningHandler } from "../http/composition-html-editing-reconstruction-opening-handler.server";
import { htmlReconstructionOpeningEnabled, type HtmlReconstructionOpening } from "../composition-html-editing-reconstruction-opening.contract";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const request = {actorId: uuid, organizationId: uuid, compositionId: other, draftId: other};
const opening: HtmlReconstructionOpening = {scope: "AUTHORIZED_RECONSTRUCTION_OPENING_NOT_DOCUMENT_OR_PUBLICATION",
  organizationId: uuid, compositionId: other, draftId: other, candidateId: other, operationId: other, seedRevisionId: other,
  seedDocumentHash: "a".repeat(64), currentDocumentHash: "b".repeat(64), currentVersion: 4, materialComponentId: null, activeRevisionId: null};
function rpcFixture() {
  const calls: string[] = []; const state = {result: opening as unknown, error: null as unknown};
  const supabase = {rpc: (name: string, parameters: Record<string, unknown>) => ({abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted(); calls.push(name);
    if (name === "consume_api_rate_limit") return {data: [{allowed: true, reset_at: "2026-10-10T00:00:00Z"}], error: null};
    assert.equal(name, "read_html_reconstruction_opening");
    assert.deepEqual(parameters, {p_org: uuid, p_actor: uuid, p_composition: other, p_draft: other});
    return {data: structuredClone(state.result), error: state.error};
  }})} as unknown as SupabaseClient;
  return {supabase, state, calls};
}
test("opening reads current metadata independently of seed/receipt without any creation or compiler", async () => {
  const f = rpcFixture();
  assert.deepEqual(await readAuthorizedHtmlReconstructionOpening({supabase: f.supabase, request}), opening);
  assert.deepEqual(f.calls, ["read_html_reconstruction_opening"]);
  assert.notEqual(opening.seedDocumentHash, opening.currentDocumentHash);
});
test("opening rejects substituted tenant/composition/draft, source fields, malformed versions and provider errors", async () => {
  for (const changed of [{organizationId: other}, {compositionId: uuid}, {draftId: uuid}, {sourceHtml: "PRIVATE"},
    {currentVersion: 0}, {materialComponentId: uuid}, {scope: "RECONSTRUCTION_CREATION_RECEIPT_NOT_PUBLICATION_OR_CURRENT_STATE"}]) {
    const f = rpcFixture(); f.state.result = {...opening, ...changed};
    await assert.rejects(readAuthorizedHtmlReconstructionOpening({supabase: f.supabase, request}), /OPENING_UNAVAILABLE/);
  }
  const f = rpcFixture(); f.state.error = {message: "PRIVATE_SQL"};
  await assert.rejects(readAuthorizedHtmlReconstructionOpening({supabase: f.supabase, request}), /OPENING_UNAVAILABLE/);
  const cancelled = rpcFixture();
  await assert.rejects(readAuthorizedHtmlReconstructionOpening({supabase: cancelled.supabase, request, signal: AbortSignal.abort()}));
  assert.deepEqual(cancelled.calls, []);
});
test("opening HTTP derives tenant/actor, applies quotas and exposes no source or original identity", async () => {
  const f = rpcFixture(); const commands: unknown[] = [];
  const handler = createHtmlReconstructionOpeningHandler({enabled: () => true,
    authenticate: async () => ({actorId: uuid, tenant: {organizationId: uuid, userId: uuid, platformRole: "ADMIN"}}),
    serviceClient: () => f.supabase, read: async (supabase, command, signal) => {commands.push(command); return readAuthorizedHtmlReconstructionOpening({supabase, request: command, signal});}});
  const response = await handler(new Request(`https://app.test/open?compositionId=${other}`), {draftId: other});
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(commands, [request]); assert.deepEqual(f.calls, ["consume_api_rate_limit", "consume_api_rate_limit", "read_html_reconstruction_opening"]);
  assert.deepEqual((await response.json()).data, opening);
});
test("opening transport rejects unknown identity, cross origin, method and disabled gate before backend", async () => {
  const f = rpcFixture(); let auth = 0;
  const ports = {enabled: () => true, authenticate: async () => {auth++; return {actorId: uuid, tenant: {organizationId: uuid, userId: uuid, platformRole: "ADMIN"}};},
    serviceClient: () => f.supabase, read: async () => opening};
  const handler = createHtmlReconstructionOpeningHandler(ports), url = `https://app.test/open?compositionId=${other}`;
  for (const [req, expected] of [[new Request(`${url}&actorId=${uuid}`), 400], [new Request(`${url}&compositionId=${other}`), 400],
    [new Request(url, {headers: {origin: "https://foreign.test"}}), 403], [new Request(url, {method: "POST"}), 405]] as const)
    assert.equal((await handler(req, {draftId: other})).status, expected);
  assert.equal((await createHtmlReconstructionOpeningHandler({...ports, enabled: () => false})(new Request(url), {draftId: other})).status, 503);
  assert.equal(auth, 0); assert.deepEqual(f.calls, []);
  assert.equal(htmlReconstructionOpeningEnabled({}), false);
  assert.equal(htmlReconstructionOpeningEnabled({COMPOSITION_HTML_RECONSTRUCTION_OPENING_ENABLED: "true", COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED: "true"}), true);
});
test("opening client only sends one bounded GET and never serializes actor/organization", async () => {
  const paths: string[] = [];
  assert.deepEqual(await consultHtmlReconstructionOpening({request, signal: AbortSignal.timeout(10_000), fetcher: async (url, options) => {
    paths.push(String(url)); assert.equal(options?.method, "GET"); assert.equal(options?.credentials, "same-origin"); assert.equal(options?.redirect, "error");
    return Response.json({success: true, requestId: uuid, correlationId: uuid, data: opening});
  }}), opening);
  assert.deepEqual(paths, [`/api/production/hyperframes/drafts/${other}/html-reconstruction-opening?compositionId=${other}`]);
});
test("client rejects receipt substitution, mismatched correlation, redirected/oversized/aborted response", async () => {
  for (const body of [{success: true, requestId: uuid, correlationId: other, data: opening},
    {success: true, requestId: uuid, correlationId: uuid, data: {...opening, receipt: "PRIVATE"}},
    {success: true, requestId: uuid, correlationId: uuid, data: {...opening, organizationId: other}}, {text: "x".repeat(6000)}])
    await assert.rejects(consultHtmlReconstructionOpening({request, signal: AbortSignal.timeout(10_000), fetcher: async () => Response.json(body)}), /UNAVAILABLE/);
  let calls = 0;
  await assert.rejects(consultHtmlReconstructionOpening({request, signal: AbortSignal.abort(), fetcher: async () => {calls++; return Response.json({});}}));
  assert.equal(calls, 0);
});
test("opening SQL is service-only read-only metadata with current membership/provenance and indexed identity", async () => {
  const sql = await readFile("../../supabase/migrations/20261010120000_read_html_reconstruction_opening.sql", "utf8");
  const body = sql.replace(/^[\t ]*--.*$/gm, "");
  assert.match(body, /CREATE UNIQUE INDEX[\s\S]*\(organization_id,draft_id\)/);
  assert.match(body, /private\.assert_html_editing_actor\(p_org,p_actor\)/);
  assert.match(body, /material_component_id IS NULL FOR SHARE/);
  assert.match(body, /draft\.source_manifest->'htmlReconstruction' IS DISTINCT FROM creation\.receipt/);
  assert.match(body, /ORDER BY d\.version DESC LIMIT 1 FOR SHARE/);
  assert.match(body, /FROM PUBLIC,anon,authenticated/); assert.match(body, /TO service_role/);
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|UPSERT)\b|read_html_editing_compilation|initialize|project_storage_path|sourceHtml/);
});
