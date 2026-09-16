import { z } from "zod";
import { dismissStoredCompositionPresetPreview, CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import { authorizeCompositionPresetRequest, compositionPresetErrorResponse } from "../../../../_composition-preset-route-support";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext { params: Promise<{ applicationId: string; draftId: string }>; }

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.preset_applications", { correlationId: requestId });
  try {
    const authorization = await authorizeCompositionPresetRequest(requestId);
    if (authorization.response) return authorization.response;
    const routeParams = await context.params;
    await dismissStoredCompositionPresetPreview({
      applicationId: z.string().uuid().parse(routeParams.applicationId),
      draftId: z.string().uuid().parse(routeParams.draftId),
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return apiSuccessResponse({}, { headers: { "Cache-Control": "private, no-store" }, requestId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de preview inválido.", requestId, status: 400 });
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error, requestId);
    logger.error("production.hyperframes.preset_application_dismiss_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo descartar el preview.", requestId, retryable: true, status: 500 });
  }
}
