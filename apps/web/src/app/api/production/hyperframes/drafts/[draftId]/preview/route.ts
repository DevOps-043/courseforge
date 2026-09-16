import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { getCurrentCompositionDocument, CompositionDocumentError } from "@/domains/production/composition-editor/composition-document.service";
import { resolveCompositionPreviewAssetUrls } from "@/domains/production/composition-editor/composition-preview-assets.service";
import { compileCompositionPreview, CompositionPreviewCompilerError } from "@/domains/production/composition-editor/composition-preview-compiler.service";
import {
  createPreviewCorrelationId,
  elapsedMilliseconds,
  formatServerTimingHeader,
  type CompositionPreviewAssetDiagnostics,
} from "@/domains/production/composition-editor/composition-preview-performance";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Compiles an isolated preview from the native versioned document. */
export async function GET(request: Request, context: RouteContext) {
  const requestStartedAt = performance.now();
  const correlationId = createPreviewCorrelationId(request.headers.get("x-correlation-id"));
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.draft.preview", { correlationId: requestId, previewCorrelationId: correlationId });
  try {
    const authorizationStartedAt = performance.now();
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    const authorizationMs = elapsedMilliseconds(authorizationStartedAt);
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const documentStartedAt = performance.now();
    const current = await getCurrentCompositionDocument({
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const documentMs = elapsedMilliseconds(documentStartedAt);
    let assetDiagnostics: CompositionPreviewAssetDiagnostics | null = null;
    const assetsStartedAt = performance.now();
    const assetUrls = await resolveCompositionPreviewAssetUrls({
      document: current.document,
      draftId,
      onDiagnostics: (diagnostics) => { assetDiagnostics = diagnostics; },
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const assetsMs = elapsedMilliseconds(assetsStartedAt);
    const compileStartedAt = performance.now();
    const previewHtml = await compileCompositionPreview({
      assetUrls,
      document: current.document,
      documentHash: current.documentHash,
    });
    const compileMs = elapsedMilliseconds(compileStartedAt);
    const timings = {
      assetsMs,
      authorizationMs,
      compileMs,
      documentMs,
      totalMs: elapsedMilliseconds(requestStartedAt),
    };
    logger.info("production.hyperframes.draft.preview_compiled", {
      assetDiagnostics,
      clipCount: current.document.clips.length,
      correlationId,
      event: "composition_preview_compiled",
      timings,
      trackCount: current.document.tracks.length,
    });
    return new NextResponse(previewHtml, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; media-src 'self' https: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'",
        "Content-Type": "text/html; charset=utf-8",
        "Server-Timing": formatServerTimingHeader(timings),
        "X-Correlation-Id": correlationId,
        "X-Content-Type-Options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de borrador inválido.", requestId, status: 400 });
    if (error instanceof CompositionDocumentError || error instanceof CompositionPreviewCompilerError) {
      const status = error instanceof CompositionDocumentError ? error.status : 400;
      return apiErrorResponse({ code: status === 404 ? API_ERROR_CODE.resourceNotFound : status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest, message: error.message, requestId, status });
    }
    logger.error("production.hyperframes.draft.preview_failed", error, { durationMs: Math.round(elapsedMilliseconds(requestStartedAt)) });
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo preparar el preview de la composición.", requestId, retryable: true, status: 500 });
  }
}

async function authorize(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) } as const;
  if (!(await canReviewContent(user.userId))) return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para previsualizar el video.", requestId, status: 403 }) } as const;
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }) } as const;
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, response: null };
}
