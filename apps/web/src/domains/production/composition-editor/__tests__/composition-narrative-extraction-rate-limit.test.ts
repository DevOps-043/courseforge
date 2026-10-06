import assert from "node:assert/strict";
import test from "node:test";
import { consumeNarrativeExtractionRateLimit, NARRATIVE_EXTRACTION_RATE_POLICY } from "../composition-narrative-extraction-rate-limit";

const organizationId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const row = { allowed: true, remaining: 11, reset_at: new Date(Date.now() + 60_000).toISOString() };

test("distributed limiter policy uses authenticated organization/user, not client draft", async () => {
  assert.deepEqual(await consumeNarrativeExtractionRateLimit({ organizationId, userId, consume: async (policy) => {
    assert.deepEqual(policy, { p_rate_key: `narrative-extraction-plan:${organizationId}:${userId}`,
      p_limit: NARRATIVE_EXTRACTION_RATE_POLICY.limit, p_window_seconds: NARRATIVE_EXTRACTION_RATE_POLICY.windowSeconds });
    return { data: [row], error: null };
  } }), { status: "ALLOWED" });
});
test("limited result provides a bounded retry interval", async () => {
  const result = await consumeNarrativeExtractionRateLimit({ organizationId, userId,
    consume: async () => ({ data: [{ ...row, allowed: false, remaining: 0 }], error: null }) });
  assert.equal(result.status, "LIMITED");
  if (result.status === "LIMITED") assert.ok(result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 60);
});
test("missing RPC, malformed responses and storage errors fail closed", async () => {
  for (const reply of [{ data: [row], error: { code: "missing" } }, { data: [], error: null },
    { data: [{ ...row, allowed: "true" }], error: null }, { data: [{ ...row, reset_at: "invalid" }], error: null }]) {
    assert.deepEqual(await consumeNarrativeExtractionRateLimit({ organizationId, userId, consume: async () => reply }), { status: "UNAVAILABLE" });
  }
});
test("invalid authenticated identities never invoke a rate-limit RPC", async () => {
  let requests = 0;
  await assert.rejects(consumeNarrativeExtractionRateLimit({ organizationId: "../", userId,
    consume: async () => { requests++; return { data: [row], error: null }; } }));
  assert.equal(requests, 0);
});
test("transport failures propagate instead of bypassing distributed protection", async () => {
  await assert.rejects(consumeNarrativeExtractionRateLimit({ organizationId, userId,
    consume: async () => { throw new Error("connection failed"); } }), /connection failed/);
});

test("plan, apply and recovery have independent actor/tenant buckets without draft-controlled keys", async () => {
  const keys: string[] = [];
  for (const purpose of ["PLAN", "APPLY", "RECOVERY"] as const) {
    await consumeNarrativeExtractionRateLimit({ organizationId, userId, purpose, consume: async (policy) => {
      keys.push(policy.p_rate_key); return { data: [row], error: null };
    } });
  }
  assert.equal(new Set(keys).size, 3);
  assert.ok(keys.every((key) => key.endsWith(`:${organizationId}:${userId}`)));
});
