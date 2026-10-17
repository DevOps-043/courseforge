import { z } from "zod";

export const COMPOSITION_PREVIEW_TELEMETRY_CONFIG = {
  batchSize: 25,
  flushIntervalMs: 10_000,
  maxEventsPerSession: 100,
  maxRequestBytes: 32 * 1024,
} as const;

/** Fixed buckets can be summed across batches to estimate a sustained p95. */
export const COMPOSITION_PREVIEW_LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1_000, 3_000, 5_000, 10_000] as const;

export const compositionPreviewMetricNameSchema = z.enum([
  "buffering_duration_ms",
  "edit_to_visual_update_ms",
  "iframe_reload_ms",
  "media_warmup_ms",
  "play_start_latency_ms",
  "preview_initial_ready_ms",
  "preview_sync_event",
  "runtime_visual_patch_ms",
  "save_roundtrip_ms",
]);
export type CompositionPreviewMetricName = z.infer<typeof compositionPreviewMetricNameSchema>;

export const COMPOSITION_PREVIEW_SLOW_THRESHOLD_MS: Record<CompositionPreviewMetricName, number> = {
  buffering_duration_ms: 500,
  edit_to_visual_update_ms: 3_000,
  iframe_reload_ms: 3_000,
  media_warmup_ms: 5_000,
  play_start_latency_ms: 1_000,
  preview_initial_ready_ms: 3_000,
  preview_sync_event: Number.POSITIVE_INFINITY,
  runtime_visual_patch_ms: 50,
  save_roundtrip_ms: 800,
};

export const compositionPreviewMetricContextSchema = z.object({
  operationCount: z.number().int().min(1).max(100).optional(),
  operationNames: z.array(z.string().regex(/^[a-z0-9.-]+$/).max(80)).max(12).optional(),
  outcome: z.enum(["CONFLICT", "ERROR", "SUCCESS"]).optional(),
  reloadReason: z.enum(["EDIT_SAVED", "DIRTY_PLAYBACK", "MANUAL", "MEDIA_RECOVERY", "SAVE_RECOVERY"]).optional(),
  runtimeOutcome: z.enum(["APPLIED", "DISPOSED", "INVALID_PATCH", "RUNTIME_ERROR", "SEND_REJECTED", "TARGET_NOT_FOUND", "TIMEOUT", "VERSION_MISMATCH"]).optional(),
  requestBytes: z.number().int().min(0).max(COMPOSITION_PREVIEW_TELEMETRY_CONFIG.maxRequestBytes).optional(),
  source: z.enum(["AGENT", "USER"]).optional(),
  syncOutcome: z.enum(["ACCESS_DENIED", "AUTH_REQUIRED", "PREVIEW_IFRAME_ERROR", "PREVIEW_LOAD_FAILED", "PREVIEW_LOADED_NO_RUNTIME", "PREVIEW_READY_TIMEOUT", "RUNTIME_FAILED", "STALE_READY", "UNVERIFIED_READY", "VISUAL_PATCH_FAILED"]).optional(),
  updateStrategy: z.enum(["FULL_RELOAD", "LIVE_DOM", "LIVE_TIMELINE"]).optional(),
}).strict();

export const compositionPreviewMetricSchema = z.object({
  atSeconds: z.number().finite().min(0).max(86_400),
  context: compositionPreviewMetricContextSchema.optional(),
  durationMs: z.number().finite().min(0).max(600_000),
  mediaIds: z.array(z.string().trim().min(1).max(160)).max(6).default([]),
  name: compositionPreviewMetricNameSchema,
}).strict().superRefine((metric, validation) => {
  if (metric.name === "preview_sync_event" && (metric.durationMs !== 0 || !metric.context?.syncOutcome)) {
    validation.addIssue({ code: "custom", message: "A sync event requires a bounded outcome and zero duration." });
  }
  if (metric.name !== "preview_sync_event" && metric.context?.syncOutcome) {
    validation.addIssue({ code: "custom", message: "Sync outcomes are only valid for sync events." });
  }
});

export const compositionPreviewTelemetryBatchSchema = z.object({
  metrics: z.array(compositionPreviewMetricSchema).min(1).max(COMPOSITION_PREVIEW_TELEMETRY_CONFIG.batchSize),
  sessionId: z.string().uuid(),
}).strict();

