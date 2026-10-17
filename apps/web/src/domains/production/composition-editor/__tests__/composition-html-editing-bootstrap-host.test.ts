import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CompositionHtmlEditingBootstrapHost } from "../composition-html-editing-bootstrap-host.server";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { computeHtmlEditingInitializationRequestSha256 } from "../composition-html-editing-initialization-operation-digest.server";
import { HtmlEditingTemplateCatalog } from "../html-editing/html-editing-template-catalog.server";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid,
  htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function host() {
  const input = fixture();
  const binding = input.current.revision.manifest.binding;
  const template = { format: "courseforge-html-editable-template-v1", templateId: binding.templateId,
    templateVersion: binding.templateVersion, sourceSha256: binding.sourceSha256, elements: input.current.revision.manifest.elements };
  const catalog = new HtmlEditingTemplateCatalog(JSON.stringify({ format: "courseforge-html-editable-catalog-v1",
    organizationId: uuid, templates: [template] }));
  const state = { bootstrap: { organizationId: uuid, documentId: uuid, clipId: binding.clipId, revisionId: other,
    documentHash: input.row.compositionDocumentHash, document: input.document, grantedAssetIds: [uuid, other] },
    revision: input.row, error: false, acknowledgement: true as unknown,
    receiptRead: { status: "NOT_FOUND" } as unknown, operationCommitError: false };
  const calls: Array<{ name: string; args: Record<string, any>; signal: AbortSignal }> = [];
  const supabase = { rpc: (name: string, args: Record<string, any>) => ({ abortSignal: async (signal: AbortSignal) => {
    calls.push({ name, args, signal });
    return { data: name === "read_html_editing_bootstrap_context" ? structuredClone(state.bootstrap)
      : name === "read_html_editing_revision" ? structuredClone(state.revision)
        : name === "read_html_editing_initialization_operation" ? state.receiptRead : state.acknowledgement,
    error: state.error || (state.operationCommitError && name === "commit_html_editing_initialization_operation") ? { message: "PRIVATE_TOKEN" } : null };
  } }) } as unknown as SupabaseClient;
  const service = new CompositionHtmlEditingBootstrapHost(supabase, catalog);
  const request = { actorId: uuid, organizationId: uuid, documentId: uuid, clipId: binding.clipId,
    templateId: binding.templateId, templateVersion: binding.templateVersion, expectedDocumentHash: input.row.compositionDocumentHash };
  return { input, state, calls, service, request };
}

function operation(scenario: ReturnType<typeof host>) {
  const request = { templateId: scenario.request.templateId, templateVersion: scenario.request.templateVersion,
    expectedDocumentHash: scenario.request.expectedDocumentHash };
  return { scope: "HTML_INITIALIZATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED", owner: { actorId: uuid, organizationId: uuid, draftId: uuid },
    operationId: other, requestSha256: computeHtmlEditingInitializationRequestSha256(request), clipId: scenario.request.clipId, request,
    acknowledgment: { status: "CONFIRMED", created: true, version: 1, sha256: scenario.input.current.sha256,
      compositionDocumentHash: scenario.request.expectedDocumentHash } };
}

test("durable bootstrap first reads scoped receipt then prepares current authority and commits once without legacy readback", async () => {
  const scenario = host(), receipt = operation(scenario); scenario.state.acknowledgement = receipt;
  assert.deepEqual(await scenario.service.registerOperation({ ...scenario.request, operationId: other }), receipt);
  assert.deepEqual(scenario.calls.map(call => call.name), ["read_html_editing_initialization_operation", "read_html_editing_bootstrap_context",
    "commit_html_editing_initialization_operation"]);
  assert.equal(scenario.calls[2]!.args.p_request_sha256, receipt.requestSha256);
  assert.deepEqual(scenario.calls[2]!.args.p_used_asset_ids, [uuid]);
});

