import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { getReadySoundEffectStorageIdentity, SoundEffectLibraryError } from "@/domains/production/sound-effects/sound-effect-library.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { recordAssetAccessAudit } from "@/domains/materials/downloads/asset-access-audit.service";

interface RouteContext { params: Promise<{ soundEffectId: string }>; }

/** Downloads a READY organization-owned sound effect without exposing its storage identity. */
export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.sound_effect.download", { correlationId: requestId });
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    const tenant = await resolveActiveTenantContext();
    if (!tenant || !(await canReviewContent(user.userId, tenant))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para descargar efectos de sonido.", requestId, status: 403 });
    }
    const { soundEffectId } = await context.params;
    const asset = await getReadySoundEffectStorageIdentity({
      organizationId: tenant.organizationId,
      soundEffectAssetId: z.string().uuid().parse(soundEffectId),
      supabase: getServiceRoleClient(),
    });
    const path = toBucketRelativePath(asset.storageBucket, asset.storagePath);
    const { data, error } = await getServiceRoleClient().storage
      .from(asset.storageBucket)
      .createSignedUrl(path, 5 * 60, { download: path.split("/").pop() || "sound-effect" });
    if (error || !data?.signedUrl) throw error || new Error("No se pudo firmar el efecto.");
    try {
      await recordAssetAccessAudit({ actorId: user.userId, eventType: "DOWNLOAD", metadata: { delivery: "signed_url" }, organizationId: tenant.organizationId, requestId, resourceId: soundEffectId, resourceType: "SOUND_EFFECT", supabase: getServiceRoleClient() });
    } catch (auditError) {
      logger.warn("production.sound_effect.download.audit_failed", { soundEffectId, error: auditError });
    }
    return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, no-store", "x-request-id": requestId }, status: 307 });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de efecto inválido.", requestId, status: 400 });
    if (error instanceof SoundEffectLibraryError) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: error.message, requestId, status: error.status });
    logger.error("production.sound_effect.download_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo preparar la descarga.", requestId, retryable: true, status: 500 });
  }
}

function toBucketRelativePath(bucket: string, storedPath: string) {
  const path = storedPath.startsWith(`${bucket}/`) ? storedPath.slice(bucket.length + 1) : storedPath;
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) throw new Error("Ruta de audio insegura.");
  return path;
}
