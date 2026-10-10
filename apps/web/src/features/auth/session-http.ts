import { API_ERROR_CODE } from "../../lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "../../lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "../../lib/server/operational-logger";
import { resolveAuthSessionUser, type AuthSessionDependencies } from "./session.service";

const sessionHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export function createAuthSessionHandler(dependencies: AuthSessionDependencies) {
  return async (request: Request) => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    try {
      const user = await resolveAuthSessionUser(dependencies);
      if (!user) return apiErrorResponse({
        code: API_ERROR_CODE.authRequired, message: "Sesión no disponible o expirada.",
        requestId, status: 401, headers: sessionHeaders,
      });
      return apiSuccessResponse({ user }, { requestId, headers: sessionHeaders });
    } catch {
      // Provider errors can contain session material or PII; log a safe event only.
      createOperationalLogger("auth.session", { correlationId: requestId }).warn("auth.session.unavailable");
      return apiErrorResponse({
        code: API_ERROR_CODE.internalError, message: "No se pudo comprobar la sesión.",
        requestId, status: 500, retryable: true, headers: sessionHeaders,
      });
    }
  };
}
