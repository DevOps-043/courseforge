import assert from "node:assert/strict";
import test from "node:test";
import { NarrativeFragmentController } from "../composition-narrative-fragment-controller";
import { NarrativeFragmentSession } from "../composition-narrative-fragment-session";
import { NarrativeExtractionController } from "../composition-narrative-extraction-controller";
import { readNarrativeCommandPending, readNarrativeExtractionPending, reserveNarrativeCommandPending,
  clearNarrativeCommandPending, narrativeExtractionPendingKey, type NarrativeExtractionPendingStorage } from "../composition-narrative-extraction-pending";
import type { NarrativeFragmentSummary } from "../composition-narrative-fragment-contract";
import type { NarrativeFragmentApplyRequest } from "../composition-narrative-fragment-command-contract";

const scope = { organizationId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222",
  draftId: "33333333-3333-4333-8333-333333333333" };
const query = { contract: "NARRATIVE_FRAGMENT_QUERY_V1" as const, selectedTrackIds: ["voice", "text"],
  selection: { documentHash: "a".repeat(64), occurrenceId: "voice", firstSourceIndex: 0, lastSourceIndex: 2 } };
const summary: NarrativeFragmentSummary = { contract: "NARRATIVE_FRAGMENT_ELIGIBILITY_V1", documentHash: query.selection.documentHash,
  reviewFingerprint: "b".repeat(64), scope: "AUDIOVISUAL", binding: "REGISTRY_METADATA_MATCH_ONLY", requiresRevalidationBeforeApply: true,
  sourceStartSeconds: 1, sourceEndSeconds: 3, destinationStartSeconds: 10, destinationEndSeconds: 12,
  clipCount: 2, trackCount: 2, captionCuts: 0, wordCuts: 0 };
const command: NarrativeFragmentApplyRequest = { contract: "NARRATIVE_FRAGMENT_APPLY_V1", commandId: "44444444-4444-4444-8444-444444444444",
  query, reviewFingerprint: summary.reviewFingerprint };
function memory(): NarrativeExtractionPendingStorage {
  const entries = new Map<string, string>();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value); }, removeItem: key => { entries.delete(key); } };
}
const acknowledged: typeof fetch = async (url, options) => {
  const submitted = JSON.parse(String(options?.body)) as NarrativeFragmentApplyRequest;
  return Response.json({ success: true, data: { contract: "NARRATIVE_FRAGMENT_COMMAND_RESULT_V1",
    status: String(url).endsWith("receipt") ? "CONFIRMED" : "COMMITTED", commandId: submitted.commandId,
    anchorClipId: `voice-extract-${submitted.commandId}`, newClipIds: [`voice-extract-${submitted.commandId}`, `fragment-${submitted.commandId}-0`],
    documentHash: "c".repeat(64), version: 2, scope: "DATABASE_COMMIT_ONLY",
    reloadDocumentRequired: true, recoveryRequired: false, automaticRetryAllowed: false } });
};
function fixture(storage = memory(), fetcher: typeof fetch = acknowledged,
  reloadDocument: (ids: string[], anchor: string, hash: string) => Promise<boolean> = async () => true) {
  const controller = new NarrativeFragmentController({ storage, scope, onState: () => undefined, fetcher, reloadDocument,
    exclusiveLock: async (key, task) => { assert.equal(key, narrativeExtractionPendingKey(scope)); return task(); } });
  controller.initialize(); return { storage, controller };
}
const signal = () => new AbortController().signal;