test("durable bootstrap recorded result is historical and bypasses current source/CAS preparation without any registration", async () => {
  const scenario = host(), receipt = operation(scenario); scenario.state.receiptRead = { status: "RECORDED", receipt };
  scenario.state.bootstrap.documentHash = "f".repeat(64); scenario.state.bootstrap.grantedAssetIds = [];
  assert.deepEqual(await scenario.service.registerOperation({ ...scenario.request, operationId: other }), receipt);
  assert.deepEqual(scenario.calls.map(call => call.name), ["read_html_editing_initialization_operation"]);
});

test("durable bootstrap cannot reuse recorded ID for another body/hash/template or foreign owner", async () => {
  for (const mismatch of ["hash", "template", "owner"] as const) {
    const scenario = host(), receipt = operation(scenario);
    scenario.state.receiptRead = { status: "RECORDED", receipt: mismatch === "owner" ? { ...receipt, owner: { ...receipt.owner, actorId: other } } : receipt };
    await assert.rejects(scenario.service.registerOperation({ ...scenario.request, operationId: other,
      ...(mismatch === "hash" ? { expectedDocumentHash: "f".repeat(64) } : mismatch === "template" ? { templateVersion: 2 } : {}) }));
    assert.equal(scenario.calls.length, 1);
  }
});

test("durable bootstrap receipt read failure is not absence or permission to proceed", async () => {
  const scenario = host(); scenario.state.error = true;
  await assert.rejects(scenario.service.registerOperation({ ...scenario.request, operationId: other }), /READ_UNAVAILABLE/);
  assert.equal(scenario.calls.length, 1);
});

test("durable bootstrap lost commit stays uncertain and never retries legacy or infers latest ACK", async () => {
  const scenario = host(); scenario.state.operationCommitError = true;
  await assert.rejects(scenario.service.registerOperation({ ...scenario.request, operationId: other }), /COMMIT_UNCONFIRMED/);
  assert.deepEqual(scenario.calls.map(call => call.name), ["read_html_editing_initialization_operation", "read_html_editing_bootstrap_context",
    "commit_html_editing_initialization_operation"]);
});

test("durable bootstrap rejects operation/authority extras before any receipt or source read", async () => {
  for (const extra of [{ operationId: "invalid" }, { sourceHtml: "forged" }, { grantedAssetIds: [uuid] }]) {
    const scenario = host();
    await assert.rejects(scenario.service.registerOperation({ ...scenario.request, operationId: other, ...extra }), /INVALID_REVISION/);
    assert.equal(scenario.calls.length, 0);
  }
});

test("pre-aborted durable bootstrap has no reads or writes", async () => {
  const scenario = host(), controller = new AbortController(); controller.abort();
  await assert.rejects(scenario.service.registerOperation({ ...scenario.request, operationId: other }, controller.signal));
  assert.equal(scenario.calls.length, 0);
});

test("authorized bootstrap composes server context, installed catalog, registration and exact readback", async () => {
  const scenario = host();
  const result = await scenario.service.register(scenario.request);
  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.sha256, scenario.input.current.sha256);
  assert.deepEqual(scenario.calls.map(call => call.name), ["read_html_editing_bootstrap_context",
    "register_html_editing_template_v2", "read_html_editing_revision"]);
  assert.deepEqual(scenario.calls[0]!.args, { p_actor_id: uuid, p_organization_id: uuid,
    p_draft_id: uuid, p_clip_id: scenario.request.clipId, p_expected_document_hash: scenario.request.expectedDocumentHash });
  assert.equal(scenario.calls[1]!.args.p_revision.manifest.binding.revisionId, other);
  assert.deepEqual(scenario.calls[1]!.args.p_used_asset_ids, [uuid]);
  assert.ok(scenario.calls.every(call => call.signal instanceof AbortSignal));
});

