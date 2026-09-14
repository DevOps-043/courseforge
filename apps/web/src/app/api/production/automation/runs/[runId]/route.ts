import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  ProductionAutomationRunError,
  ProductionAutomationRunService,
} from "@/domains/production/automation/production-automation-run.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const runIdSchema = z.string().uuid();

async function getAuthorizedService(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { error: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) };
  const tenant = await resolveActiveTenantContext();
  if (!tenant || !(await canReviewContent(user.userId, tenant))) {
    return { error: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para consultar producción.", requestId, status: 403 }) };
  }
  return { service: new ProductionAutomationRunService(getServiceRoleClient()), tenant };
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.automation.run", { correlationId: requestId });
  try {
    const authorized = await getAuthorizedService(requestId);
    if ("error" in authorized) return authorized.error;
    const { runId } = await context.params;
    if (!runIdSchema.safeParse(runId).success) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "runId inválido.", requestId, status: 400 });
    const result = await authorized.service.getRun(runId, authorized.tenant.organizationId);
    return apiSuccessResponse({ data: result }, { requestId, headers: { "Cache-Control": "private, no-store" } });
  } catch (error: unknown) {
    return respond(error, requestId, logger);
  }
}

/** Re-evaluates persisted assets; it does not enqueue, compose, or render media. */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.automation.run", { correlationId: requestId });
  try {
    const authorized = await getAuthorizedService(requestId);
    if ("error" in authorized) return authorized.error;
    const { runId } = await context.params;
    if (!runIdSchema.safeParse(runId).success) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "runId inválido.", requestId, status: 400 });
    const result = await authorized.service.refreshRun(runId, authorized.tenant.organizationId);
    return apiSuccessResponse({ data: result }, { requestId });
  } catch (error: unknown) {
    return respond(error, requestId, logger);
  }
}

function respond(error: unknown, requestId: string, logger: ReturnType<typeof createOperationalLogger>) {
  if (error instanceof ProductionAutomationRunError) {
    return apiErrorResponse({
      code: error.status === 404 ? API_ERROR_CODE.resourceNotFound : error.status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest,
      message: error.message,
      requestId,
      status: error.status,
    });
  }
  logger.error("production.automation.run.failed", error);
  return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo consultar la automatización.", requestId, retryable: true, status: 500 });
}
