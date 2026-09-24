import { z } from "zod";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { syncHyperframesSourceAssetsFromProduction } from "@/domains/production/hyperframes/hyperframes-source-asset.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext { params: Promise<{ componentId: string }>; }

/** Lists only downloadable records that belong to the authorized component. */
export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("materials.component.downloads", { correlationId: requestId });
  try {
    const { componentId } = await context.params;
    const parsedComponentId = z.string().uuid().parse(componentId);
    const session = await createClient();
    const user = await getAuthenticatedUser(session);
    if (!user) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 });
    }
    const authorized = await getAuthorizedMaterialComponentAdmin(parsedComponentId);
    if (!authorized) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Material no encontrado para esta empresa.", requestId, status: 404 });
    }
    const admin = getServiceRoleClient();
    // Older uploads are represented only inside component.assets. Materialize
    // their immutable registry records before listing so the same secure
    // download contract applies to manual and imported media alike.
    try {
      await syncHyperframesSourceAssetsFromProduction({
        componentId: parsedComponentId,
        createdBy: user.userId,
        organizationId: tenant.organizationId,
        supabase: admin,
      });
    } catch (syncError) {
      logger.warn("materials.component.downloads.registry_sync_failed", { componentId: parsedComponentId, error: syncError });
    }
    const { data, error } = await admin
      .from("production_assets")
      .select("id, asset_type, mime_type, file_size_bytes, provider, metadata, created_at")
      .eq("material_component_id", parsedComponentId)
      .not("storage_bucket", "is", null)
      .not("storage_path", "is", null)
      .neq("qa_status", "ARCHIVED")
      .order("created_at", { ascending: false });
    if (error) throw error;

    const assets = (data || []).map((asset) => {
      const metadata = isRecord(asset.metadata) ? asset.metadata : {};
      const fallbackName = `${String(asset.asset_type || "asset").toLowerCase()}-${asset.id}`;
      return {
        assetId: asset.id,
        assetType: asset.asset_type,
        createdAt: asset.created_at,
        fileName: typeof metadata.file_name === "string" ? metadata.file_name : fallbackName,
        fileSizeBytes: asset.file_size_bytes,
        mimeType: asset.mime_type || "application/octet-stream",
        provider: asset.provider || "internal",
      };
    });
    return apiSuccessResponse({
      data: {
        contentExportUrl: `/api/materials/components/${parsedComponentId}/export`,
        assets,
      },
    }, { requestId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de componente inválido.", requestId, status: 400 });
    }
    logger.error("materials.component.downloads.list_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudieron consultar los archivos descargables.", requestId, retryable: true, status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
