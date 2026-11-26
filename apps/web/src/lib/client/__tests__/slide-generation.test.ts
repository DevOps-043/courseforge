import assert from "node:assert/strict";
import test from "node:test";
import { readSlideGenerationState, waitForSlideGeneration } from "../slide-generation";

test("polls the explicitly created slide-generation job and reports its status", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  const statuses: string[] = [];

  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({
      success: true,
      data: { assets: { slides: { html_content_path: "production-assets/slides/deck.html" } }, status: "SUCCEEDED" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const completed = await waitForSlideGeneration({
      componentId: "11111111-1111-4111-8111-111111111111",
      jobId: "22222222-2222-4222-8222-222222222222",
      onStatus: (status) => statuses.push(status),
    });

    assert.equal(completed.status, "SUCCEEDED");
    assert.deepEqual(statuses, ["SUCCEEDED"]);
    assert.match(requestedUrls[0], /jobId=22222222-2222-4222-8222-222222222222/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recupera el trabajo existente sin invocar generación", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  let reads = 0;
  globalThis.fetch = async input => {
    urls.push(String(input));
    return Response.json({ success: true, data: { assets: {}, job: { id: "existing" }, status: reads++ ? "SUCCEEDED" : "RUNNING" } });
  };
  try {
    const latest = await readSlideGenerationState({ componentId: "component" });
    const done = await waitForSlideGeneration({ componentId: "component", jobId: latest.job!.id, intervalMs: 0 });
    assert.equal(done.status, "SUCCEEDED");
    assert.ok(urls.every(url => url.includes("/slides/jobs?") && !url.includes("/generate")));
    assert.match(urls[1], /jobId=existing/);
  } finally { globalThis.fetch = original; }
});

for (const status of ["NOT_FOUND", "FAILED", "CANCELLED"]) {
  test(`no deja un trabajo ${status} esperando indefinidamente`, async () => {
    const original = globalThis.fetch;
    let reads = 0;
    globalThis.fetch = async () => { reads++; return Response.json({ success: true, data: { assets: {}, job: null, status } }); };
    try {
      await assert.rejects(waitForSlideGeneration({ componentId: "component", maxAttempts: 2, intervalMs: 0 }));
      assert.equal(reads, 1);
    } finally { globalThis.fetch = original; }
  });
}
test("consulta acotada conserva estado pendiente y admite cancelación", async () => {
  const original = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async () => { reads++; return Response.json({ success: true, data: { assets: {}, job: { id: "same" }, status: "QUEUED" } }); };
  try {
    await assert.rejects(waitForSlideGeneration({ componentId: "component", maxAttempts: 2, intervalMs: 0 }), /SLIDES_STILL_PENDING/);
    assert.equal(reads, 2);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(waitForSlideGeneration({ componentId: "component", signal: controller.signal }));
    assert.equal(reads, 2);
  } finally { globalThis.fetch = original; }
});
test("cancelar durante la espera detiene el sondeo sin crear otra petición", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let reads = 0;
  globalThis.fetch = async () => {
    reads++;
    setTimeout(() => controller.abort(), 0);
    return Response.json({ success: true, data: { assets: {}, job: { id: "same" }, status: "RUNNING" } });
  };
  try {
    await assert.rejects(waitForSlideGeneration({ componentId: "component", signal: controller.signal }));
    assert.equal(reads, 1);
  } finally { globalThis.fetch = original; }
});
