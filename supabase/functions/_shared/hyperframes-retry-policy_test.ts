import { importRetryDelaySeconds, isPermanentProviderFailure } from "./hyperframes-retry-policy.ts";

Deno.test("authorization and missing renders require intervention; rate limits and outages can retry", () => {
  for (const status of [400, 401, 403, 404, 422]) {
    if (!isPermanentProviderFailure(status)) throw new Error(`Expected HTTP ${status} to be terminal`);
  }
  for (const status of [408, 429, 500, 502, 503, 504]) {
    if (isPermanentProviderFailure(status)) throw new Error(`Expected HTTP ${status} to be retryable`);
  }
});

Deno.test("retry delay is bounded and counts failures, not successful upload checkpoints", () => {
  if (importRetryDelaySeconds(0) !== 30) throw new Error("First failure should wait 30 seconds");
  if (importRetryDelaySeconds(1) !== 60) throw new Error("Second failure should wait 60 seconds");
  if (importRetryDelaySeconds(100) !== 900) throw new Error("Retry delay must be bounded");
});
