import assert from "node:assert/strict";
import test from "node:test";
import {
  isTransientTenantLookupError,
  runTenantLookupWithRetry,
} from "../tenant-lookup-retry";

test("recognizes Supabase fetch failures as transient", () => {
  assert.equal(
    isTransientTenantLookupError({
      code: "",
      details: "TypeError: fetch failed",
      message: "TypeError: fetch failed",
    }),
    true,
  );
  assert.equal(
    isTransientTenantLookupError({ message: "column platform_role does not exist" }),
    false,
  );
});

test("retries a transient tenant lookup and returns the successful result", async () => {
  let attempts = 0;
  const result = await runTenantLookupWithRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        return { data: null, error: { message: "TypeError: fetch failed" } };
      }
      return { data: { platform_role: "ADMIN" }, error: null };
    },
    { retryDelaysMs: [0, 0, 0] },
  );

  assert.equal(attempts, 3);
  assert.deepEqual(result, {
    data: { platform_role: "ADMIN" },
    error: null,
  });
});

test("does not retry non-transient database errors", async () => {
  let attempts = 0;
  const result = await runTenantLookupWithRetry(
    async () => {
      attempts += 1;
      return { data: null, error: { message: "permission denied" } };
    },
    { retryDelaysMs: [0, 0, 0] },
  );

  assert.equal(attempts, 1);
  assert.deepEqual(result, {
    data: null,
    error: { message: "permission denied" },
  });
});

test("bounds stalled lookups and aborts each database request", async () => {
  const signals: AbortSignal[] = [];
  const result = await runTenantLookupWithRetry(
    (signal) => {
      signals.push(signal);
      return new Promise<never>(() => {});
    },
    { attemptTimeoutMs: 10, retryDelaysMs: [0, 0, 0] },
  );
  assert.equal(signals.length, 3);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(result.data, null);
  assert.ok(result.error instanceof Error);
  assert.equal(result.error.name, "TimeoutError");
});

test("recovers after a timeout with a fresh signal and clears the success timer", async () => {
  const signals: AbortSignal[] = [];
  const result = await runTenantLookupWithRetry(
    async (signal) => {
      signals.push(signal);
      if (signals.length === 1) return new Promise<never>(() => {});
      return { data: { platform_role: "ADMIN" }, error: null };
    },
    { attemptTimeoutMs: 10, retryDelaysMs: [0, 0] },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  assert.deepEqual(result, { data: { platform_role: "ADMIN" }, error: null });
});

test("rejects unbounded or empty retry configurations", async () => {
  const lookup = async () => ({ data: null, error: null });
  for (const attemptTimeoutMs of [0, -1, Infinity, NaN]) {
    await assert.rejects(runTenantLookupWithRetry(lookup, { attemptTimeoutMs }));
  }
  await assert.rejects(runTenantLookupWithRetry(lookup, { retryDelaysMs: [] }));
});
