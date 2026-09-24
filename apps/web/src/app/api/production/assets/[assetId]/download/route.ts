import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { recordAssetAccessAudit } from "@/domains/materials/downloads/asset-access-audit.service";

interface RouteContext { params: Promise<{ assetId: string }>; }
const DOWNLOAD_TTL_SECONDS = 5 * 60;

/** Delivers a private, tenant-authorized production file as a browser download. */
export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.asset.download", { correlationId: requestId });
  try {
    const { assetId } = await context.params;
    const parsedAssetId = z.string().uuid().parse(assetId);
    const session = await createClient();
    const user = await getAuthenticatedUser(session);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    const tenant = await resolveActiveTenantContext();
    if (!tenant || !(await canReviewContent(user.userId, tenant))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para descargar assets.", requestId, status: 403 });
    }
    const admin = getServiceRoleClient();
    const { data: asset, error } = await admin
      .from("production_assets")
      .select("id, storage_bucket, storage_path, metadata, qa_status")
      .eq("id", parsedAssetId)
      .eq("organization_id", tenant.organizationId)
      .neq("qa_status", "ARCHIVED")
      .maybeSingle();
    if (error) throw error;
    if (!asset?.storage_bucket || !asset.storage_path) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "El asset no está disponible para descarga.", requestId, status: 404 });
    }
    const storagePath = toBucketRelativePath(asset.storage_bucket, asset.storage_path);
    const fileName = resolveFileName(asset.metadata, storagePath);
    const { data: signed, error: signedError } = await admin.storage
      .from(asset.storage_bucket)
      .createSignedUrl(storagePath, DOWNLOAD_TTL_SECONDS, { download: fileName });
    if (signedError || !signed?.signedUrl) throw signedError || new Error("No se pudo firmar el asset.");
    try {
      await recordAssetAccessAudit({
        actorId: user.userId,
        eventType: "DOWNLOAD",
        metadata: { delivery: "signed_url" },
        organizationId: tenant.organizationId,
        requestId,
        resourceId: parsedAssetId,
        resourceType: "PRODUCTION_ASSET",
        supabase: admin,
      });
    } catch (auditError) {
      logger.warn("production.asset.download.audit_failed", { assetId: parsedAssetId, error: auditError });
    }
    logger.info("production.asset.download.authorized", { assetId: parsedAssetId, organizationId: tenant.organizationId, userId: user.userId });
    return NextResponse.redirect(signed.signedUrl, {
      headers: { "Cache-Control": "private, no-store", "x-request-id": requestId },
      status: 307,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de asset inválido.", requestId, status: 400 });
    logger.error("production.asset.download.failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo preparar la descarga.", requestId, retryable: true, status: 500 });
  }
}

function toBucketRelativePath(bucket: string, storedPath: string) {
  const prefix = `${bucket}/`;
  const path = storedPath.startsWith(prefix) ? storedPath.slice(prefix.length) : storedPath;
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) throw new Error("Ruta de asset insegura.");
  return path;
}

function resolveFileName(metadata: unknown, storagePath: string) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const name = (metadata as Record<string, unknown>).file_name;
    if (typeof name === "string" && name.trim() && !/[\\/\r\n]/.test(name)) return name.trim();
  }
  return storagePath.split("/").pop() || "courseforge-asset";
}
