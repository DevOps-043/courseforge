import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { REVIEWER_ROLE_SET } from "../../../../lib/pipeline-constants";
import { htmlEditingPreviewSessionSchema } from "../composition-html-editing-preview-channel.contract";
import { prepareCompositionHtmlEditingPreviewPage } from "../composition-html-editing-preview-page.server";
import { HTML_EDITING_PREVIEW_RESOURCE_POLICY } from "../composition-html-editing-preview-inventory.server";
import type { resolveHtmlPreviewOperatorConfiguration } from "../composition-html-editing-preview-configuration.server";
import { parseHtmlPreviewResourceRenewal } from "../composition-html-editing-preview-renewal.contract";
import { readPublishedHtmlPreviewPin } from "../composition-html-editing-published-preview.server";

const policy = Object.freeze({ urlBytes: 2048, windowSeconds: 60, actorRequests: 10, organizationRequests: 30, quotaResponseBytes: 1024 });
const uuid = z.string().uuid();
const rateSchema = z.array(z.object({ allowed: z.boolean(), reset_at: z.string().datetime({ offset: true }) }).passthrough()).length(1);
type Authentication = { actorId: string | null; tenant: { organizationId: string; userId: string; platformRole: string | null } | null };

/** Authenticated read-only issuer. Query chooses exact revision/generation and
 * handshake nonce, NEVER identity/grants/source/Storage path/signing key.
 * Nonce is client-created handshake correlation, not an authorization credential. */
export function createHtmlPreviewPageHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<Authentication>; serviceClient: () => SupabaseClient;
  configuration: () => ReturnType<typeof resolveHtmlPreviewOperatorConfiguration> & { runtimeWebRoot: string };
  prepare?: typeof prepareCompositionHtmlEditingPreviewPage; logFailure?: (requestId: string) => void;
  readPublishedPin?: typeof readPublishedHtmlPreviewPin;
  responseKind?: "PAGE" | "RESOURCE_RENEWAL";
}) {
  const responseKind = dependencies.responseKind ?? "PAGE";
  return async (request: Request, rawParams: unknown): Promise<Response> => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      Vary: "Cookie, Authorization, Origin", "x-request-id": requestId };
    const fail = (status: number, code: typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE], message: string, extra?: Record<string, string>) =>
      Response.json(createApiErrorBody({ code, message, requestId, retryable: false }), { status, headers: { ...headers, ...extra } });
    try {
      if (!dependencies.enabled()) return fail(503, API_ERROR_CODE.dependencyUnavailable, "El preview HTML aún no está habilitado.");
      if (request.method !== "GET") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.", { Allow: "GET" });
      const params = z.object({ draftId: uuid }).strict().parse(rawParams), url = new URL(request.url);
      const query = [...url.searchParams.entries()];
      const revisionId = url.searchParams.has("revisionId") ? uuid.parse(url.searchParams.get("revisionId")).toLowerCase() : undefined;
      const expectedQueryCount = revisionId ? 4 : 3;
      if (Buffer.byteLength(request.url) > policy.urlBytes || query.length !== expectedQueryCount
        || new Set(query.map(([key]) => key)).size !== expectedQueryCount || query.some(([key]) => !["documentHash", "r", "nonce", "revisionId"].includes(key)))
        return fail(400, API_ERROR_CODE.invalidRequest, "Solicitud no válida.");
      const generation = url.searchParams.get("r");
      if (!generation || !/^(0|[1-9]\d*)$/.test(generation)) return fail(400, API_ERROR_CODE.invalidRequest, "Generación no válida.");
      const session = htmlEditingPreviewSessionSchema.parse({ version: 1, nonce: url.searchParams.get("nonce"),
        documentHash: url.searchParams.get("documentHash"), previewGeneration: Number(generation) });
      const config = dependencies.configuration(), origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
      if (url.origin !== config.audience || (origin !== null && origin !== config.audience)
        || (site !== null && site !== "same-origin" && site !== "none")) return fail(403, API_ERROR_CODE.tenantForbidden, "Solicitud no autorizada.");
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(HTML_EDITING_PREVIEW_RESOURCE_POLICY.preparationTimeoutMs)]);
      signal.throwIfAborted();
      const authentication = await dependencies.authenticate(); signal.throwIfAborted();
      if (!authentication.actorId) return fail(401, API_ERROR_CODE.authRequired, "No autorizado.");
      const tenant = authentication.tenant;
      if (!tenant || tenant.userId !== authentication.actorId || !uuid.safeParse(authentication.actorId).success || !uuid.safeParse(tenant.organizationId).success)
        return fail(403, API_ERROR_CODE.tenantForbidden, "Empresa no válida o no autorizada.");
      if (!tenant.platformRole || !REVIEWER_ROLE_SET.has(tenant.platformRole)) return fail(403, API_ERROR_CODE.roleForbidden, "No tienes permisos para previsualizar HTML.");
      const client = dependencies.serviceClient();
      for (const [key, limit] of [[`html-preview-page:org:${tenant.organizationId}`, policy.organizationRequests],
        [`html-preview-page:actor:${tenant.organizationId}:${authentication.actorId}`, policy.actorRequests]] as const) {
        const rate = await client.rpc("consume_api_rate_limit", { p_rate_key: key, p_limit: limit, p_window_seconds: policy.windowSeconds })
          .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
        signal.throwIfAborted();
        if (rate.error || rate.data == null || Buffer.byteLength(JSON.stringify(rate.data)) > policy.quotaResponseBytes) throw new Error();
        if (!rateSchema.parse(rate.data)[0]!.allowed) return fail(429, API_ERROR_CODE.rateLimited, "Demasiadas consultas.", { "Retry-After": String(policy.windowSeconds) });
      }
      const publishedBinding = revisionId ? await (dependencies.readPublishedPin ?? readPublishedHtmlPreviewPin)({
        organizationId: tenant.organizationId, documentId: params.draftId.toLowerCase(), revisionId,
        documentHash: session.documentHash, supabase: client, signal }) : undefined;
      signal.throwIfAborted();
      const page = await (dependencies.prepare ?? prepareCompositionHtmlEditingPreviewPage)({ actorId: authentication.actorId,
        organizationId: tenant.organizationId, documentId: params.draftId.toLowerCase(), documentHash: session.documentHash,
        previewGeneration: session.previewGeneration, session, supabase: client, storageOrigin: config.storageOrigin,
        parentOrigin: config.audience, runtimeWebRoot: config.runtimeWebRoot, deliveryKey: config.key, signal, publishedBinding });
      signal.throwIfAborted();
      if (responseKind === "RESOURCE_RENEWAL") {
        const renewal = parseHtmlPreviewResourceRenewal(page.resourceRenewal, {
          documentId: params.draftId.toLowerCase(), session, audience: config.audience });
        return Response.json(renewal, { headers });
      }
      return new Response(page.html, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": page.contentSecurityPolicy } });
    } catch (error) {
      if (error instanceof z.ZodError) return fail(400, API_ERROR_CODE.invalidRequest, "Solicitud no válida.");
      try { dependencies.logFailure?.(requestId); } catch { /* Safe observability only; no page/capability bodies. */ }
      return fail(503, API_ERROR_CODE.dependencyUnavailable, "No se pudo preparar el preview HTML.");
    }
  };
}
