import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext, TenantContextLookupError } from "@/lib/server/tenant-context";
import { initializeHyperframesDraft, HyperframesDraftError } from "@/domains/production/hyperframes/hyperframes-draft.service";
import {
  summarizeCompositionTimelineBoundaryIssues,
  summarizeHyperframesValidationIssues,
  validateHyperframesCompositionId,
} from "@/domains/production/hyperframes/hyperframes-request-validation";
import { CompositionDocumentError } from "@/domains/production/composition-editor/composition-document.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext { params: Promise<{ compositionId: string }>; }

/** Allocates and hydrates the mutable editor project without generating a render revision. */
export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.composition.draft", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    const { compositionId } = await context.params;
    const validatedCompositionId = validateHyperframesCompositionId(compositionId);
    if (!validatedCompositionId.success) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, details: { reason: "COMPOSITION_ID_INVALID" }, message: "Identificador de composición inválido.", requestId, status: 400 });
    }
    return initializeDraftResponse({
      admin: authorization.admin,
      compositionId: validatedCompositionId.data,
      organizationId: authorization.organizationId,
      userId: authorization.userId,
      requestId,
    });
  } catch (error) {
    if (error instanceof TenantContextLookupError) {
      return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, details: { reason: error.code }, message: error.message, requestId, retryable: true, status: 503 });
    }
    logger.error("production.hyperframes.composition.draft_request_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo preparar el proyecto de edición.", requestId, retryable: true, status: 500 });
  }
}

async function initializeDraftResponse(params: {
  admin: ReturnType<typeof getServiceRoleClient>;
  compositionId: string;
  organizationId: string;
  userId: string;
  requestId: string;
}) {
  const logger = createOperationalLogger("production.hyperframes.composition.draft", { correlationId: params.requestId });
  try {
    const draft = await initializeHyperframesDraft({
      compositionId: params.compositionId,
      organizationId: params.organizationId,
      supabase: params.admin,
      userId: params.userId,
    });
    return apiSuccessResponse({ data: draft }, { requestId: params.requestId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn("production.hyperframes.composition.draft_data_invalid", {
        compositionId: params.compositionId,
        issues: summarizeHyperframesValidationIssues(error),
        timelineBoundaryIssues: summarizeCompositionTimelineBoundaryIssues(error),
      });
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, details: { reason: "COMPOSITION_DATA_INVALID" }, message: "Los datos de la composición no cumplen el formato requerido.", requestId: params.requestId, status: 422 });
    }
    if (error instanceof HyperframesDraftError) return apiErrorResponse({ code: mapStatusToErrorCode(error.status), message: error.message, requestId: params.requestId, status: error.status });
    if (error instanceof CompositionDocumentError) {
      return apiErrorResponse({ code: mapStatusToErrorCode(error.status), message: error.message, requestId: params.requestId, status: error.status });
    }
    if (isTransientStorageError(error)) return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, details: { reason: "COMPOSITION_STORAGE_UNAVAILABLE" }, message: "El almacenamiento del editor está ocupado. Intenta preparar el proyecto nuevamente.", requestId: params.requestId, retryable: true, status: 503 });
    logger.error("production.hyperframes.composition.draft_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo preparar el proyecto de edición.", requestId: params.requestId, retryable: true, status: 500 });
  }
}

function serializeError(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    return {
      code: typeof candidate.code === "string" ? candidate.code : null,
      details: typeof candidate.details === "string" ? candidate.details.slice(0, 500) : null,
      hint: typeof candidate.hint === "string" ? candidate.hint.slice(0, 300) : null,
      message: typeof candidate.message === "string" ? candidate.message.slice(0, 500) : "unknown",
    };
  }
  return { message: error instanceof Error ? error.message : "unknown" };
}

function isTransientStorageError(error: unknown) {
  const serialized = serializeError(error);
  return serialized.code === "PGRST003"
    || /timed out acquiring connection|connection pool|pool timeout|fetch failed/i.test(serialized.message);
}

async function authorize(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) } as const;
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }) } as const;
  if (!(await canReviewContent(user.userId, tenant))) return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para editar videos.", requestId, status: 403 }) } as const;
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId, response: null };
}

function mapStatusToErrorCode(status: number) {
  if (status === 403) return API_ERROR_CODE.roleForbidden;
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409) return API_ERROR_CODE.conflict;
  return API_ERROR_CODE.invalidRequest;
}
