import assert from "node:assert/strict";
import test from "node:test";
import { NarrativeExtractionController, type NarrativeExtractionExclusiveLock } from "../composition-narrative-extraction-controller";
import { readNarrativeExtractionPending, reserveNarrativeExtractionPending, clearNarrativeExtractionPending, narrativeExtractionPendingKey,
  type NarrativeExtractionPendingStorage } from "../composition-narrative-extraction-pending";
import type { NarrativeExtractionApplyRequest, NarrativeExtractionSummary } from "../composition-narrative-extraction-contract";

const scope = { organizationId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222",
  draftId: "33333333-3333-4333-8333-333333333333" };
const selection = { documentHash: "a".repeat(64), occurrenceId: '["scene","clip","asset"]', firstSourceIndex: 0, lastSourceIndex: 2 };
const summary: NarrativeExtractionSummary = { contract: "NARRATIVE_VOICE_EXTRACTION_ELIGIBILITY_V2", documentHash: selection.documentHash,
  reviewFingerprint: "b".repeat(64), scope: "VOICE_ONLY", binding: "REGISTRY_METADATA_MATCH_ONLY", sourceStartSeconds: 1,
  sourceEndSeconds: 3, destinationStartSeconds: 10, destinationEndSeconds: 12, requiresRevalidationBeforeApply: true };
const command: NarrativeExtractionApplyRequest = { contract: "NARRATIVE_VOICE_EXTRACTION_APPLY_V1", commandId: "44444444-4444-4444-8444-444444444444",
  selection, reviewFingerprint: summary.reviewFingerprint };
function memory(): NarrativeExtractionPendingStorage {
  const entries = new Map<string, string>();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value); }, removeItem: key => { entries.delete(key); } };
}
const exclusiveLock: NarrativeExtractionExclusiveLock = async (_key, task) => task();
const signal = () => new AbortController().signal;
const phase = (controller: NarrativeExtractionController): string => controller.state.phase;
function fixture(options: { storage?: NarrativeExtractionPendingStorage; fetcher?: typeof fetch; reloadDocument?: (clip: string) => Promise<boolean>;
  lock?: NarrativeExtractionExclusiveLock } = {}) {
  const storage = options.storage ?? memory();
  const controller = new NarrativeExtractionController({ storage, scope, onState: () => undefined,
    exclusiveLock: options.lock ?? exclusiveLock, fetcher: options.fetcher ?? (async () => { throw Error("lost ack"); }),
    reloadDocument: options.reloadDocument ?? (async () => true) });
  controller.initialize();
  return { controller, storage };
}
const acknowledged: typeof fetch = async (url, options) => {
  const submitted = JSON.parse(String(options?.body)) as NarrativeExtractionApplyRequest;
  return Response.json({ success: true, data: { contract: "NARRATIVE_EXTRACTION_COMMAND_RESULT_V1",
    status: String(url).endsWith("receipt") ? "CONFIRMED" : "COMMITTED", commandId: submitted.commandId,
    newClipId: `voice-extract-${submitted.commandId}`, documentHash: "c".repeat(64), version: 3,
    scope: "DATABASE_COMMIT_ONLY", reloadDocumentRequired: true, recoveryRequired: false, automaticRetryAllowed: false } });
};

