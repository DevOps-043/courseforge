import { z } from "zod";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { sanitizeErrorMessage } from "./redaction.service";
export * from "./request-contract";

export function bundleAgentRouteErrorResponse(input: {
  component: string;
  error: unknown;
  requestId: string;
}) {
  const message = sanitizeErrorMessage(input.error);
  if (input.error instanceof z.ZodError) {
    return apiErrorResponse({
      code: API_ERROR_CODE.invalidRequest,
      message: "La solicitud contiene identificadores o datos inválidos.",
      requestId: input.requestId,
      status: 400,
    });
  }
  if (message.includes("No autorizado")) {
    return apiErrorResponse({
      code: API_ERROR_CODE.authRequired,
      message: "No autorizado.",
      requestId: input.requestId,
      status: 401,
    });
  }
  if (message.includes("organizacion activa")) {
    return apiErrorResponse({
      code: API_ERROR_CODE.tenantForbidden,
      message: "No se encontró una organización activa.",
      requestId: input.requestId,
      status: 403,
    });
  }
  if (message.toLowerCase().includes("no encontrada")) {
    return apiErrorResponse({
      code: API_ERROR_CODE.resourceNotFound,
      message,
      requestId: input.requestId,
      status: 404,
    });
  }
  if (message.includes("limite")) {
    return apiErrorResponse({
      code: API_ERROR_CODE.rateLimited,
      headers: { "Retry-After": "60" },
      message,
      requestId: input.requestId,
      retryable: true,
      status: 429,
    });
  }
  if (
    message.includes("debe tener entre")
    || message.includes("No hay spec disponible")
    || message.includes("coincide visualmente")
  ) {
    return apiErrorResponse({
      code: API_ERROR_CODE.invalidRequest,
      message,
      requestId: input.requestId,
      status: 400,
    });
  }

  createOperationalLogger(input.component, { correlationId: input.requestId })
    .error("bundle_agent.request_failed", input.error);
  return apiErrorResponse({
    code: API_ERROR_CODE.internalError,
    message: "No se pudo completar la operación de Bundle Agent.",
    requestId: input.requestId,
    retryable: true,
    status: 500,
  });
}
