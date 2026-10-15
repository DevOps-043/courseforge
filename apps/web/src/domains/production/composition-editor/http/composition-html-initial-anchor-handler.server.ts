import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { REVIEWER_ROLE_SET } from "../../../../lib/pipeline-constants";
import type { HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";
import { readHtmlSnapshotRequestBody } from "./composition-html-snapshot-request-body.server";
import { HTML_INITIAL_ANCHOR_POLICY as policy, htmlInitialAnchorRequestSchema, htmlInitialAnchorViewSchema,
  type HtmlInitialAnchorCommand } from "../composition-html-initial-anchor.contract";
import { HtmlInitialAnchorError } from "../composition-html-initial-anchor.server";
import { CompositionSnapshotError } from "../composition-snapshot.service";

const paramsSchema = z.object({ draftId: z.string().uuid() }).strict();
const rateSchema = z.array(z.object({ allowed: z.boolean() }).passthrough()).length(1);
export function createHtmlInitialAnchorHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<HtmlReadAuthentication>; serviceClient: () => SupabaseClient;
  read: (client: SupabaseClient, command: HtmlInitialAnchorCommand, signal: AbortSignal) => Promise<unknown>;
  prepare: (client: SupabaseClient, command: HtmlInitialAnchorCommand, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return async (request: Request, rawParams: unknown) => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, Origin", "x-request-id": requestId };
    const fail = (status: number, code: typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE], message: string, extra?: Record<string,string>) =>
      Response.json(createApiErrorBody({ code, message, requestId, retryable: false }), { status, headers: { ...headers, ...extra } });
    try {
      if (request.method !== "GET" && request.method !== "POST") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.", { Allow: "GET, POST" });
      if (!dependencies.enabled()) return fail(503, API_ERROR_CODE.dependencyUnavailable, "La preparación HTML no está habilitada.");
      const url = new URL(request.url), origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
      if ((request.method === "POST" ? origin !== url.origin : origin !== null && origin !== url.origin)
        || (site !== null && site !== "same-origin" && site !== "none")) return fail(403, API_ERROR_CODE.tenantForbidden, "Solicitud no autorizada.");
      const params = paramsSchema.safeParse(rawParams), entries = [...url.searchParams.entries()];
      const query = request.method === "GET" ? htmlInitialAnchorRequestSchema.safeParse(Object.fromEntries(entries)) : null;
      if (!params.success || Buffer.byteLength(request.url) > policy.maximumUrlBytes
        || new Set(entries.map(([key]) => key)).size !== entries.length
        || (request.method === "GET" ? !query?.success : !!url.search)) return fail(400, API_ERROR_CODE.invalidRequest, "Solicitud no válida.");
      if (request.method === "POST" && request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase() !== "application/json")
        return fail(415, API_ERROR_CODE.unsupportedMediaType, "Se requiere JSON.");
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(policy.timeoutMs)]);
      signal.throwIfAborted();
      const auth = await dependencies.authenticate(); signal.throwIfAborted();
      if (!auth.actorId) return fail(401, API_ERROR_CODE.authRequired, "No autorizado.");
      if (!auth.tenant || auth.tenant.userId !== auth.actorId || !z.string().uuid().safeParse(auth.actorId).success
        || !z.string().uuid().safeParse(auth.tenant.organizationId).success) return fail(403, API_ERROR_CODE.tenantForbidden, "Empresa no autorizada.");
      if (!auth.tenant.platformRole || !REVIEWER_ROLE_SET.has(auth.tenant.platformRole)) return fail(403, API_ERROR_CODE.roleForbidden, "No tienes permisos para preparar HTML.");
      const client = dependencies.serviceClient();
      for (const [key, limit] of [[`html-initial-anchor:${request.method}:org:${auth.tenant.organizationId}`, policy.organizationRequests],
        [`html-initial-anchor:${request.method}:actor:${auth.tenant.organizationId}:${auth.actorId}`, policy.actorRequests]] as const) {
        const rate = await client.rpc("consume_api_rate_limit", { p_rate_key: key, p_limit: limit, p_window_seconds: policy.windowSeconds }).abortSignal(signal);
        signal.throwIfAborted();
        if (rate.error || rate.data == null || Buffer.byteLength(JSON.stringify(rate.data)) > policy.maximumRateResponseBytes) throw new Error();
        if (!rateSchema.parse(rate.data)[0]!.allowed) return fail(429, API_ERROR_CODE.rateLimited, "Demasiadas solicitudes.", { "Retry-After": String(policy.windowSeconds) });
      }
      const body = request.method === "POST" ? await readHtmlSnapshotRequestBody(request, htmlInitialAnchorRequestSchema,
        policy.maximumRequestBytes, AbortSignal.any([signal, AbortSignal.timeout(policy.bodyTimeoutMs)])) : query!;
      if (!body.success) {
        const tooLarge = "reason" in body && body.reason === "too_large";
        return fail(tooLarge ? 413 : 400, tooLarge ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, "Solicitud no válida.");
      }
      signal.throwIfAborted();
      const command = { ...body.data, documentId: params.data.draftId, actorId: auth.actorId, organizationId: auth.tenant.organizationId };
      const view = htmlInitialAnchorViewSchema.parse(await (request.method === "GET" ? dependencies.read : dependencies.prepare)(client, command, signal));
      signal.throwIfAborted();
      if (view.documentId !== command.documentId || view.documentHash !== command.expectedDocumentHash) throw new Error();
      return Response.json({ success: true, data: view, requestId, correlationId: requestId }, { headers });
    } catch (error) {
      if ((error instanceof HtmlInitialAnchorError && error.code === "CONFLICT") || (error instanceof CompositionSnapshotError && error.status === 409))
        return fail(409, API_ERROR_CODE.conflict, "El borrador cambió o requiere calcular su duración. Revisa la composición antes de continuar.");
      try { dependencies.logFailure?.(requestId); } catch { /* No provider payloads. */ }
      return fail(503, API_ERROR_CODE.dependencyUnavailable, "No se pudo confirmar la preparación. Consulta su disponibilidad sin repetir el envío.");
    }
  };
}