test("bootstrap rejects client source/grants/anchor declarations and invalid actor before read", async () => {
  for (const extra of [{ sourceHtml: "forged" }, { grantedAssetIds: [uuid] }, { revisionId: uuid }, { actorId: "invalid" }]) {
    const scenario = host();
    await assert.rejects(scenario.service.register({ ...scenario.request, ...extra }), /INVALID_REVISION/);
    assert.equal(scenario.calls.length, 0);
  }
});

test("foreign reader scope or stale saved hash cannot reach registration", async () => {
  for (const key of ["organizationId", "documentId", "clipId", "documentHash"] as const) {
    const scenario = host(); scenario.state.bootstrap[key] = key === "documentHash" ? "f".repeat(64) : key === "clipId" ? "foreign" : other;
    await assert.rejects(scenario.service.register(scenario.request), /REVISION_CONFLICT/);
    assert.equal(scenario.calls.length, 1);
  }
});

test("reader source/hash corruption, invalid anchor and duplicated grants fail closed", async () => {
  for (const mode of ["source", "anchor", "grants"] as const) {
    const scenario = host();
    if (mode === "source") {
      const source = scenario.state.bootstrap.document.clips[0]!.source;
      assert.ok(source.type === "DECK_SLIDE"); source.html += " ";
    } else if (mode === "anchor") scenario.state.bootstrap.revisionId = "invalid";
    else scenario.state.bootstrap.grantedAssetIds.push(uuid);
    await assert.rejects(scenario.service.register(scenario.request), /INVALID_REVISION/);
    assert.equal(scenario.calls.length, 1);
  }
});

test("missing current image grant cannot be replaced by catalog allowlist", async () => {
  const scenario = host(); scenario.state.bootstrap.grantedAssetIds = [other];
  await assert.rejects(scenario.service.register(scenario.request), /INVALID_SOURCE/);
  assert.equal(scenario.calls.length, 1);
});

test("unknown template cannot fall back to arbitrary saved HTML declarations", async () => {
  const scenario = host();
  await assert.rejects(scenario.service.register({ ...scenario.request, templateVersion: 2 }), /TEMPLATE_UNAVAILABLE/);
  assert.equal(scenario.calls.length, 1);
});

test("an existing native HTML pointer cannot be reinitialized as an empty editorial revision", async () => {
  const scenario = host();
  const native = bindHtmlEditingRevisionToComposition({ ...scenario.input.authority,
    document: scenario.input.document, revision: scenario.input.current.revision, revisionSha256: scenario.input.current.sha256 });
  scenario.state.bootstrap.document = native.document;
  scenario.state.bootstrap.documentHash = native.documentHash;
  await assert.rejects(scenario.service.register({ ...scenario.request, expectedDocumentHash: native.documentHash }), /REVISION_CONFLICT/);
  assert.equal(scenario.calls.length, 1);
});

test("eligible but undeclared server grants do not broaden template permissions or persisted dependencies", async () => {
  const scenario = host();
  scenario.state.bootstrap.grantedAssetIds.push("33333333-3333-4333-8333-333333333333");
  await scenario.service.register(scenario.request);
  assert.deepEqual(scenario.calls[1]!.args.p_used_asset_ids, [uuid]);
  assert.deepEqual(scenario.calls[1]!.args.p_revision.manifest.elements, scenario.input.current.revision.manifest.elements);
});

test("bootstrap transport errors do not leak provider details or retry", async () => {
  const scenario = host(); scenario.state.error = true;
  await assert.rejects(scenario.service.register(scenario.request), error => error instanceof Error
    && error.message === "HTML_EDITING_READ_UNAVAILABLE");
  assert.equal(scenario.calls.length, 1);
});

test("pre-cancelled bootstrap never reaches server reads or writes", async () => {
  const scenario = host(); const controller = new AbortController(); controller.abort();
  await assert.rejects(scenario.service.register(scenario.request, controller.signal), /READ_UNAVAILABLE/);
  assert.equal(scenario.calls.length, 0);
});
