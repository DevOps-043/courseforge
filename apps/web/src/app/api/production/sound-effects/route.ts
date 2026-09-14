import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  linkReadySoundEffectToDraft,
  linkSoundEffectToDraftSchema,
  listReadySoundEffects,
  SoundEffectLibraryError,
  soundEffectLibraryQuerySchema,
  uploadSoundEffectSchema,
  uploadVerifiedWavSoundEffect,
} from "@/domains/production/sound-effects/sound-effect-library.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest, type ApiErrorCode } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_SOUND_EFFECT_JSON_BYTES = 16 * 1024;
const MAX_SOUND_EFFECT_MULTIPART_BYTES = 27 * 1024 * 1024;
const MAX_SOUND_EFFECT_FILE_BYTES = 25 * 1024 * 1024;

async function authorize(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { error: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) };
  const tenant = await resolveActiveTenantContext();
  if (!tenant || !(await canReviewContent(user.userId, tenant))) {
    return { error: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para usar efectos de sonido.", requestId, status: 403 }) };
  }
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId };
}

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.sound_effects", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if ("error" in authorization) return authorization.error;
    const url = new URL(request.url);
    const filters = soundEffectLibraryQuerySchema.parse({
      category: url.searchParams.get("category") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      query: url.searchParams.get("query") || undefined,
    });
    const data = await listReadySoundEffects({ filters, organizationId: authorization.organizationId, supabase: authorization.admin });
    return apiSuccessResponse({ data }, { requestId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Filtros inválidos.", requestId, status: 400 });
    logger.error("production.sound_effects.list_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo consultar la biblioteca de efectos.", requestId, retryable: true, status: 500 });
  }
}

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.sound_effects", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if ("error" in authorization) return authorization.error;
    const contentType = request.headers.get("content-type") || "";
    if (contentType.startsWith("multipart/form-data")) {
      if (declaredRequestTooLarge(request, MAX_SOUND_EFFECT_MULTIPART_BYTES)) {
        return apiErrorResponse({ code: API_ERROR_CODE.payloadTooLarge, message: "La carga excede el tamaño permitido.", requestId, status: 413 });
      }
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Debes adjuntar un archivo WAV.", requestId, status: 400 });
      if (file.size > MAX_SOUND_EFFECT_FILE_BYTES) {
        return apiErrorResponse({ code: API_ERROR_CODE.payloadTooLarge, message: "El archivo WAV no puede exceder 25 MB.", requestId, status: 413 });
      }
      const input = uploadSoundEffectSchema.parse({
        category: form.get("category"),
        description: form.get("description") || "",
        licenseReference: form.get("licenseReference") || undefined,
        licenseType: form.get("licenseType") || undefined,
        name: form.get("name"),
        tags: String(form.get("tags") || "").split(",").filter(Boolean),
      });
      const data = await uploadVerifiedWavSoundEffect({
        bytes: new Uint8Array(await file.arrayBuffer()), input,
        organizationId: authorization.organizationId, supabase: authorization.admin,
        userId: authorization.userId,
      });
      return apiSuccessResponse({ data }, { requestId, status: 201 });
    }
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return apiErrorResponse({ code: API_ERROR_CODE.unsupportedMediaType, message: "Usa JSON para vincular o multipart/form-data para subir un WAV.", requestId, status: 415 });
    }
    const parsedRequest = await parseJsonRequest(request, linkSoundEffectToDraftSchema, MAX_SOUND_EFFECT_JSON_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Solicitud inválida.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const input = parsedRequest.data;
    const data = await linkReadySoundEffectToDraft({ ...input, organizationId: authorization.organizationId, supabase: authorization.admin });
    return apiSuccessResponse({ data }, { requestId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Solicitud inválida.", requestId, status: 400 });
    if (error instanceof SoundEffectLibraryError) {
      return apiErrorResponse({ code: mapLibraryStatus(error.status), message: error.message, requestId, status: error.status });
    }
    logger.error("production.sound_effects.mutation_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo procesar el efecto de sonido.", requestId, retryable: true, status: 500 });
  }
}

function declaredRequestTooLarge(request: Request, maxBytes: number) {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return false;
  const bytes = Number(contentLength);
  return Number.isFinite(bytes) && bytes > maxBytes;
}

function mapLibraryStatus(status: number): ApiErrorCode {
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409) return API_ERROR_CODE.conflict;
  if (status >= 500) return API_ERROR_CODE.internalError;
  return API_ERROR_CODE.invalidRequest;
}
