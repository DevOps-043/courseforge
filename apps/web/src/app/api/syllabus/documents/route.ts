import { extractSyllabusSourceDocument } from "@/domains/syllabus/lib/syllabus-document-extractor";
import {
  isSupportedSyllabusDocument,
  SYLLABUS_SOURCE_DOCUMENT_MAX_FILES,
  SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_BYTES,
  SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_CHARACTERS,
} from "@/domains/syllabus/syllabus-source-documents";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import {
  getAuthenticatedUser,
  getAuthorizedArtifactAdminForTenant,
} from "@/lib/server/artifact-action-auth";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";

const MAX_MULTIPART_BYTES = SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_BYTES + 1024 * 1024;

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("syllabus.documents", { correlationId: requestId });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_MULTIPART_BYTES) {
    return apiErrorResponse({
      code: API_ERROR_CODE.payloadTooLarge,
      message: "Los documentos exceden el límite total de 40 MB.",
      requestId,
      status: 413,
    });
  }

  try {
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({
        code: API_ERROR_CODE.authRequired,
        message: "No autorizado.",
        requestId,
        status: 401,
      });
    }

    const tenant = await resolveActiveTenantContext();
    const formData = await request.formData();
    const artifactId = String(formData.get("artifactId") || "");
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    if (!tenant || !artifactId) {
      return apiErrorResponse({
        code: API_ERROR_CODE.invalidRequest,
        message: "No se pudo identificar el artefacto o la empresa.",
        requestId,
        status: 400,
      });
    }

    const authorized = await getAuthorizedArtifactAdminForTenant(artifactId, tenant);
    if (!authorized) {
      return apiErrorResponse({
        code: API_ERROR_CODE.resourceNotFound,
        message: "Artefacto no encontrado para esta empresa.",
        requestId,
        status: 404,
      });
    }

    if (files.length < 1 || files.length > SYLLABUS_SOURCE_DOCUMENT_MAX_FILES) {
      return apiErrorResponse({
        code: API_ERROR_CODE.invalidRequest,
        message: `Selecciona entre 1 y ${SYLLABUS_SOURCE_DOCUMENT_MAX_FILES} documentos.`,
        requestId,
        status: 400,
      });
    }

    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (totalBytes > SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_BYTES) {
      return apiErrorResponse({
        code: API_ERROR_CODE.payloadTooLarge,
        message: "Los documentos exceden el límite total de 40 MB.",
        requestId,
        status: 413,
      });
    }
    if (files.some((file) => !isSupportedSyllabusDocument(file))) {
      return apiErrorResponse({
        code: API_ERROR_CODE.invalidRequest,
        message: "Formato no compatible. Usa PDF, DOCX, PPTX o TXT.",
        requestId,
        status: 400,
      });
    }

    const documents = [];
    for (const file of files) {
      documents.push(await extractSyllabusSourceDocument(file));
    }
    const totalCharacters = documents.reduce(
      (total, document) => total + document.characterCount,
      0,
    );
    if (totalCharacters > SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_CHARACTERS) {
      return apiErrorResponse({
        code: API_ERROR_CODE.payloadTooLarge,
        message: "El texto extraído excede el límite total de 120,000 caracteres.",
        requestId,
        status: 413,
      });
    }

    logger.info("syllabus.documents.extracted", {
      artifactId,
      documentCount: documents.length,
      totalCharacters,
    });
    return apiSuccessResponse({ documents }, { requestId });
  } catch (error) {
    logger.error("syllabus.documents.failed", error);
    return apiErrorResponse({
      code: API_ERROR_CODE.invalidRequest,
      message: error instanceof Error ? error.message : "No se pudieron procesar los documentos.",
      requestId,
      status: 400,
    });
  }
}
