import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { authorizationUnavailableResponse } from "@/lib/server/authorization-unavailable-response";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";

async function resolveRenderAuthorization(requestId: string) {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) {
    return {
      admin: null as never,
      organizationId: null as never,
      response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }),
    };
  }
  const tenant = await resolveActiveTenantContext();
  if (!tenant) {
    return {
      admin: null as never,
      organizationId: null as never,
      response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }),
    };
  }
  if (!(await canReviewContent(authenticatedUser.userId, tenant))) {
    return {
      admin: null as never,
      organizationId: null as never,
      response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para consultar renders de HyperFrames.", requestId, status: 403 }),
    };
  }
  return {
    admin: getServiceRoleClient(),
    organizationId: tenant.organizationId,
    response: null,
  };
}

export async function resolveAuthorizedRenderContext(requestId: string) {
  try { return await resolveRenderAuthorization(requestId); }
  catch (error) {
    const response = authorizationUnavailableResponse(error, requestId);
    if (!response) throw error;
    return { admin: null as never, organizationId: null as never, response };
  }
}
