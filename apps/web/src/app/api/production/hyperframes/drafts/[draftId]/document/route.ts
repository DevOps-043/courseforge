import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext, TenantContextLookupError } from "@/lib/server/tenant-context";
import {
  applyAndAppendCompositionDocumentPatches,
  CompositionDocumentConflictError,
  CompositionDocumentError,
  CompositionDocumentPersistenceError,
  getCurrentCompositionDocument,
  listCompositionDocumentHistory,
} from "@/domains/production/composition-editor/composition-document.service";
import { compositionEditorPatchRequestSchema } from "@/domains/production/composition-editor/editor-patch.types";
import { createClient } from "@/utils/supabase/server";
import { initializeHyperframesDraft, HyperframesDraftError } from "@/domains/production/hyperframes/hyperframes-draft.service";
import {
  COMPOSITION_VERSION_FALLBACK_HEADER,
  describeCompositionDocumentVersion,
  formatCompositionDocumentEtag,
  resolveCompositionDocumentPrecondition,
} from "@/domains/production/composition-editor/composition-document-version";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext { params: Promise<{ draftId: string }>; }
const preassembleRequestSchema = z.object({ action: z.literal("preassemble") }).strict();
const MAX_PREASSEMBLY_REQUEST_BYTES = 4 * 1024;
const MAX_COMPOSITION_PATCH_REQUEST_BYTES = 2 * 1024 * 1024;

/** Explicitly replaces slide timing with the reviewed narrative plan. */
export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.draft.document", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    const parsed = await parseJsonRequest(request, preassembleRequestSchema, MAX_PREASSEMBLY_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "La solicitud de preensamble no es válida.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const precondition = resolveCompositionDocumentPrecondition({ ifMatchHeader: request.headers.get("if-match"), fallbackHeader: request.headers.get(COMPOSITION_VERSION_FALLBACK_HEADER) });
    if (!precondition.ok) return apiErrorResponse({ code: API_ERROR_CODE.conflict, message: "Recarga la composición antes de aplicar el preensamble.", requestId, retryable: true, status: 428 });
    const { data: draft, error } = await authorization.admin.from("video_composition_drafts").select("composition_id")
      .eq("id", draftId).eq("organization_id", authorization.organizationId).maybeSingle();
    if (error) throw error;
    if (!draft) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Borrador no encontrado.", requestId, status: 404 });
    await initializeHyperframesDraft({ compositionId: draft.composition_id, organizationId: authorization.organizationId,
      supabase: authorization.admin, userId: authorization.userId, preassemblyVersion: precondition.documentHash });
    const data = await getCurrentCompositionDocument({ draftId, organizationId: authorization.organizationId, supabase: authorization.admin });
    return apiSuccessResponse({ data }, { headers: { "Cache-Control": "private, no-store", ETag: formatCompositionDocumentEtag(data.documentHash) }, requestId });
  } catch (error) {
    if (error instanceof CompositionDocumentConflictError) return apiErrorResponse({ code: API_ERROR_CODE.conflict, extensions: { data: error.current }, message: error.message, requestId, retryable: true, status: 409 });
    if (error instanceof HyperframesDraftError || error instanceof CompositionDocumentError) return apiErrorResponse({ code: mapStatusToErrorCode(error.status), message: error.message, requestId, status: error.status });
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "El plan no cabe en los tiempos actuales. Revisa sus animaciones y duraciones.", requestId, status: 422 });
    logger.error("production.hyperframes.draft.preassembly_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo aplicar el preensamble.", requestId, retryable: true, status: 500 });
  }
}

