import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompositionPresetPreviewDocument, CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import { resolveCompositionPreviewAssetUrls } from "@/domains/production/composition-editor/composition-preview-assets.service";
import { compileCompositionPreview, CompositionPreviewCompilerError } from "@/domains/production/composition-editor/composition-preview-compiler.service";
import { authorizeCompositionPresetRequest, compositionPresetErrorResponse, COMPOSITION_PRESET_PREVIEW_HEADERS } from "../../../../../_composition-preset-route-support";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext { params: Promise<{ applicationId: string; draftId: string }>; }

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.preset_applications", { correlationId: requestId });
  try {
    const authorization = await authorizeCompositionPresetRequest(requestId);
    if (authorization.response) return authorization.response;
    const routeParams = await context.params;
    const draftId = z.string().uuid().parse(routeParams.draftId);
    const document = await getCompositionPresetPreviewDocument({
      applicationId: z.string().uuid().parse(routeParams.applicationId),
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const assetUrls = await resolveCompositionPreviewAssetUrls({
      document,
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return new NextResponse(await compileCompositionPreview({ assetUrls, document }), { headers: { ...COMPOSITION_PRESET_PREVIEW_HEADERS, "x-request-id": requestId } });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de preview inválido.", requestId, status: 400 });
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error, requestId);
    if (error instanceof CompositionPreviewCompilerError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: error.message, requestId, status: 400 });
    logger.error("production.hyperframes.preset_application_preview_compile_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo compilar el preview del preset.", requestId, retryable: true, status: 500 });
  }
}