export type CompositionPreviewMetric = z.infer<typeof compositionPreviewMetricSchema>;
export type CompositionPreviewTelemetryBatch = z.infer<typeof compositionPreviewTelemetryBatchSchema>;

export function summarizeCompositionPreviewMetrics(metrics: CompositionPreviewMetric[]) {
  const grouped = new Map<CompositionPreviewMetric["name"], number[]>();
  for (const metric of metrics) {
    if (metric.name === "preview_sync_event") continue;
    const durations = grouped.get(metric.name) || [];
    durations.push(metric.durationMs);
    grouped.set(metric.name, durations);
  }
  return Object.fromEntries([...grouped.entries()].map(([name, durations]) => {
    const histogram = Array<number>(COMPOSITION_PREVIEW_LATENCY_BUCKETS_MS.length + 1).fill(0);
    for (const duration of durations) {
      const bucketIndex = COMPOSITION_PREVIEW_LATENCY_BUCKETS_MS.findIndex((upperBound) => duration <= upperBound);
      histogram[bucketIndex < 0 ? histogram.length - 1 : bucketIndex] += 1;
    }
    return [name, {
      averageMs: Math.round(durations.reduce((total, value) => total + value, 0) / durations.length),
      count: durations.length,
      maximumMs: Math.round(Math.max(...durations)),
      p95Ms: Math.round([...durations].sort((left, right) => left - right)[Math.ceil(durations.length * 0.95) - 1]),
      slowCount: durations.filter((duration) => duration >= COMPOSITION_PREVIEW_SLOW_THRESHOLD_MS[name]).length,
      histogram,
    }];
  }));
}

/** Counts explicit sync outcomes independently of latency samples. */
export function summarizeCompositionPreviewSyncEvents(metrics: CompositionPreviewMetric[]) {
  const counts = { ACCESS_DENIED: 0, AUTH_REQUIRED: 0, PREVIEW_IFRAME_ERROR: 0, PREVIEW_LOAD_FAILED: 0, PREVIEW_LOADED_NO_RUNTIME: 0, PREVIEW_READY_TIMEOUT: 0, RUNTIME_FAILED: 0, STALE_READY: 0, UNVERIFIED_READY: 0, VISUAL_PATCH_FAILED: 0 };
  for (const metric of metrics) {
    if (metric.name === "preview_sync_event" && metric.context?.syncOutcome) {
      counts[metric.context.syncOutcome] += 1;
    }
  }
  return counts;
}

/** Produces aggregate diagnostic dimensions without retaining document or asset identifiers. */
export function summarizeCompositionPreviewMetricContexts(metrics: CompositionPreviewMetric[]) {
  const operationNames = new Set<string>();
  const outcomes = new Set<string>();
  const outcomeCounts = { CONFLICT: 0, ERROR: 0, SUCCESS: 0 };
  const reloadReasons = new Set<string>();
  const updateStrategies = new Set<string>();
  const runtimeOutcomes = new Set<string>();
  const runtimeOutcomeCounts = { APPLIED: 0, DISPOSED: 0, INVALID_PATCH: 0, RUNTIME_ERROR: 0, SEND_REJECTED: 0, TARGET_NOT_FOUND: 0, TIMEOUT: 0, VERSION_MISMATCH: 0 };
  let operationCount = 0;
  let requestBytes = 0;
  for (const metric of metrics) {
    const context = metric.context;
    if (!context) continue;
    context.operationNames?.forEach((name) => operationNames.add(name));
    if (context.outcome) {
      outcomes.add(context.outcome);
      outcomeCounts[context.outcome] += 1;
    }
    if (context.reloadReason) reloadReasons.add(context.reloadReason);
    if (context.updateStrategy) updateStrategies.add(context.updateStrategy);
    if (context.runtimeOutcome) {
      runtimeOutcomes.add(context.runtimeOutcome);
      runtimeOutcomeCounts[context.runtimeOutcome] += 1;
    }
    operationCount += context.operationCount || 0;
    requestBytes += context.requestBytes || 0;
  }
  return {
    operationCount,
    operationNames: [...operationNames].sort(),
    outcomeCounts,
    outcomes: [...outcomes].sort(),
    reloadReasons: [...reloadReasons].sort(),
    requestBytes,
    runtimeOutcomes: [...runtimeOutcomes].sort(),
    runtimeOutcomeCounts,
    updateStrategies: [...updateStrategies].sort(),
  };
}
