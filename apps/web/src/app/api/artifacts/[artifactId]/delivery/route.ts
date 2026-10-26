import { z } from "zod";
import { deliveryCommandSchema, deliverySnapshot, executeDeliveryCommand } from "@/domains/course-delivery/services/delivery-api";
import { DELIVERY_LIMITS } from "@/domains/course-delivery/config/delivery.config";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { DeliveryAccessError } from "@/domains/course-delivery/services/delivery-access";

type Context = { params: Promise<{ artifactId: string }> };
export async function GET(request: Request, context: Context) { return respond(request, context); }
export async function POST(request: Request, context: Context) { return respond(request, context); }
async function respond(request: Request, context: Context) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const { artifactId } = await context.params;
    if (!z.uuid().safeParse(artifactId).success) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Curso inválido.", requestId, status: 400 });
    if (request.method === "GET") return apiSuccessResponse(await deliverySnapshot(artifactId, new URL(request.url).searchParams.get("progress") !== "1"), { requestId, headers: { "Cache-Control": "no-store" } });
    const parsed = await parseJsonRequest(request, deliveryCommandSchema, DELIVERY_LIMITS.requestBytes);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: "Solicitud de impartición inválida.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    return apiSuccessResponse(await executeDeliveryCommand(artifactId, parsed.data), { requestId, status: parsed.data.action === "GENERATE" || parsed.data.action === "RESUME" ? 202 : 200 });
  } catch (error) {
    createOperationalLogger("imparticion.api", { requestId }).warn("solicitud_rechazada", { name: error instanceof Error ? error.name : "Error" });
    const message = error instanceof Error && !error.name.includes("Zod") ? error.message : "Los campos no cumplen el contrato de impartición.";
    const status = error instanceof DeliveryAccessError ? error.status : error instanceof z.ZodError ? 400 : 409;
    const code = status === 400 ? API_ERROR_CODE.invalidRequest : status === 401 ? API_ERROR_CODE.authRequired : status === 404 ? API_ERROR_CODE.resourceNotFound : status === 403 ? API_ERROR_CODE.roleForbidden : API_ERROR_CODE.conflict;
    return apiErrorResponse({ code, message, requestId, status });
  }
}
