import { resolveAuthorizedRenderContext } from "../../_render-route-support";
import { z } from "zod";
import {
  HyperframesCloudApiError,
} from "@/domains/production/hyperframes/hyperframes-cloud.client";
import {
  getHyperframesClientForOrganization,
  HyperframesCredentialResolverError,
} from "@/domains/production/hyperframes/hyperframes-credential-resolver.service";
import {
  HyperframesRenderPollingError,
  HyperframesRenderPollingService,
} from "@/domains/production/hyperframes/hyperframes-render-polling.service";
import { HyperframesRenderRecoveryService } from "@/domains/production/hyperframes/hyperframes-render-recovery.service";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext {
  params: Promise<{ requestId: string }>;
}

const requestIdSchema = z.string().uuid();

/** Returns tenant-scoped durable state without exposing the service-role key. */
export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.render.poll", { correlationId: requestId });
  try {
    const { requestId: rawRenderRequestId } = await context.params;
    const renderRequestId = requestIdSchema.parse(rawRenderRequestId);
    const authorized = await resolveAuthorizedRenderContext(requestId);
    if (authorized.response) return authorized.response;

    const service = new HyperframesRenderRecoveryService(authorized.admin);
    const result = await service.findById({
      organizationId: authorized.organizationId,
      requestId: renderRequestId,
    });
    if (!result) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Render HyperFrames no encontrado para esta empresa.", requestId, status: 404 });
    }
    return apiSuccessResponse({ data: result }, { headers: { "Cache-Control": "private, no-store" }, requestId });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de render inválido.", requestId, status: 400 });
    }
    logger.error("production.hyperframes.render.recovery_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno al consultar el estado durable del render.", requestId, retryable: true, status: 500 });
  }
}

/**
 * Optional user-triggered reconciliation nudge. Webhooks and scheduled Edge
 * workers own durable tracking even when no browser is open.
 */
export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.render.poll", { correlationId: requestId });
  try {
    const { requestId: rawRenderRequestId } = await context.params;
    const renderRequestId = requestIdSchema.parse(rawRenderRequestId);
    const authorized = await resolveAuthorizedRenderContext(requestId);
    if (authorized.response) return authorized.response;
    const hyperframesAuth = await getHyperframesClientForOrganization({
      allowGlobalFallback: false,
      organizationId: authorized.organizationId,
      supabase: authorized.admin,
    });
    const service = new HyperframesRenderPollingService(
      authorized.admin,
      hyperframesAuth.client,
    );
    const result = await service.poll({
      organizationId: authorized.organizationId,
      requestId: renderRequestId,
    });

    return apiSuccessResponse({ data: result }, { requestId });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de render inválido.", requestId, status: 400 });
    }
    if (error instanceof HyperframesRenderPollingError) {
      return apiErrorResponse({ code: mapStatusToErrorCode(error.status), message: error.message, requestId, status: error.status });
    }
    if (error instanceof HyperframesCredentialResolverError) {
      return apiErrorResponse({ code: mapStatusToErrorCode(error.status), details: { providerCode: error.code }, message: error.message, requestId, status: error.status });
    }
    if (error instanceof HyperframesCloudApiError) {
      const status = error.status === 429 ? 429 : 502;
      return apiErrorResponse({ code: status === 429 ? API_ERROR_CODE.rateLimited : API_ERROR_CODE.providerError, message: "No se pudo consultar el render en la nube.", requestId, retryable: true, status });
    }

    logger.error("production.hyperframes.render.poll_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno al consultar el render de video.", requestId, retryable: true, status: 500 });
  }
}

function mapStatusToErrorCode(status: number) {
  if (status === 400 || status === 422) return API_ERROR_CODE.invalidRequest;
  if (status === 403) return API_ERROR_CODE.roleForbidden;
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409) return API_ERROR_CODE.conflict;
  return API_ERROR_CODE.internalError;
}
