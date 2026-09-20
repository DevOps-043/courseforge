import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenRepository } from "@/domains/production/providers/heygen/heygen.repository";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HEYGEN_PRESET_REQUEST_BYTES = 8 * 1024;
const presetArchiveSchema = z.object({
  archived: z.boolean(),
  kind: z.enum(["avatar", "voice"]),
  presetId: z.string().uuid(),
}).strict();

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.presets", { correlationId: requestId });
  try {
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para leer presets de HeyGen.", requestId, status: 403 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada.", requestId, status: 403 });
    }

    const repository = new HeygenRepository(getServiceRoleClient());
    const [avatars, voices, archivedAvatars, archivedVoices, unavailable, sync] = await Promise.all([
      repository.listAvatarPresets(tenant.organizationId),
      repository.listVoicePresets(tenant.organizationId),
      repository.listArchivedAvatarPresets(tenant.organizationId),
      repository.listArchivedVoicePresets(tenant.organizationId),
      repository.listUnavailableCatalog(tenant.organizationId),
      repository.getWorkspaceSyncStatus(tenant.organizationId),
    ]);

    return apiSuccessResponse({
      data: {
        avatars,
        archivedAvatars,
        archivedVoices,
        sync,
        unavailable,
        voices,
      },
    }, { requestId });
  } catch (error: unknown) {
    logger.error("production.heygen.presets.read_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno del servidor al leer presets de HeyGen.", requestId, retryable: true, status: 500 });
  }
}

export async function PATCH(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.presets", { correlationId: requestId });
  try {
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    if (!(await canReviewContent(authenticatedUser.userId))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para administrar presets de HeyGen.", requestId, status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada.", requestId, status: 403 });

    const parsedRequest = await parseJsonRequest(request, presetArchiveSchema, MAX_HEYGEN_PRESET_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Solicitud de limpieza invalida.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const { archived, kind, presetId } = parsedRequest.data;

    const repository = new HeygenRepository(getServiceRoleClient());
    const result = await repository.setCatalogPresetArchived({
      actorUserId: authenticatedUser.userId,
      archived,
      kind,
      organizationId: tenant.organizationId,
      presetId,
    });
    if (result === "NOT_FOUND") return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Preset no encontrado.", requestId, status: 404 });
    if (result === "DEFAULT") {
      return apiErrorResponse({ code: API_ERROR_CODE.conflict, message: "Selecciona otro preset predeterminado antes de archivarlo.", requestId, status: 409 });
    }
    return apiSuccessResponse({ data: { archived, kind, presetId } }, { requestId });
  } catch (error: unknown) {
    logger.error("production.heygen.presets.update_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno del servidor al actualizar el catalogo.", requestId, retryable: true, status: 500 });
  }
}
