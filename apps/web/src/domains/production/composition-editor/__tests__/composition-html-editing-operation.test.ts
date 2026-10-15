import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeHtmlEditingOperationRequestSha256 } from "../composition-html-editing-operation-digest.server";
import { htmlEditingOperationReceiptSchema } from "../composition-html-editing-operation.contract";
import { SupabaseHtmlEditingRevisionRepository } from "../composition-html-editing-repository.service";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function setup(changed = true) {
  const f = fixture(), next = changed ? f.next : f.current;
  const request = { expected: { version: 1, sha256: f.current.sha256 }, expectedCompositionDocumentHash: f.row.compositionDocumentHash,
    action: "COMMAND" as const, overrides: changed ? [{ operation: "SET_TEXT" as const, elementId: "title", value: "Changed" }]
      : [{ operation: "RESET" as const, elementId: "title", property: "TEXT" as const }] };
  const input = { ...f.request, expected: request.expected, expectedCompositionDocumentHash: request.expectedCompositionDocumentHash,
    authoritativeBinding: f.authority.authoritativeBinding, revision: next.revision, sha256: next.sha256,
    operation: "COMMAND" as const, operationId: other, requestSha256: computeHtmlEditingOperationRequestSha256(request), changed };
  const receipt = { scope: "EDITORIAL_OPERATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED" as const,
    owner: { actorId: uuid, organizationId: uuid, draftId: uuid }, operationId: other, requestSha256: input.requestSha256,
    clipId: f.request.scope.clipId, acknowledgment: { scope: "EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED" as const, changed,
      previous: request.expected, next: { version: next.revision.version, sha256: next.sha256 } } };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const state = { response: receipt as unknown, read: { status: "RECORDED", receipt } as unknown, failCommit: false };
  const repository = new SupabaseHtmlEditingRevisionRepository({ rpc: (name: string, args: Record<string, unknown>) => ({
    abortSignal: async () => {
      calls.push({ name, args });
      return { data: name === "read_html_editing_revision" ? f.row : name === "read_html_editing_operation" ? state.read : state.response,
        error: state.failCommit && name === "commit_html_editing_operation" ? { message: "PRIVATE_SERVER_SECRET" } : null };
    },
  }) } as unknown as SupabaseClient);
  return { f, request, input, receipt, calls, state, repository };
}

test("request digest has a versioned independent golden preimage and ignores object key formatting", () => {
  const f = setup(), canonical = JSON.stringify(f.request);
  assert.equal(computeHtmlEditingOperationRequestSha256(f.request), createHash("sha256")
    .update(`courseforge-html-editing-operation-request-v1\n${canonical}`).digest("hex"));
  assert.equal(computeHtmlEditingOperationRequestSha256({ overrides: f.request.overrides, action: f.request.action,
    expectedCompositionDocumentHash: f.request.expectedCompositionDocumentHash, expected: { sha256: f.request.expected.sha256, version: 1 } }), f.input.requestSha256);
});

test("digest covers CAS/action/values/order, refuses client authority and over-budget commands", () => {
  const f = setup();
  assert.notEqual(computeHtmlEditingOperationRequestSha256({ ...f.request, expectedCompositionDocumentHash: "f".repeat(64) }), f.input.requestSha256);
  assert.notEqual(computeHtmlEditingOperationRequestSha256({ expected: f.request.expected,
    expectedCompositionDocumentHash: f.request.expectedCompositionDocumentHash, action: "RESTORE", restore: f.request.expected }), f.input.requestSha256);
  assert.notEqual(computeHtmlEditingOperationRequestSha256({ ...f.request, overrides: [{ ...f.request.overrides[0]!, value: "Other" }] }), f.input.requestSha256);
  const ordered = [{ operation: "SET_TEXT", elementId: "title", value: "First" }, { operation: "SET_TEXT", elementId: "subtitle", value: "Second" }];
  assert.notEqual(computeHtmlEditingOperationRequestSha256({ ...f.request, overrides: ordered }),
    computeHtmlEditingOperationRequestSha256({ ...f.request, overrides: [...ordered].reverse() }));
  assert.throws(() => computeHtmlEditingOperationRequestSha256({ ...f.request, actorId: uuid }));
  assert.throws(() => computeHtmlEditingOperationRequestSha256({ ...f.request, overrides: [{ ...f.request.overrides[0]!, value: "x".repeat(65536) }] }));
});

