import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  getReadySoundEffectStorageIdentity,
  SoundEffectLibraryError,
  SOUND_EFFECT_PREVIEW_URL_TTL_SECONDS,
} from "@/domains/production/sound-effects/sound-effect-library.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext { params: Promise<{ soundEffectId: string }>; }

/** Redirects a tenant-authorized request to a short-lived private Storage URL. */
export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.sound_effects.preview", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if (authorization instanceof NextResponse) return authorization;
    const { soundEffectId } = await context.params;
    const asset = await getReadySoundEffectStorageIdentity({
      organizationId: authorization.organizationId,
      soundEffectAssetId: z.string().uuid().parse(soundEffectId),
      supabase: authorization.admin,
    });
    const relativePath = toBucketRelativePath(asset.storageBucket, asset.storagePath);
    const { data, error } = await authorization.admin.storage
      .from(asset.storageBucket)
      .createSignedUrl(relativePath, SOUND_EFFECT_PREVIEW_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) throw error || new Error("No se pudo firmar el audio.");
    return NextResponse.redirect(data.signedUrl, {
      headers: { "Cache-Control": "private, no-store", "x-request-id": requestId },
      status: 302,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de efecto inválido.", requestId, status: 400 });
    if (error instanceof SoundEffectLibraryError) {
      return apiErrorResponse({ code: error.status === 404 ? API_ERROR_CODE.resourceNotFound : API_ERROR_CODE.invalidRequest, message: error.message, requestId, status: error.status });
    }
    logger.error("production.sound_effects.preview_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo preparar el audio para la preescucha.", requestId, retryable: true, status: 500 });
  }
}

async function authorize(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant || !(await canReviewContent(user.userId, tenant))) {
    return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para escuchar efectos de sonido.", requestId, status: 403 });
  }
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId };
}

function toBucketRelativePath(bucket: string, storedPath: string) {
  const prefix = `${bucket}/`;
  const path = storedPath.startsWith(prefix) ? storedPath.slice(prefix.length) : storedPath;
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) throw new Error("Ruta de audio insegura.");
  return path;
}
