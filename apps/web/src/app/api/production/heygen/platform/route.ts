import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import { getHeygenClientForOrganization, HeygenCredentialResolverError } from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { HeygenPlatformService, HeygenPlatformServiceError } from "@/domains/production/providers/heygen/heygen-platform.service";
import { heygenAudioSearchSchema, heygenPlatformActionSchema, heygenWorkspaceSettingsSchema } from "@/domains/production/providers/heygen/heygen-platform.validators";
import { API_ERROR_CODE, parseJsonRequest, type ApiErrorCode } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HEYGEN_PLATFORM_REQUEST_BYTES = 256 * 1024;

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.platform", { correlationId: requestId });
  try {
    const context = await authorize(requestId);
    if (context.response) return context.response;
    const service = await buildService(context.tenant.organizationId);
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource") || "dashboard";
    if (resource === "operation") {
      const operationId = z.string().uuid().parse(url.searchParams.get("operationId"));
      const data = await service.refreshOperation({ operationId, organizationId: context.tenant.organizationId });
      return apiSuccessResponse({ data }, { requestId });
    }
    if (resource === "audio-search") {
      const query = heygenAudioSearchSchema.parse({
        limit: Number(url.searchParams.get("limit") || 20),
        query: url.searchParams.get("query"),
        type: url.searchParams.get("type") || "music",
      });
      const data = await service.searchAudio(query);
      return apiSuccessResponse({ data }, { requestId });
    }
    const data = await service.getDashboard(context.tenant.organizationId);
    return apiSuccessResponse({ data }, { requestId });
  } catch (error) {
    return handleError(error, "consultar la plataforma HeyGen", requestId, logger);
  }
}

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.platform", { correlationId: requestId });
  try {
    const context = await authorize(requestId);
    if (context.response) return context.response;
    const parsedRequest = await parseJsonRequest(request, heygenPlatformActionSchema, MAX_HEYGEN_PLATFORM_REQUEST_BYTES);
    if (!parsedRequest.success) return invalidBodyResponse(parsedRequest.reason, requestId);
    const action = parsedRequest.data;
    const service = await buildService(context.tenant.organizationId);
    const data = await service.submit({
      action,
      createdBy: context.user.userId,
      organizationId: context.tenant.organizationId,
    });
    return apiSuccessResponse({ data }, { requestId, status: 202 });
  } catch (error) {
    return handleError(error, "iniciar la operación HeyGen", requestId, logger);
  }
}

export async function PATCH(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.platform", { correlationId: requestId });
  try {
    const context = await authorize(requestId);
    if (context.response) return context.response;
    const parsedRequest = await parseJsonRequest(request, heygenWorkspaceSettingsSchema, MAX_HEYGEN_PLATFORM_REQUEST_BYTES);
    if (!parsedRequest.success) return invalidBodyResponse(parsedRequest.reason, requestId);
    const settings = parsedRequest.data;
    const service = await buildService(context.tenant.organizationId);
    const data = await service.updateSettings(context.tenant.organizationId, settings);
    return apiSuccessResponse({ data }, { requestId });
  } catch (error) {
    return handleError(error, "guardar la configuración HeyGen", requestId, logger);
  }
}

async function authorize(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }), tenant: null as never, user: null as never };
  if (!(await canReviewContent(user.userId))) {
    return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para administrar HeyGen.", requestId, status: 403 }), tenant: null as never, user };
  }
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }), tenant: null as never, user };
  return { response: null, tenant, user };
}

async function buildService(organizationId: string) {
  const admin = getServiceRoleClient();
  const auth = await getHeygenClientForOrganization({
    allowGlobalFallback: false,
    organizationId,
    supabase: admin,
  });
  return new HeygenPlatformService(admin, auth.client);
}

function handleError(
  error: unknown,
  action: string,
  requestId: string,
  logger: ReturnType<typeof createOperationalLogger>,
) {
  if (error instanceof z.ZodError) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: error.issues[0]?.message || "Solicitud HeyGen inválida.", requestId, status: 400 });
  }
  if (error instanceof HeygenPlatformServiceError || error instanceof HeygenCredentialResolverError) {
    return apiErrorResponse({
      code: mapDomainStatus(error.status),
      details: { providerCode: error.code },
      message: error.message,
      requestId,
      retryable: error.status === 429 || error.status >= 500,
      status: error.status,
    });
  }
  if (error instanceof HeygenApiError) {
    const rateLimited = error.status === 429;
    return apiErrorResponse({
      code: rateLimited ? API_ERROR_CODE.rateLimited : API_ERROR_CODE.providerError,
      details: { providerCode: error.providerCode || null },
      headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined,
      message: rateLimited ? "HeyGen alcanzó temporalmente su límite de solicitudes." : `HeyGen no pudo ${action}.`,
      requestId,
      retryable: rateLimited || error.status >= 500,
      status: rateLimited ? 429 : 502,
    });
  }
  logger.error("production.heygen.platform.request_failed", error, { action });
  return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: `No se pudo ${action}.`, requestId, retryable: true, status: 500 });
}

function invalidBodyResponse(reason: "invalid" | "too_large", requestId: string) {
  return apiErrorResponse({
    code: reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
    message: reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Solicitud HeyGen inválida.",
    requestId,
    status: reason === "too_large" ? 413 : 400,
  });
}

function mapDomainStatus(status: number): ApiErrorCode {
  if (status === 403) return API_ERROR_CODE.roleForbidden;
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409) return API_ERROR_CODE.conflict;
  if (status === 429) return API_ERROR_CODE.rateLimited;
  if (status >= 500) return API_ERROR_CODE.internalError;
  return API_ERROR_CODE.invalidRequest;
}
