import { BundleAgentConversationService } from "@/domains/production/bundle-agent/conversation.service";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import {
  addBundleAgentMessageRequestSchema,
  BUNDLE_AGENT_MESSAGE_REQUEST_BYTES,
  bundleAgentConversationIdSchema,
  bundleAgentRouteErrorResponse,
} from "@/domains/production/bundle-agent/route-contract";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const conversationId = bundleAgentConversationIdSchema.parse((await context.params).conversationId);
    const parsed = await parseJsonRequest(
      request,
      addBundleAgentMessageRequestSchema,
      BUNDLE_AGENT_MESSAGE_REQUEST_BYTES,
    );
    if (!parsed.success) {
      return apiErrorResponse({
        code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsed.reason === "too_large"
          ? "La solicitud excede el tamaño permitido."
          : "Payload inválido para agregar el mensaje.",
        requestId,
        status: parsed.reason === "too_large" ? 413 : 400,
      });
    }
    const authContext = await resolveBundleAgentAuthContext();
    const service = new BundleAgentConversationService(authContext);
    const message = await service.addMessage({
      conversationId,
      role: parsed.data.role,
      content: parsed.data.content,
      metadata: parsed.data.metadata,
    });

    return apiSuccessResponse({ message }, { requestId, status: 201 });
  } catch (error) {
    return bundleAgentRouteErrorResponse({
      component: "admin.bundle-agent.messages.create",
      error,
      requestId,
    });
  }
}
