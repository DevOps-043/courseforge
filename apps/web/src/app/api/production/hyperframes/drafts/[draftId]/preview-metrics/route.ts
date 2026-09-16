import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  COMPOSITION_PREVIEW_TELEMETRY_CONFIG,
  COMPOSITION_PREVIEW_SLOW_THRESHOLD_MS,
  compositionPreviewTelemetryBatchSchema,
  summarizeCompositionPreviewMetricContexts,
  summarizeCompositionPreviewMetrics,
} from "@/domains/production/composition-editor/composition-preview-telemetry";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Accepts bounded playback diagnostics without URLs, media payloads or user content. */
export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.draft.preview_metrics", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const { data: draft, error: draftError } = await authorization.admin
      .from("video_composition_drafts")
      .select("id")
      .eq("id", draftId)
      .eq("organization_id", authorization.organizationId)
      .maybeSingle();
    if (draftError) throw draftError;
    if (!draft) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Composición no encontrada.", requestId, status: 404 });

    const parsed = await parseJsonRequest(request, compositionPreviewTelemetryBatchSchema, COMPOSITION_PREVIEW_TELEMETRY_CONFIG.maxRequestBytes);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "El lote de métricas excede el límite permitido." : "El lote de métricas no es válido.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const batch = parsed.data;
    const slowMetrics = batch.metrics.filter((metric) => (
      metric.durationMs >= COMPOSITION_PREVIEW_SLOW_THRESHOLD_MS[metric.name]
    ));
    const logContext = {
      draftId,
      event: "composition_preview_metrics",
      organizationId: authorization.organizationId,
      samplePositionsSeconds: batch.metrics.slice(0, 5).map((metric) => metric.atSeconds),
      sessionId: batch.sessionId,
      slowMetricCount: slowMetrics.length,
      slowMetricNames: [...new Set(slowMetrics.map((metric) => metric.name))],
      dimensions: summarizeCompositionPreviewMetricContexts(batch.metrics),
      summary: summarizeCompositionPreviewMetrics(batch.metrics),
    };
    if (slowMetrics.length > 0) logger.warn("production.hyperframes.draft.preview_metrics_slow", logContext);
    else logger.info("production.hyperframes.draft.preview_metrics_received", logContext);
    return new NextResponse(null, { status: 202, headers: { "Cache-Control": "private, no-store", "x-request-id": requestId } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "El lote de métricas no es válido.", requestId, status: 400 });
    }
    logger.error("production.hyperframes.draft.preview_metrics_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudieron registrar las métricas del preview.", requestId, retryable: true, status: 500 });
  }
}

async function authorize(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) } as const;
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }) } as const;
  if (!(await canReviewContent(user.userId, tenant))) {
    return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para registrar métricas del preview.", requestId, status: 403 }) } as const;
  }
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, response: null };
}
