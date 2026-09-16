import { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { dispatchBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  classifyScormImportStatus,
  isRecoverableScormJob,
  SCORM_IMPORT_STATUS,
  SCORM_PROCESSING_STEP,
  scormProcessRequestSchema,
} from "@/domains/scorm/scorm-job-contracts";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";

const SCORM_STATUS_SELECT = "id, artifact_id, status, processing_step, organization_id, manifest_raw, lease_expires_at, updated_at, correlation_id";
const MAX_SCORM_PROCESS_REQUEST_BYTES = 8 * 1024;

async function authorizeScormAdmin() {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) return { authorized: false as const, status: 401 as const };

  const tenant = await resolveActiveTenantContext();
  if (!tenant || !await canReviewContent(authenticatedUser.userId, tenant)) {
    return { authorized: false as const, status: 403 as const };
  }
  return { authorized: true as const, tenant };
}

function statusResponse(importRecord: {
  artifact_id?: string | null;
  correlation_id?: string | null;
  id: string;
  lease_expires_at?: string | null;
  manifest_raw?: unknown;
  processing_step?: string | null;
  status?: string | null;
  updated_at?: string | null;
}) {
  const kind = classifyScormImportStatus(importRecord.status);
  return {
    artifactId: importRecord.artifact_id || null,
    correlationId: importRecord.correlation_id || null,
    importId: importRecord.id,
    kind,
    manifest: kind === "ready" ? importRecord.manifest_raw || null : null,
    processingStep: importRecord.processing_step || null,
    recoverable: isRecoverableScormJob(
      importRecord.status,
      importRecord.processing_step,
      importRecord.lease_expires_at,
      importRecord.updated_at,
    ),
    status: importRecord.status || "UNKNOWN",
    success: kind === "completed",
  };
}

async function dispatchScormJob(
  status: unknown,
  importId: string,
  organizationId: string,
  correlationId: string,
) {
  if (status === SCORM_IMPORT_STATUS.parsing) {
    return dispatchBackgroundFunctionJson(
      "scorm-parsing-background",
      { correlationId, importId, organizationId },
      {
        fallbackError: "No se pudo despachar el análisis SCORM.",
        localHandlerLoader: () => import("../../../../../../netlify/functions/scorm-parsing-background"),
      },
    );
  }

  return dispatchBackgroundFunctionJson(
    "scorm-transformation-background",
    { correlationId, importId, organizationId },
    {
      fallbackError: "No se pudo despachar la transformación SCORM.",
      localHandlerLoader: () => import("../../../../../../netlify/functions/scorm-transformation-background"),
    },
  );
}

export async function GET(req: NextRequest) {
  const correlationId = resolveCorrelationId(req.headers.get("x-request-id"));
  const logger = createOperationalLogger("scorm.status", { correlationId });
  const authorized = await authorizeScormAdmin();
  if (!authorized.authorized) {
    return apiErrorResponse({
      code: authorized.status === 401 ? API_ERROR_CODE.authRequired : API_ERROR_CODE.roleForbidden,
      message: authorized.status === 401 ? "No autorizado." : "Falta de permisos.",
      requestId: correlationId,
      status: authorized.status,
    });
  }

  const parsed = scormProcessRequestSchema.safeParse({
    importId: req.nextUrl.searchParams.get("importId"),
  });
  if (!parsed.success) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Import ID inválido.", requestId: correlationId, status: 400 });
  }

  const admin = getServiceRoleClient();
  const { data: importRecord, error } = await admin
    .from("scorm_imports")
    .select(SCORM_STATUS_SELECT)
    .eq("id", parsed.data.importId)
    .eq("organization_id", authorized.tenant.organizationId)
    .maybeSingle();

  if (error) {
    logger.error("scorm.status.lookup_failed", error, { importId: parsed.data.importId });
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo consultar la importación.", requestId: correlationId, retryable: true, status: 500 });
  }
  if (!importRecord) {
    return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Importación no encontrada.", requestId: correlationId, status: 404 });
  }
  return apiSuccessResponse(statusResponse(importRecord), { requestId: correlationId });
}

