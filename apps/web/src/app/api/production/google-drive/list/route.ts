import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser } from "@/lib/server/artifact-action-auth";
import { GoogleDriveService } from "@/domains/production/providers/google-drive.service";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.google_drive.list", { correlationId: requestId });
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";
    if (query.length > 200) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "La búsqueda no puede exceder 200 caracteres.", requestId, status: 400 });
    }

    // Authenticate User
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada.", requestId, status: 403 });
    }

    const driveService = new GoogleDriveService();
    const accessToken = await driveService.refreshUserAccessToken(authenticatedUser.userId, tenant.organizationId);
    const files = await driveService.listFiles(query, accessToken);

    return apiSuccessResponse({
      files,
    }, { requestId });
  } catch (error: unknown) {
    logger.error("production.google_drive.list.failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno del servidor al buscar en Google Drive", requestId, retryable: true, status: 500 });
  }
}
