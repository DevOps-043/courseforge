import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenScenesService } from "@/domains/production/providers/heygen/heygen-scenes.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest, type ApiErrorCode } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_CLIP_EDITS_REQUEST_BYTES = 128 * 1024;
const automationIdsSchema = z.object({ componentId: z.string().uuid(), runId: z.string().uuid() }).strict();
const editsSchema = z.object({
  clips: z.array(z.object({
    id: z.string().min(1).max(200),
    avatarPresetId: z.string().uuid().optional(),
    voicePresetId: z.string().uuid().optional(),
  }).strict()).min(1).max(200),
}).strict();

interface AuthorizationFailure {
  code: ApiErrorCode;
  message: string;
  status: number;
}

async function authorize(params: Promise<{ componentId: string; runId: string }>) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { failure: { code: API_ERROR_CODE.authRequired, message: "No autorizado.", status: 401 } satisfies AuthorizationFailure };
  const tenant = await resolveActiveTenantContext();
  if (!tenant || !(await canReviewContent(user.userId, tenant))) {
    return { failure: { code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para configurar producción.", status: 403 } satisfies AuthorizationFailure };
  }
  const parsedIds = automationIdsSchema.safeParse(await params);
  if (!parsedIds.success) return { failure: { code: API_ERROR_CODE.invalidRequest, message: "Identificadores de automatización inválidos.", status: 400 } satisfies AuthorizationFailure };
  const ids = parsedIds.data;
  const admin = getServiceRoleClient();
  const { data: item, error } = await admin.from("production_run_items")
    .select("material_component_id")
    .eq("production_run_id", ids.runId).eq("organization_id", tenant.organizationId).eq("material_component_id", ids.componentId).maybeSingle();
  if (error) throw error;
  if (!item) return { failure: { code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado en esta ejecución.", status: 404 } satisfies AuthorizationFailure };
  return { admin, ids, tenant };
}

/** Creates editable scene drafts only; it does not contact HeyGen. */
export async function POST(request: Request, context: { params: Promise<{ componentId: string; runId: string }> }) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.automation.clips", { correlationId: requestId });
  try {
    const authorized = await authorize(context.params);
    if (authorized.failure) return apiErrorResponse({ ...authorized.failure, requestId });
    const { data: component, error } = await authorized.admin.from("material_components").select("id, assets, content").eq("id", authorized.ids.componentId).maybeSingle();
    if (error) throw error;
    if (!component) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado.", requestId, status: 404 });
    const service = new HeygenScenesService(authorized.admin);
    const scenes = service.buildSceneClips({ componentContent: component.content, existingClips: component.assets?.avatar_clips });
    const assets = await service.saveSceneClips({ avatarGenerationMode: "scene_clips", clips: scenes, componentId: component.id });
    return apiSuccessResponse({ data: { clips: assets.avatar_clips || [] } }, { requestId });
  } catch (error: unknown) {
    logger.error("production.automation.clips.prepare_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudieron preparar los clips.", requestId, retryable: true, status: 500 });
  }
}

/** Saves explicit avatar/voice choices per scene before the worker is dispatched. */
export async function PUT(request: Request, context: { params: Promise<{ componentId: string; runId: string }> }) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.automation.clips", { correlationId: requestId });
  try {
    const authorized = await authorize(context.params);
    if (authorized.failure) return apiErrorResponse({ ...authorized.failure, requestId });
    const parsed = await parseJsonRequest(request, editsSchema, MAX_CLIP_EDITS_REQUEST_BYTES);
    if (!parsed.success) {
      return apiErrorResponse({
        code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsed.reason === "too_large" ? "Los cambios de clips exceden el tamaño permitido." : "Cambios de clips inválidos.",
        requestId,
        status: parsed.reason === "too_large" ? 413 : 400,
      });
    }
    const { data: component, error } = await authorized.admin.from("material_components").select("id, assets, content").eq("id", authorized.ids.componentId).maybeSingle();
    if (error) throw error;
    if (!component) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado.", requestId, status: 404 });
    const service = new HeygenScenesService(authorized.admin);
    const edits = new Map(parsed.data.clips.map((clip) => [clip.id, clip]));
    const clips = service.buildSceneClips({ componentContent: component.content, existingClips: component.assets?.avatar_clips }).map((clip) => {
      const edit = edits.get(clip.id);
      return edit ? {
        ...clip,
        ...(edit.avatarPresetId ? { avatar_preset_id: edit.avatarPresetId } : {}),
        ...(edit.voicePresetId ? { voice_preset_id: edit.voicePresetId } : {}),
      } : clip;
    });
    const assets = await service.saveSceneClips({ avatarGenerationMode: "scene_clips", clips, componentId: component.id });
    return apiSuccessResponse({ data: { clips: assets.avatar_clips || [] } }, { requestId });
  } catch (error: unknown) {
    logger.error("production.automation.clips.save_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudieron guardar los clips.", requestId, retryable: true, status: 500 });
  }
}
