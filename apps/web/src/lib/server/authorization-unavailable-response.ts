import { AuthIdentityLookupError } from "./auth-identity-error";
import { TenantContextLookupError } from "./tenant-context-error";
import { API_ERROR_CODE } from "./api-contract";
import { apiErrorResponse } from "./api-response";
import { createOperationalLogger } from "./operational-logger";

export function authorizationUnavailableResponse(error: unknown, requestId: string, options?: { details?: unknown }) {
  if (!(error instanceof AuthIdentityLookupError) && !(error instanceof TenantContextLookupError)) return null;
  createOperationalLogger("autorizacion.http", { correlationId: requestId })
    .warn("autorizacion.no_disponible", { codigo: error.code });
  return apiErrorResponse({
    code: API_ERROR_CODE.dependencyUnavailable,
    details: options?.details,
    message: "No se pudo verificar temporalmente el acceso. Intenta de nuevo.",
    requestId,
    retryable: true,
    status: 503,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
