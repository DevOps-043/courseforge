import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody, type ApiErrorCode } from "../../../../lib/server/api-contract";
import { createOperationalLogger, resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS } from "../composition-narrative-extraction-contract";
import { NarrativeExtractionCommitUnconfirmedError } from "../composition-narrative-extraction-apply.service";
import { acceptsNarrativeExtractionOrigin, resolveNarrativeExtractionTrustedOrigin, parseNarrativeJsonHttpBody,
  narrativeExtractionHttpScopeSchema } from "./composition-narrative-extraction-http-policy";
import type { NarrativeExtractionHttpAuthorization } from "./composition-narrative-extraction-handler.server";

export interface NarrativeCommandHttpDependencies<C extends { commandId: string }, S> {
  enabled: () => boolean;
  configuredAppUrl: () => string | null;
  authorize: () => Promise<NarrativeExtractionHttpAuthorization>;
  consumeRateLimit: (scope: { organizationId: string; userId: string }, purpose: "APPLY" | "RECOVERY", signal: AbortSignal) => Promise<
    { status: "ALLOWED" | "UNAVAILABLE" } | { status: "LIMITED"; retryAfterSeconds: number }>;
  loadServices: (scope: { organizationId: string; userId: string; draftId: string }, signal: AbortSignal) => Promise<S | null>;
  commandSchema: z.ZodType<C>;
  execute: (mode: "APPLY" | "RECOVERY", parameters: { organizationId: string; userId: string; draftId: string;
    request: C; services: S; signal: AbortSignal }) => Promise<{ ok: true; data: unknown } | { ok: false; reason: string }>;
  unconfirmed: (commandId: string) => unknown;
  logNamespace?: "production.narrative_extraction.command" | "production.narrative_fragment.command";
  logFailure?: (requestId: string, error: unknown, commandId?: string) => void;
}

