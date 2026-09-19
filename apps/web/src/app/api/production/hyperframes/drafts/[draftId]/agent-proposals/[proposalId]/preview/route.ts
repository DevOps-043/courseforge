import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompositionAgentPreviewDocument, CompositionAgentProposalStoreError } from "@/domains/production/composition-editor/composition-agent-proposal-store.service";
import { resolveCompositionPreviewAssetUrls } from "@/domains/production/composition-editor/composition-preview-assets.service";
import { CompositionFontAssetError, resolveCompositionPreviewFonts } from "@/domains/production/composition-editor/composition-font-assets.service";
import { compileCompositionPreview, CompositionPreviewCompilerError } from "@/domains/production/composition-editor/composition-preview-compiler.service";
import { authorizeCompositionAgentRequest, compositionAgentStoreErrorResponse } from "../../_route-support";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext { params: Promise<{ draftId: string; proposalId: string }>; }

/** Compiles the simulated proposal using the same compiler and assets as the saved preview. */
export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.agent_proposals", { correlationId: requestId });
  try {
    const authorization = await authorizeCompositionAgentRequest(requestId);
    if (authorization.response) return authorization.response;
    const routeParams = await context.params;
    const draftId = z.string().uuid().parse(routeParams.draftId);
    const proposalId = z.string().uuid().parse(routeParams.proposalId);
    const document = await getCompositionAgentPreviewDocument({
      draftId,
      organizationId: authorization.organizationId,
      proposalId,
      supabase: authorization.admin,
    });
    const assetUrls = await resolveCompositionPreviewAssetUrls({
      document,
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const fontAssets = await resolveCompositionPreviewFonts({ document, organizationId: authorization.organizationId, supabase: authorization.admin });
    const html = await compileCompositionPreview({ assetUrls, document, fontAssets });
    return new NextResponse(html, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; media-src 'self' https: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'",
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de propuesta inválido.", requestId, status: 400 });
    if (error instanceof CompositionAgentProposalStoreError) return compositionAgentStoreErrorResponse(error, requestId);
    if (error instanceof CompositionFontAssetError) return apiErrorResponse({ code: error.status >= 500 ? API_ERROR_CODE.internalError : API_ERROR_CODE.invalidRequest, message: error.message, requestId, status: error.status });
    if (error instanceof CompositionPreviewCompilerError) {
      if (error.status >= 500) logger.error("production.hyperframes.agent_proposal_preview_dependency_failed", error);
      return apiErrorResponse({ code: error.status >= 500 ? API_ERROR_CODE.internalError : API_ERROR_CODE.invalidRequest, message: error.message, requestId, retryable: error.retryable, status: error.status });
    }
    logger.error("production.hyperframes.agent_proposal_preview_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo preparar el preview de la propuesta.", requestId, retryable: true, status: 500 });
  }
}
