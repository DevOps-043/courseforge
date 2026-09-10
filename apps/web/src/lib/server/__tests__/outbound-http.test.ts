import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithDeadline } from "../outbound-http";

function installStalledFetch() {
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal, "The outbound request must receive an abort signal");
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) as typeof fetch;
}

test("fetchWithDeadline aborts a stalled outbound request", async () => {
  const originalFetch = globalThis.fetch;
  installStalledFetch();

  try {
    await assert.rejects(fetchWithDeadline("https://example.com", {}, 5), (error) => {
      assert.equal((error as Error).name, "TimeoutError");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithDeadline preserves an earlier caller cancellation", async () => {
  const originalFetch = globalThis.fetch;
  installStalledFetch();

  const controller = new AbortController();
  controller.abort(new Error("cancelled by caller"));

  try {
    await assert.rejects(
      fetchWithDeadline("https://example.com", { signal: controller.signal }, 1_000),
      /cancelled by caller/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
