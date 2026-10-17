import test from "node:test";
import assert from "node:assert/strict";
import { createHtmlEditingDurableMutationService } from "../composition-html-editing-mutation.server";
import { computeHtmlEditingOperationRequestSha256 } from "../composition-html-editing-operation-digest.server";
import type { HtmlEditingOperationReceipt } from "../composition-html-editing-operation.contract";
import type { HtmlEditingRevisionRepository } from "../html-editing/html-editing-revision-gateway.server";
import type { HtmlEditingMutationInput } from "../composition-html-editing-mutation.contract";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function setup() {
  const f = fixture(), receipts = new Map<string, HtmlEditingOperationReceipt>();
  const state = { encoded: JSON.stringify(f.current.revision), grants: [uuid, other], commits: 0, appends: 0,
    legacyWrites: 0, historyReads: 0, rejectRevisionRead: false, loseReceipt: false, corruptReceipt: false };
  const repository = {
    readAuthorized: async () => {
      if (state.rejectRevisionRead) throw new Error("Revision should not be read for historical receipt");
      return { ...f.authority, encodedRevision: state.encoded, grantedAssetIds: state.grants, compositionDocumentHash: f.row.compositionDocumentHash };
    },
    appendCompareAndSwap: async () => { state.legacyWrites++; throw new Error("No legacy fallback"); },
    readRestoreRevision: async () => { state.historyReads++; return JSON.stringify(f.current.revision); },
    readOperation: async (input: { operationId: string }) => receipts.has(input.operationId)
      ? { status: "RECORDED", receipt: receipts.get(input.operationId) } : { status: "NOT_FOUND" },
    commitOperation: async (input: Parameters<NonNullable<HtmlEditingRevisionRepository["commitOperation"]>>[0]) => {
      state.commits++;
      const receipt: HtmlEditingOperationReceipt = { scope: "EDITORIAL_OPERATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED",
        owner: { actorId: input.actorId, organizationId: input.scope.organizationId, draftId: input.scope.documentId },
        operationId: input.operationId, requestSha256: input.requestSha256, clipId: input.scope.clipId,
        acknowledgment: { scope: "EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED", changed: input.changed,
          previous: input.expected, next: { version: input.revision.version, sha256: input.sha256 } } };
      receipts.set(input.operationId, receipt);
      if (input.changed) { state.appends++; state.encoded = JSON.stringify(input.revision); }
      if (state.loseReceipt) throw new Error("PRIVATE_COMMIT_RESPONSE_LOST");
      if (state.corruptReceipt) return { ...receipt, operationId: uuid };
      return receipt;
    },
  };
  const request: HtmlEditingMutationInput = { action: "COMMAND", actorId: uuid, organizationId: uuid, documentId: uuid,
    clipId: f.request.scope.clipId, expected: { version: 1, sha256: f.current.sha256 }, expectedCompositionDocumentHash: f.row.compositionDocumentHash,
    overrides: [{ operation: "SET_TEXT", elementId: "title", value: "Changed" }] };
  return { f, receipts, state, repository, request, mutate: createHtmlEditingDurableMutationService(repository) };
}

test("durable command computes digest server-side and commits prepared revision/receipt exactly once", async () => {
  const f = setup(), receipt = await f.mutate(f.request, other);
  const { actorId: _actor, organizationId: _org, documentId: _doc, clipId: _clip, ...body } = f.request;
  assert.equal(receipt.requestSha256, computeHtmlEditingOperationRequestSha256(body));
  assert.equal(receipt.acknowledgment.next.version, 2); assert.equal(f.state.commits, 1); assert.equal(f.state.appends, 1);
  assert.equal(f.state.legacyWrites, 0); assert.deepEqual(f.receipts.get(other), receipt);
});

test("durable no-op still commits a receipt without native/HTML append or version increment", async () => {
  const f = setup(), receipt = await f.mutate({ ...f.request, action: "COMMAND", overrides: [{ operation: "RESET", elementId: "title", property: "TEXT" }] }, other);
  assert.equal(receipt.acknowledgment.changed, false); assert.deepEqual(receipt.acknowledgment.next, f.request.expected);
  assert.equal(f.state.commits, 1); assert.equal(f.state.appends, 0); assert.equal(f.state.legacyWrites, 0);
});

