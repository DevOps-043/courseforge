import { z } from "zod";

export const COMPOSITION_PREVIEW_TELEMETRY_CONFIG = {
  batchSize: 25,
  flushIntervalMs: 10_000,
  maxEventsPerSession: 100,
  maxRequestBytes: 32 * 1024,
} as const;

export const compositionPreviewMetricNameSchema = z.enum([
  "buffering_duration_ms",
  "media_warmup_ms",
  "play_start_latency_ms",
  "preview_initial_ready_ms",
]);
export type CompositionPreviewMetricName = z.infer<typeof compositionPreviewMetricNameSchema>;

export const COMPOSITION_PREVIEW_SLOW_THRESHOLD_MS: Record<CompositionPreviewMetricName, number> = {
  buffering_duration_ms: 500,
  media_warmup_ms: 5_000,
  play_start_latency_ms: 1_000,
  preview_initial_ready_ms: 3_000,
};

export const compositionPreviewMetricSchema = z.object({
  atSeconds: z.number().finite().min(0).max(86_400),
  durationMs: z.number().finite().min(0).max(120_000),
  mediaIds: z.array(z.string().trim().min(1).max(160)).max(6),
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
