import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { COMPOSITION_PREVIEW_ASSET_URL_TTL_SECONDS } from "@/domains/production/composition-editor/composition-preview-assets.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext { params: Promise<{ assetId: string; draftId: string }>; }

/** Redirects an authorized preview request to a short-lived Storage URL. */
export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.draft.asset", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    const { assetId, draftId } = await context.params;
    const parsedDraftId = z.string().uuid().parse(draftId);
    const parsedAssetId = z.string().uuid().parse(assetId);
    const { data: link, error: linkError } = await authorization.admin
      .from("video_composition_draft_assets")
      .select("production_asset_id")
      .eq("draft_id", parsedDraftId)
      .eq("production_asset_id", parsedAssetId)
      .eq("organization_id", authorization.organizationId)
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Asset de edición no encontrado.", requestId, status: 404 });

    const { data: asset, error: assetError } = await authorization.admin
      .from("production_assets")
      .select("storage_bucket, storage_path")
      .eq("id", parsedAssetId)
      .eq("organization_id", authorization.organizationId)
      .maybeSingle();
    if (assetError) throw assetError;
    if (!asset?.storage_bucket || !asset.storage_path) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "El asset no tiene storage disponible.", requestId, status: 404 });
    }
    const storagePath = toBucketRelativePath(asset.storage_bucket, asset.storage_path);
    const { data: signed, error: signedError } = await authorization.admin.storage
      .from(asset.storage_bucket)
      .createSignedUrl(storagePath, COMPOSITION_PREVIEW_ASSET_URL_TTL_SECONDS);
    if (signedError) throw signedError;
    return NextResponse.redirect(signed.signedUrl, {
      headers: { "Cache-Control": "private, no-store", "x-request-id": requestId },
      status: 302,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de asset inválido.", requestId, status: 400 });
    logger.error("production.hyperframes.draft.asset_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo preparar el asset para el preview.", requestId, retryable: true, status: 500 });
  }
}

async function authorize(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) } as const;
  if (!(await canReviewContent(user.userId))) return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para editar videos.", requestId, status: 403 }) } as const;
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }) } as const;
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, response: null };
}

function toBucketRelativePath(bucket: string, storedPath: string) {
  const prefix = `${bucket}/`;
  const path = storedPath.startsWith(prefix) ? storedPath.slice(prefix.length) : storedPath;
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) throw new Error("Ruta de asset insegura.");
  return path;
}
