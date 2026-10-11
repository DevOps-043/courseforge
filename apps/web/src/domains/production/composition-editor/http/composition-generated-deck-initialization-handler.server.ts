import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { REVIEWER_ROLE_SET } from "../../../../lib/pipeline-constants";
import type { HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";
import { readHtmlSnapshotRequestBody } from "./composition-html-snapshot-request-body.server";
import { HTML_EDITING_INITIALIZATION_HTTP_POLICY as writePolicy } from "../composition-html-editing-initialization-http.contract";
import { HTML_EDITING_INITIALIZATION_OPERATION_HTTP_POLICY as readPolicy } from "../composition-html-editing-initialization-operation-http-policy";
import { GENERATED_DECK_INITIALIZATION_POLICY, generatedDeckInitializationReadSchema,
  generatedDeckInitializationReceiptSchema, generatedDeckInitializationRequestSchema,
  type GeneratedDeckInitializationOwner, type GeneratedDeckInitializationRequest } from "../composition-generated-deck-initialization.contract";
import { computeGeneratedDeckInitializationRequestSha256 } from "../composition-generated-deck-initialization.server";
import { HtmlEditingRevisionError } from "../html-editing/html-editing-revision.contract";

const paramsSchema = z.object({ draftId: z.string().uuid() }).strict();
const identitySchema = generatedDeckInitializationRequestSchema.omit({ expectedDocumentHash: true });
const rateSchema = z.array(z.object({ allowed: z.boolean() }).passthrough()).length(1);
export function createGeneratedDeckInitializationHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<HtmlReadAuthentication>; serviceClient: () => SupabaseClient;
  read: (client: SupabaseClient, owner: GeneratedDeckInitializationOwner,
    identity: z.infer<typeof identitySchema>, signal: AbortSignal) => Promise<unknown>;
  initialize: (client: SupabaseClient, owner: GeneratedDeckInitializationOwner,
    request: GeneratedDeckInitializationRequest, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return async (request: Request, rawParams: unknown) => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, Origin", "x-request-id": requestId };
    const fail = (status: number, code: typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE], message: string, extra?: Record<string, string>) =>
      Response.json(createApiErrorBody({ code, message, requestId, retryable: false }), { status, headers: { ...headers, ...extra } });
    try {
      if (request.method !== "GET" && request.method !== "POST") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.", { Allow: "GET, POST" });
      if (!dependencies.enabled()) return fail(503, API_ERROR_CODE.dependencyUnavailable, "La preparación del deck no está habilitada.");
      const url = new URL(request.url), origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
      if ((request.method === "POST" ? origin !== url.origin : origin !== null && origin !== url.origin)
        || (site !== null && site !== "same-origin" && site !== "none")) return fail(403, API_ERROR_CODE.tenantForbidden, "Solicitud no autorizada.");
      const params = paramsSchema.safeParse(rawParams), entries = [...url.searchParams.entries()];
      const identity = request.method === "GET" ? identitySchema.safeParse(Object.fromEntries(entries)) : null;
      if (!params.success || Buffer.byteLength(request.url) > writePolicy.maximumUrlBytes
        || new Set(entries.map(([key]) => key)).size !== entries.length
        || (request.method === "GET" ? !identity?.success : !!url.search)) return fail(400, API_ERROR_CODE.invalidRequest, "Solicitud no válida.");
      if (request.method === "POST" && request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")
        return fail(415, API_ERROR_CODE.unsupportedMediaType, "Se requiere JSON.");
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(GENERATED_DECK_INITIALIZATION_POLICY.timeoutMs)]);
      signal.throwIfAborted();
      const auth = await dependencies.authenticate(); signal.throwIfAborted();
      if (!auth.actorId) return fail(401, API_ERROR_CODE.authRequired, "No autorizado.");
      if (!auth.tenant || auth.tenant.userId !== auth.actorId || !z.string().uuid().safeParse(auth.actorId).success
        || !z.string().uuid().safeParse(auth.tenant.organizationId).success) return fail(403, API_ERROR_CODE.tenantForbidden, "Empresa no autorizada.");
      if (!auth.tenant.platformRole || !REVIEWER_ROLE_SET.has(auth.tenant.platformRole)) return fail(403, API_ERROR_CODE.roleForbidden, "No tienes permisos para preparar diapositivas.");
      const client = dependencies.serviceClient(), read = request.method === "GET";
      const actorLimit = read ? readPolicy.actorReadRequests : writePolicy.actorRequestsPerWindow;
      const orgLimit = read ? readPolicy.organizationReadRequests : writePolicy.organizationRequestsPerWindow;
      for (const [key, limit] of [[`generated-deck-initialization:${request.method}:org:${auth.tenant.organizationId}`, orgLimit],
        [`generated-deck-initialization:${request.method}:actor:${auth.tenant.organizationId}:${auth.actorId}`, actorLimit]] as const) {
        const rate = await client.rpc("consume_api_rate_limit", { p_rate_key: key, p_limit: limit, p_window_seconds: writePolicy.windowSeconds }).abortSignal(signal);
        signal.throwIfAborted();
        if (rate.error || rate.data == null || Buffer.byteLength(JSON.stringify(rate.data)) > writePolicy.maximumRateResponseBytes) throw new Error();
        if (!rateSchema.parse(rate.data)[0]!.allowed) return fail(429, API_ERROR_CODE.rateLimited, "Demasiadas solicitudes.", { "Retry-After": String(writePolicy.windowSeconds) });
      }
      const owner = { actorId: auth.actorId, organizationId: auth.tenant.organizationId, draftId: params.data.draftId };
      const body = !read ? await readHtmlSnapshotRequestBody(request, generatedDeckInitializationRequestSchema,
        writePolicy.maximumRequestBytes, AbortSignal.any([signal, AbortSignal.timeout(writePolicy.bodyTimeoutMs)])) : null;
      if (!read && !body?.success) {
        const tooLarge = body && "reason" in body && body.reason === "too_large";
        return fail(tooLarge ? 413 : 400, tooLarge ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, "Solicitud no válida.");
      }
      const operationRequest = body?.success ? body.data : null;
      const readIdentity = identity?.success ? identity.data : null;
      if (operationRequest && computeGeneratedDeckInitializationRequestSha256(operationRequest.expectedDocumentHash) !== operationRequest.requestSha256)
        return fail(400, API_ERROR_CODE.invalidRequest, "La identidad de la solicitud no coincide.");
      signal.throwIfAborted();
      const result = read ? generatedDeckInitializationReadSchema.parse(await dependencies.read(client, owner, readIdentity!, signal))
        : generatedDeckInitializationReceiptSchema.parse(await dependencies.initialize(client, owner, operationRequest!, signal));
      const receipt = "status" in result ? result.status === "RECORDED" ? result.receipt : null : result;
      const requestedIdentity = read ? readIdentity! : operationRequest!;
      if (receipt && (receipt.owner.actorId !== owner.actorId || receipt.owner.organizationId !== owner.organizationId || receipt.owner.draftId !== owner.draftId
        || receipt.operationId !== requestedIdentity.operationId || receipt.requestSha256 !== requestedIdentity.requestSha256
        || computeGeneratedDeckInitializationRequestSha256(receipt.expectedDocumentHash) !== receipt.requestSha256
        || (!read && receipt.expectedDocumentHash !== operationRequest!.expectedDocumentHash))) throw new Error();
      if (Buffer.byteLength(JSON.stringify(result)) > GENERATED_DECK_INITIALIZATION_POLICY.maximumReceiptBytes) throw new Error();
      signal.throwIfAborted();
      return Response.json({ success: true, data: result, requestId, correlationId: requestId }, { headers });
    } catch (error) {
      if (error instanceof HtmlEditingRevisionError && error.code === "REVISION_CONFLICT")
        return fail(409, API_ERROR_CODE.conflict, "El borrador o la operación cambió. Consulta el seguimiento antes de continuar.");
      try { dependencies.logFailure?.(requestId); } catch { /* Do not leak provider payloads. */ }
      return fail(503, API_ERROR_CODE.dependencyUnavailable, "No se pudo confirmar la preparación. Consulta el seguimiento sin repetir el envío.");
    }
  };
}
