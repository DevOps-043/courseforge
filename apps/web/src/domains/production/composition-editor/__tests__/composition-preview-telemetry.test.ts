import assert from "node:assert/strict";
import test from "node:test";
import { CompositionPreviewTelemetryBuffer } from "../composition-preview-telemetry.client";
import {
  compositionPreviewMetricSchema,
  compositionPreviewTelemetryBatchSchema,
  summarizeCompositionPreviewMetricContexts,
  summarizeCompositionPreviewMetrics,
  summarizeCompositionPreviewSyncEvents,
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
    buffering_duration_ms: { averageMs: 600, count: 2, maximumMs: 720, p95Ms: 720, slowCount: 1, histogram: [0, 0, 0, 1, 1, 0, 0, 0, 0] },
  });
});

test("uses nearest-rank p95 and reports slow samples without media identifiers", () => {
  const metrics = Array.from({ length: 20 }, (_, index) => ({ ...validMetric, durationMs: (index + 1) * 100 }));
  assert.deepEqual(summarizeCompositionPreviewMetrics(metrics), {
    buffering_duration_ms: { averageMs: 1050, count: 20, maximumMs: 2000, p95Ms: 1900, slowCount: 16, histogram: [0, 1, 1, 3, 5, 10, 0, 0, 0] },
  });
});

test("counts bounded sync failures and stale ACKs separately from latency", () => {
  const staleReady = compositionPreviewMetricSchema.parse({
    atSeconds: 2,
    context: { syncOutcome: "STALE_READY" },
    durationMs: 0,
    name: "preview_sync_event",
  });
  const runtimeFailure = compositionPreviewMetricSchema.parse({
    atSeconds: 3,
    context: { syncOutcome: "RUNTIME_FAILED" },
    durationMs: 0,
    name: "preview_sync_event",
  });
  const readyTimeout = compositionPreviewMetricSchema.parse({
    atSeconds: 4,
    context: { syncOutcome: "PREVIEW_READY_TIMEOUT" },
    durationMs: 0,
    name: "preview_sync_event",
  });
  const loadFailure = compositionPreviewMetricSchema.parse({
    atSeconds: 5,
    context: { syncOutcome: "PREVIEW_LOAD_FAILED" },
    durationMs: 0,
    name: "preview_sync_event",
  });
  const authRequired = compositionPreviewMetricSchema.parse({
    atSeconds: 6,
    context: { syncOutcome: "AUTH_REQUIRED" },
    durationMs: 0,
    name: "preview_sync_event",
  });
  const accessDenied = compositionPreviewMetricSchema.parse({
    atSeconds: 7,
    context: { syncOutcome: "ACCESS_DENIED" },
    durationMs: 0,
    name: "preview_sync_event",
  });
  const iframeError = compositionPreviewMetricSchema.parse({
    atSeconds: 8,
    context: { syncOutcome: "PREVIEW_IFRAME_ERROR" },
    durationMs: 0,
    name: "preview_sync_event",
  });
  const loadedWithoutRuntime = compositionPreviewMetricSchema.parse({
    atSeconds: 9,
    context: { syncOutcome: "PREVIEW_LOADED_NO_RUNTIME" },
    durationMs: 0,
    name: "preview_sync_event",
  });
  assert.deepEqual(summarizeCompositionPreviewSyncEvents([staleReady, runtimeFailure, staleReady, readyTimeout, loadFailure, authRequired, accessDenied, iframeError, loadedWithoutRuntime]), {
    ACCESS_DENIED: 1,
    AUTH_REQUIRED: 1,
    PREVIEW_IFRAME_ERROR: 1,
    PREVIEW_LOAD_FAILED: 1,
    PREVIEW_LOADED_NO_RUNTIME: 1,
    PREVIEW_READY_TIMEOUT: 1,
    RUNTIME_FAILED: 1,
    STALE_READY: 2,
    UNVERIFIED_READY: 0,
    VISUAL_PATCH_FAILED: 0,
  });
  assert.deepEqual(summarizeCompositionPreviewMetrics([staleReady, validMetric]), {
    buffering_duration_ms: { averageMs: 480, count: 1, maximumMs: 480, p95Ms: 480, slowCount: 0, histogram: [0, 0, 0, 1, 0, 0, 0, 0, 0] },
  });
  assert.equal(compositionPreviewMetricSchema.safeParse({ ...staleReady, durationMs: 1 }).success, false);
  assert.equal(compositionPreviewMetricSchema.safeParse({ ...validMetric, context: { syncOutcome: "STALE_READY" } }).success, false);
  assert.equal(compositionPreviewMetricSchema.safeParse({ ...staleReady, context: { syncOutcome: "https://private.test" } }).success, false);
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
    outcomeCounts: { CONFLICT: 0, ERROR: 0, SUCCESS: 1 },
    outcomes: ["SUCCESS"],
    reloadReasons: [],
    requestBytes: 640,
    runtimeOutcomes: [],
    runtimeOutcomeCounts: { APPLIED: 0, DISPOSED: 0, INVALID_PATCH: 0, RUNTIME_ERROR: 0, SEND_REJECTED: 0, TARGET_NOT_FOUND: 0, TIMEOUT: 0, VERSION_MISMATCH: 0 },
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
