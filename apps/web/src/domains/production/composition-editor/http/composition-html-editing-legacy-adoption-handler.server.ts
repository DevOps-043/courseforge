import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { REVIEWER_ROLE_SET } from "../../../../lib/pipeline-constants";
import { HTML_LEGACY_ADOPTION_HTTP_POLICY as policy } from "../composition-html-editing-legacy-adoption-http-policy";
import { HTML_LEGACY_ADOPTION_POLICY, htmlLegacyAdoptionCommandSchema, htmlLegacyAdoptionRequestSchema,
  htmlLegacyAdoptionReadSchema, htmlLegacyAdoptionReceiptSchema, htmlLegacyAdoptionScopeSchema,
  type HtmlLegacyAdoptionCommand } from "../composition-html-editing-legacy-adoption.contract";
import { computeHtmlLegacyAdoptionRequestSha256 } from "../composition-html-editing-legacy-adoption-digest.server";
import { HtmlLegacyAdoptionPersistenceError } from "../composition-html-editing-legacy-adoption-repository.server";
import { HtmlEditingLegacyAdoptionError } from "../composition-html-editing-legacy-adoption.server";
import { readHtmlSnapshotRequestBody } from "./composition-html-snapshot-request-body.server";

const uuid = z.string().uuid();
const paramsSchema = z.object({ draftId: uuid, clipId: htmlLegacyAdoptionScopeSchema.shape.clipId, operationId: uuid }).strict();
const querySchema = htmlLegacyAdoptionRequestSchema.extend({ requestSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const rateSchema = z.array(z.object({ allowed: z.boolean(), reset_at: z.string().datetime({ offset: true }) }).passthrough()).length(1);
type Authentication = { actorId: string | null; tenant: { organizationId: string; userId: string; platformRole: string | null } | null };

/** No source, package, approval or grants accepted over HTTP. Approval registration
 * is a separate operator workflow. Lost POSTs are recovered by GET only. */
export function createHtmlLegacyAdoptionHandler(dependencies: {
  enabled: (method: "GET" | "POST") => boolean;
  authenticate: () => Promise<Authentication>; serviceClient: () => SupabaseClient;
  commit: (client: SupabaseClient, command: HtmlLegacyAdoptionCommand, signal: AbortSignal) => Promise<unknown>;
  read: (client: SupabaseClient, command: HtmlLegacyAdoptionCommand, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return async (request: Request, rawParams: unknown): Promise<Response> => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, Origin", "x-request-id": requestId };
    const fail = (status: number, code: typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE], message: string, extra?: Record<string, string>) =>
      Response.json(createApiErrorBody({ code, message, requestId, retryable: false }), { status, headers: { ...headers, ...extra } });
    try {
      if (request.method !== "GET" && request.method !== "POST") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.", { Allow: "GET, POST" });
      const method = request.method;
      if (!dependencies.enabled(method)) return fail(503, API_ERROR_CODE.dependencyUnavailable, "La adopción HTML aún no está habilitada.");
      const url = new URL(request.url), origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
      if ((method === "POST" ? origin !== url.origin : origin !== null && origin !== url.origin)
        || (site !== null && site !== "same-origin" && site !== "none")) return fail(403, API_ERROR_CODE.tenantForbidden, "Solicitud no autorizada.");
      const params = paramsSchema.safeParse(rawParams), entries = [...url.searchParams.entries()];
      const query = method === "GET" && entries.length === 4 && new Set(entries.map(([key]) => key)).size === 4
        ? querySchema.safeParse(Object.fromEntries(entries)) : null;
      if (!params.success || Buffer.byteLength(request.url, "utf8") > policy.maximumUrlBytes
        || (method === "GET" ? !query?.success : !!url.search)) return fail(400, API_ERROR_CODE.invalidRequest, "La solicitud no es válida.");
      if (method === "POST" && request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")
        return fail(415, API_ERROR_CODE.unsupportedMediaType, "Se requiere una solicitud JSON.");
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(policy.timeoutMs)]);
      signal.throwIfAborted();
      const authentication = await dependencies.authenticate(); signal.throwIfAborted();
      if (!authentication.actorId) return fail(401, API_ERROR_CODE.authRequired, "No autorizado.");
      const tenant = authentication.tenant;
      if (!tenant || tenant.userId !== authentication.actorId || !uuid.safeParse(authentication.actorId).success || !uuid.safeParse(tenant.organizationId).success)
        return fail(403, API_ERROR_CODE.tenantForbidden, "Empresa no válida o no autorizada.");
      if (!tenant.platformRole || !REVIEWER_ROLE_SET.has(tenant.platformRole)) return fail(403, API_ERROR_CODE.roleForbidden, "No tienes permisos para adoptar HTML.");
      const client = dependencies.serviceClient(), prefix = method === "POST" ? "html-legacy-adoption" : "html-legacy-adoption-receipt";
      for (const [key, limit] of [[`${prefix}:org:${tenant.organizationId}`, policy.organizationRequests],
        [`${prefix}:actor:${tenant.organizationId}:${authentication.actorId}`, policy.actorRequests]] as const) {
        const rate = await client.rpc("consume_api_rate_limit", { p_rate_key: key, p_limit: limit, p_window_seconds: policy.windowSeconds }).abortSignal(signal);
        signal.throwIfAborted();
        if (rate.error || rate.data == null || Buffer.byteLength(JSON.stringify(rate.data), "utf8") > policy.maximumRateResponseBytes) throw new Error();
        if (!rateSchema.parse(rate.data)[0]!.allowed) return fail(429, API_ERROR_CODE.rateLimited, "Demasiadas solicitudes.", { "Retry-After": String(policy.windowSeconds) });
      }
      let body: z.infer<typeof htmlLegacyAdoptionRequestSchema>;
      if (method === "POST") {
        const decoded = await readHtmlSnapshotRequestBody(request, htmlLegacyAdoptionRequestSchema, policy.maximumRequestBytes,
          AbortSignal.any([signal, AbortSignal.timeout(policy.bodyTimeoutMs)]));
        signal.throwIfAborted();
        if (!decoded.success) return fail(decoded.reason === "too_large" ? 413 : 400,
          decoded.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, "La solicitud de adopción no es válida.");
        body = decoded.data;
      } else body = htmlLegacyAdoptionRequestSchema.parse({ candidateId: query!.data!.candidateId,
        provenanceSha256: query!.data!.provenanceSha256, expectedDocumentHash: query!.data!.expectedDocumentHash });
      const command = htmlLegacyAdoptionCommandSchema.parse({ actorId: authentication.actorId, organizationId: tenant.organizationId,
        documentId: params.data.draftId, clipId: params.data.clipId, operationId: params.data.operationId, request: body });
      const requestSha256 = computeHtmlLegacyAdoptionRequestSha256(command);
      if (method === "GET" && query!.data!.requestSha256 !== requestSha256) return fail(400, API_ERROR_CODE.invalidRequest, "La identidad del seguimiento no coincide.");
      const data = await (method === "POST" ? dependencies.commit : dependencies.read)(client, command, signal);
      signal.throwIfAborted();
      if (Buffer.byteLength(JSON.stringify(data) ?? "", "utf8") > HTML_LEGACY_ADOPTION_POLICY.receiptBytes) throw new Error();
      const result = method === "POST" ? { status: "RECORDED" as const, receipt: htmlLegacyAdoptionReceiptSchema.parse(data) }
        : htmlLegacyAdoptionReadSchema.parse(data);
      if (result.status === "RECORDED") {
        const receipt = result.receipt;
        if (receipt.owner.actorId !== command.actorId || receipt.owner.organizationId !== command.organizationId || receipt.owner.draftId !== command.documentId
          || receipt.operationId !== command.operationId || receipt.clipId !== command.clipId || receipt.requestSha256 !== requestSha256
          || computeHtmlLegacyAdoptionRequestSha256({ ...command, request: receipt.request }) !== requestSha256) throw new Error();
      }
      return Response.json({ success: true, data: result, requestId, correlationId: requestId }, { headers });
    } catch (error) {
      if ((error instanceof HtmlLegacyAdoptionPersistenceError && error.code === "CONFLICT")
        || (error instanceof HtmlEditingLegacyAdoptionError && error.code === "BASE_CONFLICT"))
        return fail(409, API_ERROR_CODE.conflict, "La base o el candidato revisado cambió.");
      try { dependencies.logFailure?.(requestId); } catch { /* Only safe correlation metadata. */ }
      return fail(503, API_ERROR_CODE.dependencyUnavailable, "No se pudo verificar el resultado. Conserva el seguimiento; no repitas la adopción automáticamente.");
    }
  };
}
