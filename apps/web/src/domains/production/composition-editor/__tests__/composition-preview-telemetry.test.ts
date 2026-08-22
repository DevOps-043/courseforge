import assert from "node:assert/strict";
import test from "node:test";
import { CompositionPreviewTelemetryBuffer } from "../composition-preview-telemetry.client";
import {
  compositionPreviewMetricSchema,
  compositionPreviewTelemetryBatchSchema,
  summarizeCompositionPreviewMetricContexts,
  summarizeCompositionPreviewMetrics,
} from "../composition-preview-telemetry";
import {
  createPreviewCorrelationId,
  elapsedMilliseconds,
  formatServerTimingHeader,
} from "../composition-preview-performance";

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

test("accepts bounded edit diagnostics without URLs or free-form labels", () => {
  const metric = compositionPreviewMetricSchema.parse({
    atSeconds: 3,
    context: {
      operationCount: 2,
      operationNames: ["clip.layout", "clip.crop"],
      outcome: "SUCCESS",
      requestBytes: 640,
      source: "USER",
      updateStrategy: "LIVE_DOM",
    },
    durationMs: 325,
    name: "save_roundtrip_ms",
  });
  assert.deepEqual(metric.mediaIds, []);
  assert.equal(compositionPreviewMetricSchema.safeParse({
    ...metric,
    context: { operationNames: ["https://storage.test/private.mp4"] },
  }).success, false);
  assert.deepEqual(summarizeCompositionPreviewMetricContexts([metric]), {
    operationCount: 2,
    operationNames: ["clip.crop", "clip.layout"],
    outcomes: ["SUCCESS"],
    reloadReasons: [],
    requestBytes: 640,
    runtimeOutcomes: [],
    updateStrategies: ["LIVE_DOM"],
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

test("formats stable server timings and rejects unsafe correlation ids", () => {
  assert.equal(formatServerTimingHeader({
    assetsMs: 23.26,
    authorizationMs: 4.01,
    compileMs: 10.55,
    documentMs: 8.44,
    totalMs: 46.78,
  }), "authorization;dur=4.0, document;dur=8.4, assets;dur=23.3, compile;dur=10.6, total;dur=46.8");
  assert.equal(createPreviewCorrelationId("preview_session-123"), "preview_session-123");
  assert.match(createPreviewCorrelationId("token=secret&url=https://example.test"), /^[0-9a-f-]{36}$/);
  assert.equal(elapsedMilliseconds(25, 40), 15);
});
