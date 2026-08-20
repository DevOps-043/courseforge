import assert from "node:assert/strict";
import test from "node:test";
import { CompositionPreviewTelemetryBuffer } from "../composition-preview-telemetry.client";
import {
  compositionPreviewMetricSchema,
  compositionPreviewTelemetryBatchSchema,
  summarizeCompositionPreviewMetrics,
} from "../composition-preview-telemetry";

const validMetric = {
  atSeconds: 12.5,
  durationMs: 480,
  mediaIds: ["avatar-video-1"],
  name: "buffering_duration_ms" as const,
};

test("accepts bounded diagnostics and rejects URL-shaped extra fields", () => {
  assert.equal(compositionPreviewMetricSchema.safeParse(validMetric).success, true);
  assert.equal(compositionPreviewMetricSchema.safeParse({
    ...validMetric,
    sourceUrl: "https://storage.test/video.mp4?token=secret",
  }).success, false);
  assert.equal(compositionPreviewTelemetryBatchSchema.safeParse({
    metrics: [validMetric],
    sessionId: "00000000-0000-4000-8000-000000000099",
  }).success, true);
});

test("summarizes latency without retaining individual media identifiers", () => {
  assert.deepEqual(summarizeCompositionPreviewMetrics([
    validMetric,
    { ...validMetric, durationMs: 720 },
  ]), {
    buffering_duration_ms: { averageMs: 600, count: 2, maximumMs: 720 },
  });
});

test("batches preview telemetry through the authenticated draft endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const telemetry = new CompositionPreviewTelemetryBuffer({
    draftId: "00000000-0000-4000-8000-000000000041",
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ body: String(init?.body), url: String(url) });
      return new Response(null, { status: 202 });
    }) as typeof fetch,
    sessionId: "00000000-0000-4000-8000-000000000099",
  });
  assert.equal(telemetry.record(validMetric), true);
  assert.equal(telemetry.record({ ...validMetric, durationMs: -1 }), false);
  await telemetry.flush();

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "/api/production/hyperframes/drafts/00000000-0000-4000-8000-000000000041/preview-metrics");
  assert.deepEqual(JSON.parse(requests[0]!.body), {
    metrics: [validMetric],
    sessionId: "00000000-0000-4000-8000-000000000099",
  });
});
