import { NextResponse } from "next/server";
import {
  createApiErrorBody,
  type ApiErrorCode,
} from "./api-contract";

function responseHeaders(requestId: string, headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set("x-request-id", requestId);
  return result;
}

export function apiErrorResponse(input: {
  code: ApiErrorCode;
  details?: unknown;
  extensions?: Record<string, unknown>;
  headers?: HeadersInit;
  message: string;
  requestId: string;
  retryable?: boolean;
  status: number;
}) {
  return NextResponse.json({
    ...input.extensions,
    ...createApiErrorBody(input),
  }, {
    status: input.status,
    headers: responseHeaders(input.requestId, input.headers),
  });
}

export function apiSuccessResponse<T extends object>(
  data: T,
  input: {
    headers?: HeadersInit;
    requestId: string;
    status?: number;
  },
) {
  return NextResponse.json(
    {
      success: true,
      ...data,
      correlationId: input.requestId,
      requestId: input.requestId,
    },
    {
      status: input.status ?? 200,
      headers: responseHeaders(input.requestId, input.headers),
    },
  );
}
