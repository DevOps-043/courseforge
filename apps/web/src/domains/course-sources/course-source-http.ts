import { z } from "zod";
import { listLegacySources, importLegacySource, legacySourceImportSchema } from "./course-source-legacy";
import { API_ERROR_CODE, parseJsonRequest } from "../../lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "../../lib/server/api-response";
import { authorizationUnavailableResponse } from "../../lib/server/authorization-unavailable-response";
import { createOperationalLogger, resolveCorrelationId } from "../../lib/server/operational-logger";
import { requireCourseSourceAccess } from "./course-source-access";
import { COURSE_SOURCE_LIMITS } from "./course-source-policy";
import { CourseSourceError } from "./course-source-error";
import { CourseSourceRepository } from "./course-source.repository";
import { CourseSourceService } from "./course-source.service";
import { createSourceStorage } from "./course-source-storage";
import { confirmSourceUploadSchema, createSourceDraftSchema, publicSourceDocument, reserveSourceUploadSchema, sourcePageSchema } from "./course-source.schema";

type Operation = "draft" | "reserve" | "confirm" | "list" | "legacy-list" | "legacy-import";

export async function courseSourceHttp(request: Request, operation: Operation, artifactId?: string) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    if (operation !== "list" && operation !== "legacy-list") {
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        throw new CourseSourceError(415, "La solicitud debe usar application/json.");
      }
      const origin = request.headers.get("origin");
      if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) {
        throw new CourseSourceError(403, "El origen de la solicitud no está autorizado.");
      }
    }
    if (operation !== "draft" && !z.uuid().safeParse(artifactId).success) throw new CourseSourceError(400, "Identificador de curso inválido.");
    const { tenant, admin } = await requireCourseSourceAccess(artifactId);
    const repository = new CourseSourceRepository(admin, tenant);
    let result: object;
    if (operation === "legacy-list") {
      result = await listLegacySources(admin, artifactId!);
    } else if (operation === "legacy-import") {
      result = await importLegacySource(admin, artifactId!, tenant, await parseBody(request, legacySourceImportSchema));
    } else if (operation === "list") {
      const parameters = Object.fromEntries(new URL(request.url).searchParams);
      const page = sourcePageSchema.parse(parameters);
      const collection = await repository.list(artifactId!, page.offset, page.limit);
      result = { documents: collection.documents.map(publicSourceDocument), nextOffset: collection.nextOffset };
    } else if (operation === "draft") {
      const input = await parseBody(request, createSourceDraftSchema);
      result = { artifactId: await repository.createDraft(input), state: "DRAFT" };
    } else {
      const service = new CourseSourceService(repository, createSourceStorage(admin), tenant.userId);
      result = operation === "reserve"
        ? await service.reserve(artifactId!, await parseBody(request, reserveSourceUploadSchema))
        : await service.confirm(artifactId!, (await parseBody(request, confirmSourceUploadSchema)).documentId);
    }
    createOperationalLogger("fuentes.http", { correlationId: requestId }).info("fuentes.operacion_completada", { operation, artifactId });
    return apiSuccessResponse(result, { requestId, headers });
  } catch (error) {
    const unavailable = authorizationUnavailableResponse(error, requestId);
    if (unavailable) return unavailable;
    const known = error instanceof CourseSourceError;
    const status = known ? error.status : error instanceof z.ZodError ? 400 : 503;
    const codes: Record<number, typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE]> = {
      400: API_ERROR_CODE.invalidRequest, 401: API_ERROR_CODE.authRequired, 403: API_ERROR_CODE.roleForbidden,
      404: API_ERROR_CODE.resourceNotFound, 409: API_ERROR_CODE.conflict, 413: API_ERROR_CODE.payloadTooLarge,
      415: API_ERROR_CODE.unsupportedMediaType, 429: API_ERROR_CODE.rateLimited,
    };
    createOperationalLogger("fuentes.http", { correlationId: requestId }).warn("fuentes.operacion_rechazada", { operation, status });
    return apiErrorResponse({ requestId, headers, status, code: codes[status] || API_ERROR_CODE.dependencyUnavailable,
      retryable: status === 503,
      message: known ? error.message : status === 400 ? "Los campos no cumplen el contrato documental." : "El servicio documental no está disponible. Consulta el estado antes de reintentar.",
    });
  }
}

async function parseBody<T>(request: Request, schema: z.ZodType<T>) {
  const parsed = await parseJsonRequest(request, schema, COURSE_SOURCE_LIMITS.requestBytes);
  if (!parsed.success) throw new CourseSourceError(parsed.reason === "too_large" ? 413 : 400, "Solicitud documental inválida o demasiado grande.");
  return parsed.data;
}
