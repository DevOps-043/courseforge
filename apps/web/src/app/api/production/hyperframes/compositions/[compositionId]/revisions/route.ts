import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  HyperframesRevisionGenerationError,
  HyperframesRevisionGenerationService,
} from "@/domains/production/hyperframes/hyperframes-revision-generation.service";
import {
  activateCompositionSnapshot,
  CompositionSnapshotError,
  listCompositionSnapshots,
} from "@/domains/production/composition-editor/composition-snapshot.service";
import {
  COMPOSITION_VERSION_FALLBACK_HEADER,
  formatCompositionDocumentEtag,
  resolveCompositionDocumentPrecondition,
} from "@/domains/production/composition-editor/composition-document-version";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HYPERFRAMES_REVISION_REQUEST_BYTES = 32 * 1024;

interface RouteContext { params: Promise<{ compositionId: string }>; }

const revisionRequestSchema = z.object({
  agentInstruction: z.string().trim().min(1).max(1_000).optional(),
  generationMode: z.enum(["AUTOMATIC", "AGENT_ASSISTED"]),
  selectedAssetIds: z.array(z.string().uuid()).min(1).max(250).optional(),
}).strict();

const activateSnapshotSchema = z.object({
  draftId: z.string().uuid(),
  revisionId: z.string().uuid(),
}).strict();

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.composition.revisions", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    const compositionId = z.string().uuid().parse((await context.params).compositionId);
    const data = await listCompositionSnapshots({
      compositionId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return apiSuccessResponse({ data }, { headers: { "Cache-Control": "private, no-store" }, requestId });
  } catch (error) {
    logger.error("production.hyperframes.composition.revisions.list_failed", error);
    return respondSnapshotError(error, "No se pudo cargar el historial de snapshots.", requestId);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.composition.revisions", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    const compositionId = z.string().uuid().parse((await context.params).compositionId);
    const precondition = resolveCompositionDocumentPrecondition({
      fallbackHeader: request.headers.get(COMPOSITION_VERSION_FALLBACK_HEADER),
      ifMatchHeader: request.headers.get("if-match"),
    });
    if (!precondition.ok) {
      return apiErrorResponse({ code: API_ERROR_CODE.conflict, details: { reason: "COMPOSITION_IF_MATCH_REQUIRED" }, headers: { "Cache-Control": "private, no-store" }, message: "Falta la versión actual del timeline para restaurar el snapshot.", requestId, retryable: true, status: 428 });
    }
    const parsed = await parseJsonRequest(request, activateSnapshotSchema, MAX_HYPERFRAMES_REVISION_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "El snapshot solicitado no es válido.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const { draftId, revisionId } = parsed.data;
    const data = await activateCompositionSnapshot({
      compositionId,
      draftId,
      expectedDocumentHash: precondition.documentHash,
      organizationId: authorization.organizationId,
      revisionId,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return apiSuccessResponse({ data }, {
      headers: {
        "Cache-Control": "private, no-store",
        ETag: formatCompositionDocumentEtag(data.documentHash),
      },
      requestId,
    });
  } catch (error) {
    logger.error("production.hyperframes.composition.revisions.restore_failed", error);
    return respondSnapshotError(error, "No se pudo restaurar el snapshot.", requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.composition.revisions", { correlationId: requestId });
  try {
    const { compositionId } = await context.params;
    const parsed = await parseJsonRequest(request, revisionRequestSchema, MAX_HYPERFRAMES_REVISION_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Solicitud de revisión de video inválida.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const input = parsed.data;
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    const result = await new HyperframesRevisionGenerationService(authorization.admin).generate({
      ...input,
      compositionId: z.string().uuid().parse(compositionId),
      createdBy: authorization.userId,
      organizationId: authorization.organizationId,
    });
    return apiSuccessResponse({ data: result }, { requestId, status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Solicitud de revisión de video inválida.", requestId, status: 400 });
    }
    if (error instanceof HyperframesRevisionGenerationError) {
      return apiErrorResponse({ code: mapStatusToErrorCode(error.status), message: error.message, requestId, status: error.status });
    }
    logger.error("production.hyperframes.composition.revisions.generate_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo generar la revisión de video.", requestId, retryable: true, status: 500 });
  }
}

async function authorize(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) } as const;
  if (!(await canReviewContent(user.userId))) {
    return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para generar revisiones HyperFrames.", requestId, status: 403 }) } as const;
  }
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }) } as const;
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, response: null, userId: user.userId };
}

function respondSnapshotError(error: unknown, fallback: string, requestId: string) {
  if (error instanceof z.ZodError) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "El snapshot solicitado no es válido.", requestId, status: 400 });
  }
  if (error instanceof CompositionSnapshotError) {
    return apiErrorResponse({ code: mapStatusToErrorCode(error.status), message: error.message, requestId, status: error.status });
  }
  return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: fallback, requestId, retryable: true, status: 500 });
}

function mapStatusToErrorCode(status: number) {
  if (status === 403) return API_ERROR_CODE.roleForbidden;
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409 || status === 428) return API_ERROR_CODE.conflict;
  if (status === 503) return API_ERROR_CODE.dependencyUnavailable;
  return API_ERROR_CODE.invalidRequest;
}
