import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  listHyperframesSourceAssets,
  syncHyperframesSourceAssetsFromProduction,
} from "@/domains/production/hyperframes/hyperframes-source-asset.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HYPERFRAMES_DETACH_AUDIO_REQUEST_BYTES = 8 * 1024;

const requestSchema = z.object({
  componentId: z.string().uuid(),
  durationSeconds: z.number().positive().max(86_400),
  fileName: z.string().trim().min(1).max(180),
  sourceAssetId: z.string().uuid(),
  sourceClipId: z.string().trim().min(1).max(128),
  storagePath: z.string().trim().min(1).max(500),
}).strict();

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Registers an editor-produced audio derivative and links it to the active draft. */
export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.draft.detach_audio", { correlationId: requestId });
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para separar audio.", requestId, status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 });
    const { draftId } = await context.params;
    const parsedDraftId = z.string().uuid().parse(draftId);
    const parsed = await parseJsonRequest(request, requestSchema, MAX_HYPERFRAMES_DETACH_AUDIO_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Solicitud inválida.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const payload = parsed.data;
    const expectedPrefix = `editor-audio/${payload.componentId}/`;
    if (!payload.storagePath.startsWith(expectedPrefix) || payload.storagePath.includes("..") || payload.storagePath.includes("\\")) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "La ruta del audio separado no es válida.", requestId, status: 400 });
    }

    const admin = getServiceRoleClient();
    const { data: draft, error: draftError } = await admin
      .from("video_composition_drafts")
      .select("composition_id")
      .eq("id", parsedDraftId)
      .eq("organization_id", tenant.organizationId)
      .maybeSingle();
    if (draftError) throw draftError;
    if (!draft?.composition_id) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Borrador de edición no encontrado.", requestId, status: 404 });
    const { data: composition, error: compositionError } = await admin
      .from("video_compositions")
      .select("material_component_id")
      .eq("id", draft.composition_id)
      .eq("organization_id", tenant.organizationId)
      .maybeSingle();
    if (compositionError) throw compositionError;
    if (composition?.material_component_id !== payload.componentId) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "El borrador no pertenece al componente indicado.", requestId, status: 403 });
    }
    const { data: sourceLink, error: sourceLinkError } = await admin
      .from("video_composition_draft_assets")
      .select("production_asset_id")
      .eq("draft_id", parsedDraftId)
      .eq("production_asset_id", payload.sourceAssetId)
      .eq("organization_id", tenant.organizationId)
      .maybeSingle();
    if (sourceLinkError) throw sourceLinkError;
    if (!sourceLink) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "El video fuente no pertenece al borrador.", requestId, status: 404 });
    const { data: sourceAsset, error: sourceAssetError } = await admin
      .from("production_assets")
      .select("mime_type")
      .eq("id", payload.sourceAssetId)
      .eq("organization_id", tenant.organizationId)
      .eq("material_component_id", payload.componentId)
      .maybeSingle();
    if (sourceAssetError) throw sourceAssetError;
    if (!sourceAsset?.mime_type?.startsWith("video/")) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "El asset fuente no es un video separable.", requestId, status: 400 });
    }

    const fullStoragePath = `production-assets/${payload.storagePath}`;
    const { data: component, error: componentError } = await admin
      .from("material_components")
      .select("assets")
      .eq("id", payload.componentId)
      .maybeSingle();
    if (componentError) throw componentError;
    if (!component) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado.", requestId, status: 404 });
    const assets = isRecord(component.assets) ? component.assets : {};
    const existing = Array.isArray(assets.detached_audio_clips) ? assets.detached_audio_clips : [];
    const nextReference = {
      content_type: "audio/wav",
      detached_from_asset_id: payload.sourceAssetId,
      detached_from_clip_id: payload.sourceClipId,
      duration: payload.durationSeconds,
      file_name: payload.fileName,
      has_audio: true,
      public_url: null,
      storage_path: fullStoragePath,
    };
    const deduplicated = existing.filter((entry) => !isRecord(entry) || (
      entry.storage_path !== fullStoragePath
      && (entry.detached_from_asset_id !== payload.sourceAssetId || entry.detached_from_clip_id !== payload.sourceClipId)
    ));
    const { error: patchError } = await admin.rpc("patch_material_component_assets", {
      p_assets_patch: { detached_audio_clips: [...deduplicated, nextReference], updated_at: new Date().toISOString() },
      p_component_id: payload.componentId,
    });
    if (patchError) throw patchError;

    await syncHyperframesSourceAssetsFromProduction({
      componentId: payload.componentId,
      createdBy: user.userId,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    const candidates = await listHyperframesSourceAssets({
      componentId: payload.componentId,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    const detachedAsset = candidates.find((asset) => asset.storagePath === fullStoragePath);
    if (!detachedAsset) throw new Error("No se pudo registrar el audio separado.");
    const { error: linkError } = await admin.from("video_composition_draft_assets").upsert({
      draft_id: parsedDraftId,
      organization_id: tenant.organizationId,
      production_asset_id: detachedAsset.productionAssetId,
      role: "VOICE",
      source_reference: "PRODUCTION_MEDIA",
    }, { onConflict: "draft_id,production_asset_id" });
    if (linkError) throw linkError;
    return apiSuccessResponse({ data: detachedAsset }, { requestId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: error.issues[0]?.message || "Solicitud inválida.", requestId, status: 400 });
    }
    logger.error("production.hyperframes.draft.detach_audio_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo registrar el audio separado.", requestId, retryable: true, status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
