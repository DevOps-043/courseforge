import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { CompositionPresetApplicationError } from "@/domains/production/composition-editor/composition-preset-application.service";
import { CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import {
  COMPOSITION_VERSION_FALLBACK_HEADER,
  describeCompositionDocumentVersion,
  resolveCompositionDocumentPrecondition,
} from "@/domains/production/composition-editor/composition-document-version";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger } from "@/lib/server/operational-logger";

export async function authorizeCompositionPresetRequest(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) } as const;
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }) } as const;
  if (!(await canReviewContent(user.userId, tenant))) {
    return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para editar videos.", requestId, status: 403 }) } as const;
  }
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, response: null, userId: user.userId };
}

export function compositionPresetErrorResponse(error: CompositionPresetApplicationError | CompositionPresetStoreError, requestId: string) {
  return apiErrorResponse({ code: mapStatusToErrorCode(error.status), details: { reason: error.code }, headers: { "Cache-Control": "private, no-store" }, message: error.message, requestId, retryable: error instanceof CompositionPresetStoreError ? error.retryable : false, status: error.status });
}

export function resolveCompositionPresetMutationPrecondition(params: {
  documentId: string;
  operation: "APPLY" | "CREATE" | "UNDO";
  request: Request;
  requestId: string;
}) {
  const rawIfMatch = params.request.headers.get("if-match");
  const rawFallbackVersion = params.request.headers.get(COMPOSITION_VERSION_FALLBACK_HEADER);
  const precondition = resolveCompositionDocumentPrecondition({
    fallbackHeader: rawFallbackVersion,
    ifMatchHeader: rawIfMatch,
  });
  if (precondition.ok) return precondition;

  createOperationalLogger("production.hyperframes.composition_presets", { correlationId: params.requestId }).warn("production.hyperframes.composition_preset_precondition_rejected", {
    documentId: params.documentId,
    event: "composition_preset_precondition_rejected",
    operation: params.operation,
    receivedVersion: describeCompositionDocumentVersion(
      rawIfMatch?.trim() ? rawIfMatch.replaceAll('"', "") : rawFallbackVersion,
    ),
    rejectionReason: precondition.reason,
  });
  return {
    ok: false as const,
    response: apiErrorResponse({
      code: API_ERROR_CODE.conflict,
      details: { reason: precondition.reason === "MISSING"
        ? "COMPOSITION_IF_MATCH_REQUIRED"
        : precondition.reason === "MISMATCH"
          ? "COMPOSITION_VERSION_MISMATCH"
          : "COMPOSITION_IF_MATCH_INVALID" },
      message: precondition.reason === "MISSING"
        ? "Falta la versión actual del documento."
        : precondition.reason === "MISMATCH"
          ? "Los identificadores de versión no coinciden. Recarga el editor."
          : "La versión del documento no tiene el formato esperado.",
      requestId: params.requestId,
      retryable: true,
      status: 428,
      headers: { "Cache-Control": "private, no-store" },
    }),
  };
}

export const COMPOSITION_PRESET_PREVIEW_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; media-src 'self' https: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'",
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
} as const;

function mapStatusToErrorCode(status: number) {
  if (status === 403) return API_ERROR_CODE.roleForbidden;
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409 || status === 428) return API_ERROR_CODE.conflict;
  if (status === 503) return API_ERROR_CODE.dependencyUnavailable;
  if (status >= 500) return API_ERROR_CODE.internalError;
  return API_ERROR_CODE.invalidRequest;
}

