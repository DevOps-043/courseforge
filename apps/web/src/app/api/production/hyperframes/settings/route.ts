import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  getHyperframesGenerationSettings,
  hyperframesGenerationSettingsSchema,
  saveHyperframesGenerationSettings,
} from "@/domains/production/hyperframes/hyperframes-generation-settings.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HYPERFRAMES_SETTINGS_REQUEST_BYTES = 16 * 1024;

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.settings", { correlationId: requestId });
  try {
    const authorization = await getSettingsAuthorization(requestId);
    if (authorization.response) return authorization.response;
    const settings = await getHyperframesGenerationSettings({
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return apiSuccessResponse({ data: settings }, { requestId });
  } catch (error) {
    logger.error("production.hyperframes.settings.read_failed", error);
    return respondSettingsError(error, requestId);
  }
}

export async function PUT(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.settings", { correlationId: requestId });
  try {
    const parsed = await parseJsonRequest(request, hyperframesGenerationSettingsSchema, MAX_HYPERFRAMES_SETTINGS_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Configuración de generación de video inválida.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const settings = parsed.data;
    const authorization = await getSettingsAuthorization(requestId);
    if (authorization.response) return authorization.response;
    const result = await saveHyperframesGenerationSettings({
      organizationId: authorization.organizationId,
      settings,
      supabase: authorization.admin,
      updatedBy: authorization.userId,
    });
    return apiSuccessResponse({ data: result }, { requestId });
  } catch (error) {
    logger.error("production.hyperframes.settings.save_failed", error);
    return respondSettingsError(error, requestId);
  }
}

async function getSettingsAuthorization(requestId: string) {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) } as const;
  if (!(await canReviewContent(authenticatedUser.userId))) {
    return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para configurar el estudio de video.", requestId, status: 403 }) } as const;
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

function respondSettingsError(error: unknown, requestId: string) {
  if (error instanceof z.ZodError) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Configuración de generación de video inválida.", requestId, status: 400 });
  }
  return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo actualizar la configuración de video.", requestId, retryable: true, status: 500 });
}