/** Transport-independent controller; deployed routes must supply the closed-by-default rollout policy. */
export function createNarrativeCommandHttpHandler<C extends { commandId: string }, S>(mode: "APPLY" | "RECOVERY", dependencies: NarrativeCommandHttpDependencies<C, S>) {
  return async (request: Request, rawDraftId: unknown): Promise<Response> => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, Origin", "x-request-id": requestId };
    let command: C | undefined;
    let mayHaveCommitted = false;
    const fail = (status: number, code: ApiErrorCode, message: string, reason: string, recoveryRequired = false, extra?: Record<string, string>) =>
      Response.json(createApiErrorBody({ code, message, requestId, retryable: false,
        details: { reason, automaticRetryAllowed: false, recoveryRequired,
          requestNotApplied: mode === "APPLY" && !mayHaveCommitted && !recoveryRequired,
          ...(command ? { commandId: command.commandId } : {}) } }),
      { status, headers: { ...headers, ...extra } });
    const succeed = (data: unknown, status = 200) => Response.json({ success: true,
      requestId, correlationId: requestId, data }, { status, headers });
    try {
      if (!dependencies.enabled()) return fail(503, API_ERROR_CODE.dependencyUnavailable, "El guardado de extracción aún no está habilitado.", "FEATURE_DISABLED");
      if (request.method !== "POST") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.", "METHOD_INVALID", false, { Allow: "POST" });
      const origin = resolveNarrativeExtractionTrustedOrigin(dependencies.configuredAppUrl());
      if (!origin) return fail(503, API_ERROR_CODE.dependencyUnavailable, "La operación no tiene una configuración segura disponible.", "ORIGIN_UNCONFIGURED");
      if (!acceptsNarrativeExtractionOrigin(request, origin)) return fail(403, API_ERROR_CODE.tenantForbidden, "Origen de solicitud no autorizado.", "ORIGIN_FORBIDDEN");
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) {
        return fail(415, API_ERROR_CODE.unsupportedMediaType, "Se requiere una solicitud JSON UTF-8.", "MEDIA_TYPE_INVALID");
      }
      const draftId = z.string().uuid().safeParse(rawDraftId);
      if (!draftId.success || new URL(request.url).search) return fail(400, API_ERROR_CODE.invalidRequest, "Identificador o parámetros inválidos.", "REQUEST_INVALID");
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS)]);
      signal.throwIfAborted();
      const authorized = await dependencies.authorize();
      signal.throwIfAborted();
      if (authorized.status !== "AUTHORIZED") return fail(authorized.status === "AUTH_REQUIRED" ? 401 : 403,
        API_ERROR_CODE[authorized.status === "AUTH_REQUIRED" ? "authRequired" : authorized.status === "ROLE_FORBIDDEN" ? "roleForbidden" : "tenantForbidden"],
        "No tienes acceso a esta operación.", authorized.status);
      const parsedScope = narrativeExtractionHttpScopeSchema.safeParse({ organizationId: authorized.organizationId, userId: authorized.userId });
      if (!parsedScope.success) return fail(403, API_ERROR_CODE.tenantForbidden, "Contexto de acceso inválido.", "TENANT_FORBIDDEN");
      const scope = parsedScope.data;
      const limit = await dependencies.consumeRateLimit(scope, mode, signal);
      signal.throwIfAborted();
      if (limit.status === "UNAVAILABLE") return fail(503, API_ERROR_CODE.dependencyUnavailable, "No se pudo verificar el límite de solicitudes.", "RATE_LIMIT_UNAVAILABLE");
      if (limit.status === "LIMITED") return fail(429, API_ERROR_CODE.rateLimited, "Espera antes de volver a consultar.", "RATE_LIMITED", false,
        { "Retry-After": String(Number.isInteger(limit.retryAfterSeconds) ? Math.min(60, Math.max(1, limit.retryAfterSeconds)) : 60) });
      const parsed = await parseNarrativeJsonHttpBody(request, signal, dependencies.commandSchema);
      if (!parsed.ok) return fail(parsed.reason === "TOO_LARGE" ? 413 : 400,
        parsed.reason === "TOO_LARGE" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        "La solicitud de extracción no es válida.", parsed.reason);
      command = parsed.command;
      const services = await dependencies.loadServices({ ...scope, draftId: draftId.data }, signal);
      signal.throwIfAborted();
      if (!services) return fail(404, API_ERROR_CODE.resourceNotFound, "Borrador no disponible.", "DRAFT_NOT_FOUND");
      const parameters = { ...scope, draftId: draftId.data, request: command, services, signal };
      mayHaveCommitted = mode === "APPLY";
      const result = await dependencies.execute(mode, parameters);
      if (!result.ok) {
        if (result.reason === "COMMIT_UNCONFIRMED") return succeed(dependencies.unconfirmed(command.commandId), 202);
        const status = result.reason === "DRAFT_NOT_FOUND" ? 404 : result.reason === "INVALID_RECEIPT" ? 503
          : ["COMMAND_REUSED", "CONFLICT", "STALE_DOCUMENT", "REVIEW_STALE", "BUSY", "ASSET_CHANGED", "FONT_CHANGED"].includes(result.reason) ? 409 : 422;
        // Expected plan/transaction rejection proves no append. Reused/corrupt receipts may refer to an earlier commit.
        mayHaveCommitted = mode === "APPLY" && ["COMMAND_REUSED", "INVALID_RECEIPT"].includes(result.reason);
        return fail(status, status === 404 ? API_ERROR_CODE.resourceNotFound : status === 503 ? API_ERROR_CODE.dependencyUnavailable
          : status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest,
          "No se puede confirmar la extracción con esta solicitud.", result.reason, result.reason === "INVALID_RECEIPT");
      }
      return succeed(result.data);
    } catch (error) {
      if (dependencies.logFailure) dependencies.logFailure(requestId, error, command?.commandId);
      else createOperationalLogger(dependencies.logNamespace ?? "production.narrative_extraction.command", { correlationId: requestId })
        .error("production.narrative_command.command_failed", error, { commandId: command?.commandId, mode });
      const unconfirmed = error instanceof NarrativeExtractionCommitUnconfirmedError;
      return fail(503, API_ERROR_CODE.dependencyUnavailable,
        unconfirmed ? "El guardado no está confirmado. Consulta su recibo; no repitas la extracción."
          : "No se pudo completar la consulta. No se ha repetido automáticamente la operación.",
        unconfirmed ? "COMMIT_UNCONFIRMED" : "OPERATION_UNAVAILABLE", Boolean(command));
    }
  };
}
