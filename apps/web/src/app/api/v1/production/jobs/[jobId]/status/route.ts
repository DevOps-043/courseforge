import {
  authenticateWorkerUser,
  isUuid,
  mapWorkerError,
} from "@/lib/server/desktop-worker-routes";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { resolveCorrelationId } from "@/lib/server/operational-logger";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const auth = await authenticateWorkerUser(request);
    if (!auth) {
      return apiErrorResponse({
        code: API_ERROR_CODE.authRequired,
        message: "Unauthorized",
        requestId,
        status: 401,
      });
    }

    const { jobId } = await context.params;
    if (!isUuid(jobId)) {
      return apiErrorResponse({
        code: API_ERROR_CODE.invalidRequest,
        message: "jobId must be a valid UUID",
        requestId,
        status: 400,
      });
    }

    const job = await auth.service.getJobStatus(jobId, auth.organizationIds);
    return apiSuccessResponse(job, { requestId });
  } catch (error) {
    return mapWorkerError(error, requestId);
  }
}