test("pending store is scoped, bounded and does not overwrite another intention", () => {
  const storage = memory();
  assert.equal(reserveNarrativeExtractionPending(storage, scope, command), true);
  assert.equal(reserveNarrativeExtractionPending(storage, scope, { ...command, commandId: scope.draftId }), false);
  assert.equal(readNarrativeExtractionPending(storage, { ...scope, userId: scope.draftId }).status, "EMPTY");
  assert.equal(clearNarrativeExtractionPending(storage, scope, { ...command, reviewFingerprint: "c".repeat(64) }), false);
  assert.equal(clearNarrativeExtractionPending(storage, scope, command), true);
});
test("corrupt, oversize and scope-mismatched entries fail closed without deleting evidence", () => {
  const storage = memory(); const key = narrativeExtractionPendingKey(scope);
  for (const value of ["broken", "x".repeat(10 * 1024), JSON.stringify({ contract: "NARRATIVE_EXTRACTION_PENDING_V1",
    scope: { ...scope, userId: scope.draftId }, command })]) {
    storage.setItem(key, value); assert.equal(readNarrativeExtractionPending(storage, scope).status, "UNAVAILABLE");
    assert.equal(reserveNarrativeExtractionPending(storage, scope, command), false); assert.equal(storage.getItem(key), value);
  }
});
test("storage failure prevents dispatch", async () => {
  let calls = 0;
  const storage = memory(); storage.setItem = () => { throw Error("quota"); };
  const { controller } = fixture({ storage, fetcher: async () => { calls++; throw Error("unexpected"); } });
  assert.equal(controller.review(selection, summary), true);
  assert.equal(await controller.apply(selection, signal()), false); assert.equal(calls, 0); assert.equal(controller.unavailable, true);
});
test("apply records intent before fetch, retains lost acknowledgement, reload restores recovery only", async () => {
  let calls = 0; const storage = memory();
  const { controller } = fixture({ storage, fetcher: async () => {
    calls++; assert.equal(readNarrativeExtractionPending(storage, scope).status, "PENDING"); throw Error("lost");
  } });
  controller.review(selection, summary); await controller.apply(selection, signal()); controller.invalidateReview();
  assert.equal(controller.state.phase, "UNCONFIRMED"); assert.equal(calls, 1);
  const restored = fixture({ storage, fetcher: acknowledged }).controller;
  assert.equal(restored.state.phase, "UNCONFIRMED"); assert.equal(restored.review(selection, summary), false);
  assert.equal(await restored.apply(selection, signal()), false);
  assert.equal(await restored.recover(signal()), true); assert.equal(restored.state.phase, "RELOAD_REQUIRED");
  assert.equal(await restored.reload(), true); assert.equal(phase(restored), "IDLE");
  assert.equal(readNarrativeExtractionPending(storage, scope).status, "EMPTY");
});
test("confirmed acknowledgement does not clear pointer until current document reload succeeds", async () => {
  let reloadWorks = false; const { controller, storage } = fixture({ fetcher: acknowledged, reloadDocument: async () => reloadWorks });
  controller.review(selection, summary); assert.equal(await controller.apply(selection, signal()), true);
  assert.equal(await controller.reload(), false); assert.equal(readNarrativeExtractionPending(storage, scope).status, "PENDING");
  reloadWorks = true; assert.equal(await controller.reload(), true);
});
test("another tab's pending command wins before dispatch", async () => {
  let calls = 0; const { controller, storage } = fixture({ fetcher: async () => { calls++; throw Error("unexpected"); } });
  controller.review(selection, summary); reserveNarrativeExtractionPending(storage, scope, command);
  assert.equal(await controller.apply(selection, signal()), false); assert.equal(calls, 0);
  assert.equal(controller.state.phase, "UNCONFIRMED");
});
test("double apply is blocked synchronously while lock is pending", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  const lock: NarrativeExtractionExclusiveLock = async (_key, task) => { await gate; return task(); };
  const { controller } = fixture({ lock, fetcher: async (...args) => { calls++; return acknowledged(...args); } });
  controller.review(selection, summary); const first = controller.apply(selection, signal());
  assert.equal(await controller.apply(selection, signal()), false); release();
  assert.equal(await first, true); assert.equal(calls, 1);
});
test("abort before acquiring lock sends nothing and does not reserve pending intent", async () => {
  const { controller, storage } = fixture(); controller.review(selection, summary);
  const aborted = new AbortController(); aborted.abort();
  assert.equal(await controller.apply(selection, aborted.signal), false);
  assert.equal(readNarrativeExtractionPending(storage, scope).status, "EMPTY");
});
test("recovery never falls back to apply when receipt is unavailable", async () => {
  const storage = memory(); reserveNarrativeExtractionPending(storage, scope, command); const urls: string[] = [];
  const { controller } = fixture({ storage, fetcher: async url => { urls.push(String(url)); return new Response("unavailable", { status: 503 }); } });
  assert.equal(await controller.recover(signal()), false); assert.equal(controller.state.phase, "UNCONFIRMED");
  assert.equal(urls.length, 1); assert.ok(urls[0].endsWith("receipt"));
});
