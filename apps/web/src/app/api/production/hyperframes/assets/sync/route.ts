import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  HyperframesSourceAssetError,
  syncHyperframesSourceAssetsFromProduction,
} from "@/domains/production/hyperframes/hyperframes-source-asset.service";
import { getHeygenClientForOrganization } from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { HeygenScenesService } from "@/domains/production/providers/heygen/heygen-scenes.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HYPERFRAMES_ASSET_SYNC_REQUEST_BYTES = 4 * 1024;

const inputSchema = z.object({ componentId: z.string().uuid() }).strict();

/** Synchronizes assets from the preceding Production step; it never moves or deletes files. */
export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.assets.sync", { correlationId: requestId });
  try {
    const parsed = await parseJsonRequest(request, inputSchema, MAX_HYPERFRAMES_ASSET_SYNC_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Component ID inválido.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const input = parsed.data;
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para preparar assets de video.", requestId, status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 });
    const admin = getServiceRoleClient();
    const heygenPendingClipCount = await refreshPendingHeygenClips({
      admin,
      componentId: input.componentId,
      organizationId: tenant.organizationId,
      userId: user.userId,
      requestId,
    });
    const synchronizedAssets = await syncHyperframesSourceAssetsFromProduction({
      componentId: input.componentId,
      createdBy: user.userId,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    return apiSuccessResponse({ data: { ...synchronizedAssets, heygenPendingClipCount } }, { requestId });
  } catch (error) {
    if (error instanceof HyperframesSourceAssetError) {
      return apiErrorResponse({ code: mapStatusToErrorCode(error.status), message: error.message, requestId, status: error.status });
    }
    logger.error("production.hyperframes.assets.sync_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudieron preparar los assets del paso de Producción.", requestId, retryable: true, status: 500 });
  }
}

async function refreshPendingHeygenClips(params: {
  admin: ReturnType<typeof getServiceRoleClient>;
  componentId: string;
  organizationId: string;
  userId: string;
  requestId: string;
}) {
  const logger = createOperationalLogger("production.hyperframes.assets.sync", { correlationId: params.requestId });
  const recoveryService = new HeygenScenesService(params.admin);
  await recoveryService.recoverCompletedSceneAssets({
    componentId: params.componentId,
    organizationId: params.organizationId,
  });

  try {
    const auth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: params.organizationId,
      supabase: params.admin,
    });
    const recovery = await new HeygenScenesService(params.admin, auth.client).recoverHistoricalSceneAssets({
      componentId: params.componentId,
      createdBy: params.userId,
      organizationId: params.organizationId,
    });
    logger.info("production.hyperframes.assets.heygen_reconciled", {
      componentId: params.componentId,
      matchedJobCount: recovery.report.matchedJobCount,
      pendingAvatarCount: recovery.report.pendingAvatarCount,
      pendingExpectedMediaCount: recovery.report.pendingExpectedMediaCount,
      recoveredAvatarCount: recovery.report.recoveredAvatarCount,
      unconfiguredSceneCount: recovery.report.unconfiguredSceneCount,
      unresolvedSceneCount: recovery.report.unresolvedSceneCount,
    });
    return recovery.report.pendingAvatarCount;
  } catch (refreshError) {
    // Asset sync remains usable for already imported media. A transient HeyGen
    // lookup must not prevent the editor from opening.
    logger.warn("production.hyperframes.assets.heygen_refresh_failed", {
      componentId: params.componentId,
      error: refreshError,
    });
  }

  const { data: component, error } = await params.admin
    .from("material_components")
    .select("assets")
    .eq("id", params.componentId)
    .maybeSingle();
  if (error) throw error;
  const assets = component?.assets && typeof component.assets === "object"
    ? component.assets as Record<string, unknown>
    : {};
  const avatarClips = Array.isArray(assets.avatar_clips)
    ? assets.avatar_clips
    : [];
  return avatarClips.filter((clip) => (
    clip && typeof clip === "object"
    && (clip as Record<string, unknown>).status === "WAITING_PROVIDER"
  )).length;
}

function mapStatusToErrorCode(status: number) {
  if (status === 403) return API_ERROR_CODE.roleForbidden;
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409) return API_ERROR_CODE.conflict;
  return API_ERROR_CODE.invalidRequest;
}
