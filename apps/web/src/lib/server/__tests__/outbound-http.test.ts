import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchIdempotentWithRetry,
  fetchWithDeadline,
  OutboundCircuitBreaker,
  OutboundCircuitOpenError,
  OutboundResponseTooLargeError,
  readJsonResponseWithLimit,
  readResponseArrayBufferWithLimit,
  readResponseTextWithLimit,
} from "../outbound-http";

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

test("idempotent retries recover from 429 and transient 5xx responses", async () => {
  const originalFetch = globalThis.fetch;
  const statuses = [429, 503, 200];
  let calls = 0;
  globalThis.fetch = (async () => {
    const status = statuses[calls++] ?? 500;
    return new Response(null, {
      headers: status === 429 ? { "Retry-After": "0" } : undefined,
      status,
    });
  }) as typeof fetch;

  try {
    const response = await fetchIdempotentWithRetry("https://example.com", {}, {
      baseDelayMilliseconds: 1,
      maxDelayMilliseconds: 1,
      totalTimeoutMilliseconds: 1_000,
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("idempotent retries return the last response after the bounded attempts", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(null, { status: 503 });
  }) as typeof fetch;

  try {
    const response = await fetchIdempotentWithRetry("https://example.com", {}, {
      attempts: 2,
      baseDelayMilliseconds: 1,
      maxDelayMilliseconds: 1,
      totalTimeoutMilliseconds: 1_000,
    });
    assert.equal(response.status, 503);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("idempotent retries do not violate a Retry-After beyond the wait budget", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(null, { headers: { "Retry-After": "60" }, status: 429 });
  }) as typeof fetch;

  try {
    const response = await fetchIdempotentWithRetry("https://example.com", {}, {
      baseDelayMilliseconds: 1,
      maxDelayMilliseconds: 1,
      totalTimeoutMilliseconds: 1_000,
    });
    assert.equal(response.status, 429);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("idempotent retries reject mutating methods before issuing a request", async () => {
  await assert.rejects(
    fetchIdempotentWithRetry("https://example.com", { method: "POST" }),
    /solo admiten operaciones GET o HEAD/,
  );
});

test("idempotent retries share one total deadline across all attempts", async () => {
  const originalFetch = globalThis.fetch;
  installStalledFetch();

  try {
    await assert.rejects(
      fetchIdempotentWithRetry("https://example.com", {}, {
        attempts: 3,
        baseDelayMilliseconds: 1,
        maxDelayMilliseconds: 1,
        perAttemptTimeoutMilliseconds: 1_000,
        totalTimeoutMilliseconds: 5,
      }),
      (error) => {
        assert.equal((error as Error).name, "TimeoutError");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("circuit breaker opens after complete logical requests keep failing", async () => {
  const originalFetch = globalThis.fetch;
  const circuitBreaker = new OutboundCircuitBreaker(2, 30_000);
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(null, { status: 503 });
  }) as typeof fetch;

  try {
    const options = {
      attempts: 1,
      circuitBreaker,
      totalTimeoutMilliseconds: 1_000,
    };
    assert.equal((await fetchIdempotentWithRetry("https://example.com", {}, options)).status, 503);
    assert.equal((await fetchIdempotentWithRetry("https://example.com", {}, options)).status, 503);
    await assert.rejects(
      fetchIdempotentWithRetry("https://example.com", {}, options),
      (error) => error instanceof OutboundCircuitOpenError
        && error.retryAfterSeconds === 30,
    );
    assert.equal(calls, 2);
    assert.equal(circuitBreaker.snapshot().state, "open");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("circuit breaker admits one recovery probe and closes after success", async () => {
  const originalFetch = globalThis.fetch;
  let nowMilliseconds = 0;
  const circuitBreaker = new OutboundCircuitBreaker(1, 1_000, () => nowMilliseconds);
  let status = 503;
  globalThis.fetch = (async () => new Response(null, { status })) as typeof fetch;

  try {
    const options = {
      attempts: 1,
      circuitBreaker,
      totalTimeoutMilliseconds: 1_000,
    };
    await fetchIdempotentWithRetry("https://example.com", {}, options);
    assert.equal(circuitBreaker.snapshot().state, "open");

    nowMilliseconds = 1_000;
    assert.equal(circuitBreaker.snapshot().state, "half_open");
    status = 200;
    assert.equal((await fetchIdempotentWithRetry("https://example.com", {}, options)).status, 200);
    assert.equal(circuitBreaker.snapshot().state, "closed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bounded response reads reject an excessive declared body", async () => {
  const response = new Response("oversized", {
    headers: { "Content-Length": "9" },
  });

  await assert.rejects(
    readResponseTextWithLimit(response, 8),
    (error) => error instanceof OutboundResponseTooLargeError
      && error.maximumBytes === 8,
  );
});

test("bounded response reads enforce streamed bytes without a content length", async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("1234"));
      controller.enqueue(new TextEncoder().encode("5678"));
      controller.close();
    },
  }));

  await assert.rejects(
    readResponseTextWithLimit(response, 7),
    (error) => error instanceof OutboundResponseTooLargeError,
  );
});

test("bounded JSON reads parse valid provider responses", async () => {
  const payload = await readJsonResponseWithLimit<{ ok: boolean }>(
    new Response('{"ok":true}'),
    32,
  );

  assert.deepEqual(payload, { ok: true });
});

test("bounded binary reads preserve bytes inside the budget", async () => {
  const bytes = await readResponseArrayBufferWithLimit(
    new Response(new Uint8Array([0, 1, 2, 255])),
    4,
  );

  assert.deepEqual(Array.from(new Uint8Array(bytes)), [0, 1, 2, 255]);
});
