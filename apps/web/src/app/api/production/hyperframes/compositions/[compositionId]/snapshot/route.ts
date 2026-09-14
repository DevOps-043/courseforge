import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext, TenantContextLookupError } from "@/lib/server/tenant-context";
import { CompositionSnapshotError, snapshotCompositionDocument } from "@/domains/production/composition-editor/composition-snapshot.service";
import {
  DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID,
  getHyperframesRenderProfile,
  HYPERFRAMES_RENDER_PROFILE_IDS,
} from "@/domains/production/hyperframes/hyperframes-render-profiles";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HYPERFRAMES_SNAPSHOT_REQUEST_BYTES = 4 * 1024;

interface RouteContext { params: Promise<{ compositionId: string }>; }
const bodySchema = z.object({
  draftId: z.string().uuid(),
  renderProfileId: z.enum(HYPERFRAMES_RENDER_PROFILE_IDS).default(DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID),
}).strict();

export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.composition.snapshot", { correlationId: requestId });
  try {
    const auth = await authorize(requestId); if (auth.response) return auth.response;
    const compositionId = z.string().uuid().parse((await context.params).compositionId);
    const parsed = await parseJsonRequest(request, bodySchema, MAX_HYPERFRAMES_SNAPSHOT_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "La solicitud de snapshot no es válida.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const { draftId, renderProfileId } = parsed.data;
    const data = await snapshotCompositionDocument({
      compositionId,
      draftId,
      organizationId: auth.organizationId,
      renderProfile: getHyperframesRenderProfile(renderProfileId),
      supabase: auth.admin,
      userId: auth.userId,
    });
    return apiSuccessResponse({ data }, { requestId, status: data.reused ? 200 : 201 });
  } catch (error) {
    if (error instanceof TenantContextLookupError) return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, details: { reason: error.code }, message: error.message, requestId, retryable: true, status: 503 });
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "La solicitud de snapshot no es válida.", requestId, status: 400 });
    if (error instanceof CompositionSnapshotError) return apiErrorResponse({ code: mapStatusToErrorCode(error.status), message: error.message, requestId, status: error.status });
    logger.error("production.hyperframes.composition.snapshot_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo preparar el snapshot de ensamble.", requestId, retryable: true, status: 500 });
  }
}

async function authorize(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) } as const;
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }) } as const;
  if (!(await canReviewContent(user.userId, tenant))) return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para ensamblar videos.", requestId, status: 403 }) } as const;
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, response: null, userId: user.userId };
}

function mapStatusToErrorCode(status: number) {
  if (status === 403) return API_ERROR_CODE.roleForbidden;
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409) return API_ERROR_CODE.conflict;
  return API_ERROR_CODE.invalidRequest;
}
