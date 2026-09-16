import { disconnectCloudStorageAction } from "@/domains/production/actions/cloud-storage.actions";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { resolveCorrelationId } from "@/lib/server/operational-logger";

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const result = await disconnectCloudStorageAction("onedrive");
  if (!result.success) {
    const unauthorized = result.error === "No autorizado";
    const forbidden = result.error === "Empresa no valida o no autorizada";
    return apiErrorResponse({
      code: unauthorized
        ? API_ERROR_CODE.authRequired
        : forbidden
          ? API_ERROR_CODE.tenantForbidden
          : API_ERROR_CODE.internalError,
      message: unauthorized || forbidden
        ? result.error
        : "No se pudo desvincular OneDrive.",
      requestId,
      retryable: !unauthorized && !forbidden,
      status: unauthorized ? 401 : forbidden ? 403 : 500,
    });
  }

  return apiSuccessResponse({}, { requestId });
}
