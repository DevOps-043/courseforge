import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { REVIEWER_ROLE_SET } from "../../../../lib/pipeline-constants";
import { htmlEditingBindingSchema } from "../html-editing/html-editing.contract";
import { HtmlEditingRevisionError } from "../html-editing/html-editing-revision.contract";
import { HtmlEditingCatalogError } from "../html-editing/html-editing-template-catalog.server";
import { htmlEditingInitializationRequestSchema, HTML_EDITING_INITIALIZATION_HTTP_POLICY as writePolicy } from "../composition-html-editing-initialization-http.contract";
import { HTML_EDITING_INITIALIZATION_OPERATION_POLICY, htmlEditingInitializationOperationReceiptSchema,
  htmlEditingInitializationOperationReadSchema } from "../composition-html-editing-initialization-operation.contract";
import { HTML_EDITING_INITIALIZATION_OPERATION_HTTP_POLICY as policy } from "../composition-html-editing-initialization-operation-http-policy";
import { computeHtmlEditingInitializationRequestSha256 } from "../composition-html-editing-initialization-operation-digest.server";
import type { CompositionHtmlEditingBootstrapHost } from "../composition-html-editing-bootstrap-host.server";
import { SupabaseHtmlEditingRevisionRepository } from "../composition-html-editing-repository.service";
import { readHtmlSnapshotRequestBody } from "./composition-html-snapshot-request-body.server";

const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const paramsSchema = z.object({ draftId: uuid, clipId: htmlEditingBindingSchema.shape.clipId, operationId: uuid }).strict();
const rateSchema = z.array(z.object({ allowed: z.boolean(), reset_at: z.string().datetime({ offset: true }) }).passthrough()).length(1);
type Authentication = { actorId: string | null; tenant: { organizationId: string; userId: string; platformRole: string | null } | null };
type RegisterInput = Parameters<CompositionHtmlEditingBootstrapHost["registerOperation"]>[0];
type ReadInput = Parameters<SupabaseHtmlEditingRevisionRepository["readInitializationOperation"]>[0];

/** Durable initialization only. Authentication derives scope; GET never registers
 * or authorizes retry. Read gate remains separate from new-write gate. */
