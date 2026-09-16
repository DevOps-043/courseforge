import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { CompositionAgentProposalStoreError } from "@/domains/production/composition-editor/composition-agent-proposal-store.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";

export async function authorizeCompositionAgentRequest(requestId: string) {
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

export function compositionAgentStoreErrorResponse(error: CompositionAgentProposalStoreError, requestId: string) {
  const code = error.status === 404
    ? API_ERROR_CODE.resourceNotFound
    : error.status === 409
      ? API_ERROR_CODE.conflict
      : error.status === 503
        ? API_ERROR_CODE.dependencyUnavailable
        : error.status >= 500
          ? API_ERROR_CODE.internalError
          : API_ERROR_CODE.invalidRequest;
  return apiErrorResponse({ code, details: { reason: error.code }, message: error.message, requestId, retryable: error.retryable, status: error.status });
}
