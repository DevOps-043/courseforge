import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import { BundleAgentWorkflowService } from "@/domains/production/bundle-agent/workflow.service";
import {
  BUNDLE_AGENT_SMALL_REQUEST_BYTES,
  bundleAgentConversationIdSchema,
  bundleAgentRouteErrorResponse,
  generateBundleAgentVersionRequestSchema,
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
      generateBundleAgentVersionRequestSchema,
      BUNDLE_AGENT_SMALL_REQUEST_BYTES,
    );
    if (!parsed.success) {
      return apiErrorResponse({
        code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsed.reason === "too_large"
          ? "La solicitud excede el tamaño permitido."
          : "Payload inválido para generar la versión.",
        requestId,
        status: parsed.reason === "too_large" ? 413 : 400,
      });
    }
    const body = parsed.data ?? {};
    const authContext = await resolveBundleAgentAuthContext();
    const service = new BundleAgentWorkflowService(authContext);
    const result = await service.generateVersion(conversationId, {
      artifactKind: body?.artifactKind === "slide_template" ? "slide_template" : "video_bundle",
      specId: typeof body?.specId === "string" ? body.specId : null,
    });

    return apiSuccessResponse(result, { requestId, status: 201 });
  } catch (error) {
    return bundleAgentRouteErrorResponse({
      component: "admin.bundle-agent.generate",
      error,
      requestId,
    });
  }
}
