import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeRenderDiagnostic, type HyperframesRenderDiagnostics, type RenderDiagnosticEvent } from "./hyperframes-render-diagnostics";

export class HyperframesRenderDiagnosticsService {
  constructor(private readonly supabase: SupabaseClient<any, "public", any>) {}

  async read(organizationId: string, requestId: string): Promise<HyperframesRenderDiagnostics | null> {
    const { data: request, error } = await this.supabase.from("hyperframes_render_requests")
      .select("id, production_job_id, provider_render_id, provider_status, import_status, provider_error, created_at, updated_at, archive_size_bytes, cancelled_at, diagnostic_events")
      .eq("id", requestId).eq("organization_id", organizationId).maybeSingle();
    if (error) throw error;
    if (!request) return null;
    const [{ data: job, error: jobError }, { data: imports, error: importError }] = await Promise.all([
      this.supabase.from("production_jobs")
        .select("id, status, progress, provider_error, completed_at, failed_at, updated_at")
        .eq("id", request.production_job_id).eq("organization_id", organizationId).maybeSingle(),
      this.supabase.rpc("get_hyperframes_import_diagnostics", { p_request_id: requestId, p_organization_id: organizationId }),
    ]);
    if (jobError) throw jobError;
    if (importError) throw importError;
    if (!job) throw new Error("No se encontró el trabajo de render.");
    const transfer = imports?.[0];
    const events: RenderDiagnosticEvent[] = [{ at: request.created_at, level: "info", stage: "created", message: "Solicitud registrada" }];
    for (const entry of Array.isArray(job.progress) ? job.progress : []) {
      if (!entry || typeof entry.at !== "string" || typeof entry.stage !== "string") continue;
      events.push({ at: entry.at, level: entry.stage.includes("fail") ? "error" : "info", stage: sanitizeRenderDiagnostic(entry.stage),
        message: sanitizeRenderDiagnostic(entry.stage) });
    }
    for (const entry of Array.isArray(request.diagnostic_events) ? request.diagnostic_events : []) {
      if (!entry || typeof entry.at !== "string") continue;
      events.push({ at: entry.at, level: entry.error ? "error" : "info", stage: sanitizeRenderDiagnostic(entry.stage),
        message: sanitizeRenderDiagnostic(entry.error?.message || entry.stage) });
    }
    const lastError = request.provider_error || job.provider_error;
    const errorMessage = sanitizeRenderDiagnostic(lastError?.message) || null;
    if (errorMessage) events.push({ at: request.updated_at, level: "error", stage: sanitizeRenderDiagnostic(lastError?.source), message: errorMessage });
    events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return {
      requestId, jobId: job.id, providerRenderId: request.provider_render_id,
      providerStatus: request.provider_status, importStatus: request.import_status, jobStatus: job.status,
      createdAt: request.created_at, updatedAt: request.updated_at,
      finishedAt: request.cancelled_at || job.completed_at || job.failed_at || null,
      cancelledAt: request.cancelled_at, archiveSizeBytes: request.archive_size_bytes,
      uploadedBytes: transfer?.uploaded_bytes || 0, sourceSizeBytes: transfer?.source_size_bytes || null,
      attempts: transfer?.attempt_count || 0, failures: transfer?.failure_count || 0,
      nextAttemptAt: transfer?.next_attempt_at || null,
      lastActivityAt: transfer?.updated_at || job.updated_at || request.updated_at,
      events: events.slice(-100), error: errorMessage,
    };
  }

  async cancel(organizationId: string, requestId: string): Promise<string | null> {
    const { data, error } = await this.supabase.rpc("cancel_hyperframes_render", {
      p_organization_id: organizationId, p_request_id: requestId,
    });
    if (error) throw error;
    return data;
  }
}
