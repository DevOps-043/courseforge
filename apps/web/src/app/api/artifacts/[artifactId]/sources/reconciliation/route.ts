import { z } from "zod";
import { requireCourseSourceAccess } from "@/domains/course-sources/course-source-access";
import { reconcileCourseUploads, purgeAbandonedSource } from "@/domains/course-sources/course-source-reconciliation";
import { CourseSourceError } from "@/domains/course-sources/course-source-error";
import { parseJsonRequest, API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiSuccessResponse, apiErrorResponse } from "@/lib/server/api-response";
import { authorizationUnavailableResponse } from "@/lib/server/authorization-unavailable-response";
import { rejectCrossOriginMutation } from "@/lib/server/mutation-request-origin";
import { resolveCorrelationId } from "@/lib/server/operational-logger";

const command = z.discriminatedUnion("action", [z.object({ action: z.literal("inspect") }).strict(),
  z.object({ action: z.literal("purge"), documentId: z.uuid(), confirmDocumentId: z.uuid() }).strict()]);
export async function POST(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const { artifactId } = await context.params;
    if (!z.uuid().safeParse(artifactId).success) throw new CourseSourceError(400, "Curso inválido.");
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new CourseSourceError(415, "Usa application/json.");
    const rejectedOrigin = rejectCrossOriginMutation(request, { requestId, headers });
    if (rejectedOrigin) return rejectedOrigin;
    const { tenant, admin } = await requireCourseSourceAccess(artifactId);
    if (!["ADMIN", "SUPERADMIN", "ARQUITECTO"].includes(tenant.platformRole || "")) throw new CourseSourceError(403, "La conciliación requiere un revisor autorizado.");
    const input = await parseJsonRequest(request, command, 1024);
    if (!input.success) throw new CourseSourceError(400, "Comando de conciliación inválido.");
    const result = input.data.action === "inspect"
      ? await reconcileCourseUploads(admin, artifactId, tenant.organizationId, tenant.userId)
      : input.data.documentId === input.data.confirmDocumentId
        ? await purgeAbandonedSource(admin, artifactId, tenant.organizationId, tenant.userId, input.data.documentId)
        : (() => { throw new CourseSourceError(409, "Confirma el identificador exacto para autorizar la purga."); })();
    return apiSuccessResponse(result, { requestId, headers });
  } catch (error) {
    const unavailable = authorizationUnavailableResponse(error, requestId); if (unavailable) return unavailable;
    const status = error instanceof CourseSourceError ? error.status : 503;
    const codes: Record<number, typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE]> = {
      400: API_ERROR_CODE.invalidRequest, 401: API_ERROR_CODE.authRequired, 403: API_ERROR_CODE.roleForbidden,
      404: API_ERROR_CODE.resourceNotFound, 409: API_ERROR_CODE.conflict, 415: API_ERROR_CODE.unsupportedMediaType,
    };
    return apiErrorResponse({ requestId, headers, status, code: codes[status] || API_ERROR_CODE.dependencyUnavailable,
      message: error instanceof CourseSourceError ? error.message : "Conciliación no disponible." });
  }
}
