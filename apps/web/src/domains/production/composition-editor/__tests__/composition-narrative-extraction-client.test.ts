import assert from "node:assert/strict";
import test from "node:test";
import { requestNarrativeExtractionReview } from "../composition-narrative-extraction-client";
import { narrativeExtractionSelectionKey, narrativeExtractionSummarySchema } from "../composition-narrative-extraction-contract";

const draftId = "55555555-5555-4555-8555-555555555555";
const selection = { documentHash: "b".repeat(64), occurrenceId: "occurrence", firstSourceIndex: 1, lastSourceIndex: 2 };
const summary = { contract: "NARRATIVE_VOICE_EXTRACTION_ELIGIBILITY_V2", documentHash: selection.documentHash, reviewFingerprint: "d".repeat(64),
  scope: "VOICE_ONLY", binding: "REGISTRY_METADATA_MATCH_ONLY", sourceStartSeconds: 1, sourceEndSeconds: 2.5,
  destinationStartSeconds: 30, destinationEndSeconds: 31.5, requiresRevalidationBeforeApply: true };
const response = (payload: unknown) => Response.json({ success: true, data: payload });
const fetcher = (reply: () => Promise<Response>): typeof fetch => async () => reply();

test("client posts only the selection and accepts the bounded versioned summary", async () => {
  const loader: typeof fetch = async (url, options) => {
    assert.equal(url, `/api/production/hyperframes/drafts/${draftId}/narrative-extraction/plan`);
    assert.equal(options?.method, "POST");
    assert.equal(options?.cache, "no-store");
    assert.deepEqual(JSON.parse(String(options?.body)), selection);
    return response(summary);
  };
  assert.deepEqual(await requestNarrativeExtractionReview({ draftId, selection, signal: new AbortController().signal, fetcher: loader }),
    { ok: true, summary });
});
test("different revision, audiovisual scope or patch-bearing summary cannot be reviewed", async () => {
  for (const patch of [{ documentHash: "c".repeat(64) }, { scope: "AUDIOVISUAL" }, { operations: [] },
    { requiresRevalidationBeforeApply: false }]) {
    const result = await requestNarrativeExtractionReview({ draftId, selection, signal: new AbortController().signal,
      fetcher: fetcher(async () => response({ ...summary, ...patch })) });
    assert.equal(result.ok, false);
  }
});
test("invalid intervals never produce an eligible client summary", () => {
  for (const patch of [{ sourceEndSeconds: 1 }, { destinationEndSeconds: 31 },
    { sourceEndSeconds: 122, destinationEndSeconds: 151 }, { sourceStartSeconds: -1 }, { destinationStartSeconds: Infinity }]) {
    assert.equal(narrativeExtractionSummarySchema.safeParse({ ...summary, ...patch }).success, false);
  }
});
test("identity changes for every relevant selection field and draft", () => {
  const key = narrativeExtractionSelectionKey(draftId, selection);
  assert.ok(key);
  assert.equal(key, narrativeExtractionSelectionKey(draftId, { ...selection }));
  for (const patch of [{ documentHash: "c".repeat(64) }, { occurrenceId: "other" }, { firstSourceIndex: 0 },
    { lastSourceIndex: 3 }, { adjustedStartSeconds: 10, adjustedEndSeconds: 12 }]) {
    assert.notEqual(key, narrativeExtractionSelectionKey(draftId, { ...selection, ...patch }));
  }
  assert.notEqual(key, narrativeExtractionSelectionKey("66666666-6666-4666-8666-666666666666", selection));
  assert.equal(narrativeExtractionSelectionKey(draftId, { ...selection, firstSourceIndex: NaN }), null);
});
test("an aborted superseded request cannot return a review even if fetch ignores cancellation", async () => {
  const controller = new AbortController();
  await assert.rejects(requestNarrativeExtractionReview({ draftId, selection, signal: controller.signal,
    fetcher: fetcher(async () => { controller.abort(); return response(summary); }) }), { name: "AbortError" });
});
test("rate limit is not retried automatically and ignores unsafe retry headers", async () => {
  let requests = 0;
  const result = await requestNarrativeExtractionReview({ draftId, selection, signal: new AbortController().signal,
    fetcher: fetcher(async () => { requests++; return new Response("private", { status: 429, headers: { "retry-after": "invalid" } }); }) });
  assert.equal(requests, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.retryAfterSeconds, 60);
});
test("backend error content is never reflected to the user", async () => {
  for (const status of [401, 403, 409, 422, 500, 503]) {
    const result = await requestNarrativeExtractionReview({ draftId, selection, signal: new AbortController().signal,
      fetcher: fetcher(async () => new Response("internal secret", { status })) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(!result.message.includes("internal secret"));
  }
});
test("malformed and oversized successful responses fail without returning a summary", async () => {
  for (const body of ["not JSON", "a".repeat(16 * 1024 + 1)]) {
    await assert.rejects(requestNarrativeExtractionReview({ draftId, selection, signal: new AbortController().signal,
      fetcher: fetcher(async () => new Response(body)) }));
  }
});
test("invalid draft identifiers cannot create request URLs", async () => {
  let requests = 0;
  await assert.rejects(requestNarrativeExtractionReview({ draftId: "../document", selection, signal: new AbortController().signal,
    fetcher: fetcher(async () => { requests++; return response(summary); }) }));
  assert.equal(requests, 0);
});
