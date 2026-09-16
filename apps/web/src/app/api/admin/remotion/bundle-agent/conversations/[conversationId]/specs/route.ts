import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import { BundleAgentWorkflowService } from "@/domains/production/bundle-agent/workflow.service";
import {
  BUNDLE_AGENT_SPEC_REQUEST_BYTES,
  bundleAgentConversationIdSchema,
  bundleAgentRouteErrorResponse,
  createBundleAgentSpecRequestSchema,
} from "@/domains/production/bundle-agent/route-contract";
import { API_ERROR_CODE, parseJsonRequestOptional } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const conversationId = bundleAgentConversationIdSchema.parse((await context.params).conversationId);
    const parsed = await parseJsonRequestOptional(
      request,
      createBundleAgentSpecRequestSchema,
      BUNDLE_AGENT_SPEC_REQUEST_BYTES,
    );
    if (!parsed.success) {
      return apiErrorResponse({
        code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsed.reason === "too_large"
          ? "La solicitud excede el tamaño permitido."
          : "Payload inválido para crear la especificación.",
        requestId,
        status: parsed.reason === "too_large" ? 413 : 400,
      });
    }
    const body = parsed.data ?? {};
    const authContext = await resolveBundleAgentAuthContext();
    const service = new BundleAgentWorkflowService(authContext);
    const spec = await service.createSpec(conversationId, body?.overrides, body?.artifactKind);

    return apiSuccessResponse({ spec }, { requestId, status: 201 });
  } catch (error) {
    return bundleAgentRouteErrorResponse({
      component: "admin.bundle-agent.specs.create",
      error,
      requestId,
    });
  }
}
