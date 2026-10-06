import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { REVIEWER_ROLE_SET } from "../../../../lib/pipeline-constants";
import { htmlEditingBindingSchema } from "../html-editing/html-editing.contract";
import { HtmlEditingRevisionError } from "../html-editing/html-editing-revision.contract";
import { HtmlEditingValidationError } from "../html-editing/html-editing-validation";
import { htmlEditingMutationRequestSchema, htmlEditingMutationAcknowledgmentSchema,
  HTML_EDITING_MUTATION_HTTP_POLICY as policy, type HtmlEditingMutationInput } from "../composition-html-editing-mutation.contract";
import { createHtmlEditingMutationService } from "../composition-html-editing-mutation.server";
import { SupabaseHtmlEditingRevisionRepository } from "../composition-html-editing-repository.service";
import { readHtmlSnapshotRequestBody } from "./composition-html-snapshot-request-body.server";

const uuid = z.string().uuid();
const rateSchema = z.array(z.object({ allowed: z.boolean(), reset_at: z.string().datetime({ offset: true }) }).passthrough()).length(1);
type Authentication = { actorId: string | null; tenant: { organizationId: string; userId: string; platformRole: string | null } | null };
export function createHtmlEditingMutationHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<Authentication>; serviceClient: () => SupabaseClient;
  mutate?: (client: SupabaseClient, input: HtmlEditingMutationInput, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return async (request: Request, rawParams: unknown): Promise<Response> => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, Origin", "x-request-id": requestId };
    const fail = (status: number, code: typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE], message: string, extra?: Record<string, string>) =>
      Response.json(createApiErrorBody({ code, message, requestId, retryable: false }), { status, headers: { ...headers, ...extra } });
    try {
      if (!dependencies.enabled()) return fail(503, API_ERROR_CODE.dependencyUnavailable, "La edición HTML aún no está habilitada.");
      if (request.method !== "POST") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.", { Allow: "POST" });
      const url = new URL(request.url), fetchSite = request.headers.get("sec-fetch-site");
      if (request.headers.get("origin") !== url.origin || (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none"))
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
        return fail(403, API_ERROR_CODE.roleForbidden, "No tienes permisos para editar HTML.");
      const client = dependencies.serviceClient();
      for (const [key, limit] of [[`html-editing-mutation:org:${tenant.organizationId}`, policy.organizationRequestsPerWindow],
        [`html-editing-mutation:actor:${tenant.organizationId}:${authentication.actorId}`, policy.actorRequestsPerWindow]] as const) {
        const rate = await client.rpc("consume_api_rate_limit", { p_rate_key: key, p_limit: limit, p_window_seconds: policy.windowSeconds }).abortSignal(signal);
        signal.throwIfAborted();
        if (rate.error || rate.data == null || Buffer.byteLength(JSON.stringify(rate.data)) > policy.maximumRateResponseBytes) throw new Error();
        if (!rateSchema.parse(rate.data)[0]!.allowed) return fail(429, API_ERROR_CODE.rateLimited, "Demasiadas operaciones.", { "Retry-After": String(policy.windowSeconds) });
      }
      const body = await readHtmlSnapshotRequestBody(request, htmlEditingMutationRequestSchema, policy.maximumRequestBytes,
        AbortSignal.any([signal, AbortSignal.timeout(policy.bodyTimeoutMs)]));
      signal.throwIfAborted();
      if (!body.success) return fail(body.reason === "too_large" ? 413 : 400,
        body.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, "El comando editorial no es válido.");
      const mutate = dependencies.mutate ?? ((admin: SupabaseClient, input: HtmlEditingMutationInput, abort: AbortSignal) =>
        createHtmlEditingMutationService(new SupabaseHtmlEditingRevisionRepository(admin))(input, abort));
      const data = htmlEditingMutationAcknowledgmentSchema.parse(await mutate(client, { ...body.data, actorId: authentication.actorId,
        organizationId: tenant.organizationId, documentId: params.data.draftId, clipId: params.data.clipId }, signal));
      signal.throwIfAborted();
      if (data.previous.version !== body.data.expected.version || data.previous.sha256 !== body.data.expected.sha256) throw new Error();
      return Response.json({ success: true, data, requestId, correlationId: requestId }, { headers });
    } catch (error) {
      if (error instanceof HtmlEditingRevisionError && (error.code === "REVISION_CONFLICT" || error.code === "RESTORE_SOURCE_MISMATCH"))
        return fail(409, API_ERROR_CODE.conflict, "La revisión cambió o el historial no es compatible. Actualiza el estado antes de continuar.");
      if (error instanceof HtmlEditingValidationError) return fail(400, API_ERROR_CODE.invalidRequest, "El cambio no cumple las opciones o permisos actuales.");
      try { dependencies.logFailure?.(requestId); } catch { /* No provider payload is exposed. */ }
      return fail(503, API_ERROR_CODE.dependencyUnavailable, "No se pudo confirmar el cambio. Consulta el estado; no repitas el envío automáticamente.");
    }
  };
}
