import { BundleAgentConversationService } from "@/domains/production/bundle-agent/conversation.service";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import {
  BUNDLE_AGENT_SMALL_REQUEST_BYTES,
  bundleAgentRouteErrorResponse,
  createBundleAgentConversationRequestSchema,
} from "@/domains/production/bundle-agent/route-contract";
import { API_ERROR_CODE, parseJsonRequestOptional } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { resolveCorrelationId } from "@/lib/server/operational-logger";

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const parsed = await parseJsonRequestOptional(
      request,
      createBundleAgentConversationRequestSchema,
      BUNDLE_AGENT_SMALL_REQUEST_BYTES,
    );
    if (!parsed.success) {
      return apiErrorResponse({
        code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsed.reason === "too_large"
          ? "La solicitud excede el tamaño permitido."
          : "Payload inválido para crear la conversación.",
        requestId,
        status: parsed.reason === "too_large" ? 413 : 400,
      });
    }
    const body = parsed.data ?? {};
    const context = await resolveBundleAgentAuthContext();

    const service = new BundleAgentConversationService(context);
    const conversation = await service.createConversation({
      artifactKind: body?.artifactKind,
      title: typeof body?.title === "string" ? body.title : null,
      templateId: typeof body?.templateId === "string" ? body.templateId : null,
    });

    return apiSuccessResponse({ conversation }, { requestId, status: 201 });
  } catch (error) {
    return bundleAgentRouteErrorResponse({
      component: "admin.bundle-agent.conversations.create",
      error,
      requestId,
    });
  }
}
