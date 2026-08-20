import {
  COMPOSITION_PREVIEW_TELEMETRY_CONFIG,
  compositionPreviewMetricSchema,
  type CompositionPreviewMetric,
} from "./composition-preview-telemetry";

interface TelemetryBufferOptions {
  draftId: string;
  fetchImpl?: typeof fetch;
  sessionId?: string;
}

/** Batches bounded, non-sensitive preview metrics without blocking playback. */
export class CompositionPreviewTelemetryBuffer {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sessionId: string;
  private acceptedEvents = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private metrics: CompositionPreviewMetric[] = [];

  constructor(options: TelemetryBufferOptions) {
    this.endpoint = `/api/production/hyperframes/drafts/${encodeURIComponent(options.draftId)}/preview-metrics`;
    this.fetchImpl = options.fetchImpl || fetch;
    this.sessionId = options.sessionId || crypto.randomUUID();
  }

  record(candidate: unknown) {
    if (this.acceptedEvents >= COMPOSITION_PREVIEW_TELEMETRY_CONFIG.maxEventsPerSession) return false;
    const parsed = compositionPreviewMetricSchema.safeParse(candidate);
    if (!parsed.success) return false;
    this.acceptedEvents += 1;
    this.metrics.push(parsed.data);
    if (this.metrics.length >= COMPOSITION_PREVIEW_TELEMETRY_CONFIG.batchSize) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
    return true;
  }

  async flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.metrics.length === 0) return;
    const metrics = this.metrics.splice(0, COMPOSITION_PREVIEW_TELEMETRY_CONFIG.batchSize);
    try {
      await this.fetchImpl(this.endpoint, {
        body: JSON.stringify({ metrics, sessionId: this.sessionId }),
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        method: "POST",
      });
    } catch {
      // Telemetry is best-effort and must never interrupt editor playback.
    }
    if (this.metrics.length > 0) this.scheduleFlush();
  }

  dispose() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    return this.flush();
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => void this.flush(), COMPOSITION_PREVIEW_TELEMETRY_CONFIG.flushIntervalMs);
  }
}
