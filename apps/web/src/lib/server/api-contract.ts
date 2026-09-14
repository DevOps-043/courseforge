import type { z } from "zod";

export const API_ERROR_CODE = {
  authRequired: "AUTH_REQUIRED",
  conflict: "CONFLICT",
  dependencyUnavailable: "DEPENDENCY_UNAVAILABLE",
  internalError: "INTERNAL_ERROR",
  invalidRequest: "INVALID_REQUEST",
  payloadTooLarge: "PAYLOAD_TOO_LARGE",
  providerError: "PROVIDER_ERROR",
  rateLimited: "RATE_LIMITED",
  resourceNotFound: "RESOURCE_NOT_FOUND",
  roleForbidden: "ROLE_FORBIDDEN",
  tenantForbidden: "TENANT_FORBIDDEN",
  unsupportedMediaType: "UNSUPPORTED_MEDIA_TYPE",
} as const;

export type ApiErrorCode = typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE];

export interface ApiErrorBody {
  code: ApiErrorCode;
  correlationId: string;
  error: string;
  message: string;
  requestId: string;
  retryable: boolean;
  success: false;
  details?: unknown;
}

export function createApiErrorBody(input: {
  code: ApiErrorCode;
  details?: unknown;
  message: string;
  requestId: string;
  retryable?: boolean;
}): ApiErrorBody {
  return {
    code: input.code,
    correlationId: input.requestId,
    error: input.message,
    message: input.message,
    requestId: input.requestId,
    retryable: input.retryable ?? false,
    success: false,
    ...(input.details === undefined ? {} : { details: input.details }),
  };
}

export type ParsedJsonRequest<T> =
  | { data: T; success: true }
  | { reason: "invalid" | "too_large"; success: false };

export async function parseJsonRequest<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes: number,
): Promise<ParsedJsonRequest<T>> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      return { reason: "too_large", success: false };
    }
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return { reason: "invalid", success: false };
  }
  if (new TextEncoder().encode(rawBody).byteLength > maxBytes) {
    return { reason: "too_large", success: false };
  }

  try {
    const parsed = schema.safeParse(JSON.parse(rawBody));
    return parsed.success
      ? { data: parsed.data, success: true }
      : { reason: "invalid", success: false };
  } catch {
    return { reason: "invalid", success: false };
  }
}

export async function parseJsonRequestOptional<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes: number,
): Promise<ParsedJsonRequest<T | null>> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      return { reason: "too_large", success: false };
    }
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return { reason: "invalid", success: false };
  }
  if (new TextEncoder().encode(rawBody).byteLength > maxBytes) {
    return { reason: "too_large", success: false };
  }
  if (!rawBody.trim()) return { data: null, success: true };

  try {
    const parsed = schema.safeParse(JSON.parse(rawBody));
    return parsed.success
      ? { data: parsed.data, success: true }
      : { reason: "invalid", success: false };
  } catch {
    return { reason: "invalid", success: false };
  }
}
