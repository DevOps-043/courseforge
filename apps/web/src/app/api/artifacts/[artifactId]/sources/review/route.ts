import { z } from "zod";
import { requireCourseSourceAccess } from "@/domains/course-sources/course-source-access";
import {
  readSourceReview,
  readSourcePolicySnapshot,
  changeSourceReview,
} from "@/domains/course-sources/course-source-review.service";
import { sourceReviewCommandSchema } from "@/domains/course-sources/course-source-review.schema";
import { CourseSourceError } from "@/domains/course-sources/course-source-error";
import { COURSE_SOURCE_LIMITS } from "@/domains/course-sources/course-source-policy";
import { parseJsonRequest, API_ERROR_CODE } from "@/lib/server/api-contract";
import {
  apiErrorResponse,
  apiSuccessResponse,
} from "@/lib/server/api-response";
import { authorizationUnavailableResponse } from "@/lib/server/authorization-unavailable-response";
import { resolveCorrelationId } from "@/lib/server/operational-logger";
type Context = { params: Promise<{ artifactId: string }> };
export async function GET(request: Request, context: Context) {
  return respond(request, context);
}
export async function POST(request: Request, context: Context) {
  return respond(request, context);
}
async function respond(request: Request, context: Context) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const { artifactId } = await context.params;
    if (!z.uuid().safeParse(artifactId).success)
      throw new CourseSourceError(400, "Curso inválido.");
    if (
      request.method === "POST" &&
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      throw new CourseSourceError(415, "Usa application/json.");
    if (
      request.method === "POST" &&
      (request.headers.get("sec-fetch-site") === "cross-site" ||
        (request.headers.get("origin") &&
          request.headers.get("origin") !== new URL(request.url).origin))
    )
      throw new CourseSourceError(403, "Formato u origen no autorizado.");
    const { tenant, admin } = await requireCourseSourceAccess(artifactId);
    if (request.method === "GET")
      return apiSuccessResponse(
        {...await (new URL(request.url).searchParams.get("policyOnly") === "1"
          ? readSourcePolicySnapshot(admin, artifactId)
          : readSourceReview(admin, artifactId)),canApprove:["ADMIN","SUPERADMIN","ARQUITECTO"].includes(tenant.platformRole||"")},
        { requestId, headers },
      );
    const parsed = await parseJsonRequest(
      request,
      sourceReviewCommandSchema,
      COURSE_SOURCE_LIMITS.reviewRequestBytes,
    );
    if (!parsed.success)
      throw new CourseSourceError(
        parsed.reason === "too_large" ? 413 : 400,
        "Solicitud de revisión inválida.",
      );
    return apiSuccessResponse(
      await changeSourceReview(
        admin,
        artifactId,
        tenant.organizationId,
        tenant.userId,
        ["ADMIN", "SUPERADMIN", "ARQUITECTO"].includes(
          tenant.platformRole || "",
        ),
        parsed.data,
      ),
      { requestId, headers },
    );
  } catch (error) {
    const unavailable = authorizationUnavailableResponse(error, requestId);
    if (unavailable) return unavailable;
    const status = error instanceof CourseSourceError ? error.status : 503;
    return apiErrorResponse({
      requestId,
      headers,
      status,
      code:
        status === 403
          ? API_ERROR_CODE.roleForbidden
          : status === 404
            ? API_ERROR_CODE.resourceNotFound
            : status === 400
              ? API_ERROR_CODE.invalidRequest
              : status === 415
                ? API_ERROR_CODE.unsupportedMediaType
                : status === 413
                  ? API_ERROR_CODE.payloadTooLarge
                  : status === 503
                    ? API_ERROR_CODE.dependencyUnavailable
                    : API_ERROR_CODE.conflict,
      message:
        error instanceof CourseSourceError
          ? error.message
          : "La revisión documental no está disponible.",
    });
  }
}
