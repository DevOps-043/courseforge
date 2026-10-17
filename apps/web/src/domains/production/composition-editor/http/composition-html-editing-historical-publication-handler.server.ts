import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { REVIEWER_ROLE_SET } from "../../../../lib/pipeline-constants";
import type { HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";
import { readHtmlSnapshotRequestBody } from "./composition-html-snapshot-request-body.server";
import { HTML_HISTORICAL_PUBLICATION_HTTP_POLICY as policy, htmlHistoricalPublicationHttpQuerySchema,
  htmlHistoricalPublicationHttpRequestSchema } from "../composition-html-editing-historical-publication-http.contract";
import { htmlHistoricalPublicationCommandSchema, htmlHistoricalPublicationReadSchema,
  htmlHistoricalPublicationReceiptSchema, type HtmlHistoricalPublicationCommand } from "../composition-html-editing-historical-publication.contract";
import { historicalHtmlPublicationRequestPreimage } from "../composition-html-editing-historical-publication-preimage";

const uuid = z.string().uuid();
const paramsSchema = z.object({draftId: uuid, operationId: uuid}).strict();
const rateSchema = z.array(z.object({allowed: z.boolean(), reset_at: z.string().datetime({offset: true})}).passthrough()).length(1);

/** Only IDs/digests cross this boundary. No approval, ZIP, HTML or active-state
 * ACK. GET recovers metadata only; errors/NOT_FOUND never authorize POST retries. */
export function createHtmlHistoricalPublicationHandler(dependencies: {
  enabled: (method: "GET" | "POST") => boolean; authenticate: () => Promise<HtmlReadAuthentication>;
  serviceClient: () => SupabaseClient;
  commit: (client: SupabaseClient, command: HtmlHistoricalPublicationCommand, signal: AbortSignal) => Promise<unknown>;
  read: (client: SupabaseClient, command: HtmlHistoricalPublicationCommand, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return async (request: Request, rawParams: unknown) => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = {"Cache-Control": "private, no-store", Vary: "Cookie, Authorization, Origin", "x-request-id": requestId};
    const fail = (status: number, code: typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE], message: string, extra?: Record<string, string>) =>
      Response.json(createApiErrorBody({code, message, requestId, retryable: false}), {status, headers: {...headers, ...extra}});
    try {
      if (request.method !== "GET" && request.method !== "POST") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.", {Allow: "GET, POST"});
      const method = request.method;
      if (!dependencies.enabled(method)) return fail(503, API_ERROR_CODE.dependencyUnavailable, "El registro histórico HTML no está habilitado.");
      const url = new URL(request.url), origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
      if ((method === "POST" ? origin !== url.origin : origin !== null && origin !== url.origin)
        || site !== null && site !== "same-origin" && site !== "none") return fail(403, API_ERROR_CODE.tenantForbidden, "Solicitud no autorizada.");
      const params = paramsSchema.safeParse(rawParams), entries = [...url.searchParams.entries()];
      const query = method === "GET" ? htmlHistoricalPublicationHttpQuerySchema.safeParse(Object.fromEntries(entries)) : null;
      if (!params.success || Buffer.byteLength(request.url, "utf8") > policy.maximumUrlBytes
        || new Set(entries.map(([key]) => key)).size !== entries.length
        || (method === "GET" ? !query?.success : !!url.search)) return fail(400, API_ERROR_CODE.invalidRequest, "La solicitud no es válida.");
      if (method === "POST" && request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")
        return fail(415, API_ERROR_CODE.unsupportedMediaType, "Se requiere JSON.");
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(policy.timeoutMs)]); signal.throwIfAborted();
      const authentication = await dependencies.authenticate(); signal.throwIfAborted();
      if (!authentication.actorId) return fail(401, API_ERROR_CODE.authRequired, "No autorizado.");
      const tenant = authentication.tenant;
      if (!tenant || tenant.userId !== authentication.actorId || !uuid.safeParse(authentication.actorId).success
        || !uuid.safeParse(tenant.organizationId).success) return fail(403, API_ERROR_CODE.tenantForbidden, "Empresa no válida o no autorizada.");
      if (!tenant.platformRole || !REVIEWER_ROLE_SET.has(tenant.platformRole)) return fail(403, API_ERROR_CODE.roleForbidden, "No tienes permisos para registrar HTML.");
      const client = dependencies.serviceClient(), prefix = method === "POST" ? "html-historical-publication" : "html-historical-publication-receipt";
      for (const [key, limit] of [[`${prefix}:org:${tenant.organizationId}`, policy.organizationRequests],
        [`${prefix}:actor:${tenant.organizationId}:${authentication.actorId}`, policy.actorRequests]] as const) {
        const rate = await client.rpc("consume_api_rate_limit", {p_rate_key: key, p_limit: limit, p_window_seconds: policy.windowSeconds}).abortSignal(signal);
        signal.throwIfAborted();
        if (rate.error || rate.data == null || Buffer.byteLength(JSON.stringify(rate.data), "utf8") > policy.maximumRateResponseBytes) throw new Error();
        if (!rateSchema.parse(rate.data)[0]!.allowed) return fail(429, API_ERROR_CODE.rateLimited, "Demasiadas solicitudes.", {"Retry-After": String(policy.windowSeconds)});
      }
      let body: z.infer<typeof htmlHistoricalPublicationHttpRequestSchema>;
      if (method === "POST") {
        const decoded = await readHtmlSnapshotRequestBody(request, htmlHistoricalPublicationHttpRequestSchema, policy.maximumRequestBytes,
          AbortSignal.any([signal, AbortSignal.timeout(policy.bodyTimeoutMs)]));
        signal.throwIfAborted();
        if (!decoded.success) return fail(decoded.reason === "too_large" ? 413 : 400,
          decoded.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, "La solicitud no es válida.");
        body = decoded.data;
      } else body = htmlHistoricalPublicationHttpRequestSchema.parse({compositionId: query!.data!.compositionId,
        candidateId: query!.data!.candidateId, candidateSha256: query!.data!.candidateSha256});
      const command = htmlHistoricalPublicationCommandSchema.parse({...params.data, actorId: authentication.actorId,
        organizationId: tenant.organizationId, compositionId: body.compositionId,
        request: {candidateId: body.candidateId, candidateSha256: body.candidateSha256}});
      const requestSha256 = createHash("sha256").update(historicalHtmlPublicationRequestPreimage(command)).digest("hex");
      if (method === "GET" && query!.data!.requestSha256 !== requestSha256) return fail(400, API_ERROR_CODE.invalidRequest, "El seguimiento no coincide.");
      const raw = await (method === "POST" ? dependencies.commit : dependencies.read)(client, command, signal); signal.throwIfAborted();
      if (Buffer.byteLength(JSON.stringify(raw) ?? "", "utf8") > policy.maximumResponseBytes) throw new Error();
      const result = method === "POST" ? {status: "RECORDED" as const, receipt: htmlHistoricalPublicationReceiptSchema.parse(raw)}
        : htmlHistoricalPublicationReadSchema.parse(raw);
      if (result.status === "RECORDED" && (result.receipt.requestSha256 !== requestSha256
        || Object.entries(command).some(([key, value]) => !isDeepStrictEqual(value, result.receipt[key as keyof HtmlHistoricalPublicationCommand])))) throw new Error();
      return Response.json({success: true, data: result, requestId, correlationId: requestId}, {headers});
    } catch {
      try {dependencies.logFailure?.(requestId);} catch { /* Correlation metadata only. */ }
      return fail(503, API_ERROR_CODE.dependencyUnavailable, "Resultado sin confirmar. Conserva el seguimiento y consulta su recibo; no repitas el registro automáticamente.");
    }
  };
}
