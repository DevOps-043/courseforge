import assert from "node:assert/strict";
import test from "node:test";
import { waitForSlideGeneration } from "../slide-generation";

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
