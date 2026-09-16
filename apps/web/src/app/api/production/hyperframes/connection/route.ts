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
import { HyperframesConnectionService } from "@/domains/production/hyperframes/hyperframes-connection.service";
import {
  configureHeygenHyperframesWebhook,
  disconnectHeygenHyperframesWebhook,
} from "@/domains/production/providers/heygen/heygen-webhook.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HYPERFRAMES_CONNECTION_REQUEST_BYTES = 4 * 1024;

const connectionRequestSchema = z.object({ apiKey: z.string().trim().min(12).max(500) }).strict();

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.connection", { correlationId: requestId });
  try {
    const context = await resolveAuthorizedContext("consultar", requestId);
    if (context.response) return context.response;
    const service = new HyperframesConnectionService(getServiceRoleClient());
    const status = await service.getStatus(context.tenant.organizationId);
    return apiSuccessResponse({ data: status }, { requestId });
  } catch (error) {
    logger.error("production.hyperframes.connection.read_failed", error);
    return unexpected(requestId);
  }
}

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.connection", { correlationId: requestId });
  try {
    const parsed = await parseJsonRequest(request, connectionRequestSchema, MAX_HYPERFRAMES_CONNECTION_REQUEST_BYTES);
    if (!parsed.success) {
      return apiErrorResponse({
        code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Ingresa una API key de HyperFrames Cloud válida.",
        requestId,
        status: parsed.reason === "too_large" ? 413 : 400,
      });
    }
    const payload = parsed.data;
    const context = await resolveAuthorizedContext("configurar", requestId);
    if (context.response) return context.response;
    const admin = getServiceRoleClient();
    const service = new HyperframesConnectionService(admin);
    const credentials = new ProductionProviderCredentialsService({ supabase: admin });
    const previous = await credentials.getDecryptedSecret({
      organizationId: context.tenant.organizationId,
      provider: "hyperframes_cloud",
    });
    const status = await service.saveApiKey({
      apiKey: payload.apiKey,
      createdBy: context.user.userId,
      organizationId: context.tenant.organizationId,
    });
    await configureHeygenHyperframesWebhook({
      apiKey: payload.apiKey,
      organizationId: context.tenant.organizationId,
      previousApiKey: previous?.secret,
      supabase: admin,
    });
    return apiSuccessResponse({ data: status }, { requestId });
  } catch (error) {
    if (error instanceof ProductionProviderCredentialError) {
      return apiErrorResponse({ code: error.status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest, details: { providerCode: error.code }, message: error.message, requestId, status: error.status });
    }
    logger.error("production.hyperframes.connection.save_failed", error);
    return unexpected(requestId);
  }
}

export async function DELETE(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.connection", { correlationId: requestId });
  try {
    const context = await resolveAuthorizedContext("desconectar", requestId);
    if (context.response) return context.response;
    const admin = getServiceRoleClient();
    const service = new ProductionProviderCredentialsService({ supabase: admin });
    const credential = await service.getDecryptedSecret({
      organizationId: context.tenant.organizationId,
      provider: "hyperframes_cloud",
    });
    const avatarStatus = await service.getCredentialStatus({
      organizationId: context.tenant.organizationId,
      provider: "heygen_avatar",
    });
    if (credential?.secret && !avatarStatus.connected) {
      await disconnectHeygenHyperframesWebhook({
        apiKey: credential.secret,
        organizationId: context.tenant.organizationId,
        supabase: admin,
      });
    } else if (!avatarStatus.connected) {
      const { error } = await admin.rpc("clear_heygen_webhook", {
        p_organization_id: context.tenant.organizationId,
      });
      if (error) throw error;
    }
    const status = await service.revokeCredential({
      organizationId: context.tenant.organizationId,
      provider: "hyperframes_cloud",
    });
    return apiSuccessResponse({ data: status }, { requestId });
  } catch (error) {
    logger.error("production.hyperframes.connection.disconnect_failed", error);
    return unexpected(requestId);
  }
}

async function resolveAuthorizedContext(action: string, requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }), tenant: null as never, user: null as never };
  if (!(await canReviewContent(user.userId))) {
    return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: `No tienes permisos para ${action} HyperFrames Cloud.`, requestId, status: 403 }), tenant: null as never, user };
  }
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }), tenant: null as never, user };
  return { response: null, tenant, user };
}

function unexpected(requestId: string) {
  return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo gestionar la conexión de HyperFrames Cloud.", requestId, retryable: true, status: 500 });
}
