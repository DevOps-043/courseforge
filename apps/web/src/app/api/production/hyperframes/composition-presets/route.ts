import { listCompositionPresetCatalog, CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import { authorizeCompositionPresetRequest, compositionPresetErrorResponse } from "../_composition-preset-route-support";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.composition_presets", { correlationId: requestId });
  try {
    const authorization = await authorizeCompositionPresetRequest(requestId);
    if (authorization.response) return authorization.response;
    const data = await listCompositionPresetCatalog({
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return apiSuccessResponse({ data }, { headers: { "Cache-Control": "private, no-store" }, requestId });
  } catch (error) {
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error, requestId);
    logger.error("production.hyperframes.composition_presets.list_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo cargar el catálogo de presets.", requestId, retryable: true, status: 500 });
  }
}
