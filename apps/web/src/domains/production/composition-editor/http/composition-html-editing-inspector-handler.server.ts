import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { REVIEWER_ROLE_SET } from "../../../../lib/pipeline-constants";
import { HTML_EDITING_INSPECTOR_HTTP_POLICY as policy } from "../composition-html-editing-inspector-http-policy";
import { htmlEditingBindingSchema } from "../html-editing/html-editing.contract";
import { htmlEditingInspectorViewSchema, HTML_EDITING_INSPECTOR_POLICY } from "../html-editing/html-editing-inspector.contract";
import { createHtmlEditingInspectorView } from "../html-editing/html-editing-inspector.server";
import { SupabaseHtmlEditingRevisionRepository } from "../composition-html-editing-repository.service";

const uuid = z.string().uuid();
const rateSchema = z.array(z.object({ allowed: z.boolean(), reset_at: z.string().datetime({ offset: true }) }).passthrough()).length(1);
type Authentication = { actorId: string | null; tenant: { organizationId: string; userId: string; platformRole: string | null } | null };
type ReadInput = { actorId: string; scope: { organizationId: string; documentId: string; clipId: string }; signal: AbortSignal };
/** Metadata read only, except shared quota counters. No implicit initialization,
 * grant/upload/revision/render writes or HTML execution. SQL rechecks authority. */
export function createHtmlEditingInspectorHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<Authentication>; serviceClient: () => SupabaseClient;
  read?: (client: SupabaseClient, input: ReadInput) => Promise<unknown>; logFailure?: (requestId: string) => void;
}) {
  return async (request: Request, rawParams: unknown): Promise<Response> => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, Origin", "x-request-id": requestId };
    const fail = (status: number, code: typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE], message: string, extra?: Record<string, string>) =>
      Response.json(createApiErrorBody({ code, message, requestId, retryable: false }), { status, headers: { ...headers, ...extra } });
    try {
      if (!dependencies.enabled()) return fail(503, API_ERROR_CODE.dependencyUnavailable, "La lectura HTML aún no está habilitada.");
      if (request.method !== "GET") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.", { Allow: "GET" });
      const url = new URL(request.url), origin = request.headers.get("origin");
      const fetchSite = request.headers.get("sec-fetch-site");
      if ((fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") || (origin !== null && origin !== url.origin))
        return fail(403, API_ERROR_CODE.tenantForbidden, "Solicitud no autorizada.");
      const params = z.object({ draftId: uuid, clipId: htmlEditingBindingSchema.shape.clipId }).strict().safeParse(rawParams);
      if (!params.success || url.search || Buffer.byteLength(request.url) > policy.maximumUrlBytes)
        return fail(400, API_ERROR_CODE.invalidRequest, "La solicitud no es válida.");
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(policy.timeoutMs)]);
      signal.throwIfAborted();
      const authentication = await dependencies.authenticate(); signal.throwIfAborted();
      if (!authentication.actorId) return fail(401, API_ERROR_CODE.authRequired, "No autorizado.");
      const tenant = authentication.tenant;
      if (!tenant || tenant.userId !== authentication.actorId || !uuid.safeParse(authentication.actorId).success || !uuid.safeParse(tenant.organizationId).success)
        return fail(403, API_ERROR_CODE.tenantForbidden, "Empresa no válida o no autorizada.");
      if (!tenant.platformRole || !REVIEWER_ROLE_SET.has(tenant.platformRole))
        return fail(403, API_ERROR_CODE.roleForbidden, "No tienes permisos para inspeccionar HTML editable.");
      const client = dependencies.serviceClient();
      for (const [key, limit] of [[`html-editing-inspector:org:${tenant.organizationId}`, policy.organizationRequestsPerWindow],
        [`html-editing-inspector:actor:${tenant.organizationId}:${authentication.actorId}`, policy.actorRequestsPerWindow]] as const) {
        const rate = await client.rpc("consume_api_rate_limit", { p_rate_key: key, p_limit: limit, p_window_seconds: policy.windowSeconds }).abortSignal(signal);
        signal.throwIfAborted();
        if (rate.error || rate.data == null || Buffer.byteLength(JSON.stringify(rate.data)) > policy.maximumRateResponseBytes) throw new Error();
        if (!rateSchema.parse(rate.data)[0]!.allowed) return fail(429, API_ERROR_CODE.rateLimited, "Demasiadas consultas.", { "Retry-After": String(policy.windowSeconds) });
      }
      const input = { actorId: authentication.actorId, scope: { organizationId: tenant.organizationId,
        documentId: params.data.draftId, clipId: params.data.clipId }, signal };
      const payload = await (dependencies.read ?? (async (admin, current) => createHtmlEditingInspectorView(
        await new SupabaseHtmlEditingRevisionRepository(admin).readAuthorized(current))))(client, input);
      signal.throwIfAborted();
      if (Buffer.byteLength(JSON.stringify(payload) ?? "", "utf8") > HTML_EDITING_INSPECTOR_POLICY.responseBytes) throw new Error();
      const data = htmlEditingInspectorViewSchema.parse(payload);
      const binding = data.manifest.binding;
      if (binding.organizationId !== tenant.organizationId || binding.documentId !== params.data.draftId || binding.clipId !== params.data.clipId) throw new Error();
      return Response.json({ success: true, data, requestId, correlationId: requestId }, { headers });
    } catch {
      try { dependencies.logFailure?.(requestId); } catch { /* Observability cannot replace the safe response. */ }
      return fail(503, API_ERROR_CODE.dependencyUnavailable, "No se pudo leer el estado editorial. No se ha inicializado ni modificado contenido.");
    }
  };
}
