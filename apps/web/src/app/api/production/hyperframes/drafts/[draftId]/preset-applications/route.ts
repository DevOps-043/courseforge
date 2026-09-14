import { z } from "zod";
import { compositionPresetApplicationRequestSchema } from "@/domains/production/composition-editor/composition-preset.types";
import {
  createCompositionPresetPreview,
  getRecoverableCompositionPresetApplication,
  CompositionPresetStoreError,
} from "@/domains/production/composition-editor/composition-preset-store.service";
import { CompositionPresetApplicationError } from "@/domains/production/composition-editor/composition-preset-application.service";
import { authorizeCompositionPresetRequest, compositionPresetErrorResponse } from "../../../_composition-preset-route-support";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_COMPOSITION_PRESET_APPLICATION_REQUEST_BYTES = 4 * 1024;

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Recovers a safe undo affordance after the editor is reloaded. */
export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.preset_applications", { correlationId: requestId });
  try {
    const authorization = await authorizeCompositionPresetRequest(requestId);
    if (authorization.response) return authorization.response;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const data = await getRecoverableCompositionPresetApplication({
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return apiSuccessResponse({ data }, { headers: { "Cache-Control": "private, no-store" }, requestId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, headers: { "Cache-Control": "private, no-store" }, message: "El borrador no es válido.", requestId, status: 400 });
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error, requestId);
    logger.error("production.hyperframes.preset_application_recovery_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, headers: { "Cache-Control": "private, no-store" }, message: "No se pudo recuperar la última aplicación del preset.", requestId, retryable: true, status: 500 });
  }
}

/** Persists an expiring preview; the current editor document remains untouched. */
export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.preset_applications", { correlationId: requestId });
  try {
    const authorization = await authorizeCompositionPresetRequest(requestId);
    if (authorization.response) return authorization.response;
    const parsed = await parseJsonRequest(request, compositionPresetApplicationRequestSchema, MAX_COMPOSITION_PRESET_APPLICATION_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, headers: { "Cache-Control": "private, no-store" }, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "La solicitud del preset no es válida.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const body = parsed.data;
    const data = await createCompositionPresetPreview({
      draftId: z.string().uuid().parse((await context.params).draftId),
      organizationId: authorization.organizationId,
      presetId: body.presetId,
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    logger.info("production.hyperframes.preset_application_preview_created", {
      affectedClipCount: data.summary.affectedClipCount,
      affectedTrackCount: data.summary.affectedTrackCount,
      event: "composition_preset_preview_created",
      generatedAnimationCount: data.summary.generatedAnimationCount,
      warningCount: data.summary.warnings.length,
    });
    return apiSuccessResponse({ data }, { headers: { "Cache-Control": "private, no-store" }, requestId, status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, headers: { "Cache-Control": "private, no-store" }, message: "La solicitud del preset no es válida.", requestId, status: 400 });
    if (error instanceof CompositionPresetApplicationError || error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error, requestId);
    logger.error("production.hyperframes.preset_application_preview_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, headers: { "Cache-Control": "private, no-store" }, message: "No se pudo preparar el preview del preset.", requestId, retryable: true, status: 500 });
  }
}