export function createHtmlEditingInitializationOperationHandler(dependencies: {
  enabled: (method: "GET" | "POST") => boolean; authenticate: () => Promise<Authentication>; serviceClient: () => SupabaseClient;
  register: (client: SupabaseClient, input: RegisterInput, signal: AbortSignal) => Promise<unknown>;
  read?: (client: SupabaseClient, input: ReadInput) => Promise<unknown>; logFailure?: (requestId: string) => void;
}) {
  return async (request: Request, rawParams: unknown): Promise<Response> => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, Origin", "x-request-id": requestId };
    const fail = (status: number, code: typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE], message: string, extra?: Record<string, string>) =>
      Response.json(createApiErrorBody({ code, message, requestId, retryable: false }), { status, headers: { ...headers, ...extra } });
    try {
      if (request.method !== "GET" && request.method !== "POST") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.", { Allow: "GET, POST" });
      const method = request.method;
      if (!dependencies.enabled(method)) return fail(503, API_ERROR_CODE.dependencyUnavailable, "Los recibos de inicialización aún no están habilitados.");
      const url = new URL(request.url), origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
      if ((method === "POST" ? origin !== url.origin : origin !== null && origin !== url.origin)
        || (site !== null && site !== "same-origin" && site !== "none")) return fail(403, API_ERROR_CODE.tenantForbidden, "Solicitud no autorizada.");
      const params = paramsSchema.safeParse(rawParams), query = [...url.searchParams.entries()];
      const digest = method === "GET" && query.length === 1 && query[0]?.[0] === "requestSha256" ? hash.safeParse(query[0][1]) : null;
      if (!params.success || Buffer.byteLength(request.url) > policy.maximumUrlBytes
        || (method === "GET" ? !digest?.success : !!url.search)) return fail(400, API_ERROR_CODE.invalidRequest, "La solicitud no es válida.");
      if (method === "POST" && request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")
        return fail(415, API_ERROR_CODE.unsupportedMediaType, "Se requiere una solicitud JSON.");
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(method === "GET" ? policy.readTimeoutMs : writePolicy.timeoutMs)]);
      signal.throwIfAborted();
      const authentication = await dependencies.authenticate(); signal.throwIfAborted();
      if (!authentication.actorId) return fail(401, API_ERROR_CODE.authRequired, "No autorizado.");
      const tenant = authentication.tenant;
      if (!tenant || tenant.userId !== authentication.actorId || !uuid.safeParse(authentication.actorId).success || !uuid.safeParse(tenant.organizationId).success)
        return fail(403, API_ERROR_CODE.tenantForbidden, "Empresa no válida o no autorizada.");
      if (!tenant.platformRole || !REVIEWER_ROLE_SET.has(tenant.platformRole)) return fail(403, API_ERROR_CODE.roleForbidden, "No tienes permisos para inicializar HTML.");
      const client = dependencies.serviceClient(), prefix = method === "POST" ? "html-editing-initialization" : "html-initialization-receipt";
      for (const [key, limit] of [[`${prefix}:org:${tenant.organizationId}`, method === "POST" ? writePolicy.organizationRequestsPerWindow : policy.organizationReadRequests],
        [`${prefix}:actor:${tenant.organizationId}:${authentication.actorId}`, method === "POST" ? writePolicy.actorRequestsPerWindow : policy.actorReadRequests]] as const) {
        const rate = await client.rpc("consume_api_rate_limit", { p_rate_key: key, p_limit: limit, p_window_seconds: policy.windowSeconds }).abortSignal(signal);
        signal.throwIfAborted();
        if (rate.error || rate.data == null || Buffer.byteLength(JSON.stringify(rate.data)) > policy.maximumRateResponseBytes) throw new Error();
        if (!rateSchema.parse(rate.data)[0]!.allowed) return fail(429, API_ERROR_CODE.rateLimited, "Demasiadas solicitudes.", { "Retry-After": String(policy.windowSeconds) });
      }
      const owner = { actorId: authentication.actorId, organizationId: tenant.organizationId, draftId: params.data.draftId };
      let requestSha256: string, data: unknown;
      if (method === "POST") {
        const body = await readHtmlSnapshotRequestBody(request, htmlEditingInitializationRequestSchema, writePolicy.maximumRequestBytes,
          AbortSignal.any([signal, AbortSignal.timeout(writePolicy.bodyTimeoutMs)]));
        signal.throwIfAborted();
        if (!body.success) return fail(body.reason === "too_large" ? 413 : 400,
          body.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, "La solicitud de inicialización no es válida.");
        requestSha256 = computeHtmlEditingInitializationRequestSha256(body.data);
        data = await dependencies.register(client, { ...body.data, actorId: owner.actorId, organizationId: owner.organizationId,
          documentId: owner.draftId, clipId: params.data.clipId, operationId: params.data.operationId }, signal);
      } else {
        requestSha256 = digest!.data!;
        const read = dependencies.read ?? ((admin: SupabaseClient, input: ReadInput) => new SupabaseHtmlEditingRevisionRepository(admin).readInitializationOperation(input));
        data = await read(client, { actorId: owner.actorId, scope: { organizationId: owner.organizationId, documentId: owner.draftId, clipId: params.data.clipId },
          operationId: params.data.operationId, requestSha256, signal });
      }
      signal.throwIfAborted();
      if (Buffer.byteLength(JSON.stringify(data) ?? "", "utf8") > HTML_EDITING_INITIALIZATION_OPERATION_POLICY.maximumReceiptBytes) throw new Error();
      const result = method === "POST" ? { status: "RECORDED" as const, receipt: htmlEditingInitializationOperationReceiptSchema.parse(data) }
        : htmlEditingInitializationOperationReadSchema.parse(data);
      if (result.status === "RECORDED") {
        const receipt = result.receipt;
        if (receipt.owner.actorId !== owner.actorId || receipt.owner.organizationId !== owner.organizationId || receipt.owner.draftId !== owner.draftId
          || receipt.clipId !== params.data.clipId || receipt.operationId !== params.data.operationId || receipt.requestSha256 !== requestSha256
          || computeHtmlEditingInitializationRequestSha256(receipt.request) !== requestSha256) throw new Error();
      }
      // Always 200: created=true may be an immutable historical result on replay.
      return Response.json({ success: true, data: result, requestId, correlationId: requestId }, { headers });
    } catch (error) {
      if (error instanceof HtmlEditingRevisionError && error.code === "REVISION_CONFLICT") return fail(409, API_ERROR_CODE.conflict, "El documento o la revisión inicial cambió.");
      if (error instanceof HtmlEditingCatalogError && error.code === "TEMPLATE_UNAVAILABLE") return fail(409, API_ERROR_CODE.conflict, "La plantilla instalada no es compatible.");
      try { dependencies.logFailure?.(requestId); } catch { /* Safe metadata only. */ }
      return fail(503, API_ERROR_CODE.dependencyUnavailable, "No se pudo verificar el resultado. Conserva el seguimiento; no repitas la inicialización automáticamente.");
    }
  };
}
