import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { extractHyperframesAnimatedDeck, syncHyperframesSourceAssetsFromProduction } from "@/domains/production/hyperframes/hyperframes-source-asset.service";
import { buildSceneVisualCatalog, validateSceneVisualPlans } from "@/domains/production/composition-editor/composition-narrative-source.service";
import { initializeHyperframesDraft } from "@/domains/production/hyperframes/hyperframes-draft.service";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import {
  HeygenScenesService,
  HeygenScenesServiceError,
} from "@/domains/production/providers/heygen/heygen-scenes.service";
import {
  heygenScenesPatchRequestSchema,
  heygenScenesResetRequestSchema,
} from "@/domains/production/providers/heygen/heygen.validators";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { heygenCredentialErrorResponse, heygenProviderErrorResponse, heygenServiceErrorResponse } from "@/lib/server/heygen-route-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const componentIdSchema = z.string().uuid();
const componentRequestSchema = z.object({ componentId: componentIdSchema }).strict();
const MAX_HEYGEN_SCENE_RECOVERY_REQUEST_BYTES = 8 * 1024;
const MAX_HEYGEN_SCENES_REQUEST_BYTES = 1024 * 1024;
const MAX_HEYGEN_SCENE_RESET_REQUEST_BYTES = 32 * 1024;

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.scenes", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(request, componentRequestSchema, MAX_HEYGEN_SCENE_RECOVERY_REQUEST_BYTES);
    if (!parsedRequest.success) return invalidBodyResponse(parsedRequest.reason, "recuperar assets históricos de HeyGen", requestId);
    const { componentId } = parsedRequest.data;
    const auth = await authorizeComponent(componentId, "recuperar assets históricos de HeyGen", requestId);
    if (auth.response) return auth.response;

    const heygenAuth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: auth.tenant.organizationId,
      supabase: auth.authorizedComponent.admin,
    });
    const service = new HeygenScenesService(
      auth.authorizedComponent.admin,
      heygenAuth.client,
    );
    const recovered = await service.recoverHistoricalSceneAssets({
      componentId,
      createdBy: auth.authenticatedUser.userId,
      organizationId: auth.tenant.organizationId,
    });

    let editorSync: Record<string, unknown> | null = null;
    let editorSyncWarning: string | null = null;
    try {
      editorSync = await syncHyperframesSourceAssetsFromProduction({
        componentId,
        createdBy: auth.authenticatedUser.userId,
        organizationId: auth.tenant.organizationId,
        supabase: auth.authorizedComponent.admin,
      });
      const { data: composition, error: compositionError } = await auth.authorizedComponent.admin
        .from("video_compositions")
        .select("id")
        .eq("material_component_id", componentId)
        .eq("organization_id", auth.tenant.organizationId)
        .neq("status", "ARCHIVED")
        .maybeSingle();
      if (compositionError) throw compositionError;
      if (composition?.id) {
        const draft = await initializeHyperframesDraft({
          compositionId: composition.id,
          organizationId: auth.tenant.organizationId,
          supabase: auth.authorizedComponent.admin,
          userId: auth.authenticatedUser.userId,
        });
        editorSync = { ...editorSync, draft };
      }
    } catch (syncError) {
      editorSyncWarning = "Los clips se recuperaron, pero el editor no pudo sincronizarse automáticamente.";
      logger.warn("production.heygen.scenes.editor_sync_failed", { componentId, error: syncError });
    }

    return apiSuccessResponse({
      data: { ...recovered, editorSync, editorSyncWarning },
    }, { requestId });
  } catch (error: unknown) {
    return handleScenesError(error, "recuperar assets históricos de HeyGen", requestId, logger);
  }
}

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.scenes", { correlationId: requestId });
  try {
    const componentId = componentIdSchema.parse(
      new URL(request.url).searchParams.get("componentId"),
    );
    const auth = await authorizeComponent(componentId, "consultar escenas HeyGen", requestId);
    if (auth.response) return auth.response;

    const service = new HeygenScenesService(auth.authorizedComponent.admin);
    const recoveredAssets = await service.recoverCompletedSceneAssets({
      componentId,
      organizationId: auth.tenant.organizationId,
    });
    const existingClips = recoveredAssets.avatar_clips || [];
    const clips = service.buildSceneClips({
      componentContent: auth.authorizedComponent.component.content,
      existingClips,
    });

    return apiSuccessResponse({
      data: {
        avatarGenerationMode:
          recoveredAssets.avatar_generation_mode || "scene_clips",
        clips,
        componentId,
        voiceAudio: recoveredAssets.voice_audio || null,
        voiceClips: recoveredAssets.voice_clips || [],
        visualCatalog: buildSceneVisualCatalog(extractHyperframesAnimatedDeck(recoveredAssets)),
      },
    }, { requestId });
  } catch (error: unknown) {
    return handleScenesError(error, "consultar escenas HeyGen", requestId, logger);
  }
}

