import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { AudioWaveformReadError, readAudioWaveformPreview } from "@/domains/production/audio-processing/audio-waveform-read.service";

interface RouteContext { params: Promise<{ assetId: string }>; }

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.audio.waveform", { correlationId: requestId });
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "Sin permisos para consultar audio.", requestId, status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no autorizada.", requestId, status: 403 });
    const assetId = z.string().uuid().parse((await context.params).assetId);
    const componentId = z.string().uuid().parse(new URL(request.url).searchParams.get("componentId"));
    const waveform = await readAudioWaveformPreview({
      assetId,
      componentId,
      organizationId: tenant.organizationId,
      supabase: getServiceRoleClient(),
    });
    return apiSuccessResponse({ data: waveform }, {
      headers: { "Cache-Control": "private, max-age=60" },
      requestId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador inválido.", requestId, status: 400 });
    }
    if (error instanceof AudioWaveformReadError) {
      return apiErrorResponse({
        code: error.status === 404 ? API_ERROR_CODE.resourceNotFound : API_ERROR_CODE.invalidRequest,
        message: error.message,
        requestId,
        status: error.status,
      });
    }
    logger.error("production.audio.waveform.read_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo consultar la waveform.", requestId, retryable: true, status: 500 });
  }
}
