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
