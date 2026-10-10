import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { REVIEWER_ROLE_SET } from "../../../../lib/pipeline-constants";
import { createHtmlAuthenticatedReadHandler, type HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";
import { readHtmlSnapshotRequestBody } from "./composition-html-snapshot-request-body.server";
import { HtmlReconstructionResourceLinkError, readAuthorizedHtmlReconstructionResource, operateHtmlReconstructionResourceLink } from "../composition-html-editing-reconstruction-resource-link.server";
import { HTML_RECONSTRUCTION_RESOURCE_LINK_POLICY as policy, htmlReconstructionResourceCandidateSchema,
  htmlReconstructionResourceLookupRequestSchema, htmlReconstructionResourceLinkCommandSchema,
  htmlReconstructionResourceLinkHttpSchema, htmlReconstructionResourceLinkReadSchema, htmlReconstructionResourceLinkReceiptSchema,
  htmlReconstructionResourceLinkPreimage, matchesHtmlReconstructionResourceLinkReceipt,
  type HtmlReconstructionResourceLinkCommand, type HtmlReconstructionResourceLookupRequest } from "../composition-html-editing-reconstruction-resource-link.contract";

const uuid = z.string().uuid(), operationParams = z.object({draftId: uuid, operationId: uuid}).strict();
const receiptQuery = htmlReconstructionResourceLinkHttpSchema.omit({expectedVersion: true, confirmedResourceOnly: true}).extend({
  expectedVersion: z.coerce.number().pipe(z.number().int().positive().max(2_147_483_647)), confirmedResourceOnly: z.literal("true").transform(() => true as const),
}).strict();
const rateSchema = z.array(z.object({allowed: z.boolean(), reset_at: z.string().datetime({offset: true})}).passthrough()).length(1);
type Dependencies = {enabled: (method: "GET" | "POST") => boolean; authenticate: () => Promise<HtmlReadAuthentication>;
  serviceClient: () => SupabaseClient; logFailure?: (requestId: string) => void;
  lookup?: (client: SupabaseClient, request: HtmlReconstructionResourceLookupRequest, signal: AbortSignal) => Promise<unknown>;
  operate?: (client: SupabaseClient, command: HtmlReconstructionResourceLinkCommand, signal: AbortSignal, mode: "READ" | "LINK") => Promise<unknown>;
};
function buildCommand(params: z.infer<typeof operationParams>, body: z.infer<typeof htmlReconstructionResourceLinkHttpSchema>,
  owner: {actorId: string; organizationId: string}) {
  const {compositionId, ...request} = body;
  return htmlReconstructionResourceLinkCommandSchema.parse({...params, ...owner, compositionId, request});
}
export function createHtmlReconstructionResourceHandlers(dependencies: Dependencies) {
  const operate = dependencies.operate ?? ((supabase, command, signal, mode) => operateHtmlReconstructionResourceLink({supabase, command, signal, mode}));
  const lookup = createHtmlAuthenticatedReadHandler({enabled: () => dependencies.enabled("GET"), authenticate: dependencies.authenticate,
    serviceClient: dependencies.serviceClient, logFailure: dependencies.logFailure,
    paramsSchema: z.object({draftId: uuid, assetId: uuid}).strict(), querySchema: z.object({compositionId: uuid}).strict(),
    resultSchema: htmlReconstructionResourceCandidateSchema, policy, maximumResponseBytes: policy.responseBytes, ratePrefix: "html-reconstruction-resource-candidate",
    command: (params, query, owner) => htmlReconstructionResourceLookupRequestSchema.parse({...owner, draftId: params.draftId,
      query: {...query, assetId: params.assetId}}),
    read: dependencies.lookup ?? ((supabase, request, signal) => readAuthorizedHtmlReconstructionResource({supabase, request, signal})),
    matches: (candidate, request) => candidate.organizationId === request.organizationId && candidate.compositionId === request.query.compositionId
      && candidate.draftId === request.draftId && candidate.asset.productionAssetId === request.query.assetId,
  });
  const read = createHtmlAuthenticatedReadHandler({enabled: () => dependencies.enabled("GET"), authenticate: dependencies.authenticate,
    serviceClient: dependencies.serviceClient, logFailure: dependencies.logFailure, paramsSchema: operationParams, querySchema: receiptQuery,
    resultSchema: htmlReconstructionResourceLinkReadSchema, policy, maximumResponseBytes: policy.responseBytes, ratePrefix: "html-reconstruction-resource-link-receipt",
    command: buildCommand, read: (client, command, signal) => operate(client, command, signal, "READ"),
    matches: (result, command) => result.status === "NOT_FOUND" || matchesHtmlReconstructionResourceLinkReceipt(result.receipt, command,
      createHash("sha256").update(htmlReconstructionResourceLinkPreimage(command)).digest("hex")),
    isConflict: error => error instanceof HtmlReconstructionResourceLinkError && error.code === "CONFLICT",
  });
  const link = async (request: Request, rawParams: unknown) => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = {"Cache-Control": "private, no-store", Vary: "Cookie, Authorization, Origin", "x-request-id": requestId};
    const fail = (status: number, code: typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE], message: string, extra?: Record<string, string>) =>
      Response.json(createApiErrorBody({code, message, requestId, retryable: false}), {status, headers: {...headers, ...extra}});
    try {
      if (request.method !== "POST") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.", {Allow: "POST"});
      if (!dependencies.enabled("POST")) return fail(503, API_ERROR_CODE.dependencyUnavailable, "El enlace de recursos no está habilitado.");
      const url = new URL(request.url), site = request.headers.get("sec-fetch-site"), params = operationParams.safeParse(rawParams);
      if (request.headers.get("origin") !== url.origin || (site !== null && site !== "same-origin" && site !== "none"))
        return fail(403, API_ERROR_CODE.tenantForbidden, "Solicitud no autorizada.");
      if (!params.success || url.search || Buffer.byteLength(request.url) > policy.maximumUrlBytes)
        return fail(400, API_ERROR_CODE.invalidRequest, "La solicitud no es válida.");
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")
        return fail(415, API_ERROR_CODE.unsupportedMediaType, "Se requiere JSON.");
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(policy.timeoutMs)]); signal.throwIfAborted();
      const authentication = await dependencies.authenticate(); signal.throwIfAborted();
      if (!authentication.actorId) return fail(401, API_ERROR_CODE.authRequired, "No autorizado.");
      const tenant = authentication.tenant;
      if (!tenant || tenant.userId !== authentication.actorId || !uuid.safeParse(authentication.actorId).success || !uuid.safeParse(tenant.organizationId).success)
        return fail(403, API_ERROR_CODE.tenantForbidden, "Empresa no válida o no autorizada.");
      if (!tenant.platformRole || !REVIEWER_ROLE_SET.has(tenant.platformRole)) return fail(403, API_ERROR_CODE.roleForbidden, "No tienes permisos para vincular medios.");
      const client = dependencies.serviceClient();
      for (const [key, limit] of [[`html-reconstruction-resource-link:org:${tenant.organizationId}`, policy.organizationRequests],
        [`html-reconstruction-resource-link:actor:${tenant.organizationId}:${authentication.actorId}`, policy.actorRequests]] as const) {
        const rate = await client.rpc("consume_api_rate_limit", {p_rate_key: key, p_limit: limit, p_window_seconds: policy.windowSeconds}).abortSignal(signal);
        signal.throwIfAborted();
        if (rate.error || Buffer.byteLength(JSON.stringify(rate.data) ?? "") > policy.maximumRateResponseBytes) throw new Error();
        if (!rateSchema.parse(rate.data)[0]!.allowed) return fail(429, API_ERROR_CODE.rateLimited, "Demasiadas solicitudes.", {"Retry-After": String(policy.windowSeconds)});
      }
      const body = await readHtmlSnapshotRequestBody(request, htmlReconstructionResourceLinkHttpSchema, policy.maximumRequestBytes,
        AbortSignal.any([signal, AbortSignal.timeout(policy.bodyTimeoutMs)])); signal.throwIfAborted();
      if (!body.success) return fail(body.reason === "too_large" ? 413 : 400,
        body.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, "La solicitud no es válida.");
      const command = buildCommand(params.data, body.data, {actorId: authentication.actorId, organizationId: tenant.organizationId});
      const raw = await operate(client, command, signal, "LINK"); signal.throwIfAborted();
      if (Buffer.byteLength(JSON.stringify(raw) ?? "") > policy.responseBytes) throw new Error();
      const result = htmlReconstructionResourceLinkReadSchema.parse(raw);
      if (result.status !== "RECORDED" || !matchesHtmlReconstructionResourceLinkReceipt(htmlReconstructionResourceLinkReceiptSchema.parse(result.receipt), command,
        createHash("sha256").update(htmlReconstructionResourceLinkPreimage(command)).digest("hex"))) throw new Error();
      return Response.json({success: true, data: result, requestId, correlationId: requestId}, {headers});
    } catch {
      try {dependencies.logFailure?.(requestId);} catch { /* Correlation only. */ }
      return fail(503, API_ERROR_CODE.dependencyUnavailable, "Resultado sin confirmar. Conserva el seguimiento y consulta el recibo; no repitas el envío.");
    }
  };
  return {lookup, read, link};
}