export async function POST(req: NextRequest) {
  const requestCorrelationId = resolveCorrelationId(req.headers.get("x-request-id"));
  const logger = createOperationalLogger("scorm.process", { correlationId: requestCorrelationId });
  const authorized = await authorizeScormAdmin();
  if (!authorized.authorized) {
    return apiErrorResponse({
      code: authorized.status === 401 ? API_ERROR_CODE.authRequired : API_ERROR_CODE.roleForbidden,
      message: authorized.status === 401 ? "No autorizado." : "Falta de permisos.",
      requestId: requestCorrelationId,
      status: authorized.status,
    });
  }

  const parsed = await parseJsonRequest(req, scormProcessRequestSchema, MAX_SCORM_PROCESS_REQUEST_BYTES);
  if (!parsed.success) {
    return apiErrorResponse({
      code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
      message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Import ID inválido.",
      requestId: requestCorrelationId,
      status: parsed.reason === "too_large" ? 413 : 400,
    });
  }

  const { importId } = parsed.data;
  const organizationId = authorized.tenant.organizationId;
  const admin = getServiceRoleClient();
  const { data: current, error: lookupError } = await admin
    .from("scorm_imports")
    .select(SCORM_STATUS_SELECT)
    .eq("id", importId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (lookupError) {
    logger.error("scorm.process.lookup_failed", lookupError, { importId });
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo iniciar la importación.", requestId: requestCorrelationId, retryable: true, status: 500 });
  }
  if (!current) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Importación no encontrada.", requestId: requestCorrelationId, status: 404 });
  const correlationId = resolveCorrelationId(current.correlation_id || requestCorrelationId);

  const currentKind = classifyScormImportStatus(current.status);
  if (currentKind === "completed") return apiSuccessResponse(statusResponse(current), { requestId: correlationId });
  if (currentKind === "active") {
    const isParsing = current.status === SCORM_IMPORT_STATUS.parsing;
    const runningStep = isParsing
      ? SCORM_PROCESSING_STEP.parseRunning
      : SCORM_PROCESSING_STEP.transformRunning;
    const queuedStep = isParsing
      ? SCORM_PROCESSING_STEP.parseQueued
      : SCORM_PROCESSING_STEP.transformQueued;
    if (!isRecoverableScormJob(
      current.status,
      current.processing_step,
      current.lease_expires_at,
      current.updated_at,
    )) {
      return apiSuccessResponse(statusResponse(current), { requestId: correlationId, status: 202 });
    }

    const recoveryTimestamp = new Date().toISOString();
    let recoveryQuery = admin
      .from("scorm_imports")
      .update({
        lease_expires_at: null,
        processing_heartbeat_at: null,
        processing_step: queuedStep,
        updated_at: recoveryTimestamp,
      })
      .eq("id", importId)
      .eq("organization_id", organizationId)
      .eq("status", current.status)
      .eq("processing_step", current.processing_step);
    recoveryQuery = current.processing_step === runningStep
      ? recoveryQuery.lte("lease_expires_at", recoveryTimestamp)
      : recoveryQuery.eq("updated_at", current.updated_at);
    const { data: recovered, error: recoveryError } = await recoveryQuery
      .select(SCORM_STATUS_SELECT)
      .maybeSingle();
    if (recoveryError) {
      logger.error("scorm.recovery.reservation_failed", recoveryError, { correlationId, importId });
      return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo recuperar la importación detenida.", requestId: correlationId, retryable: true, status: 500 });
    }
    if (!recovered) return apiSuccessResponse(statusResponse(current), { requestId: correlationId, status: 202 });

    try {
      await dispatchScormJob(current.status, importId, organizationId, correlationId);
    } catch (dispatchError) {
      logger.error("scorm.recovery.dispatch_failed", dispatchError, { correlationId, importId });
      const { error: rollbackError } = await admin
        .from("scorm_imports")
        .update({
          lease_expires_at: current.lease_expires_at,
          processing_step: current.processing_step,
          updated_at: current.updated_at,
        })
        .eq("id", importId)
        .eq("organization_id", organizationId)
        .eq("status", current.status)
        .eq("processing_step", queuedStep);
      if (rollbackError) {
        logger.error("scorm.recovery.rollback_failed", rollbackError, {
          correlationId,
          importId,
        });
      }
      return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, message: "No se pudo reanudar la importación SCORM.", requestId: correlationId, retryable: true, status: 503 });
    }
    return apiSuccessResponse(statusResponse(recovered), { requestId: correlationId, status: 202 });
  }
  if (currentKind === "failed") {
    return apiErrorResponse({ code: API_ERROR_CODE.conflict, message: "La importación falló y requiere revisión antes de reintentarse.", requestId: correlationId, status: 409 });
  }
  if (currentKind !== "ready") {
    return apiErrorResponse({ code: API_ERROR_CODE.conflict, message: "El paquete SCORM todavía no está listo para transformarse.", requestId: correlationId, status: 409 });
  }

  const { data: queued, error: queueError } = await admin
    .from("scorm_imports")
    .update({
      error_message: null,
      correlation_id: correlationId,
      lease_expires_at: null,
      processing_heartbeat_at: null,
      processing_step: SCORM_PROCESSING_STEP.transformQueued,
      status: SCORM_IMPORT_STATUS.transforming,
      updated_at: new Date().toISOString(),
    })
    .eq("id", importId)
    .eq("organization_id", organizationId)
    .eq("status", current.status)
    .select(SCORM_STATUS_SELECT)
    .maybeSingle();

  if (queueError) {
    logger.error("scorm.transformation.reservation_failed", queueError, { correlationId, importId });
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo reservar la importación.", requestId: correlationId, retryable: true, status: 500 });
  }
  if (!queued) {
    return apiSuccessResponse({ importId, status: SCORM_IMPORT_STATUS.transforming, kind: "active" }, { requestId: correlationId, status: 202 });
  }

  try {
    await dispatchScormJob(SCORM_IMPORT_STATUS.transforming, importId, organizationId, correlationId);
  } catch (dispatchError) {
    logger.error("scorm.transformation.dispatch_failed", dispatchError, { correlationId, importId });
    await admin
      .from("scorm_imports")
      .update({ processing_step: null, status: current.status })
      .eq("id", importId)
      .eq("organization_id", organizationId)
      .eq("processing_step", SCORM_PROCESSING_STEP.transformQueued);
    return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, message: "No se pudo despachar la transformación SCORM.", requestId: correlationId, retryable: true, status: 503 });
  }

  return apiSuccessResponse(statusResponse(queued), { requestId: correlationId, status: 202 });
}
