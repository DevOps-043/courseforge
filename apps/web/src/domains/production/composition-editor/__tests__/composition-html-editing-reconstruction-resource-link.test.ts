import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { scope, candidate, command, receipt, actor, draft, assetId, operation, resourceLinkFixture } from "./composition-html-editing-reconstruction-resource-link-fixtures";
import { readAuthorizedHtmlReconstructionResource, operateHtmlReconstructionResourceLink } from "../composition-html-editing-reconstruction-resource-link.server";
import { htmlReconstructionResourceLinkReceiptSchema, htmlReconstructionResourceLinkEnabled, htmlReconstructionResourceLinkPreimage } from "../composition-html-editing-reconstruction-resource-link.contract";
import { computeHtmlReconstructionResourceLinkDigest, consultHtmlReconstructionResource, requestHtmlReconstructionResourceLink } from "../composition-html-editing-reconstruction-resource-link.client";
import { coordinateHtmlReconstructionResourceLink } from "../composition-html-editing-reconstruction-resource-link-coordinator.client";
import { beginHtmlReconstructionResourceLinkJournal, readHtmlReconstructionResourceLinkJournal,
  closeVerifiedHtmlReconstructionResourceLinkJournal } from "../composition-html-editing-reconstruction-resource-link-journal.client";

