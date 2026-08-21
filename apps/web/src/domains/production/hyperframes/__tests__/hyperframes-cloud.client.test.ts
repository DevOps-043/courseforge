import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HyperframesCloudClient } from "../hyperframes-cloud.client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("HyperFrames Cloud client", () => {
  it("uploads directly, finalizes and submits without a webhook", async () => {
    const requests: Array<{ body?: unknown; url: string }> = [];
    const client = new HyperframesCloudClient({
      apiKey: "test-key-123456",
      fetchImpl: async (input, init) => {
        const url = String(input);
        requests.push({ body: init?.body, url });
        if (url.endsWith("/direct-uploads")) {
          return jsonResponse({
            data: {
              asset_id: "asst_123",
              max_bytes: 200 * 1024 * 1024,
              upload_headers: { "x-amz-meta-test": "yes" },
              upload_url: "https://uploads.example.test/project.zip",
            },
          });
        }
        if (url.includes("uploads.example.test")) return new Response(null, { status: 200 });
        if (url.endsWith("/complete")) return jsonResponse({ data: { asset_id: "asst_123" } });
        if (url.endsWith("/v3/hyperframes/renders")) return jsonResponse({ data: { render_id: "hfr_123" } });
        throw new Error(`Unexpected request ${url}`);
      },
    });

    const upload = await client.uploadProjectArchive({
      bytes: new Uint8Array([1, 2, 3]),
      fileName: "courseforge-project.zip",
      idempotencyKey: "hf:project:1",
    });
    const render = await client.createRender({
      aspectRatio: "16:9",
      assetId: upload.assetId,
      idempotencyKey: "hf:render:1",
      variables: { title: "Lección 1" },
    });

    assert.equal(render.render_id, "hfr_123");
    assert.equal(requests.length, 4);
    assert.equal(String(requests.at(-1)?.body).includes("callback_url"), false);
    assert.match(String(requests.at(-1)?.body), /asset_id/);
  });

  it("fails before network use when the idempotency key is unsafe", async () => {
    const client = new HyperframesCloudClient({
      apiKey: "test-key-123456",
      fetchImpl: async () => {
        throw new Error("No debe ejecutarse");
      },
    });

    await assert.rejects(
      client.createRender({
        aspectRatio: "16:9",
        assetId: "asst_123",
        idempotencyKey: "llave con espacios",
      }),
      /idempotencia/,
    );
  });

  it("includes the durable callback correlation when configured", async () => {
    let submittedBody = "";
    const client = new HyperframesCloudClient({
      apiKey: "test-key-123456",
      fetchImpl: async (_input, init) => {
        submittedBody = String(init?.body || "");
        return jsonResponse({ data: { render_id: "hfr_callback" } }, 202);
      },
    });

    await client.createRender({
      aspectRatio: "16:9",
      assetId: "asst_123",
      callbackId: "request-correlation-1",
      callbackUrl: "https://project.supabase.co/functions/v1/heygen-hyperframes-webhook",
      idempotencyKey: "hf:render:callback",
    });

    assert.deepEqual(JSON.parse(submittedBody), {
      aspect_ratio: "16:9",
      callback_id: "request-correlation-1",
      callback_url: "https://project.supabase.co/functions/v1/heygen-hyperframes-webhook",
      format: "mp4",
      project: { asset_id: "asst_123", type: "asset_id" },
      quality: "high",
      resolution: "1080p",
    });
  });
});
