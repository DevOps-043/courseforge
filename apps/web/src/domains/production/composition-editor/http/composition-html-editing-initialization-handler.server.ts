import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { REVIEWER_ROLE_SET } from "../../../../lib/pipeline-constants";
import { htmlEditingBindingSchema } from "../html-editing/html-editing.contract";
import { HtmlEditingRevisionError } from "../html-editing/html-editing-revision.contract";
import { HtmlEditingCatalogError } from "../html-editing/html-editing-template-catalog.server";
import { htmlEditingInitializationRequestSchema, htmlEditingInitializationAcknowledgmentSchema as acknowledgmentSchema, HTML_EDITING_INITIALIZATION_HTTP_POLICY as policy } from "../composition-html-editing-initialization-http.contract";
import { readHtmlSnapshotRequestBody } from "./composition-html-snapshot-request-body.server";

const uuid = z.string().uuid();
const rateSchema = z.array(z.object({ allowed: z.boolean(), reset_at: z.string().datetime({ offset: true }) }).passthrough()).length(1);
type Authentication = { actorId: string | null; tenant: { organizationId: string; userId: string; platformRole: string | null } | null };
export type HtmlEditingInitializationHttpInput = z.infer<typeof htmlEditingInitializationRequestSchema> & {
  actorId: string; organizationId: string; documentId: string; clipId: string;
};

/** Strict same-origin mutation with host-derived identity and shared quotas.
 * Registration rechecks source/role/grants/CAS. Never retry an uncertain result. */
export function createHtmlEditingInitializationHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<Authentication>; serviceClient: () => SupabaseClient;
  register: (client: SupabaseClient, input: HtmlEditingInitializationHttpInput, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return async (request: Request, rawParams: unknown): Promise<Response> => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, Origin", "x-request-id": requestId };
    const fail = (status: number, code: typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE], message: string, extra?: Record<string, string>) =>
      Response.json(createApiErrorBody({ code, message, requestId, retryable: false }), { status, headers: { ...headers, ...extra } });
    try {
      if (!dependencies.enabled()) return fail(503, API_ERROR_CODE.dependencyUnavailable, "La inicialización HTML aún no está habilitada.");
      if (request.method !== "POST") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.", { Allow: "POST" });
      const url = new URL(request.url);
      if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site")
        return fail(403, API_ERROR_CODE.tenantForbidden, "Solicitud no autorizada.");
      const params = z.object({ draftId: uuid, clipId: htmlEditingBindingSchema.shape.clipId }).strict().safeParse(rawParams);
      if (!params.success || url.search || Buffer.byteLength(request.url) > policy.maximumUrlBytes)
        return fail(400, API_ERROR_CODE.invalidRequest, "La solicitud no es válida.");
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")
        return fail(415, API_ERROR_CODE.unsupportedMediaType, "Se requiere una solicitud JSON.");
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(policy.timeoutMs)]);
      signal.throwIfAborted();
      const authentication = await dependencies.authenticate(); signal.throwIfAborted();
      if (!authentication.actorId) return fail(401, API_ERROR_CODE.authRequired, "No autorizado.");
      const tenant = authentication.tenant;
      if (!tenant || tenant.userId !== authentication.actorId || !uuid.safeParse(authentication.actorId).success || !uuid.safeParse(tenant.organizationId).success)
        return fail(403, API_ERROR_CODE.tenantForbidden, "Empresa no válida o no autorizada.");
      if (!tenant.platformRole || !REVIEWER_ROLE_SET.has(tenant.platformRole))
        return fail(403, API_ERROR_CODE.roleForbidden, "No tienes permisos para inicializar HTML editable.");
      const client = dependencies.serviceClient();
      for (const [key, limit] of [[`html-editing-initialization:org:${tenant.organizationId}`, policy.organizationRequestsPerWindow],
        [`html-editing-initialization:actor:${tenant.organizationId}:${authentication.actorId}`, policy.actorRequestsPerWindow]] as const) {
        const rate = await client.rpc("consume_api_rate_limit", { p_rate_key: key, p_limit: limit, p_window_seconds: policy.windowSeconds }).abortSignal(signal);
        signal.throwIfAborted();
        if (rate.error || rate.data == null || Buffer.byteLength(JSON.stringify(rate.data)) > policy.maximumRateResponseBytes) throw new Error();
        if (!rateSchema.parse(rate.data)[0]!.allowed) return fail(429, API_ERROR_CODE.rateLimited, "Demasiadas solicitudes.", { "Retry-After": String(policy.windowSeconds) });
      }
      const body = await readHtmlSnapshotRequestBody(request, htmlEditingInitializationRequestSchema, policy.maximumRequestBytes,
        AbortSignal.any([signal, AbortSignal.timeout(policy.bodyTimeoutMs)]));
      signal.throwIfAborted();
      if (!body.success) return fail(body.reason === "too_large" ? 413 : 400,
        body.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, "La solicitud de inicialización no es válida.");
      const data = acknowledgmentSchema.parse(await dependencies.register(client, { ...body.data, actorId: authentication.actorId,
        organizationId: tenant.organizationId, documentId: params.data.draftId, clipId: params.data.clipId }, signal));
      signal.throwIfAborted();
      if (data.compositionDocumentHash !== body.data.expectedDocumentHash) throw new Error();
      return Response.json({ success: true, data, requestId, correlationId: requestId }, { status: data.created ? 201 : 200, headers });
    } catch (error) {
      if (error instanceof HtmlEditingRevisionError && error.code === "REVISION_CONFLICT")
        return fail(409, API_ERROR_CODE.conflict, "El documento o la revisión HTML cambió. Actualiza su estado antes de continuar.");
      if (error instanceof HtmlEditingCatalogError && error.code === "TEMPLATE_UNAVAILABLE")
        return fail(409, API_ERROR_CODE.conflict, "No hay una plantilla instalada compatible con este documento.");
      // Logging is best effort; provider failures must not replace a safe reply.
      try { dependencies.logFailure?.(requestId); } catch { /* No provider payload is exposed. */ }
      return fail(503, API_ERROR_CODE.dependencyUnavailable, "No se pudo confirmar la inicialización. Revisa el estado; no repitas el envío automáticamente.");
    }
  };
}
