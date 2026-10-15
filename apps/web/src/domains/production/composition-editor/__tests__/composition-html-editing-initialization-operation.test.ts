import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseHtmlEditingRevisionRepository } from "../composition-html-editing-repository.service";
import { computeHtmlEditingInitializationRequestSha256 } from "../composition-html-editing-initialization-operation-digest.server";
import { htmlEditingInitializationOperationReceiptSchema } from "../composition-html-editing-initialization-operation.contract";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function setup() {
  const f = fixture(), binding = f.current.revision.manifest.binding;
  const request = { templateId: binding.templateId, templateVersion: binding.templateVersion, expectedDocumentHash: binding.documentSha256 };
  const requestSha256 = computeHtmlEditingInitializationRequestSha256(request);
  const receipt = { scope: "HTML_INITIALIZATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED" as const,
    owner: { actorId: uuid, organizationId: uuid, draftId: uuid }, operationId: other, requestSha256,
    clipId: f.request.scope.clipId, request, acknowledgment: { status: "CONFIRMED" as const, created: true,
      version: 1 as const, sha256: f.current.sha256, compositionDocumentHash: binding.documentSha256 } };
  const registration = { ...f.request, initializationOperationId: other,
    authoritativeAnchor: { organizationId: binding.organizationId, documentId: binding.documentId, revisionId: binding.revisionId,
      documentSha256: binding.documentSha256, clipId: binding.clipId },
    encodedTrustedTemplate: JSON.stringify({ format: "courseforge-html-editable-template-v1", templateId: binding.templateId,
      templateVersion: binding.templateVersion, sourceSha256: binding.sourceSha256, elements: f.current.revision.manifest.elements }),
    sourceHtml: f.current.revision.sourceHtml, grantedAssetIds: f.authority.grantedAssetIds, imageSources: f.authority.imageSources };
  const state = { commit: receipt as unknown, read: { status: "RECORDED", receipt } as unknown, fail: false };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const repository = new SupabaseHtmlEditingRevisionRepository({ rpc: (name: string, args: Record<string, unknown>) => ({
    abortSignal: async () => { calls.push({ name, args }); return { data: name.startsWith("read_") ? state.read : state.commit,
      error: state.fail ? { message: "PRIVATE_PROVIDER_SECRET" } : null }; },
  }) } as unknown as SupabaseClient);
  const readInput = { ...f.request, operationId: other, requestSha256 };
  return { f, request, receipt, registration, repository, state, calls, readInput };
}

test("initialization digest matches independent versioned preimage and canonicalizes input key order", () => {
  const f = setup();
  const golden = createHash("sha256").update(`courseforge-html-initialization-request-v1\n${JSON.stringify(f.request)}`).digest("hex");
  assert.equal(computeHtmlEditingInitializationRequestSha256(f.request), golden);
  assert.equal(computeHtmlEditingInitializationRequestSha256({ expectedDocumentHash: f.request.expectedDocumentHash,
    templateVersion: f.request.templateVersion, templateId: f.request.templateId }), golden);
  for (const changed of [{ ...f.request, templateId: "another" }, { ...f.request, templateVersion: 2 },
    { ...f.request, expectedDocumentHash: "e".repeat(64) }]) assert.notEqual(computeHtmlEditingInitializationRequestSha256(changed), golden);
  assert.throws(() => computeHtmlEditingInitializationRequestSha256({ ...f.request, actorId: uuid }));
});

test("receipt contract binds initial hash and refuses current/render claims or private/source extras", () => {
  const f = setup(); assert.deepEqual(htmlEditingInitializationOperationReceiptSchema.parse(f.receipt), f.receipt);
  for (const invalid of [{ ...f.receipt, scope: "CURRENT" }, { ...f.receipt, sourceHtml: "secret" },
    { ...f.receipt, acknowledgment: { ...f.receipt.acknowledgment, version: 2 } },
    { ...f.receipt, acknowledgment: { ...f.receipt.acknowledgment, compositionDocumentHash: "e".repeat(64) } }]) {
    assert.equal(htmlEditingInitializationOperationReceiptSchema.safeParse(invalid).success, false);
  }
});

