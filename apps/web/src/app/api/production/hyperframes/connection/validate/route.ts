import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HyperframesConnectionService } from "@/domains/production/hyperframes/hyperframes-connection.service";
import { ProductionProviderCredentialError } from "@/domains/production/providers/credentials/provider-credentials.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.connection.validate", { correlationId: requestId });
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    if (!(await canReviewContent(user.userId))) return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para validar HyperFrames Cloud.", requestId, status: 403 });
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 });
    const service = new HyperframesConnectionService(getServiceRoleClient());
    const status = await service.validateActiveApiKey(tenant.organizationId);
    return apiSuccessResponse({ data: status }, { requestId });
  } catch (error) {
    if (error instanceof ProductionProviderCredentialError) return apiErrorResponse({ code: error.status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest, details: { providerCode: error.code }, message: error.message, requestId, status: error.status });
    logger.error("production.hyperframes.connection.validation_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo validar la conexión de HyperFrames Cloud.", requestId, retryable: true, status: 500 });
  }
}
