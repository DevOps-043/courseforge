import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  getCompositionDocumentByHash,
  getCurrentCompositionDocument,
  CompositionDocumentError,
} from "@/domains/production/composition-editor/composition-document.service";
import { resolveCompositionPreviewAssetUrls } from "@/domains/production/composition-editor/composition-preview-assets.service";
import { CompositionFontAssetError, resolveCompositionPreviewFonts } from "@/domains/production/composition-editor/composition-font-assets.service";
import {
  compileCompositionPreview,
  CompositionPreviewCompilerError,
  type CompositionPreviewCompilerDiagnostics,
} from "@/domains/production/composition-editor/composition-preview-compiler.service";
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
import { isCompositionDocumentHash, parseCompositionPreviewGeneration } from "@/domains/production/composition-editor/composition-preview-comparison";
import { buildCompositionPreviewFailureBridge } from "@/domains/production/composition-editor/composition-preview-failure-bridge";
import type { CompositionPreviewLoadErrorCode } from "@/domains/production/composition-editor/composition-preview-protocol";
import { buildCompositionHtmlEditingPreviewCsp, HtmlEditingPreviewCspError } from "@/domains/production/composition-editor/composition-html-editing-preview-csp.server";

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Compiles an isolated preview from the native versioned document. */
export async function GET(request: Request, context: RouteContext) {
  const requestUrl = new URL(request.url);
  const requestedDocumentHash = requestUrl.searchParams.get("documentHash");
  const syncV2Requested = requestUrl.searchParams.get("sync") === "2";
  const previewGeneration = syncV2Requested ? parseCompositionPreviewGeneration(requestUrl.searchParams.get("r")) : null;
  const failureBridgeHash = syncV2Requested && previewGeneration !== null && requestedDocumentHash && isCompositionDocumentHash(requestedDocumentHash)
    ? requestedDocumentHash.toLowerCase()
    : null;
  const requestStartedAt = performance.now();
  const correlationId = createPreviewCorrelationId(request.headers.get("x-correlation-id"));
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.draft.preview", { correlationId: requestId, previewCorrelationId: correlationId });
  try {
    const authorizationStartedAt = performance.now();
    const authorization = await authorize(requestId, failureBridgeHash, previewGeneration);
    if (authorization.response) {
      logger.warn("production.hyperframes.draft.preview_access_denied", {
        event: "composition_preview_access_denied",
        outcome: authorization.response.status === 401 ? "AUTH_REQUIRED" : "ACCESS_DENIED",
      });
      return authorization.response;
    }
    const authorizationMs = elapsedMilliseconds(authorizationStartedAt);
    const draftId = z.string().uuid().parse((await context.params).draftId);
    if (syncV2Requested && previewGeneration === null) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "La generación del preview no es válida.", requestId, status: 400 });
    }
    const documentStartedAt = performance.now();
    if (requestedDocumentHash && !isCompositionDocumentHash(requestedDocumentHash)) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "La versión de comparación no es válida.", requestId, status: 400 });
    }
    const current = requestedDocumentHash
      ? await getCompositionDocumentByHash({
        documentHash: requestedDocumentHash,
        draftId,
        organizationId: authorization.organizationId,
        supabase: authorization.admin,
      })
      : await getCurrentCompositionDocument({
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
    const fontAssets = await resolveCompositionPreviewFonts({
      document: current.document,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const assetsMs = elapsedMilliseconds(assetsStartedAt);
    const compileStartedAt = performance.now();
    const compilerDiagnostics: { current: CompositionPreviewCompilerDiagnostics | null } = { current: null };
    const previewHtml = await compileCompositionPreview({
      assetUrls,
      document: current.document,
      documentHash: current.documentHash,
      fontAssets,
      onDiagnostics: (diagnostics) => { compilerDiagnostics.current = diagnostics; },
      previewGeneration,
    });
    const compileMs = elapsedMilliseconds(compileStartedAt);
    const editableContentSecurityPolicy = current.document.htmlEditing?.items.length
      ? buildCompositionHtmlEditingPreviewCsp(previewHtml) : null;
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
      compilerDiagnostics: compilerDiagnostics.current,
      correlationId,
      documentHash: current.documentHash,
      event: "composition_preview_compiled",
      timings,
      trackCount: current.document.tracks.length,
    });
    return new NextResponse(previewHtml, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": editableContentSecurityPolicy ?? "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; media-src 'self' https: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'",
        "Content-Type": "text/html; charset=utf-8",
        "Server-Timing": formatServerTimingHeader(timings),
        "X-Correlation-Id": correlationId,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    if (error instanceof HtmlEditingPreviewCspError) return previewFailureResponse({ bridgeCode: "COMPILATION_FAILED",
      code: API_ERROR_CODE.invalidRequest, documentHash: failureBridgeHash, message: "La política de aislamiento del HTML editable fue rechazada.",
      previewGeneration, requestId, retryable: false, status: 422 });
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de borrador inválido.", requestId, status: 400 });
    if (error instanceof CompositionDocumentError || error instanceof CompositionPreviewCompilerError || error instanceof CompositionFontAssetError) {
      const status = error.status;
      if (status >= 500) logger.error("production.hyperframes.draft.preview_dependency_failed", error);
      const code = status >= 500
        ? API_ERROR_CODE.internalError
        : status === 404
          ? API_ERROR_CODE.resourceNotFound
          : status === 409
            ? API_ERROR_CODE.conflict
            : API_ERROR_CODE.invalidRequest;
      const retryable = error instanceof CompositionPreviewCompilerError ? error.retryable : false;
      const bridgeCode: CompositionPreviewLoadErrorCode = error instanceof CompositionPreviewCompilerError
        ? "COMPILATION_FAILED"
        : error instanceof CompositionFontAssetError ? "DEPENDENCY_FAILED" : "DOCUMENT_UNAVAILABLE";
      return previewFailureResponse({ bridgeCode, code, documentHash: failureBridgeHash, message: error.message, previewGeneration, requestId, retryable, status });
    }
    logger.error("production.hyperframes.draft.preview_failed", error, { durationMs: Math.round(elapsedMilliseconds(requestStartedAt)) });
    return previewFailureResponse({ bridgeCode: "UNKNOWN", code: API_ERROR_CODE.internalError, documentHash: failureBridgeHash, message: "No se pudo preparar el preview de la composición.", previewGeneration, requestId, retryable: true, status: 500 });
  }
}

function previewFailureResponse(input: {
  bridgeCode: CompositionPreviewLoadErrorCode;
  code: Parameters<typeof apiErrorResponse>[0]["code"];
  documentHash: string | null;
  message: string;
  previewGeneration: number | null;
  requestId: string;
  retryable: boolean;
  status: number;
}) {
  if (!input.documentHash || input.previewGeneration === null) return apiErrorResponse(input);
  const bridge = buildCompositionPreviewFailureBridge({ code: input.bridgeCode, documentHash: input.documentHash, nonce: crypto.randomUUID(), previewGeneration: input.previewGeneration });
  return new NextResponse(bridge.html, {
    status: input.status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": bridge.contentSecurityPolicy,
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "x-request-id": input.requestId,
    },
  });
}

async function authorize(requestId: string, documentHash: string | null, previewGeneration: number | null) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: previewFailureResponse({ bridgeCode: "AUTH_REQUIRED", code: API_ERROR_CODE.authRequired, documentHash, message: "No autorizado.", previewGeneration, requestId, retryable: false, status: 401 }) } as const;
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: previewFailureResponse({ bridgeCode: "ACCESS_DENIED", code: API_ERROR_CODE.tenantForbidden, documentHash, message: "Empresa no válida o no autorizada.", previewGeneration, requestId, retryable: false, status: 403 }) } as const;
  if (!(await canReviewContent(user.userId, tenant))) return { response: previewFailureResponse({ bridgeCode: "ACCESS_DENIED", code: API_ERROR_CODE.roleForbidden, documentHash, message: "No tienes permisos para previsualizar el video.", previewGeneration, requestId, retryable: false, status: 403 }) } as const;
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, response: null };
}
