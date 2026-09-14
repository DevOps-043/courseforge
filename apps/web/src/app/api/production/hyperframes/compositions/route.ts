import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  getOrCreateHyperframesCompositionDraft,
  HyperframesCompositionError,
  listHyperframesCompositions,
} from "@/domains/production/hyperframes/hyperframes-composition.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HYPERFRAMES_COMPOSITION_REQUEST_BYTES = 8 * 1024;

const createCompositionSchema = z.object({
  componentId: z.string().uuid(),
  name: z.string().trim().min(1).max(160).optional(),
}).strict();

const componentIdSchema = z.string().uuid().optional();

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.compositions", { correlationId: requestId });
  try {
    const authorization = await getHyperframesAuthorization(requestId);
    if (authorization.response) return authorization.response;
    const componentId = componentIdSchema.parse(
      new URL(request.url).searchParams.get("componentId") || undefined,
    );
    const compositions = await listHyperframesCompositions({
      componentId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return apiSuccessResponse({ data: compositions }, { requestId });
  } catch (error) {
    logger.error("production.hyperframes.compositions.list_failed", error);
    return respondCompositionError(error, "No se pudieron listar composiciones de video.", requestId);
  }
}

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.compositions", { correlationId: requestId });
  try {
    const parsed = await parseJsonRequest(request, createCompositionSchema, MAX_HYPERFRAMES_COMPOSITION_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Payload inválido para la composición de video.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const input = parsed.data;
    const authorization = await getHyperframesAuthorization(requestId);
    if (authorization.response) return authorization.response;
    const result = await getOrCreateHyperframesCompositionDraft({
      componentId: input.componentId,
      createdBy: authorization.userId,
      name: input.name || "Composición de video",
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return apiSuccessResponse({ data: result.composition, created: result.created }, { requestId, status: result.created ? 201 : 200 });
  } catch (error) {
    logger.error("production.hyperframes.compositions.create_failed", error);
    return respondCompositionError(error, "No se pudo crear la composición de video.", requestId);
  }
}

async function getHyperframesAuthorization(requestId: string) {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) } as const;
  if (!(await canReviewContent(authenticatedUser.userId))) {
    return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para administrar composiciones de video.", requestId, status: 403 }) } as const;
  }
  const tenant = await resolveActiveTenantContext();
  if (!tenant) {
    return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }) } as const;
  }
  return {
    admin: getServiceRoleClient(),
    organizationId: tenant.organizationId,
    userId: authenticatedUser.userId,
    response: null,
  };
}

function respondCompositionError(error: unknown, fallback: string, requestId: string) {
  if (error instanceof z.ZodError) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Payload inválido para la composición de video.", requestId, status: 400 });
  }
  if (error instanceof HyperframesCompositionError) {
    return apiErrorResponse({ code: mapStatusToErrorCode(error.status), message: error.message, requestId, status: error.status });
  }
  return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: fallback, requestId, retryable: true, status: 500 });
}

function mapStatusToErrorCode(status: number) {
  if (status === 403) return API_ERROR_CODE.roleForbidden;
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409) return API_ERROR_CODE.conflict;
  return API_ERROR_CODE.invalidRequest;
}
