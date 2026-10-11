import { getAuthenticatedUser, getAuthorizedMaterialComponentAdmin } from "@/lib/server/artifact-action-auth";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { standaloneMediaInputSchema } from "@/domains/production/standalone/standalone-media.types";
import { registerStandaloneMedia, StandaloneMediaValidationError } from "@/domains/production/standalone/standalone-media.service";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("standalone.media", { correlationId: requestId });
  try {
    const parsed = await parseJsonRequest(request, standaloneMediaInputSchema, 4096);
    if (!parsed.success) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Solicitud de archivo inválida.", requestId, status: 400 });
    const user = await getAuthenticatedUser(await createClient());
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    const authorized = await getAuthorizedMaterialComponentAdmin(parsed.data.componentId);
    if (!authorized) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Proyecto no encontrado.", requestId, status: 404 });
    await registerStandaloneMedia({ input: parsed.data, supabase: authorized.admin, userId: user.userId });
    return apiSuccessResponse({ assetId: parsed.data.assetId }, { requestId });
  } catch (error) {
    if (error instanceof StandaloneMediaValidationError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: error.message, requestId, status: 422 });
    logger.error("standalone.media.registration_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo verificar el archivo. Reintenta o utiliza otro archivo.", requestId, status: 500 });
  }
}
