import type { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import { API_ERROR_CODE, type ApiErrorCode } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";

export function heygenCredentialErrorResponse(
  error: { code: string; message: string; status: number },
  requestId: string,
) {
  return apiErrorResponse({
    code: error.status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest,
    details: { providerCode: error.code },
    message: error.message,
    requestId,
    status: error.status,
  });
}

export function heygenProviderErrorResponse(input: {
  error: HeygenApiError;
  failureMessage: string;
  hint?: string | null;
  requestId: string;
}) {
  const rateLimited = input.error.status === 429;
  return apiErrorResponse({
    code: rateLimited ? API_ERROR_CODE.rateLimited : API_ERROR_CODE.providerError,
    details: {
      providerCode: input.error.providerCode || null,
      retryAfterSeconds: input.error.retryAfterSeconds || null,
    },
    extensions: input.hint ? { hint: input.hint } : undefined,
    headers: input.error.retryAfterSeconds
      ? { "Retry-After": String(input.error.retryAfterSeconds) }
      : undefined,
    message: rateLimited
      ? "HeyGen alcanzó temporalmente su límite de solicitudes."
      : input.failureMessage,
    requestId: input.requestId,
    retryable: rateLimited || input.error.status >= 500,
    status: rateLimited ? 429 : 502,
  });
}

export function heygenServiceErrorResponse(
  error: { message: string; status: number },
  requestId: string,
) {
  return apiErrorResponse({
    code: mapHeygenServiceStatus(error.status),
    message: error.message,
    requestId,
    retryable: error.status === 429 || error.status >= 500,
    status: error.status,
  });
}

function mapHeygenServiceStatus(status: number): ApiErrorCode {
  if (status === 403) return API_ERROR_CODE.tenantForbidden;
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409) return API_ERROR_CODE.conflict;
  if (status === 429) return API_ERROR_CODE.rateLimited;
  if (status === 503) return API_ERROR_CODE.dependencyUnavailable;
  if (status >= 500) return API_ERROR_CODE.internalError;
  return API_ERROR_CODE.invalidRequest;
}
