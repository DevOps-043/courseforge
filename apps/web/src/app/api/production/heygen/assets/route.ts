import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import { getHeygenClientForOrganization, HeygenCredentialResolverError } from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HEYGEN_ASSET_REQUEST_BYTES = 16 * 1024;

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("prepare"),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    contentType: z.string().trim().min(3).max(150),
    fileName: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().positive().max(5 * 1024 * 1024 * 1024),
  }).strict(),
  z.object({
    action: z.literal("complete"),
    assetId: z.string().trim().min(1).max(255),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  }).strict(),
]);

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.assets", { correlationId: requestId });
  try {
    const context = await authorize(requestId);
    if (context.response) return context.response;
    const client = await resolveClient(context.tenant.organizationId);
    const url = new URL(request.url);
    const query = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50))) });
    const token = url.searchParams.get("token");
    if (token) query.set("token", token);
    const data = await client.platformRequest({ path: `/v3/assets?${query}` });
    return apiSuccessResponse({ data }, { requestId });
  } catch (error) { return handleError(error, requestId, logger); }
}

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.assets", { correlationId: requestId });
  try {
    const context = await authorize(requestId);
    if (context.response) return context.response;
    const parsedRequest = await parseJsonRequest(request, requestSchema, MAX_HEYGEN_ASSET_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Solicitud de asset inválida.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const payload = parsedRequest.data;
    const client = await resolveClient(context.tenant.organizationId);
    const data = payload.action === "prepare"
      ? await client.platformRequest({
          body: {
            checksum_sha256: payload.checksumSha256,
            content_type: payload.contentType,
            filename: payload.fileName,
            size_bytes: payload.sizeBytes,
          },
          idempotencyKey: crypto.randomUUID(),
          method: "POST",
          path: "/v3/assets/direct-uploads",
        })
      : await client.platformRequest({
          body: { checksum_sha256: payload.checksumSha256 },
          method: "POST",
          path: `/v3/assets/${encodeURIComponent(payload.assetId)}/complete`,
        });
    return apiSuccessResponse({ data }, { requestId });
  } catch (error) { return handleError(error, requestId, logger); }
}

async function authorize(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }), tenant: null as never };
  if (!(await canReviewContent(user.userId))) return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para administrar assets HeyGen.", requestId, status: 403 }), tenant: null as never };
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }), tenant: null as never };
  return { response: null, tenant };
}

async function resolveClient(organizationId: string) {
  return (await getHeygenClientForOrganization({
    allowGlobalFallback: false,
    organizationId,
    supabase: getServiceRoleClient(),
  })).client;
}

function handleError(
  error: unknown,
  requestId: string,
  logger: ReturnType<typeof createOperationalLogger>,
) {
  if (error instanceof HeygenCredentialResolverError) {
    return apiErrorResponse({ code: error.status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest, details: { providerCode: error.code }, message: error.message, requestId, status: error.status });
  }
  if (error instanceof HeygenApiError) {
    const rateLimited = error.status === 429;
    return apiErrorResponse({
      code: rateLimited ? API_ERROR_CODE.rateLimited : API_ERROR_CODE.providerError,
      details: { providerCode: error.providerCode || null },
      headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined,
      message: rateLimited ? "HeyGen alcanzó temporalmente su límite de solicitudes." : "HeyGen no pudo gestionar el asset.",
      requestId,
      retryable: rateLimited || error.status >= 500,
      status: rateLimited ? 429 : 502,
    });
  }
  logger.error("production.heygen.assets.request_failed", error);
  return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo gestionar el asset HeyGen.", requestId, retryable: true, status: 500 });
}