test("one pointer namespace holds either command and legacy voice fails closed on audiovisual", () => {
  const storage = memory();
  assert.equal(reserveNarrativeCommandPending(storage, scope, command), true);
  assert.equal(readNarrativeCommandPending(storage, scope).status, "PENDING");
  assert.equal(readNarrativeExtractionPending(storage, scope).status, "UNAVAILABLE");
  assert.equal(reserveNarrativeCommandPending(storage, scope, { ...command, commandId: scope.draftId }), false);
  assert.equal(clearNarrativeCommandPending(storage, scope, { ...command, query: { ...query, selectedTrackIds: ["voice", "other"] } }), false);
  assert.equal(clearNarrativeCommandPending(storage, scope, command), true);
});
test("fragment review binds exact range and track set; detached intent cannot mutate active state", () => {
  const session = new NarrativeFragmentSession();
  assert.equal(session.review(scope.draftId, query, { ...summary, trackCount: 3 }), false);
  assert.equal(session.review(scope.draftId, query, summary), true);
  assert.equal(session.beginApply(scope.draftId, { ...query, selectedTrackIds: ["voice", "other"] }, command.commandId), null);
  const submitted = session.beginApply(scope.draftId, { ...query, selectedTrackIds: ["text", "voice"] }, command.commandId)!;
  submitted.query.selectedTrackIds.push("other");
  const state = session.state; assert.equal(state.phase, "APPLYING");
  if (state.phase === "APPLYING") assert.equal(state.command.query.selectedTrackIds.length, 2);
  session.invalidateReview(); assert.equal(session.state.phase, "APPLYING");
});
test("reservation precedes dispatch; confirmed batch stays pending until full current reload", async () => {
  let reloads = 0;
  const storage = memory();
  const current = fixture(storage, async (url, options) => {
    assert.equal(readNarrativeCommandPending(storage, scope).status, "PENDING");
    assert.ok(String(url).endsWith("/narrative-fragment/apply")); return acknowledged(url, options);
  }, async (ids, anchor, hash) => { reloads++; assert.equal(ids.length, 2); assert.ok(ids.includes(anchor)); assert.equal(hash, "c".repeat(64)); return true; });
  assert.equal(current.controller.review(query, summary), true);
  assert.equal(await current.controller.apply(query, signal()), true); assert.equal(current.controller.state.phase, "RELOAD_REQUIRED");
  assert.equal(readNarrativeCommandPending(storage, scope).status, "PENDING");
  assert.equal(await current.controller.apply(query, signal()), false);
  assert.equal(await current.controller.reload(), true); assert.equal(reloads, 1);
  assert.equal(readNarrativeCommandPending(storage, scope).status, "EMPTY");
});
test("lost ACK restores only receipt recovery and never sends another apply after remount", async () => {
  const first = fixture(memory(), async () => { throw Error("lost ack"); });
  first.controller.review(query, summary); assert.equal(await first.controller.apply(query, signal()), false);
  assert.equal(first.controller.state.phase, "UNCONFIRMED");
  const urls: string[] = [];
  const second = fixture(first.storage, async (url, options) => { urls.push(String(url)); return acknowledged(url, options); });
  assert.equal(second.controller.state.phase, "UNCONFIRMED"); assert.equal(second.controller.review(query, summary), false);
  assert.equal(await second.controller.apply(query, signal()), false); assert.equal(urls.length, 0);
  assert.equal(await second.controller.recover(signal()), true);
  assert.equal(urls.length, 1); assert.ok(urls[0]!.endsWith("/narrative-fragment/receipt"));
  assert.equal(await second.controller.reload(), true);
});
test("failed reload preserves the full audiovisual pointer and blocks new commands", async () => {
  const current = fixture(memory(), acknowledged, async () => false);
  current.controller.review(query, summary); await current.controller.apply(query, signal());
  assert.equal(await current.controller.reload(), false); assert.equal(current.controller.state.phase, "RELOAD_REQUIRED");
  assert.equal(readNarrativeCommandPending(current.storage, scope).status, "PENDING");
});
test("voice and fragment controllers cannot overwrite the other command type", async () => {
  const storage = memory(); reserveNarrativeCommandPending(storage, scope, command);
  let calls = 0;
  const voice = new NarrativeExtractionController({ storage, scope, onState: () => undefined,
    exclusiveLock: async (_key, task) => task(), reloadDocument: async () => true,
    fetcher: async () => { calls++; throw Error("unexpected"); } });
  voice.initialize(); assert.equal(voice.unavailable, true); assert.equal(await voice.recover(signal()), false);
  assert.equal(calls, 0); assert.equal(readNarrativeCommandPending(storage, scope).status, "PENDING");
  clearNarrativeCommandPending(storage, scope, command);
  reserveNarrativeCommandPending(storage, scope, { contract: "NARRATIVE_VOICE_EXTRACTION_APPLY_V1", commandId: command.commandId,
    selection: query.selection, reviewFingerprint: summary.reviewFingerprint });
  const fragment = fixture(storage); assert.equal(fragment.controller.unavailable, true);
  assert.equal(await fragment.controller.apply(query, signal()), false);
});
test("journal corruption and quota failure preserve evidence and prevent dispatch", async () => {
  const storage = memory(); storage.setItem(narrativeExtractionPendingKey(scope), "broken");
  const corrupt = fixture(storage); assert.equal(corrupt.controller.unavailable, true);
  assert.equal(storage.getItem(narrativeExtractionPendingKey(scope)), "broken");
  const failing = memory(); failing.setItem = () => { throw Error("quota"); };
  let calls = 0; const current = fixture(failing, async () => { calls++; throw Error("unexpected"); });
  current.controller.review(query, summary); assert.equal(await current.controller.apply(query, signal()), false);
  assert.equal(calls, 0); assert.equal(current.controller.unavailable, true);
});
