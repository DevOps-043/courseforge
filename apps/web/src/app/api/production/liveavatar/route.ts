import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  ProductionProviderCredentialError,
  ProductionProviderCredentialsService,
} from "@/domains/production/providers/credentials/provider-credentials.service";
import {
  LiveAvatarApiError,
  LiveAvatarClient,
} from "@/domains/production/providers/liveavatar/liveavatar.client";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest, type ApiErrorCode } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_LIVEAVATAR_REQUEST_BYTES = 8 * 1024;

const connectionSchema = z.object({
  action: z.literal("connect"),
  apiKey: z.string().trim().min(12).max(500),
}).strict();

const embeddingSchema = z.object({
  action: z.literal("create_embedding"),
  avatarId: z.string().trim().min(1).max(255),
  contextId: z.string().trim().min(1).max(255),
  isSandbox: z.boolean().default(true),
}).strict();

const requestSchema = z.discriminatedUnion("action", [connectionSchema, embeddingSchema]);

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.liveavatar", { correlationId: requestId });
  try {
    const context = await authorize(requestId);
    if (context.response) return context.response;
    const credentials = new ProductionProviderCredentialsService({ supabase: getServiceRoleClient() });
    const status = await credentials.getCredentialStatus({
      organizationId: context.tenant.organizationId,
      provider: "liveavatar",
    });
    if (!status.connected) {
      return apiSuccessResponse({ data: { status, avatars: [], contexts: [], credits: null } }, { requestId });
    }
    const secret = await credentials.getDecryptedSecret({
      organizationId: context.tenant.organizationId,
      provider: "liveavatar",
    });
    if (!secret?.secret) throw new Error("La credencial LiveAvatar no está disponible.");
    const client = new LiveAvatarClient(secret.secret);
    const [credits, avatars, publicAvatars, contexts] = await Promise.all([
      client.getCredits(),
      client.listAvatars(),
      client.listPublicAvatars(),
      client.listContexts(),
    ]);
    return apiSuccessResponse({
      data: { avatars, contexts, credits, publicAvatars, status },
    }, { requestId });
  } catch (error) {
    return handleError(error, "consultar LiveAvatar", requestId, logger);
  }
}

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.liveavatar", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(request, requestSchema, MAX_LIVEAVATAR_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Solicitud LiveAvatar inválida.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const context = await authorize(requestId);
    if (context.response) return context.response;
    const payload = parsedRequest.data;
    const admin = getServiceRoleClient();
    const credentials = new ProductionProviderCredentialsService({ supabase: admin });

    if (payload.action === "connect") {
      const client = new LiveAvatarClient(payload.apiKey);
      const credits = await client.getCredits();
      const status = await credentials.upsertValidatedSecret({
        createdBy: context.user.userId,
        metadata: { validation_provider: "liveavatar" },
        organizationId: context.tenant.organizationId,
        provider: "liveavatar",
        secret: payload.apiKey.trim(),
      });
      return apiSuccessResponse({ data: { credits, status } }, { requestId });
    }

    const secret = await credentials.getDecryptedSecret({
      organizationId: context.tenant.organizationId,
      provider: "liveavatar",
    });
    if (!secret?.secret) {
      return apiErrorResponse({ code: API_ERROR_CODE.conflict, message: "Conecta LiveAvatar antes de crear un embed.", requestId, status: 409 });
    }
    const embedding = await new LiveAvatarClient(secret.secret).createEmbedding(payload);
    const { error: settingsError } = await admin.from("heygen_workspace_settings").upsert({
      liveavatar_avatar_id: payload.avatarId,
      liveavatar_context_id: payload.contextId,
      liveavatar_sandbox: payload.isSandbox,
      organization_id: context.tenant.organizationId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id" });
    if (settingsError) throw settingsError;
    return apiSuccessResponse({ data: embedding }, { requestId, status: 201 });
  } catch (error) {
    return handleError(error, "configurar LiveAvatar", requestId, logger);
  }
}

export async function DELETE(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.liveavatar", { correlationId: requestId });
  try {
    const context = await authorize(requestId);
    if (context.response) return context.response;
    const credentials = new ProductionProviderCredentialsService({ supabase: getServiceRoleClient() });
    const status = await credentials.revokeCredential({
      organizationId: context.tenant.organizationId,
      provider: "liveavatar",
    });
    return apiSuccessResponse({ data: status }, { requestId });
  } catch (error) {
    return handleError(error, "desconectar LiveAvatar", requestId, logger);
  }
}

async function authorize(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }), tenant: null as never, user: null as never };
  if (!(await canReviewContent(user.userId))) {
    return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para administrar LiveAvatar.", requestId, status: 403 }), tenant: null as never, user };
  }
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }), tenant: null as never, user };
  return { response: null, tenant, user };
}

function handleError(error: unknown, action: string, requestId: string, logger: ReturnType<typeof createOperationalLogger>) {
  if (error instanceof z.ZodError) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: error.issues[0]?.message || "Solicitud LiveAvatar inválida.", requestId, status: 400 });
  }
  if (error instanceof ProductionProviderCredentialError) {
    return apiErrorResponse({ code: mapStatus(error.status), details: { providerCode: error.code }, message: error.message, requestId, status: error.status });
  }
  if (error instanceof LiveAvatarApiError) {
    const invalidCredential = error.status === 401 || error.status === 403;
    const rateLimited = error.status === 429;
    return apiErrorResponse({
      code: invalidCredential ? API_ERROR_CODE.invalidRequest : rateLimited ? API_ERROR_CODE.rateLimited : API_ERROR_CODE.providerError,
      message: invalidCredential ? "La API key de LiveAvatar no es válida o no tiene permisos." : rateLimited ? "LiveAvatar alcanzó temporalmente su límite de solicitudes." : `LiveAvatar no pudo ${action}.`,
      requestId,
      retryable: rateLimited || error.status >= 500,
      status: invalidCredential ? 400 : rateLimited ? 429 : 502,
    });
  }
  logger.error("production.liveavatar.request_failed", error, { action });
  return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: `No se pudo ${action}.`, requestId, retryable: true, status: 500 });
}

function mapStatus(status: number): ApiErrorCode {
  if (status === 409) return API_ERROR_CODE.conflict;
  if (status >= 500) return API_ERROR_CODE.internalError;
  return API_ERROR_CODE.invalidRequest;
}
