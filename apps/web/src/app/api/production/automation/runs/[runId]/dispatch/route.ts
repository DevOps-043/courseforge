import { z } from "zod";
import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { signBackgroundPayload } from "@/lib/server/background-payload-signature";
import { canReviewContent, getAuthenticatedUser } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { runProductionAutomationBackground } from "@/domains/production/automation/production-automation-background.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const runIdSchema = z.string().uuid();

/** Explicit post-review dispatch. This only creates configured source assets. */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.automation.dispatch", { correlationId: requestId });
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    const tenant = await resolveActiveTenantContext();
    if (!tenant || !(await canReviewContent(user.userId, tenant))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para iniciar producción.", requestId, status: 403 });
    }
    const { runId } = await context.params;
    if (!runIdSchema.safeParse(runId).success) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "runId inválido.", requestId, status: 400 });
    await callBackgroundFunctionJson(
      "production-automation-background",
      signBackgroundPayload({ organizationId: tenant.organizationId, runId }),
      {
        fallbackError: "No se pudo iniciar el despachador de assets.",
        localHandlerLoader: async () => ({
          handler: async () => {
            await runProductionAutomationBackground({ organizationId: tenant.organizationId, runId });
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
          },
        }),
      },
    );
    return apiSuccessResponse({ submissionStatus: "QUEUED" }, { requestId, status: 202 });
  } catch (error: unknown) {
    logger.error("production.automation.dispatch.failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, message: "No se pudo iniciar la producción.", requestId, retryable: true, status: 503 });
  }
}
