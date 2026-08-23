import { z } from "zod";

export const COMPOSITION_PREVIEW_TELEMETRY_CONFIG = {
  batchSize: 25,
  flushIntervalMs: 10_000,
  maxEventsPerSession: 100,
  maxRequestBytes: 32 * 1024,
} as const;

export const compositionPreviewMetricNameSchema = z.enum([
  "buffering_duration_ms",
  "edit_to_visual_update_ms",
  "iframe_reload_ms",
  "media_warmup_ms",
  "play_start_latency_ms",
  "preview_initial_ready_ms",
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
  runtime_visual_patch_ms: 50,
  save_roundtrip_ms: 800,
};

export const compositionPreviewMetricContextSchema = z.object({
  operationCount: z.number().int().min(1).max(100).optional(),
  operationNames: z.array(z.string().regex(/^[a-z0-9.-]+$/).max(80)).max(12).optional(),
  outcome: z.enum(["CONFLICT", "ERROR", "SUCCESS"]).optional(),
  reloadReason: z.enum(["DIRTY_PLAYBACK", "MANUAL", "MEDIA_RECOVERY", "SAVE_RECOVERY"]).optional(),
  runtimeOutcome: z.enum(["APPLIED", "DISPOSED", "INVALID_PATCH", "RUNTIME_ERROR", "SEND_REJECTED", "TARGET_NOT_FOUND", "TIMEOUT", "VERSION_MISMATCH"]).optional(),
  requestBytes: z.number().int().min(0).max(COMPOSITION_PREVIEW_TELEMETRY_CONFIG.maxRequestBytes).optional(),
  source: z.enum(["AGENT", "USER"]).optional(),
  updateStrategy: z.enum(["FULL_RELOAD", "LIVE_DOM", "LIVE_TIMELINE"]).optional(),
}).strict();

export const compositionPreviewMetricSchema = z.object({
  atSeconds: z.number().finite().min(0).max(86_400),
  context: compositionPreviewMetricContextSchema.optional(),
  durationMs: z.number().finite().min(0).max(600_000),
  mediaIds: z.array(z.string().trim().min(1).max(160)).max(6).default([]),
  name: compositionPreviewMetricNameSchema,
}).strict();

export const compositionPreviewTelemetryBatchSchema = z.object({
  metrics: z.array(compositionPreviewMetricSchema).min(1).max(COMPOSITION_PREVIEW_TELEMETRY_CONFIG.batchSize),
  sessionId: z.string().uuid(),
}).strict();

export type CompositionPreviewMetric = z.infer<typeof compositionPreviewMetricSchema>;
export type CompositionPreviewTelemetryBatch = z.infer<typeof compositionPreviewTelemetryBatchSchema>;

export function summarizeCompositionPreviewMetrics(metrics: CompositionPreviewMetric[]) {
  const grouped = new Map<CompositionPreviewMetric["name"], number[]>();
  for (const metric of metrics) {
    const durations = grouped.get(metric.name) || [];
    durations.push(metric.durationMs);
    grouped.set(metric.name, durations);
  }
  return Object.fromEntries([...grouped.entries()].map(([name, durations]) => [name, {
    averageMs: Math.round(durations.reduce((total, value) => total + value, 0) / durations.length),
    count: durations.length,
    maximumMs: Math.round(Math.max(...durations)),
  }]));
}

/** Produces aggregate diagnostic dimensions without retaining document or asset identifiers. */
export function summarizeCompositionPreviewMetricContexts(metrics: CompositionPreviewMetric[]) {
  const operationNames = new Set<string>();
  const outcomes = new Set<string>();
  const reloadReasons = new Set<string>();
  const updateStrategies = new Set<string>();
  const runtimeOutcomes = new Set<string>();
  let operationCount = 0;
  let requestBytes = 0;
  for (const metric of metrics) {
    const context = metric.context;
    if (!context) continue;
    context.operationNames?.forEach((name) => operationNames.add(name));
    if (context.outcome) outcomes.add(context.outcome);
    if (context.reloadReason) reloadReasons.add(context.reloadReason);
    if (context.updateStrategy) updateStrategies.add(context.updateStrategy);
    if (context.runtimeOutcome) runtimeOutcomes.add(context.runtimeOutcome);
    operationCount += context.operationCount || 0;
    requestBytes += context.requestBytes || 0;
  }
  return {
    operationCount,
    operationNames: [...operationNames].sort(),
    outcomes: [...outcomes].sort(),
    reloadReasons: [...reloadReasons].sort(),
    requestBytes,
    runtimeOutcomes: [...runtimeOutcomes].sort(),
    updateStrategies: [...updateStrategies].sort(),
  };
}
