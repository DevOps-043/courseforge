import assert from "node:assert/strict";
import test from "node:test";
import { requestNarrativeFragmentReview } from "../composition-narrative-fragment.client";
import { narrativeFragmentSelectionKey, type NarrativeFragmentQuery } from "../composition-narrative-fragment-contract";

const draftId = "55555555-5555-4555-8555-555555555555";
const request: NarrativeFragmentQuery = { contract: "NARRATIVE_FRAGMENT_QUERY_V1", selectedTrackIds: ["voice", "text"],
  selection: { documentHash: "b".repeat(64), occurrenceId: "occurrence", firstSourceIndex: 1, lastSourceIndex: 2 } };
const summary = { contract: "NARRATIVE_FRAGMENT_ELIGIBILITY_V1", documentHash: request.selection.documentHash,
  reviewFingerprint: "c".repeat(64), scope: "AUDIOVISUAL", binding: "REGISTRY_METADATA_MATCH_ONLY", requiresRevalidationBeforeApply: true,
  sourceStartSeconds: 1, sourceEndSeconds: 2, destinationStartSeconds: 10, destinationEndSeconds: 11,
  clipCount: 2, trackCount: 2, captionCuts: 1, wordCuts: 2 };
const parameters = () => ({ draftId, request: structuredClone(request), signal: new AbortController().signal });
const response = (data: unknown) => Response.json({ success: true, requestId: "correlation", data });
test("review sends only explicit selection/tracks and accepts bounded summary without writes", async () => {
  let calls = 0;
  const result = await requestNarrativeFragmentReview({ ...parameters(), fetcher: async (url, init) => {
    calls++; assert.equal(url, `/api/production/hyperframes/drafts/${draftId}/narrative-fragment/plan`);
    assert.equal(init?.method, "POST"); assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(init?.body)), request); return response(summary);
  } });
  assert.deepEqual(result, { ok: true, summary }); assert.equal(calls, 1);
});
test("foreign revision, scope, track count, invalid intervals and operation-bearing data are rejected", async () => {
  for (const change of [{ documentHash: "d".repeat(64) }, { scope: "VOICE_ONLY" }, { trackCount: 3 },
    { destinationEndSeconds: 12 }, { operations: [] }]) {
    const result = await requestNarrativeFragmentReview({ ...parameters(), fetcher: async () => response({ ...summary, ...change }) });
    assert.equal(result.ok, false);
  }
});
test("review identity changes with selection and track set, not presentation order", () => {
  const key = narrativeFragmentSelectionKey(draftId, request); assert.ok(key);
  assert.equal(narrativeFragmentSelectionKey(draftId, { ...request, selectedTrackIds: ["text", "voice"] }), key);
  assert.notEqual(narrativeFragmentSelectionKey(draftId, { ...request, selectedTrackIds: ["voice", "caption"] }), key);
  assert.notEqual(narrativeFragmentSelectionKey(draftId, { ...request, selection: { ...request.selection, lastSourceIndex: 3 } }), key);
  assert.equal(narrativeFragmentSelectionKey(draftId, { ...request, selectedTrackIds: ["voice", "voice"] }), null);
  assert.equal(narrativeFragmentSelectionKey("invalid", request), null);
});
test("rate limit and other failures never retry or expose backend contents", async () => {
  for (const status of [429, 403, 409, 422, 503]) {
    let calls = 0;
    const result = await requestNarrativeFragmentReview({ ...parameters(), fetcher: async () => {
      calls++; return new Response("secret internal detail", { status, headers: { "retry-after": "999999" } });
    } });
    assert.equal(result.ok, false); assert.equal(calls, 1);
    if (!result.ok) { assert.ok(!result.message.includes("secret")); if (status === 429) assert.equal(result.retryAfterSeconds, 60); }
  }
});
test("invalid client input and pre-dispatch abort never send; late abort never returns review", async () => {
  const fetcher: typeof fetch = async () => { throw Error("must not send"); };
  await assert.rejects(requestNarrativeFragmentReview({ ...parameters(), draftId: "invalid", fetcher }));
  await assert.rejects(requestNarrativeFragmentReview({ ...parameters(), request: { ...request, selectedTrackIds: ["voice"] }, fetcher }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestNarrativeFragmentReview({ ...parameters(), signal: controller.signal, fetcher }));
  const late = new AbortController();
  await assert.rejects(requestNarrativeFragmentReview({ ...parameters(), signal: late.signal, fetcher: async () => {
    late.abort(); return response(summary);
  } }));
});
test("oversized and malformed UTF-8 successful bodies cannot authorize review", async () => {
  for (const body of [" ".repeat(16 * 1024 + 1), new Uint8Array([0xff])]) {
    await assert.rejects(requestNarrativeFragmentReview({ ...parameters(), fetcher: async () => new Response(body) }));
  }
});
