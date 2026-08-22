import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
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

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Accepts bounded playback diagnostics without URLs, media payloads or user content. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > COMPOSITION_PREVIEW_TELEMETRY_CONFIG.maxRequestBytes) {
      return NextResponse.json({ error: "El lote de métricas excede el límite permitido." }, { status: 413 });
    }
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const { data: draft, error: draftError } = await authorization.admin
      .from("video_composition_drafts")
      .select("id")
      .eq("id", draftId)
      .eq("organization_id", authorization.organizationId)
      .maybeSingle();
    if (draftError) throw draftError;
    if (!draft) return NextResponse.json({ error: "Composición no encontrada." }, { status: 404 });

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > COMPOSITION_PREVIEW_TELEMETRY_CONFIG.maxRequestBytes) {
      return NextResponse.json({ error: "El lote de métricas excede el límite permitido." }, { status: 413 });
    }
    const batch = compositionPreviewTelemetryBatchSchema.parse(JSON.parse(rawBody));
    const slowMetrics = batch.metrics.filter((metric) => (
      metric.durationMs >= COMPOSITION_PREVIEW_SLOW_THRESHOLD_MS[metric.name]
    ));
    const logBatch = slowMetrics.length > 0 ? console.warn : console.info;
    logBatch("[CompositionPreviewTelemetry] Batch received", {
      draftId,
      event: "composition_preview_metrics",
      organizationId: authorization.organizationId,
      samplePositionsSeconds: batch.metrics.slice(0, 5).map((metric) => metric.atSeconds),
      sessionId: batch.sessionId,
      slowMetricCount: slowMetrics.length,
      slowMetricNames: [...new Set(slowMetrics.map((metric) => metric.name))],
      dimensions: summarizeCompositionPreviewMetricContexts(batch.metrics),
      summary: summarizeCompositionPreviewMetrics(batch.metrics),
    });
    return new NextResponse(null, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "El lote de métricas no es válido." }, { status: 400 });
    }
    console.error("[CompositionPreviewTelemetry] Unexpected error", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudieron registrar las métricas del preview." }, { status: 500 });
  }
}

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
  if (!(await canReviewContent(user.userId, tenant))) {
    return NextResponse.json({ error: "No tienes permisos para registrar métricas del preview." }, { status: 403 });
  }
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId };
}
