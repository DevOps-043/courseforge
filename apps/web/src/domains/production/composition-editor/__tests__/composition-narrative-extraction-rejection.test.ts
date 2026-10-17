import assert from "node:assert/strict";
import test from "node:test";
import { requestNarrativeExtractionCommand } from "../composition-narrative-extraction-command.client";
import { NarrativeExtractionController } from "../composition-narrative-extraction-controller";
import { NarrativeExtractionSession } from "../composition-narrative-extraction-session";
import { readNarrativeExtractionPending, reserveNarrativeExtractionPending, type NarrativeExtractionPendingStorage } from "../composition-narrative-extraction-pending";
import type { NarrativeExtractionApplyRequest, NarrativeExtractionSummary } from "../composition-narrative-extraction-contract";

const scope = { organizationId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", draftId: "33333333-3333-4333-8333-333333333333" };
const selection = { documentHash: "a".repeat(64), occurrenceId: "occurrence", firstSourceIndex: 0, lastSourceIndex: 1 };
const summary: NarrativeExtractionSummary = { contract: "NARRATIVE_VOICE_EXTRACTION_ELIGIBILITY_V2", documentHash: selection.documentHash,
  reviewFingerprint: "b".repeat(64), scope: "VOICE_ONLY", binding: "REGISTRY_METADATA_MATCH_ONLY", sourceStartSeconds: 0, sourceEndSeconds: 1,
  destinationStartSeconds: 10, destinationEndSeconds: 11, requiresRevalidationBeforeApply: true };
const command: NarrativeExtractionApplyRequest = { contract: "NARRATIVE_VOICE_EXTRACTION_APPLY_V1", commandId: "44444444-4444-4444-8444-444444444444", selection, reviewFingerprint: summary.reviewFingerprint };
const rejection = () => ({ success: false, code: "CONFLICT", error: "secret internals", message: "secret internals", requestId: "request", correlationId: "request",
  retryable: false, details: { reason: "STALE_DOCUMENT", automaticRetryAllowed: false, recoveryRequired: false, requestNotApplied: true } });
function memory(): NarrativeExtractionPendingStorage {
  const items = new Map<string, string>();
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); }, removeItem: key => { items.delete(key); } };
}
test("only a complete explicit negative acknowledgement rejects a fresh apply without leaking internals", async () => {
  const result = await requestNarrativeExtractionCommand({ mode: "APPLY", draftId: scope.draftId, command, signal: new AbortController().signal,
    fetcher: async () => Response.json(rejection(), { status: 409 }) });
  assert.equal(result.kind, "REJECTED"); assert.ok(!JSON.stringify(result).includes("secret"));
});
test("missing marker, recovery requirement, mismatched command or unknown fields cannot clear uncertainty", async () => {
  for (const patch of [{ requestNotApplied: undefined }, { requestNotApplied: false }, { recoveryRequired: true },
    { commandId: scope.userId }, { operations: [] }]) {
    const body = rejection();
    const result = await requestNarrativeExtractionCommand({ mode: "APPLY", draftId: scope.draftId, command, signal: new AbortController().signal,
      fetcher: async () => Response.json({ ...body, details: { ...body.details, ...patch } }, { status: 409 }) });
    assert.equal(result.kind, "UNCONFIRMED");
  }
});
test("recovery error never proves that an earlier transaction failed", async () => {
  const result = await requestNarrativeExtractionCommand({ mode: "RECOVERY", draftId: scope.draftId, command, signal: new AbortController().signal,
    fetcher: async () => Response.json(rejection(), { status: 403 }) });
  assert.equal(result.kind, "UNCONFIRMED");
  const session = new NarrativeExtractionSession(); session.restorePending(scope.draftId, command); session.beginRecovery();
  assert.equal(session.settle({ kind: "REJECTED", commandId: command.commandId, message: "rejected" }), false);
});
test("definitive apply rejection clears only its pending pointer and requires a new review", async () => {
  const storage = memory(); let calls = 0;
  const controller = new NarrativeExtractionController({ scope, storage, exclusiveLock: async (_key, task) => task(), onState: () => undefined,
    reloadDocument: async () => true, fetcher: async () => { calls++; return Response.json(rejection(), { status: 409 }); } });
  controller.initialize(); controller.review(selection, summary); assert.equal(await controller.apply(selection, new AbortController().signal), false);
  assert.equal(controller.state.phase, "IDLE"); assert.equal(readNarrativeExtractionPending(storage, scope).status, "EMPTY");
  assert.equal(await controller.apply(selection, new AbortController().signal), false); assert.equal(calls, 1);
});
test("failure to remove rejected pointer retains blockage; recovery rejection retains original pointer", async () => {
  const storage = memory(); storage.removeItem = () => { throw Error("unavailable"); };
  const controller = new NarrativeExtractionController({ scope, storage, exclusiveLock: async (_key, task) => task(), onState: () => undefined,
    reloadDocument: async () => true, fetcher: async () => Response.json(rejection(), { status: 409 }) });
  controller.initialize(); controller.review(selection, summary); await controller.apply(selection, new AbortController().signal);
  assert.equal(controller.unavailable, true); assert.equal(controller.state.phase, "UNCONFIRMED");
  assert.equal(readNarrativeExtractionPending(storage, scope).status, "PENDING");
  const recoveredStorage = memory(); reserveNarrativeExtractionPending(recoveredStorage, scope, command);
  const recovered = new NarrativeExtractionController({ scope, storage: recoveredStorage, exclusiveLock: async (_key, task) => task(), onState: () => undefined,
    reloadDocument: async () => true, fetcher: async () => Response.json(rejection(), { status: 403 }) });
  recovered.initialize(); await recovered.recover(new AbortController().signal);
  assert.equal(recovered.state.phase, "UNCONFIRMED"); assert.equal(readNarrativeExtractionPending(recoveredStorage, scope).status, "PENDING");
});
