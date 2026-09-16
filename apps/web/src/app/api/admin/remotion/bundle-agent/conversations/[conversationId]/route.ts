import { BundleAgentConversationService } from "@/domains/production/bundle-agent/conversation.service";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import {
  BUNDLE_AGENT_SMALL_REQUEST_BYTES,
  bundleAgentConversationIdSchema,
  bundleAgentRouteErrorResponse,
  updateBundleAgentConversationRequestSchema,
} from "@/domains/production/bundle-agent/route-contract";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const conversationId = bundleAgentConversationIdSchema.parse((await context.params).conversationId);
    const authContext = await resolveBundleAgentAuthContext();
    const service = new BundleAgentConversationService(authContext);
    const data = await service.getConversation(conversationId);

    return apiSuccessResponse(data, { requestId });
  } catch (error) {
    return bundleAgentRouteErrorResponse({
      component: "admin.bundle-agent.conversations.get",
      error,
      requestId,
    });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const conversationId = bundleAgentConversationIdSchema.parse((await context.params).conversationId);
    const parsed = await parseJsonRequest(
      request,
      updateBundleAgentConversationRequestSchema,
      BUNDLE_AGENT_SMALL_REQUEST_BYTES,
    );
    if (!parsed.success) {
      return apiErrorResponse({
        code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsed.reason === "too_large"
          ? "La solicitud excede el tamaño permitido."
          : "Payload inválido para actualizar la conversación.",
        requestId,
        status: parsed.reason === "too_large" ? 413 : 400,
      });
    }
    const authContext = await resolveBundleAgentAuthContext();
    const service = new BundleAgentConversationService(authContext);
    const conversation = await service.updateConversation(conversationId, {
      title: parsed.data.title,
    });

    return apiSuccessResponse({ conversation }, { requestId });
  } catch (error) {
    return bundleAgentRouteErrorResponse({
      component: "admin.bundle-agent.conversations.update",
      error,
      requestId,
    });
  }
}