/** Returns the native editor document; no source HTML or Storage path is exposed. */
export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.draft.document", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    const { draftId } = await context.params;
    const parsedDraftId = z.string().uuid().parse(draftId);
    if (new URL(request.url).searchParams.get("history") === "1") {
      const data = await listCompositionDocumentHistory({
        draftId: parsedDraftId,
        organizationId: authorization.organizationId,
        supabase: authorization.admin,
      });
      return apiSuccessResponse({ data }, { headers: { "Cache-Control": "private, no-store" }, requestId });
    }
    const data = await getCurrentCompositionDocument({
      draftId: parsedDraftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return apiSuccessResponse({ data }, { headers: { ETag: formatCompositionDocumentEtag(data.documentHash), "Cache-Control": "private, no-store" }, requestId });
  } catch (error) {
    if (error instanceof TenantContextLookupError) return tenantUnavailableResponse(error, requestId);
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de borrador inválido.", requestId, status: 400 });
    if (error instanceof CompositionDocumentPersistenceError) return compositionErrorResponse(error, requestId);
    if (error instanceof CompositionDocumentError) return apiErrorResponse({ code: mapStatusToErrorCode(error.status), details: { reason: "COMPOSITION_DOCUMENT_ERROR" }, message: error.message, requestId, status: error.status });
    if (isTransientStorageError(error)) return storageUnavailableResponse(requestId);
    logger.error("production.hyperframes.draft.document_read_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo cargar el documento de composición.", requestId, retryable: true, status: 500 });
  }
}

