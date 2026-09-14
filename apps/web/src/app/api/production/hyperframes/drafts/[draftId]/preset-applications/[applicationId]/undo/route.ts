import { z } from "zod";
import { undoStoredCompositionPreset, CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import { formatCompositionDocumentEtag } from "@/domains/production/composition-editor/composition-document-version";
import { authorizeCompositionPresetRequest, compositionPresetErrorResponse, resolveCompositionPresetMutationPrecondition } from "../../../../../_composition-preset-route-support";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext { params: Promise<{ applicationId: string; draftId: string }>; }

export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.preset_applications", { correlationId: requestId });
  try {
    const authorization = await authorizeCompositionPresetRequest(requestId);
    if (authorization.response) return authorization.response;
    const routeParams = await context.params;
    const applicationId = z.string().uuid().parse(routeParams.applicationId);
    const draftId = z.string().uuid().parse(routeParams.draftId);
    const precondition = resolveCompositionPresetMutationPrecondition({
      documentId: draftId,
      operation: "UNDO",
      request,
      requestId,
    });
    if (!precondition.ok) return precondition.response;
    const data = await undoStoredCompositionPreset({
      applicationId,
      draftId,
      expectedDocumentHash: precondition.documentHash,
      organizationId: authorization.organizationId,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    logger.info("production.hyperframes.preset_application_undone", {
      event: "composition_preset_undone",
      version: data.version,
    });
    return apiSuccessResponse({ data }, { headers: { "Cache-Control": "private, no-store", ETag: formatCompositionDocumentEtag(data.documentHash) }, requestId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, headers: { "Cache-Control": "private, no-store" }, message: "Identificador de aplicación inválido.", requestId, status: 400 });
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error, requestId);
    logger.error("production.hyperframes.preset_application_undo_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, headers: { "Cache-Control": "private, no-store" }, message: "No se pudo deshacer el preset.", requestId, retryable: true, status: 500 });
  }
}
