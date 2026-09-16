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
import { createClient } from "@/utils/supabase/server";
import {
  configureHeygenWebhook,
  disconnectHeygenWebhook,
} from "@/domains/production/providers/heygen/heygen-webhook.service";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HEYGEN_CONNECTION_REQUEST_BYTES = 4 * 1024;

const heygenConnectionRequestSchema = z
  .object({
    apiKey: z.string().trim().min(12).max(500),
  })
  .strict();

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.connection", { correlationId: requestId });
  try {
    const context = await resolveAuthorizedConnectionContext("consultar", requestId);
    if (context.response) return context.response;

    const service = new ProductionProviderCredentialsService({
      supabase: getServiceRoleClient(),
    });
    const status = await service.getCredentialStatus({
      organizationId: context.tenant.organizationId,
      provider: "heygen_avatar",
    });

    return apiSuccessResponse({ data: status }, { requestId });
  } catch (error) {
    logger.error("production.heygen.connection.read_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo consultar la conexion HeyGen.", requestId, retryable: true, status: 500 });
  }
}

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.connection", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(request, heygenConnectionRequestSchema, MAX_HEYGEN_CONNECTION_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Ingresa una API key de HeyGen valida.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const payload = parsedRequest.data;
    const context = await resolveAuthorizedConnectionContext("configurar", requestId);
    if (context.response) return context.response;

    const admin = getServiceRoleClient();
    const service = new ProductionProviderCredentialsService({ supabase: admin });
    const previous = await service.getDecryptedSecret({
      organizationId: context.tenant.organizationId,
      provider: "heygen_avatar",
    });
    const status = await service.upsertHeygenAvatarApiKey({
      apiKey: payload.apiKey,
      createdBy: context.user.userId,
      organizationId: context.tenant.organizationId,
    });
    await configureHeygenWebhook({
      apiKey: payload.apiKey,
      organizationId: context.tenant.organizationId,
      previousApiKey: previous?.secret,
      supabase: admin,
    });

    return apiSuccessResponse({ data: status }, { requestId });
  } catch (error) {
    if (error instanceof ProductionProviderCredentialError) {
      return apiErrorResponse({
        code: error.status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest,
        details: { providerCode: error.code },
        message: error.message,
        requestId,
        status: error.status,
      });
    }

    logger.error("production.heygen.connection.save_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo guardar la conexion HeyGen.", requestId, retryable: true, status: 500 });
  }
}

export async function DELETE(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.connection", { correlationId: requestId });
  try {
    const context = await resolveAuthorizedConnectionContext("desconectar", requestId);
    if (context.response) return context.response;

    const admin = getServiceRoleClient();
    const service = new ProductionProviderCredentialsService({ supabase: admin });
    const [credential, hyperframes] = await Promise.all([
      service.getDecryptedSecret({
        organizationId: context.tenant.organizationId,
        provider: "heygen_avatar",
      }),
      service.getCredentialStatus({
        organizationId: context.tenant.organizationId,
        provider: "hyperframes_cloud",
      }),
    ]);
    if (credential?.secret && !hyperframes.connected) {
      await disconnectHeygenWebhook({
        apiKey: credential.secret,
        organizationId: context.tenant.organizationId,
        supabase: admin,
      });
    }
    const status = await service.revokeCredential({
      organizationId: context.tenant.organizationId,
      provider: "heygen_avatar",
    });

    return apiSuccessResponse({ data: status }, { requestId });
  } catch (error) {
    logger.error("production.heygen.connection.disconnect_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo desconectar HeyGen.", requestId, retryable: true, status: 500 });
  }
}

async function resolveAuthorizedConnectionContext(action: string, requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) {
    return {
      response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }),
      tenant: null as never,
      user: null as never,
    };
  }

  const canReview = await canReviewContent(user.userId);
  if (!canReview) {
    return {
      response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: `No tienes permisos para ${action} HeyGen.`, requestId, status: 403 }),
      tenant: null as never,
      user,
    };
  }

  const tenant = await resolveActiveTenantContext();
  if (!tenant) {
    return {
      response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada.", requestId, status: 403 }),
      tenant: null as never,
      user,
    };
  }

  return { response: null, tenant, user };
}