test("durable initialization uses one atomic receipt RPC, derives digest from prepared binding, never reads latest to fabricate ACK", async () => {
  for (const created of [true, false]) {
    const f = setup(), receipt = { ...f.receipt, acknowledgment: { ...f.receipt.acknowledgment, created } }; f.state.commit = receipt;
    const original = structuredClone(f.f.document);
    assert.deepEqual(await f.repository.registerInitial(f.registration), { ...receipt.acknowledgment, initializationReceipt: receipt });
    assert.deepEqual(f.calls.map(call => call.name), ["commit_html_editing_initialization_operation"]);
    assert.equal(f.calls[0]!.args.p_operation_id, other); assert.equal(f.calls[0]!.args.p_request_sha256, f.receipt.requestSha256);
    assert.equal(f.calls[0]!.args.p_revision_sha256, f.f.current.sha256); assert.deepEqual(f.calls[0]!.args.p_used_asset_ids, [uuid]);
    assert.deepEqual(f.f.document, original);
  }
});

test("durable initialization rejects foreign/mismatched response and never retries/falls back to legacy registration", async () => {
  for (const failure of ["owner", "operation", "clip", "digest", "request", "sha", "oversized"] as const) {
    const f = setup();
    f.state.commit = failure === "owner" ? { ...f.receipt, owner: { ...f.receipt.owner, actorId: other } }
      : failure === "operation" ? { ...f.receipt, operationId: uuid }
        : failure === "clip" ? { ...f.receipt, clipId: "foreign-clip" }
          : failure === "digest" ? { ...f.receipt, requestSha256: "e".repeat(64) }
            : failure === "request" ? { ...f.receipt, request: { ...f.request, templateId: "another" } }
              : failure === "sha" ? { ...f.receipt, acknowledgment: { ...f.receipt.acknowledgment, sha256: "e".repeat(64) } }
                : " ".repeat(4097);
    await assert.rejects(f.repository.registerInitial(f.registration), /COMMIT_UNCONFIRMED/);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.name, "commit_html_editing_initialization_operation");
  }
});

test("initialization receipt reader is scoped metadata only and missing receipt is not retry evidence", async () => {
  const f = setup();
  assert.deepEqual(await f.repository.readInitializationOperation(f.readInput), { status: "RECORDED", receipt: f.receipt });
  assert.equal(f.calls[0]!.name, "read_html_editing_initialization_operation");
  assert.equal(f.calls[0]!.args.p_actor_id, uuid); assert.equal(f.calls[0]!.args.p_operation_id, other);
  f.state.read = { status: "NOT_FOUND" }; assert.deepEqual(await f.repository.readInitializationOperation(f.readInput), { status: "NOT_FOUND" });
  assert.equal(f.calls.length, 2); assert.ok(f.calls.every(call => call.name.startsWith("read_")));
});

test("initialization reader independently checks owner/ID/digest and digest of returned typed request", async () => {
  for (const failure of ["owner", "operation", "digest", "request", "private"] as const) {
    const f = setup();
    const receipt = failure === "owner" ? { ...f.receipt, owner: { ...f.receipt.owner, organizationId: other } }
      : failure === "operation" ? { ...f.receipt, operationId: uuid }
        : failure === "digest" ? { ...f.receipt, requestSha256: "e".repeat(64) }
          : failure === "request" ? { ...f.receipt, request: { ...f.request, templateVersion: 2 } }
            : { ...f.receipt, private: "not public" };
    f.state.read = { status: "RECORDED", receipt };
    await assert.rejects(f.repository.readInitializationOperation(f.readInput), /INVALID_REVISION/); assert.equal(f.calls.length, 1);
  }
});

test("invalid initialization ID/owner or pre-abort cannot dispatch durable registration or receipt reads", async () => {
  const f = setup(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.repository.registerInitial({ ...f.registration, initializationOperationId: "invalid" }));
  await assert.rejects(f.repository.registerInitial({ ...f.registration, signal: controller.signal }));
  await assert.rejects(f.repository.readInitializationOperation({ ...f.readInput, actorId: "invalid" }));
  await assert.rejects(f.repository.readInitializationOperation({ ...f.readInput, signal: controller.signal }));
  assert.equal(f.calls.length, 0);
});

test("provider failure remains safe uncertainty for commit and safe read error without retries", async () => {
  const f = setup(); f.state.fail = true;
  await assert.rejects(f.repository.registerInitial(f.registration), /COMMIT_UNCONFIRMED/);
  await assert.rejects(f.repository.readInitializationOperation(f.readInput), /READ_UNAVAILABLE/);
  assert.equal(f.calls.length, 2);
});