export async function PATCH(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.scenes", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(request, heygenScenesPatchRequestSchema, MAX_HEYGEN_SCENES_REQUEST_BYTES);
    if (!parsedRequest.success) return invalidBodyResponse(parsedRequest.reason, "guardar escenas HeyGen", requestId);
    const payload = parsedRequest.data;
    const auth = await authorizeComponent(payload.componentId, "guardar escenas HeyGen", requestId);
    if (auth.response) return auth.response;

    const service = new HeygenScenesService(auth.authorizedComponent.admin);
    const materialAssets = await service.saveSceneClips({
      avatarGenerationMode: payload.avatarGenerationMode,
      clips: validateSceneVisualPlans(payload.clips, buildSceneVisualCatalog(extractHyperframesAnimatedDeck(auth.authorizedComponent.component.assets))),
      componentId: payload.componentId,
    });

    return apiSuccessResponse({
      data: {
        avatarGenerationMode: materialAssets.avatar_generation_mode,
        clips: materialAssets.avatar_clips || [],
        voiceClips: materialAssets.voice_clips || [],
      },
    }, { requestId });
  } catch (error: unknown) {
    return handleScenesError(error, "guardar escenas HeyGen", requestId, logger);
  }
}

export async function DELETE(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.scenes", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(request, heygenScenesResetRequestSchema, MAX_HEYGEN_SCENE_RESET_REQUEST_BYTES);
    if (!parsedRequest.success) return invalidBodyResponse(parsedRequest.reason, "limpiar assets de escenas HeyGen", requestId);
    const payload = parsedRequest.data;
    const auth = await authorizeComponent(payload.componentId, "limpiar assets de escenas HeyGen", requestId);
    if (auth.response) return auth.response;

    const service = new HeygenScenesService(auth.authorizedComponent.admin);
    const data = await service.resetSceneAssets({
      clipIds: payload.clipIds,
      componentId: payload.componentId,
      organizationId: auth.tenant.organizationId,
    });

    return apiSuccessResponse({ data }, { requestId });
  } catch (error: unknown) {
    return handleScenesError(error, "limpiar assets de escenas HeyGen", requestId, logger);
  }
}

async function authorizeComponent(componentId: string, action: string, requestId: string) {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) {
    return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) };
  }

  const canReview = await canReviewContent(authenticatedUser.userId);
  if (!canReview) {
    return {
      response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: `No tienes permisos para ${action}.`, requestId, status: 403 }),
    };
  }

  const tenant = await resolveActiveTenantContext();
  if (!tenant) {
    return {
      response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada.", requestId, status: 403 }),
    };
  }

  const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
  if (!authorizedComponent) {
    return {
      response: apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado para esta empresa.", requestId, status: 404 }),
    };
  }

  return { authenticatedUser, authorizedComponent, tenant };
}

function handleScenesError(
  error: unknown,
  action: string,
  requestId: string,
  logger: ReturnType<typeof createOperationalLogger>,
) {
  if (error instanceof z.ZodError) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: `Payload invalido para ${action}.`, requestId, status: 400 });
  }

  if (error instanceof HeygenScenesServiceError) {
    return heygenServiceErrorResponse(error, requestId);
  }
  if (error instanceof HeygenCredentialResolverError) return heygenCredentialErrorResponse(error, requestId);
  if (error instanceof HeygenApiError) {
    return heygenProviderErrorResponse({ error, failureMessage: `HeyGen no pudo ${action}.`, requestId });
  }
  logger.error("production.heygen.scenes.request_failed", error, { action });
  return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: `Error interno del servidor al ${action}.`, requestId, retryable: true, status: 500 });
}

function invalidBodyResponse(reason: "invalid" | "too_large", action: string, requestId: string) {
  return apiErrorResponse({
    code: reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
    message: reason === "too_large" ? "La solicitud excede el tamaño permitido." : `Payload invalido para ${action}.`,
    requestId,
    status: reason === "too_large" ? 413 : 400,
  });
}
