import { z } from "zod";
import { completeAuthBridgeLogin } from "@/app/login/auth-bridge";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_LOGIN_REQUEST_BYTES = 4 * 1024;
const loginRequestSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(256),
  rememberMe: z.boolean().optional(),
}).strict();

/**
 * POST /api/auth/login
 *
 * Stable login endpoint for the client.
 * This avoids coupling the browser to a server-action build id,
 * which can break after a fresh deployment if the user still has
 * an older tab open.
 */
export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("auth.login", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(request, loginRequestSchema, MAX_LOGIN_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Datos de acceso inválidos.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const { identifier, password, rememberMe } = parsedRequest.data;

    const result = await completeAuthBridgeLogin(
      identifier,
      password,
      Boolean(rememberMe),
    );

    if ("error" in result) {
      const isInternal = result.error === "Ocurrió un error inesperado";
      return apiErrorResponse({
        code: isInternal ? API_ERROR_CODE.internalError : API_ERROR_CODE.invalidRequest,
        message: result.error,
        requestId,
        retryable: isInternal,
        status: isInternal ? 500 : 400,
      });
    }

    return apiSuccessResponse(result, { requestId });
  } catch (error: unknown) {
    logger.error("auth.login.failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Ocurrió un error inesperado", requestId, retryable: true, status: 500 });
  }
}
