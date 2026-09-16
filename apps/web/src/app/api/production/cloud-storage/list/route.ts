import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser } from "@/lib/server/artifact-action-auth";
import { getCloudStorageService } from "@/domains/production/cloud-storage/cloud-storage.service";
import { isCloudStorageProvider } from "@/domains/production/cloud-storage/types";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.cloud_storage.list", { correlationId: requestId });
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";
    const provider = searchParams.get("provider");

    if (!isCloudStorageProvider(provider) || query.length > 200) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Proveedor cloud o búsqueda inválidos.", requestId, status: 400 });
    }

    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada.", requestId, status: 403 });
    }

    const files = await getCloudStorageService(provider).listFiles(
      authenticatedUser.userId,
      tenant.organizationId,
      query,
    );

    return apiSuccessResponse({
      files,
    }, { requestId });
  } catch (error: unknown) {
    logger.error("production.cloud_storage.list.failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno del servidor al buscar en el proveedor cloud", requestId, retryable: true, status: 500 });
  }
}