function action(f = resourceLinkFixture()) {
  return {f, input: {scope, storage: f.storage, lock: f.lock, signal: AbortSignal.timeout(10_000), isCurrent: () => true,
    fetcher: f.fetcher, createOperationId: () => operation,
    action: {mode: "LINK" as const, candidate, confirmedResourceOnly: true as const}}};
}
test("lookup captures current new-draft identity and bounded foreign-component medium without links or sensitive locations", async () => {
  const f = resourceLinkFixture();
  assert.deepEqual(await readAuthorizedHtmlReconstructionResource({supabase: f.supabase,
    request: {actorId: actor, organizationId: actor, draftId: draft, query: {compositionId: draft, assetId}}, signal: AbortSignal.timeout(10_000)}), candidate);
  assert.deepEqual(f.calls[0]!.parameters, {p_org: actor, p_actor: actor, p_composition: draft, p_draft: draft, p_asset: assetId});
  assert.equal(f.state.mutations, 0); assert.doesNotMatch(JSON.stringify(candidate), /storagePath|storageBucket|sourceHtml|signedUrl/);
});
test("lookup rejects substituted identity and private provider failures before client can review a candidate", async () => {
  for (const changed of [{organizationId: draft}, {draftId: actor}, {compositionId: actor}, {storagePath: "PRIVATE"}]) {
    const f = resourceLinkFixture(); Object.assign(f.state.candidate, changed);
    await assert.rejects(consultHtmlReconstructionResource({request: {actorId: actor, organizationId: actor, draftId: draft,
      query: {compositionId: draft, assetId}}, fetcher: f.fetcher, signal: AbortSignal.timeout(10_000)}));
    assert.equal(f.state.mutations, 0);
  }
  const f = resourceLinkFixture(); f.state.error = {message: "PRIVATE_SQL_TOKEN"};
  await assert.rejects(readAuthorizedHtmlReconstructionResource({supabase: f.supabase,
    request: {actorId: actor, organizationId: actor, draftId: draft, query: {compositionId: draft, assetId}}, signal: AbortSignal.timeout(10_000)}), /UNAVAILABLE/);
});
test("shared digest binds every owner/base/resource/operation field identically on server and client", async () => {
  assert.equal(await computeHtmlReconstructionResourceLinkDigest(command), receipt().requestSha256);
  for (const changed of [{actorId: draft}, {organizationId: draft}, {compositionId: actor}, {draftId: actor}, {operationId: actor},
    {request: {...command.request, assetId: actor}}, {request: {...command.request, expectedVersion: 3}},
    {request: {...command.request, expectedDocumentHash: "d".repeat(64)}}, {request: {...command.request, resourceIdentitySha256: "d".repeat(64)}}])
    assert.notEqual(await computeHtmlReconstructionResourceLinkDigest({...command, ...changed}), receipt().requestSha256);
  assert.equal(htmlReconstructionResourceLinkReceiptSchema.safeParse({...receipt(), nativeDocumentChanged: true}).success, false);
  assert.equal(htmlReconstructionResourceLinkReceiptSchema.safeParse({...receipt(), resourceLinked: false}).success, false);
  assert.equal(htmlReconstructionResourceLinkReceiptSchema.safeParse(receipt(command, "BASE_CHANGED")).success, true);
});
test("one link RPC passes exact intention and native stays untouched; reads never relink", async () => {
  const f = resourceLinkFixture(), original = f.state.originalNative;
  const result = await operateHtmlReconstructionResourceLink({supabase: f.supabase, command, mode: "LINK", signal: AbortSignal.timeout(10_000)});
  assert.equal(result.status, "RECORDED"); assert.equal(f.state.mutations, 1);
  assert.equal(f.calls[0]!.parameters.p_request_sha256, receipt().requestSha256);
  assert.equal(f.state.originalNative, original);
  assert.deepEqual(await operateHtmlReconstructionResourceLink({supabase: f.supabase, command, mode: "READ", signal: AbortSignal.timeout(10_000)}), result);
  assert.equal(f.state.mutations, 1); assert.deepEqual(f.calls.map(call => call.name), ["link_html_reconstruction_resource", "read_html_reconstruction_resource_link"]);
});
test("journal is durable before POST and direct receipt does not automatically close tracking", async () => {
  const {f, input} = action();
  f.state.beforePost = async () => {const current = await readHtmlReconstructionResourceLinkJournal(f.storage, scope);
    assert.equal(current.status, "PENDING"); if (current.status === "PENDING") assert.equal(current.entry.command.operationId, operation);};
  assert.deepEqual(await coordinateHtmlReconstructionResourceLink(input), receipt());
  const pending = await readHtmlReconstructionResourceLinkJournal(f.storage, scope); assert.equal(pending.status, "PENDING");
  assert.equal(f.state.mutations, 1); assert.equal(f.requests.filter(req => req.method === "POST").length, 1);
  assert.equal(f.state.originalNative, "UNCHANGED");
  const serialized = JSON.parse(f.requests.find(req => req.method === "POST")!.body!);
  assert.equal(serialized.actorId, undefined); assert.equal(serialized.organizationId, undefined);
});
test("lost POST ACK is recovered by fresh GET; replay is blocked and close never issues a second POST", async () => {
  const {f, input} = action(); f.state.lostPost = true;
  await assert.rejects(coordinateHtmlReconstructionResourceLink(input)); assert.equal(f.state.mutations, 1);
  await assert.rejects(coordinateHtmlReconstructionResourceLink(input));
  f.state.lostPost = false;
  assert.deepEqual(await coordinateHtmlReconstructionResourceLink({...input, action: {mode: "RECOVER", operationId: operation}}), receipt());
  assert.equal((await readHtmlReconstructionResourceLinkJournal(f.storage, scope)).status, "PENDING");
  assert.deepEqual(await coordinateHtmlReconstructionResourceLink({...input, action: {mode: "CLOSE", operationId: operation}}), receipt());
  assert.equal((await readHtmlReconstructionResourceLinkJournal(f.storage, scope)).status, "EMPTY");
  assert.equal(f.requests.filter(req => req.method === "POST").length, 1); assert.equal(f.state.mutations, 1);
});
test("NOT_FOUND cannot clear an uncertain intention, reauthorize a link or automatically retry", async () => {
  const {f, input} = action(); assert.ok(await beginHtmlReconstructionResourceLinkJournal(f.storage, command));
  const before = [...f.slots];
  await assert.rejects(coordinateHtmlReconstructionResourceLink({...input, action: {mode: "CLOSE", operationId: operation}}), /no está confirmado/);
  assert.deepEqual([...f.slots], before); assert.equal(f.state.mutations, 0); assert.equal(f.requests.filter(req => req.method === "POST").length, 0);
});
test("known base/resource/limit rejection is a durable negative receipt that can be closed without any link", async () => {
  for (const reason of ["BASE_CHANGED", "RESOURCE_CHANGED", "LIMIT"] as const) {
    const {f, input} = action(); f.state.rejectReason = reason;
    assert.deepEqual(await coordinateHtmlReconstructionResourceLink(input), receipt(command, reason));
    assert.equal(f.state.mutations, 0);
    assert.deepEqual(await coordinateHtmlReconstructionResourceLink({...input, action: {mode: "CLOSE", operationId: operation}}), receipt(command, reason));
    assert.equal((await readHtmlReconstructionResourceLinkJournal(f.storage, scope)).status, "EMPTY");
    assert.equal(f.requests.filter(req => req.method === "POST").length, 1);
  }
});
test("fresh selection drift, unavailable lock/storage, cancellation and malformed confirmation prevent dispatch", async () => {
  for (const failure of ["drift", "lock", "storage", "cancel", "confirmation"] as const) {
    const {f, input} = action();
    if (failure === "drift") f.state.candidate.resourceIdentitySha256 = "d".repeat(64);
    if (failure === "storage") f.state.failStorage = true;
    await assert.rejects(coordinateHtmlReconstructionResourceLink({...input,
      ...(failure === "lock" ? {lock: null} : {}), ...(failure === "cancel" ? {signal: AbortSignal.abort()} : {}),
      ...(failure === "confirmation" ? {action: {...input.action, confirmedResourceOnly: false as true}} : {})}));
    assert.equal(f.state.mutations, 0); assert.equal(f.requests.filter(req => req.method === "POST").length, 0);
  }
});
test("corrupt tracking is not empty and old direct receipts cannot close without a fresh authorized read", async () => {
  const {f, input} = action(); await coordinateHtmlReconstructionResourceLink(input);
  const pending = await readHtmlReconstructionResourceLinkJournal(f.storage, scope); assert.equal(pending.status, "PENDING");
  f.state.authenticated = false;
  await assert.rejects(coordinateHtmlReconstructionResourceLink({...input, action: {mode: "CLOSE", operationId: operation}}));
  assert.equal((await readHtmlReconstructionResourceLinkJournal(f.storage, scope)).status, "PENDING");
  if (pending.status === "PENDING") assert.equal(await closeVerifiedHtmlReconstructionResourceLinkJournal(f.storage, scope, pending.entry, () => false), false);
  const key = [...f.slots.keys()][0]!; f.slots.set(key, "{bad");
  assert.equal((await readHtmlReconstructionResourceLinkJournal(f.storage, scope)).status, "UNAVAILABLE");
  await assert.rejects(coordinateHtmlReconstructionResourceLink(input)); assert.equal(f.slots.get(key), "{bad");
});
test("mismatched or native-changing ACK remains unconfirmed after backend success and retains local tracking", async () => {
  const {f, input} = action(); f.state.malformedReceipt = true;
  await assert.rejects(coordinateHtmlReconstructionResourceLink(input));
  assert.equal(f.state.mutations, 1); assert.equal((await readHtmlReconstructionResourceLinkJournal(f.storage, scope)).status, "PENDING");
  assert.equal(f.requests.filter(req => req.method === "POST").length, 1);
});
test("HTTP rejects caller owner, foreign origin and disabled writes, and quotas block before link RPC", async () => {
  const f = resourceLinkFixture(), body = {...command.request, compositionId: draft}, url = `https://app.test/link/${operation}`;
  const req = (payload: unknown, origin = "https://app.test") => new Request(url, {method: "POST", headers: {origin, "content-type": "application/json"}, body: JSON.stringify(payload)});
  assert.equal((await f.handlers.link(req({...body, actorId: actor}), {draftId: draft, operationId: operation})).status, 400);
  assert.equal((await f.handlers.link(req(body, "https://foreign.test"), {draftId: draft, operationId: operation})).status, 403);
  f.state.allowed = false;
  assert.equal((await f.handlers.link(req(body), {draftId: draft, operationId: operation})).status, 429);
  assert.equal(f.state.mutations, 0);
  f.state.allowed = true; f.state.writesEnabled = false;
  const callsBefore = f.calls.length;
  assert.equal((await f.handlers.link(req(body), {draftId: draft, operationId: operation})).status, 503);
  assert.equal(f.calls.length, callsBefore);
  assert.equal((await consultHtmlReconstructionResource({request: {actorId: actor, organizationId: actor,
    draftId: draft, query: {compositionId: draft, assetId}}, fetcher: f.fetcher,
    signal: AbortSignal.timeout(10_000)})).asset.productionAssetId, assetId);
  assert.equal(htmlReconstructionResourceLinkEnabled({}), false);
  assert.equal(htmlReconstructionResourceLinkEnabled({COMPOSITION_HTML_RECONSTRUCTION_OPENING_ENABLED: "true", COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED: "true",
    COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED: "true", COMPOSITION_HTML_RECONSTRUCTION_RESOURCE_LINK_ENABLED: "true"}), true);
});
test("source selection SQL shares unchanged eligibility/projection without global scan, source exports or writes", async () => {
  const sql = await readFile("../../supabase/migrations/20261010150000_html_reconstruction_resource_selection.sql", "utf8"), body = sql.replace(/^[\t ]*--.*$/gm, "");
  assert.match(body, /CREATE OR REPLACE FUNCTION public\.read_html_reconstruction_library/);
  assert.match(body, /private\.html_reconstruction_resource_metadata\(asset,linked_role\)/);
  assert.match(body, /WHERE id = p_asset AND organization_id = p_org FOR SHARE/);
  assert.match(body, /private\.html_reconstruction_resource_identity\(asset\)/); assert.match(body, /public\.read_html_reconstruction_opening/);
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|UPSERT)\b|signedUrl|sourceHtml|read_html_editing_compilation/);
  assert.equal(body.match(/'label',left\(/g)?.length, 1);
  assert.match(body, /FROM PUBLIC,anon,authenticated,service_role/);
});
test("attachment SQL has current authority/OCC/locked pins, atomic negative receipts and only new-draft link mutation", async () => {
  const sql = await readFile("../../supabase/migrations/20261010160000_link_html_reconstruction_resources.sql", "utf8"), body = sql.replace(/^[\t ]*--.*$/gm, "");
  assert.match(body, /ENABLE ROW LEVEL SECURITY/); assert.match(body, /FOR UPDATE NOWAIT/);
  assert.match(body, /public\.read_html_reconstruction_opening\(p_org,p_actor,p_composition,p_draft\)/);
  assert.match(body, /organization_id = p_org FOR SHARE/); assert.match(body, /private\.html_reconstruction_resource_identity\(asset\)/);
  assert.match(body, /opening->>'currentDocumentHash' IS DISTINCT FROM p_request->>'expectedDocumentHash'/);
  assert.match(body, /rejection_reason := 'BASE_CHANGED'/); assert.match(body, /rejection_reason := 'RESOURCE_CHANGED'/); assert.match(body, /rejection_reason := 'LIMIT'/);
  assert.match(body, /'resourceLinked',rejection_reason IS NULL/); assert.match(body, /'nativeDocumentChanged',false,'originalDraftChanged',false/);
  assert.equal(body.match(/INSERT INTO public\./g)?.length, 1);
  assert.match(body, /VALUES\(p_draft,asset\.id,p_org,link_role,'HTML_RECONSTRUCTION_EXPLICIT_RESOURCE'\)/);
  assert.doesNotMatch(body, /UPDATE public\.|DELETE FROM|INSERT INTO public\.video_composition_draft_documents|active_revision_id|sourceHtml/);
  const recoveryStart = body.indexOf("CREATE FUNCTION public.read_html_reconstruction_resource_link");
  const recovery = body.slice(recoveryStart, body.indexOf("END $$;", recoveryStart) + "END $$;".length);
  assert.doesNotMatch(recovery, /INSERT INTO|UPDATE |DELETE|link_html_reconstruction_resource\(/);
  assert.match(recovery, /'status','NOT_FOUND'/);
  assert.match(body, /courseforge-html-reconstruction-resource-link-v1/);
  assert.ok(htmlReconstructionResourceLinkPreimage(command).startsWith("courseforge-html-reconstruction-resource-link-v1\n"));
});
test("resource panel is explicitly mounted and does not transplant native or initialize the original", async () => {
  const wrapper = await readFile("src/domains/materials/components/composition-editor/CompositionHtmlReconstructionEditor.tsx", "utf8");
  assert.match(wrapper, /CompositionHtmlReconstructionResourceLinkPanel/); assert.match(wrapper, /onLinked=\{\(\) => loadLibrary\(false\)\}/);
  const panel = await readFile("src/domains/materials/components/composition-editor/CompositionHtmlReconstructionResourceLinkPanel.tsx", "utf8");
  assert.match(panel, /window\.confirm/); assert.match(panel, /tracking\?\.status !== "EMPTY"/); assert.match(panel, /inFlight\.current\?\.abort\(\)/);
  assert.doesNotMatch(panel, /savePatch|document\.restore|initializeHyperframesDraft|getOrCreate|sourceDraftId|onContinueToPublication/);
  const f = resourceLinkFixture();
  await assert.rejects(requestHtmlReconstructionResourceLink({command, mode: "READ", signal: AbortSignal.abort(), fetcher: f.fetcher}));
  assert.equal(f.requests.length, 0);
});