/** Appends one validated editor version. The If-Match hash prevents silent overwrites. */
export async function PUT(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const diagnosticId = requestId;
  const logger = createOperationalLogger("production.hyperframes.draft.document", { correlationId: requestId });
  let updateStage = "AUTHORIZE";
  try {
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    updateStage = "PRECONDITION";
    const { draftId } = await context.params;
    const rawIfMatch = request.headers.get("if-match");
    const rawFallbackVersion = request.headers.get(COMPOSITION_VERSION_FALLBACK_HEADER);
    const precondition = resolveCompositionDocumentPrecondition({
      fallbackHeader: rawFallbackVersion,
      ifMatchHeader: rawIfMatch,
    });
    if (!precondition.ok) {
      logger.warn("production.hyperframes.draft.document_precondition_rejected", {
        documentId: draftId,
        event: "composition_document_precondition_rejected",
        receivedVersion: describeCompositionDocumentVersion(rawIfMatch?.replaceAll('"', "") ?? rawFallbackVersion),
        rejectionReason: precondition.reason,
      });
      const reason = precondition.reason === "MISSING"
        ? "COMPOSITION_IF_MATCH_REQUIRED"
        : precondition.reason === "MISMATCH"
          ? "COMPOSITION_VERSION_MISMATCH"
          : "COMPOSITION_IF_MATCH_INVALID";
      return apiErrorResponse({
        code: API_ERROR_CODE.conflict,
        details: { reason },
        message: precondition.reason === "MISSING"
          ? "Falta la versión actual del documento (If-Match)."
          : precondition.reason === "MISMATCH"
            ? "Los identificadores de versión del documento no coinciden. Recarga el editor."
            : "La versión del documento no tiene el formato esperado.",
        requestId,
        retryable: true,
        status: 428,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (precondition.source === "X_COMPOSITION_VERSION") {
      logger.warn("production.hyperframes.draft.document_precondition_fallback", {
        documentId: draftId,
        event: "composition_document_precondition_fallback_used",
        receivedVersion: describeCompositionDocumentVersion(precondition.documentHash),
      });
    }
    updateStage = "PATCH_VALIDATION";
    const parsed = await parseJsonRequest(request, compositionEditorPatchRequestSchema, MAX_COMPOSITION_PATCH_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, details: { reason: "COMPOSITION_PATCH_INVALID" }, message: parsed.reason === "too_large" ? "La edición excede el tamaño permitido." : "La edición solicitada no es válida.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const body = parsed.data;
    const persistenceSignal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
    updateStage = "APPLY_AND_APPEND";
    const data = await applyAndAppendCompositionDocumentPatches({
      draftId: z.string().uuid().parse(draftId),
      expectedDocumentHash: precondition.documentHash,
      organizationId: authorization.organizationId,
      patch: body,
      signal: persistenceSignal,
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return apiSuccessResponse({ data }, { headers: { ETag: formatCompositionDocumentEtag(data.documentHash), "Cache-Control": "private, no-store" }, requestId });
  } catch (error) {
    if (error instanceof TenantContextLookupError) return tenantUnavailableResponse(error, requestId);
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, details: { reason: "COMPOSITION_PATCH_INVALID" }, message: error.issues[0]?.message || "La edición solicitada no es válida.", requestId, status: 400 });
    }
    if (error instanceof CompositionDocumentConflictError) {
      return apiErrorResponse({ code: API_ERROR_CODE.conflict, details: { reason: "COMPOSITION_VERSION_CONFLICT" }, extensions: { data: error.current }, message: error.message, requestId, retryable: true, status: error.status });
    }
    if (error instanceof CompositionDocumentPersistenceError) return compositionErrorResponse(error, requestId);
    if (error instanceof CompositionDocumentError) return apiErrorResponse({ code: mapStatusToErrorCode(error.status), details: { reason: "COMPOSITION_DOCUMENT_ERROR" }, message: error.message, requestId, status: error.status });
    if (isTransientStorageError(error)) return storageUnavailableResponse(requestId);
    logger.error("production.hyperframes.draft.document_update_failed", error, {
      diagnosticId,
      stage: updateStage,
    });
    return apiErrorResponse({
      code: API_ERROR_CODE.internalError,
      details: { diagnosticId, reason: "COMPOSITION_UPDATE_FAILED" },
      message: "No se pudo guardar la edición de la composición.",
      requestId,
      retryable: true,
      status: 500,
    });
  }
}

function compositionErrorResponse(error: CompositionDocumentPersistenceError, requestId: string) {
  return apiErrorResponse({ code: mapStatusToErrorCode(error.status), details: { reason: error.code, ...(error.diagnosticId ? { diagnosticId: error.diagnosticId } : {}) }, message: error.message, requestId, retryable: error.retryable, status: error.status });
}

function tenantUnavailableResponse(error: TenantContextLookupError, requestId: string) {
  return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, details: { reason: error.code }, message: error.message, requestId, retryable: true, status: 503 });
}

function storageUnavailableResponse(requestId: string) {
  return apiErrorResponse({
    code: API_ERROR_CODE.dependencyUnavailable,
    details: { reason: "COMPOSITION_STORAGE_UNAVAILABLE" },
    message: "El almacenamiento está ocupado y no respondió a tiempo. Tus cambios no se descartaron; vuelve a intentar.",
    requestId,
    retryable: true,
    status: 503,
  });
}

function isTransientStorageError(error: unknown) {
  const serialized = serializeError(error);
  return serialized.code === "PGRST003"
    || /timed out acquiring connection|connection pool|pool timeout|fetch failed/i.test(serialized.message);
}

function serializeError(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    return {
      code: typeof candidate.code === "string" ? candidate.code : null,
      details: typeof candidate.details === "string" ? candidate.details.slice(0, 500) : null,
      hint: typeof candidate.hint === "string" ? candidate.hint.slice(0, 300) : null,
      message: typeof candidate.message === "string" ? candidate.message.slice(0, 500) : "unknown",
    };
  }
  return { message: error instanceof Error ? error.message : "unknown" };
}

async function authorize(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) } as const;
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }) } as const;
  if (!(await canReviewContent(user.userId, tenant))) return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para editar videos.", requestId, status: 403 }) } as const;
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, response: null, userId: user.userId };
}

function mapStatusToErrorCode(status: number) {
  if (status === 403) return API_ERROR_CODE.roleForbidden;
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409 || status === 428) return API_ERROR_CODE.conflict;
  if (status === 503) return API_ERROR_CODE.dependencyUnavailable;
  return API_ERROR_CODE.invalidRequest;
}
