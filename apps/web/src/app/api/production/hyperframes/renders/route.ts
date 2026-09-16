import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import {
  HyperframesRenderSubmissionError,
  HyperframesRenderSubmissionService,
} from "@/domains/production/hyperframes/hyperframes-render-submission.service";
import { HyperframesRenderRecoveryService } from "@/domains/production/hyperframes/hyperframes-render-recovery.service";
import {
  summarizeHyperframesValidationIssues,
  validateHyperframesCompositionId,
} from "@/domains/production/hyperframes/hyperframes-request-validation";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HYPERFRAMES_RENDER_REQUEST_BYTES = 16 * 1024;

const renderRequestSchema = z.object({
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  attemptId: z.string().uuid().optional(),
  format: z.enum(["mp4", "webm", "mov"]).optional(),
  fps: z.number().int().min(1).max(240).optional(),
  quality: z.enum(["draft", "standard", "high"]).optional(),
  resolution: z.enum(["1080p", "4k"]).optional(),
  revisionId: z.string().uuid(),
  title: z.string().trim().min(1).max(160).optional(),
}).strict();

/** Returns durable provider work so a reopened editor can resume reconciliation. */
export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.renders", { correlationId: requestId });
  try {
    const compositionId = validateHyperframesCompositionId(
      new URL(request.url).searchParams.get("compositionId"),
    );
    if (!compositionId.success) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, details: { reason: "COMPOSITION_ID_INVALID" }, message: "Identificador de composición inválido.", requestId, status: 400 });
    }
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }
    if (!(await canReviewContent(authenticatedUser.userId))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para consultar renders de HyperFrames.", requestId, status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 });
    }

    const service = new HyperframesRenderRecoveryService(getServiceRoleClient());
    const result = await service.findLatestForComposition({
      compositionId: compositionId.data,
      organizationId: tenant.organizationId,
    });
    return apiSuccessResponse({ data: result }, { headers: { "Cache-Control": "private, no-store" }, requestId });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      const issues = summarizeHyperframesValidationIssues(error);
      logger.warn("production.hyperframes.renders.recovery_data_invalid", { issues });
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, details: { reason: "RENDER_RECOVERY_DATA_INVALID" }, message: "Los datos del render pendiente no cumplen el formato requerido.", requestId, status: 422 });
    }
    logger.error("production.hyperframes.renders.recovery_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno al recuperar el render pendiente.", requestId, retryable: true, status: 500 });
  }
}

/** Submits an approved internal revision; it never accepts arbitrary HTML or ZIPs. */
export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.renders", { correlationId: requestId });
  try {
    const parsed = await parseJsonRequest(request, renderRequestSchema, MAX_HYPERFRAMES_RENDER_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Payload inválido para renderizar el video.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const input = parsed.data;
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }
    if (!(await canReviewContent(authenticatedUser.userId))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para enviar renders de HyperFrames.", requestId, status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 });
    }

    const admin = getServiceRoleClient();
    const service = new HyperframesRenderSubmissionService(admin);
    const result = await service.submit({
      ...input,
      createdBy: authenticatedUser.userId,
      deferProcessing: true,
      organizationId: tenant.organizationId,
    });
    if (!result.reused && !result.providerRenderId) {
      try {
        await callBackgroundFunctionJson(
          "hyperframes-render-background",
          { renderRequestId: result.renderRequestId },
          {
            fallbackError: "No se pudo iniciar el worker de render.",
            localHandlerLoader: () =>
              import("../../../../../../netlify/functions/hyperframes-render-background"),
          },
        );
      } catch (dispatchError) {
        await service.failDispatch({
          error: dispatchError,
          organizationId: tenant.organizationId,
          requestId: result.renderRequestId,
        });
        throw new HyperframesRenderSubmissionError(
          "No se pudo iniciar el worker de render. Intenta nuevamente.",
          503,
        );
      }
    }
    return apiSuccessResponse({ data: result }, { requestId, status: result.reused ? 200 : 202 });
  } catch (error: unknown) {
    if (error instanceof HyperframesRenderSubmissionError) {
      return apiErrorResponse({ code: mapStatusToErrorCode(error.status), message: error.message, requestId, retryable: error.status === 503, status: error.status });
    }
    logger.error("production.hyperframes.renders.submission_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno al enviar el render de video.", requestId, retryable: true, status: 500 });
  }
}

function mapStatusToErrorCode(status: number) {
  if (status === 400 || status === 422) return API_ERROR_CODE.invalidRequest;
  if (status === 403) return API_ERROR_CODE.roleForbidden;
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409) return API_ERROR_CODE.conflict;
  if (status === 503) return API_ERROR_CODE.dependencyUnavailable;
  return API_ERROR_CODE.internalError;
}
