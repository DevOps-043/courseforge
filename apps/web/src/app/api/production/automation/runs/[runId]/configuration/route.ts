import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_AUTOMATION_CONFIGURATION_BYTES = 256 * 1024;
const runIdSchema = z.string().uuid();

const avatarSchema = z.object({
  aspectRatio: z.enum(["16:9", "9:16"]),
  avatarPresetId: z.string().uuid(),
  caption: z.boolean(),
  engine: z.enum(["avatar_iv", "avatar_v"]),
  generationMode: z.enum(["scene_clips", "single_video"]),
  outputFormat: z.enum(["mp4", "webm"]),
  resolution: z.enum(["720p", "1080p", "4k"]),
  voicePresetId: z.string().uuid(),
}).strict();

const slidesSchema = z.object({
  appearance: z.enum(["light", "dark"]).default("light"),
  generateVisuals: z.boolean(),
  locale: z.enum(["es", "en"]),
  slideTemplateRunId: z.string().uuid().optional(),
  template: z.enum(["concept-lesson", "course-module", "data-explainer", "demo-guide"]),
}).strict();

const itemConfigurationSchema = z.object({
  avatar: avatarSchema.optional(),
  slides: slidesSchema.optional(),
}).strict();

const configurationSchema = z.object({
  approve: z.boolean().default(false),
  defaults: itemConfigurationSchema.optional(),
  items: z.array(z.object({
    componentId: z.string().uuid(),
  }).merge(itemConfigurationSchema).strict()).default([]),
}).strict();

export async function PUT(request: Request, context: { params: Promise<{ runId: string }> }) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.automation.configuration", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(request, configurationSchema, MAX_AUTOMATION_CONFIGURATION_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La configuración excede el tamaño permitido." : "Configuración inválida.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const input = parsedRequest.data;
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    const tenant = await resolveActiveTenantContext();
    if (!tenant || !(await canReviewContent(user.userId, tenant))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para configurar producción.", requestId, status: 403 });
    }
    const { runId } = await context.params;
    if (!runIdSchema.safeParse(runId).success) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "runId inválido.", requestId, status: 400 });
    const admin = getServiceRoleClient();
    const { data: run, error: runError } = await admin
      .from("production_runs")
      .select("id, configuration")
      .eq("id", runId)
      .eq("organization_id", tenant.organizationId)
      .maybeSingle();
    if (runError) throw runError;
    if (!run) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Ejecución de producción no encontrada.", requestId, status: 404 });

    const componentIds = input.items.map((item) => item.componentId);
    const { data: knownItems, error: knownItemsError } = await admin
      .from("production_run_items")
      .select("id, material_component_id, requirements, configuration")
      .eq("production_run_id", runId)
      .eq("organization_id", tenant.organizationId);
    if (knownItemsError) throw knownItemsError;
    const itemByComponentId = new Map((knownItems || []).map((item) => [item.material_component_id, item]));
    if (componentIds.some((componentId) => !itemByComponentId.has(componentId))) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Uno o más componentes no pertenecen a esta ejecución.", requestId, status: 400 });
    }

    const now = new Date().toISOString();
    for (const item of input.items) {
      const existing = itemByComponentId.get(item.componentId);
      const existingConfiguration = asObject(existing?.configuration);
      const { error } = await admin
        .from("production_run_items")
        .update({
          configuration: {
            ...existingConfiguration,
            ...(item.avatar ? { avatar: item.avatar } : {}),
            ...(item.slides ? { slides: item.slides } : {}),
          },
          updated_at: now,
        })
        .eq("production_run_id", runId)
        .eq("organization_id", tenant.organizationId)
        .eq("material_component_id", item.componentId);
      if (error) throw error;
    }
    const previousRunConfiguration = asObject(run.configuration);
    const defaults = {
      ...asObject(previousRunConfiguration.defaults),
      ...asObject(input.defaults),
    };
    if (input.approve) {
      const configuredItems = (knownItems || []).map((item) => {
        const incoming = input.items.find((entry) => entry.componentId === item.material_component_id);
        const itemConfiguration = {
          ...asObject(item.configuration),
          ...(incoming?.avatar ? { avatar: incoming.avatar } : {}),
          ...(incoming?.slides ? { slides: incoming.slides } : {}),
        };
        return { ...item, configuration: itemConfiguration };
      });
      const incomplete = configuredItems.flatMap((item) => {
        const requirements = Array.isArray(item.requirements) ? item.requirements : [];
        const itemConfiguration = asObject(item.configuration);
        const unresolved: string[] = [];
        if ((requirements.length === 0 || requirements.some((requirement: { kind?: string }) => requirement.kind === "AVATAR_AND_VOICE"))
          && !itemConfiguration.avatar && !defaults.avatar) {
          unresolved.push("avatar y voz");
        }
        if (requirements.some((requirement: { kind?: string }) => requirement.kind === "SLIDES")
          && !itemConfiguration.slides && !defaults.slides) {
          unresolved.push("plantilla de diapositivas");
        }
        return unresolved.length > 0 ? [`${item.material_component_id}: ${unresolved.join(", ")}`] : [];
      });
      if (incomplete.length > 0) {
        return apiErrorResponse({
          code: API_ERROR_CODE.invalidRequest,
          details: { incomplete },
          message: "Antes de aprobar, configura todos los assets requeridos de forma general o por lección.",
          requestId,
          status: 400,
        });
      }
    }
    const { error: updateRunError } = await admin
      .from("production_runs")
      .update({
        configuration: {
          ...previousRunConfiguration,
          approval_state: input.approve ? "APPROVED" : "DRAFT",
          configured_at: now,
          configured_by: user.userId,
          defaults,
        },
        updated_at: now,
      })
      .eq("id", runId)
      .eq("organization_id", tenant.organizationId);
    if (updateRunError) throw updateRunError;
    return apiSuccessResponse({ approved: input.approve }, { requestId });
  } catch (error: unknown) {
    logger.error("production.automation.configuration.failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo guardar la configuración.", requestId, retryable: true, status: 500 });
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
