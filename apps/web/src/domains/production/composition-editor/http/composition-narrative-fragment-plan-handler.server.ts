import { randomUUID } from "node:crypto";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody, type ApiErrorCode } from "../../../../lib/server/api-contract";
import { createOperationalLogger, resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { CompositionDocumentError } from "../composition-document.service";
import { NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS } from "../composition-narrative-extraction-contract";
import { narrativeFragmentQuerySchema } from "../composition-narrative-fragment-contract";
import { queryNarrativeFragment, type NarrativeFragmentReadRepository } from "../composition-narrative-fragment-query.server";
import type { NarrativeExtractionHttpAuthorization } from "./composition-narrative-extraction-handler.server";
import { acceptsNarrativeExtractionOrigin, resolveNarrativeExtractionTrustedOrigin, parseNarrativeJsonHttpBody,
  narrativeExtractionHttpScopeSchema } from "./composition-narrative-extraction-http-policy";

export interface NarrativeFragmentPlanHttpDependencies {
  configuredAppUrl: () => string | null;
  authorize: () => Promise<NarrativeExtractionHttpAuthorization>;
  consumeRateLimit: (scope: { organizationId: string; userId: string }, signal: AbortSignal) => Promise<
    { status: "ALLOWED" | "UNAVAILABLE" } | { status: "LIMITED"; retryAfterSeconds: number }>;
  createRepository: (signal: AbortSignal) => NarrativeFragmentReadRepository;
  logFailure?: (requestId: string, error: unknown) => void;
}

/** Read-only eligibility, not a write gate or an asset/Storage attestation. */
export function createNarrativeFragmentPlanHttpHandler(dependencies: NarrativeFragmentPlanHttpDependencies) {
  return async (request: Request, rawDraftId: unknown): Promise<Response> => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, Origin", "x-request-id": requestId };
    const fail = (status: number, code: ApiErrorCode, reason: string, extra?: Record<string, string>) =>
      Response.json(createApiErrorBody({ code, requestId, message: "No se pudo preparar la revisión audiovisual.",
        retryable: false, details: { reason, automaticRetryAllowed: false } }), { status, headers: { ...headers, ...extra } });
    try {
      if (request.method !== "POST") return fail(405, API_ERROR_CODE.invalidRequest, "METHOD_INVALID", { Allow: "POST" });
      const origin = resolveNarrativeExtractionTrustedOrigin(dependencies.configuredAppUrl());
      if (!origin) return fail(503, API_ERROR_CODE.dependencyUnavailable, "ORIGIN_UNCONFIGURED");
      if (!acceptsNarrativeExtractionOrigin(request, origin)) return fail(403, API_ERROR_CODE.tenantForbidden, "ORIGIN_FORBIDDEN");
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) {
        return fail(415, API_ERROR_CODE.unsupportedMediaType, "MEDIA_TYPE_INVALID");
      }
      const draftId = z.string().uuid().safeParse(rawDraftId);
      if (!draftId.success || new URL(request.url).search) return fail(400, API_ERROR_CODE.invalidRequest, "REQUEST_INVALID");
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS)]);
      signal.throwIfAborted();
      const authorized = await dependencies.authorize();
      signal.throwIfAborted();
      if (authorized.status !== "AUTHORIZED") return fail(authorized.status === "AUTH_REQUIRED" ? 401 : 403,
        API_ERROR_CODE[authorized.status === "AUTH_REQUIRED" ? "authRequired" : authorized.status === "ROLE_FORBIDDEN" ? "roleForbidden" : "tenantForbidden"], authorized.status);
      const scope = narrativeExtractionHttpScopeSchema.safeParse({ organizationId: authorized.organizationId, userId: authorized.userId });
      if (!scope.success) return fail(403, API_ERROR_CODE.tenantForbidden, "TENANT_FORBIDDEN");
      const limit = await dependencies.consumeRateLimit(scope.data, signal);
      signal.throwIfAborted();
      if (limit.status === "UNAVAILABLE") return fail(503, API_ERROR_CODE.dependencyUnavailable, "RATE_LIMIT_UNAVAILABLE");
      if (limit.status === "LIMITED") return fail(429, API_ERROR_CODE.rateLimited, "RATE_LIMITED", {
        "Retry-After": String(Number.isInteger(limit.retryAfterSeconds) ? Math.min(60, Math.max(1, limit.retryAfterSeconds)) : 60) });
      const parsed = await parseNarrativeJsonHttpBody(request, signal, narrativeFragmentQuerySchema);
      if (!parsed.ok) return fail(parsed.reason === "TOO_LARGE" ? 413 : 400,
        parsed.reason === "TOO_LARGE" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, parsed.reason);
      signal.throwIfAborted();
      const result = await queryNarrativeFragment({ draftId: draftId.data, organizationId: scope.data.organizationId,
        request: parsed.command, commandId: randomUUID(), repository: dependencies.createRepository(signal), signal });
      signal.throwIfAborted();
      if (!result.ok) {
        const status = result.reason === "DRAFT_NOT_FOUND" ? 404 : result.reason === "STALE_DOCUMENT" ? 409 : 422;
        return fail(status, status === 404 ? API_ERROR_CODE.resourceNotFound : status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest, result.reason);
      }
      return Response.json({ success: true, requestId, correlationId: requestId, data: result.summary }, { status: 200, headers });
    } catch (error) {
      if (error instanceof CompositionDocumentError && error.status === 404) return fail(404, API_ERROR_CODE.resourceNotFound, "DRAFT_NOT_FOUND");
      if (dependencies.logFailure) dependencies.logFailure(requestId, error);
      else createOperationalLogger("production.narrative_fragment.plan", { correlationId: requestId })
        .error("production.narrative_fragment.plan_failed", error);
      return fail(503, API_ERROR_CODE.dependencyUnavailable, "OPERATION_UNAVAILABLE");
    }
  };
}
