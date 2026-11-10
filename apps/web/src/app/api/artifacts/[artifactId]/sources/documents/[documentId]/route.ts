import { z } from "zod";
import { requireCourseSourceAccess } from "@/domains/course-sources/course-source-access";
import { CourseSourceRepository } from "@/domains/course-sources/course-source.repository";
import { COURSE_SOURCE_BUCKET, COURSE_SOURCE_LIMITS } from "@/domains/course-sources/course-source-policy";
import { dispatchBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { authorizationUnavailableResponse } from "@/lib/server/authorization-unavailable-response";
import { rejectCrossOriginMutation } from "@/lib/server/mutation-request-origin";
import { resolveCorrelationId } from "@/lib/server/operational-logger";
import { CourseSourceError } from "@/domains/course-sources/course-source-error";

type Context = { params: Promise<{ artifactId: string; documentId: string }> };
export async function GET(request: Request, context: Context) { return respond(request, context); }
export async function POST(request: Request, context: Context) { return respond(request, context); }
async function respond(request: Request, context: Context) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const { artifactId, documentId } = await context.params;
    if (!z.uuid().safeParse(artifactId).success || !z.uuid().safeParse(documentId).success) throw new CourseSourceError(400, "Identificador inválido.");
    if (request.method === "POST") {
      const rejectedOrigin = rejectCrossOriginMutation(request, { requestId, headers });
      if (rejectedOrigin) return rejectedOrigin;
    }
    const { tenant, admin } = await requireCourseSourceAccess(artifactId);
    const document = await new CourseSourceRepository(admin, tenant).get(artifactId, documentId);
    if (!document) throw new CourseSourceError(404, "Documento no encontrado.");
    if (request.method === "POST") {
      if (new URL(request.url).searchParams.get("action") === "retire") {
        const result = await admin.rpc("process_course_source_document", { p_document: documentId, p_artifact: artifactId,
          p_organization: tenant.organizationId, p_action: "retire", p_token: null });
        if (result.error) throw new CourseSourceError(409, "No se pudo retirar la fuente.");
        return apiSuccessResponse({ retired: true }, { requestId, headers });
      }
      if (!["UPLOADED", "FAILED", "PROCESSING"].includes(document.status)) throw new CourseSourceError(409, "El documento no admite extracción.");
      await dispatchBackgroundFunctionJson("course-source-extraction-background", { artifactId, documentId, organizationId: tenant.organizationId }, {
        fallbackError: "No se pudo iniciar la extracción.",
        localHandlerLoader: () => import("../../../../../../../../netlify/functions/course-source-extraction-background"),
      });
      return apiSuccessResponse({ queued: true }, { requestId, headers, status: 202 });
    }
    if (new URL(request.url).searchParams.get("download") === "1") {
      const signed = await admin.storage.from(COURSE_SOURCE_BUCKET).createSignedUrl(document.storage_path, 60, { download: document.filename });
      if (signed.error || !signed.data) throw new CourseSourceError(503, "No se pudo autorizar la descarga.");
      return apiSuccessResponse({ url: signed.data.signedUrl }, { requestId, headers });
    }
    const cursor = z.coerce.number().int().min(0).max(100_000).safeParse(new URL(request.url).searchParams.get("from") ?? 0);
    if (!cursor.success) throw new CourseSourceError(400, "Posición de lectura inválida.");
    const pageSize = COURSE_SOURCE_LIMITS.fragmentPageSize;
    const fragments = await admin.from("course_source_fragments").select("ordinal,text_content,locator")
      .eq("artifact_id", artifactId).eq("document_id", documentId).gte("ordinal", cursor.data).order("ordinal").limit(pageSize + 1);
    if (fragments.error) throw new CourseSourceError(503, "No se pudo leer el texto.");
    const rows = fragments.data ?? [];
    return apiSuccessResponse({ status: document.status, fragments: rows.slice(0, pageSize),
      nextOrdinal: rows[pageSize]?.ordinal ?? null }, { requestId, headers });
  } catch (error) {
    const unavailable = authorizationUnavailableResponse(error, requestId); if (unavailable) return unavailable;
    return apiErrorResponse({ requestId, headers, status: error instanceof CourseSourceError ? error.status : 503,
      code: API_ERROR_CODE.conflict, message: error instanceof CourseSourceError ? error.message : "Servicio documental no disponible." });
  }
}