test("recorded operation returns its historical receipt without preparing or re-appending current state", async () => {
  const f = setup(), first = await f.mutate(f.request, other);
  f.state.rejectRevisionRead = true;
  assert.deepEqual(await f.mutate(f.request, other), first);
  assert.equal(f.state.commits, 1); assert.equal(f.state.appends, 1); assert.equal(f.state.historyReads, 0);
});

test("recorded ID cannot acknowledge a different command, owner or CAS", async () => {
  const f = setup(); await f.mutate(f.request, other);
  await assert.rejects(f.mutate({ ...f.request, action: "COMMAND", overrides: [{ operation: "SET_TEXT", elementId: "title", value: "Other" }] }, other));
  await assert.rejects(f.mutate({ ...f.request, actorId: other }, other));
  await assert.rejects(f.mutate({ ...f.request, expected: { version: 1, sha256: "f".repeat(64) } }, other));
  assert.equal(f.state.commits, 1);
});

test("lost receipt and malformed correlation remain unconfirmed without fallback or retry", async () => {
  for (const mode of ["loseReceipt", "corruptReceipt"] as const) {
    const f = setup(); f.state[mode] = true;
    await assert.rejects(f.mutate(f.request, other), /COMMIT_UNCONFIRMED/);
    assert.equal(f.state.commits, 1); assert.equal(f.state.legacyWrites, 0); assert.equal(f.state.appends, 1);
    // Explicit metadata read can recover causal evidence later; never infer it
    // from current revision and never issue an automatic second mutation.
    const recovered = await f.repository.readOperation({ operationId: other });
    assert.equal(recovered.status, "RECORDED"); assert.equal(f.state.commits, 1);
  }
});

test("durable restore uses authorized history and appends a new receipt-bound forward revision", async () => {
  const f = setup(), command = await f.mutate(f.request, other);
  const restore = await f.mutate({ action: "RESTORE", actorId: uuid, organizationId: uuid, documentId: uuid,
    clipId: f.request.clipId, expected: command.acknowledgment.next, expectedCompositionDocumentHash: f.request.expectedCompositionDocumentHash,
    restore: f.request.expected }, uuid);
  assert.equal(restore.acknowledgment.next.version, 3); assert.equal(f.state.historyReads, 1);
  assert.equal(f.state.commits, 2); assert.deepEqual(JSON.parse(f.state.encoded).state.overrides, []);
});

test("revoked dependencies, stale native CAS and pre-abort reject before durable commit", async () => {
  const revoked = setup(); revoked.state.grants = [];
  await assert.rejects(revoked.mutate(revoked.request, other)); assert.equal(revoked.state.commits, 0);
  const stale = setup();
  await assert.rejects(stale.mutate({ ...stale.request, expectedCompositionDocumentHash: "f".repeat(64) }, other)); assert.equal(stale.state.commits, 0);
  const cancelled = setup(), controller = new AbortController(); controller.abort();
  await assert.rejects(cancelled.mutate(cancelled.request, other, controller.signal)); assert.equal(cancelled.state.commits, 0);
});

test("cancellation after persistence stays unconfirmed and preserves a retrievable causal receipt", async () => {
  const f = setup(), controller = new AbortController();
  const commit = f.repository.commitOperation;
  f.repository.commitOperation = async input => {
    const receipt = await commit(input); controller.abort(); return receipt;
  };
  await assert.rejects(f.mutate(f.request, other, controller.signal), /COMMIT_UNCONFIRMED/);
  assert.equal(f.state.commits, 1); assert.equal(f.state.appends, 1); assert.equal(f.state.legacyWrites, 0);
  assert.equal((await f.repository.readOperation({ operationId: other })).status, "RECORDED");
});

test("missing durable commit port fails closed even for no-op, with no legacy fallback", async () => {
  const f = setup();
  const incomplete = { ...f.repository, commitOperation: undefined } as unknown as Parameters<typeof createHtmlEditingDurableMutationService>[0];
  await assert.rejects(createHtmlEditingDurableMutationService(incomplete)({ ...f.request, action: "COMMAND",
    overrides: [{ operation: "RESET", elementId: "title", property: "TEXT" }] }, other), /INVALID_REVISION/);
  assert.equal(f.state.commits, 0); assert.equal(f.state.appends, 0); assert.equal(f.state.legacyWrites, 0);
});