test("durable commit verifies current source/grants/native pointer and uses one receipt RPC", async () => {
  const f = setup(); assert.deepEqual(await f.repository.commitOperation(f.input), f.receipt);
  assert.deepEqual(f.calls.map(call => call.name), ["read_html_editing_revision", "commit_html_editing_operation"]);
  const args = f.calls[1]!.args;
  assert.equal(args.p_operation_id, other); assert.equal(args.p_request_sha256, f.input.requestSha256);
  assert.equal(args.p_changed, true); assert.equal(args.p_actor_id, uuid);
  assert.notDeepEqual(args.p_document, f.f.document);
});

test("durable no-op records a receipt without fabricating a native pointer or forward version", async () => {
  const f = setup(false); assert.deepEqual(await f.repository.commitOperation(f.input), f.receipt);
  const args = f.calls[1]!.args;
  assert.equal(args.p_changed, false); assert.deepEqual(args.p_document, f.f.document);
  assert.equal(args.p_document_hash, f.f.row.compositionDocumentHash); assert.equal(f.receipt.acknowledgment.next.version, 1);
});

test("commit rejects malformed, foreign, differently correlated and lost receipts without retry", async () => {
  for (const response of [null, { scope: "bad" }, "x".repeat(4097)]) {
    const f = setup(); f.state.response = response;
    await assert.rejects(f.repository.commitOperation(f.input), /COMMIT_UNCONFIRMED/); assert.equal(f.calls.length, 2);
  }
  for (const change of [{ operationId: uuid }, { requestSha256: "f".repeat(64) }, { clipId: "other" },
    { owner: { actorId: other, organizationId: uuid, draftId: uuid } }]) {
    const f = setup(); f.state.response = { ...f.receipt, ...change };
    await assert.rejects(f.repository.commitOperation(f.input), /COMMIT_UNCONFIRMED/); assert.equal(f.calls.length, 2);
  }
  const lost = setup(); lost.state.failCommit = true;
  await assert.rejects(lost.repository.commitOperation(lost.input), /COMMIT_UNCONFIRMED/); assert.equal(lost.calls.length, 2);
});

test("stale CAS and revoked compiled resources reject before durable commit", async () => {
  const stale = setup();
  await assert.rejects(stale.repository.commitOperation({ ...stale.input, expectedCompositionDocumentHash: "f".repeat(64) }), /REVISION_CONFLICT/);
  assert.equal(stale.calls.length, 1);
  const revoked = setup(); revoked.f.row.grantedAssetIds = [];
  await assert.rejects(revoked.repository.commitOperation(revoked.input)); assert.equal(revoked.calls.length, 1);
});

test("receipt read is scoped metadata only; absence is retained as NOT_FOUND, not a retry authorization", async () => {
  const f = setup(); assert.deepEqual(await f.repository.readOperation(f.input), { status: "RECORDED", receipt: f.receipt });
  assert.equal(f.calls[0]!.name, "read_html_editing_operation"); assert.equal(f.calls[0]!.args.p_actor_id, uuid);
  f.state.read = { status: "NOT_FOUND" }; assert.deepEqual(await f.repository.readOperation(f.input), { status: "NOT_FOUND" });
  assert.equal(JSON.stringify(f.receipt).includes("sourceHtml"), false); assert.equal(JSON.stringify(f.receipt).includes("overrides"), false);
});

test("receipt read rejects foreign scope, digest mismatch, oversized and automatic retry claims", async () => {
  const f = setup();
  for (const read of [{ status: "RECORDED", receipt: { ...f.receipt, requestSha256: "f".repeat(64) } },
    { status: "RECORDED", receipt: { ...f.receipt, owner: { ...f.receipt.owner, draftId: other } } },
    { status: "NOT_FOUND", retryable: true }, "x".repeat(4097)]) {
    f.state.read = read; await assert.rejects(f.repository.readOperation(f.input));
  }
});

test("receipt contract requires exact forward/no-op ACK and never certifies latest state or render", () => {
  const f = setup(); assert.equal(htmlEditingOperationReceiptSchema.safeParse(f.receipt).success, true);
  assert.equal(htmlEditingOperationReceiptSchema.safeParse({ ...f.receipt, active: true }).success, false);
  assert.equal(htmlEditingOperationReceiptSchema.safeParse({ ...f.receipt, acknowledgment: { ...f.receipt.acknowledgment, changed: false } }).success, false);
});
