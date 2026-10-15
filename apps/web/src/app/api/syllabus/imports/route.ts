import { z } from "zod";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import {
  apiErrorResponse,
  apiSuccessResponse,
} from "@/lib/server/api-response";
import {
  createOperationalLogger,
  resolveCorrelationId,
} from "@/lib/server/operational-logger";
import { dispatchBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { isNetlifyDeployment } from "@/lib/server/env";
import { authorizeSyllabusImport } from "@/domains/syllabus/import/syllabus-import.http";
import {
  importCommandSchema,
  SYLLABUS_IMPORT_POLICY,
} from "@/domains/syllabus/import/syllabus-import.schema";
import {
  assertConfirmableOutline,
  acceptExpansions,
} from "@/domains/syllabus/import/syllabus-fidelity";
import {
  isSyllabusImportEnabled,
  SyllabusImportError,
  SyllabusImportRepository,
} from "@/domains/syllabus/import/syllabus-import.repository";
import { executeSyllabusImport } from "@/domains/syllabus/import/syllabus-import.service";

export const maxDuration = 120;

function errorResponse(error: unknown, requestId: string) {
  const status =
    error instanceof SyllabusImportError
      ? error.status
      : error instanceof z.ZodError
        ? 400
        : 503;
  return apiErrorResponse({
    requestId,
    status,
    code:
      status === 429
        ? API_ERROR_CODE.rateLimited
        : status === 409
          ? API_ERROR_CODE.conflict
          : status === 401
            ? API_ERROR_CODE.authRequired
            : status === 403
              ? API_ERROR_CODE.tenantForbidden
              : status === 404
                ? API_ERROR_CODE.resourceNotFound
                : status >= 500
                  ? API_ERROR_CODE.dependencyUnavailable
                  : API_ERROR_CODE.invalidRequest,
    message:
      error instanceof SyllabusImportError
        ? error.message
        : status === 400
          ? "Revisa la estructura del temario y sus campos."
          : "No se pudo completar la importación. El documento original está conservado.",
    retryable: status >= 500,
  });
}

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const url = new URL(request.url);
    const artifactId = url.searchParams.get("artifactId") || "";
    const { admin, tenant } = await authorizeSyllabusImport(artifactId);
    const enabled = isSyllabusImportEnabled(tenant.organizationId);
    if (!enabled)
      return apiSuccessResponse(
        { enabled, import: null, documents: [] },
        { requestId },
      );
    const importId = url.searchParams.get("importId") || undefined;
    if (importId && !z.string().uuid().safeParse(importId).success)
      throw new SyllabusImportError(
        "Identificador de importación inválido.",
        400,
      );
    const repository = new SyllabusImportRepository(admin, artifactId);
    const entry = await repository.get(importId);
    const { data: documents, error } = await admin
      .from("syllabus_source_documents")
      .select("id,filename,mime_type,size_bytes")
      .eq("artifact_id", artifactId)
      .order("created_at", { ascending: false })
      .limit(SYLLABUS_IMPORT_POLICY.maxStoredDocuments);
    if (error) throw error;
    const original = entry
      ? (await repository.documents([entry.primary_document_id]))[0]
      : null;
    return apiSuccessResponse(
      {
        enabled,
        import: entry,
        documents,
        original: original
          ? { filename: original.filename, text: original.extracted_text }
          : null,
      },
      { requestId, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const parsed = await parseJsonRequest(
    request,
    importCommandSchema,
    512 * 1024,
  );
  if (!parsed.success)
    return apiErrorResponse({
      requestId,
      status: parsed.reason === "too_large" ? 413 : 400,
      code:
        parsed.reason === "too_large"
          ? API_ERROR_CODE.payloadTooLarge
          : API_ERROR_CODE.invalidRequest,
      message: "Solicitud de importación inválida o demasiado grande.",
    });
  try {
    const command = parsed.data;
    const { admin, actorId, tenant } = await authorizeSyllabusImport(
      command.artifactId,
    );
    if (!isSyllabusImportEnabled(tenant.organizationId))
      throw new SyllabusImportError(
        "La importación de temarios no está habilitada.",
        409,
      );
    const repository = new SyllabusImportRepository(admin, command.artifactId);
    let entry;
    let execute = false;
    if (command.action === "start") {
      const result = await repository.start(
        command.primaryDocumentId,
        command.supportDocumentIds,
        command.idempotencyKey,
        actorId,
      );
      entry = result.entry;
      execute = result.created;
    } else {
      entry = await repository.get(command.importId);
      if (!entry)
        throw new SyllabusImportError("Importación no encontrada.", 404);
      if (entry.revision !== command.expectedRevision)
        throw new SyllabusImportError(
          "La revisión cambió. Actualiza antes de continuar.",
        );
      if (command.action === "revise")
        entry = await repository.transition(
          entry,
          "revise",
          { outline: command.outline },
          actorId,
        );
      if (command.action === "confirm") {
        try {
          assertConfirmableOutline(entry.candidate_outline);
        } catch {
          throw new SyllabusImportError(
            "Define al menos un módulo y una lección por módulo antes de confirmar.",
            422,
          );
        }
        entry = await repository.transition(entry, "confirm", {}, actorId);
      }
      if (command.action === "decide") {
        let outline;
        try {
          outline = acceptExpansions(
            entry.confirmed_outline || [],
            entry.proposals,
            command.acceptedIds,
          );
        } catch {
          throw new SyllabusImportError(
            "Revisa las propuestas seleccionadas y sus límites antes de aplicar la decisión.",
            422,
          );
        }
        entry = await repository.transition(
          entry,
          "decide",
          { outline, acceptedIds: command.acceptedIds },
          actorId,
        );
      }
      if (
        command.action === "enrich" ||
        command.action === "propose" ||
        command.action === "retry"
      ) {
        entry = await repository.transition(
          entry,
          command.action === "retry" ? "retry" : `reserve_${command.action}`,
          {},
          actorId,
        );
        execute = true;
      }
    }
    if (execute) {
      if (isNetlifyDeployment()) {
        try {
          await dispatchBackgroundFunctionJson(
            "syllabus-import-background",
            {
              artifactId: command.artifactId,
              importId: entry.id,
              revision: entry.revision,
              organizationId: tenant.organizationId,
            },
            {
              fallbackError: "No se pudo iniciar el procesamiento del temario.",
            },
          );
        } catch (error) {
          await repository.transition(entry, "failed");
          throw error;
        }
      } else {
        await executeSyllabusImport(
          admin,
          command.artifactId,
          entry.id,
          entry.revision,
        );
        entry = (await repository.get(entry.id))!;
      }
    }
    createOperationalLogger("syllabus.import.http", {
      correlationId: requestId,
    }).info("syllabus.import.command", {
      artifactId: command.artifactId,
      importId: entry.id,
      revision: entry.revision,
      action: command.action,
    });
    return apiSuccessResponse(
      { import: entry },
      { requestId, status: execute && isNetlifyDeployment() ? 202 : 200 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
