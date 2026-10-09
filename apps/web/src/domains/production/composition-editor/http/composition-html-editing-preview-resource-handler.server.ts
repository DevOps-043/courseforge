import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { verifyHtmlPreviewResourceCapability, HtmlPreviewCapabilityError } from "../composition-html-editing-preview-capability.server";
import { deliverCompositionHtmlEditingPreviewResource, HtmlPreviewDeliveryAccessError } from "../composition-html-editing-preview-delivery.server";
import { HtmlPreviewRangeError } from "../composition-html-editing-preview-file-stream.server";

export const HTML_PREVIEW_RESOURCE_HTTP_POLICY = Object.freeze({ windowSeconds: 60, actorRequests: 300,
  organizationRequests: 600, quotaResponseBytes: 1024, urlBytes: 4608 });
type Configuration = { key: Uint8Array; audience: string; storageOrigin: string };
const rateSchema = z.array(z.object({ allowed: z.boolean(), reset_at: z.string().datetime({ offset: true }) }).passthrough()).length(1);
class QuotaError extends Error {}

/** Capability-only subresource route for opaque frames. Issuance is authenticated
 * elsewhere; Origin:null and possession of a hash are NEVER sufficient. This
 * route does not initialize a document or issue tokens from request claims. */
export function createHtmlPreviewResourceHandler(dependencies: {
  enabled: () => boolean; configuration: () => Configuration; serviceClient: () => SupabaseClient;
  deliver?: typeof deliverCompositionHtmlEditingPreviewResource; nowSeconds?: () => number; logFailure?: (requestId: string) => void;
}) {
  return async (request: Request, rawParams: unknown): Promise<Response> => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer", "x-request-id": requestId };
    const fail = (status: number, code: typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE], message: string, extra?: Record<string, string>) =>
      Response.json(createApiErrorBody({ code, message, requestId, retryable: false }), { status, headers: { ...headers, ...extra } });
    let resourceSize: number | undefined;
    try {
      if (!dependencies.enabled()) return fail(503, API_ERROR_CODE.dependencyUnavailable, "La entrega HTML no está habilitada.");
      if (request.method !== "GET") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.", { Allow: "GET" });
      const params = z.object({ draftId: z.string().uuid() }).strict().parse(rawParams);
      const url = new URL(request.url), config = dependencies.configuration();
      if (url.origin !== config.audience || Buffer.byteLength(request.url) > HTML_PREVIEW_RESOURCE_HTTP_POLICY.urlBytes
        || url.searchParams.getAll("cap").length !== 1 || [...url.searchParams.keys()].some(key => key !== "cap")) throw new HtmlPreviewCapabilityError();
      const origin = request.headers.get("origin"), destination = request.headers.get("sec-fetch-dest");
      if ((origin !== null && origin !== "null" && origin !== config.audience)
        || (destination !== null && !["empty", "image", "audio", "video", "font"].includes(destination))) throw new HtmlPreviewCapabilityError();
      const token = url.searchParams.get("cap")!;
      const nowSeconds = dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
      const claims = verifyHtmlPreviewResourceCapability({ token, key: config.key, audience: config.audience,
        documentId: params.draftId, nowSeconds: nowSeconds() });
      resourceSize = claims.fileSizeBytes;
      request.signal.throwIfAborted();
      const client = dependencies.serviceClient();
      const response = await (dependencies.deliver ?? deliverCompositionHtmlEditingPreviewResource)({
        token, ...config, documentId: params.draftId, range: request.headers.get("range"), supabase: client,
        signal: request.signal, nowSeconds,
        consumeQuota: async current => {
          for (const [key, limit] of [[`html-preview-resource:org:${current.organizationId}`, HTML_PREVIEW_RESOURCE_HTTP_POLICY.organizationRequests],
            [`html-preview-resource:actor:${current.organizationId}:${current.actorId}`, HTML_PREVIEW_RESOURCE_HTTP_POLICY.actorRequests]] as const) {
            const rate = await client.rpc("consume_api_rate_limit", { p_rate_key: key, p_limit: limit,
              p_window_seconds: HTML_PREVIEW_RESOURCE_HTTP_POLICY.windowSeconds }).abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]));
            request.signal.throwIfAborted();
            if (rate.error || rate.data == null || Buffer.byteLength(JSON.stringify(rate.data)) > HTML_PREVIEW_RESOURCE_HTTP_POLICY.quotaResponseBytes) throw new Error();
            if (!rateSchema.parse(rate.data)[0]!.allowed) throw new QuotaError();
          }
          return true;
        },
      });
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      if (error instanceof z.ZodError) return fail(400, API_ERROR_CODE.invalidRequest, "Solicitud no válida.");
      if (error instanceof QuotaError) return fail(429, API_ERROR_CODE.rateLimited, "Demasiadas consultas.", { "Retry-After": "60" });
      if (error instanceof HtmlPreviewRangeError) return fail(416, API_ERROR_CODE.invalidRequest, "Rango no válido.",
        resourceSize === undefined ? undefined : { "Content-Range": `bytes */${resourceSize}` });
      if (error instanceof HtmlPreviewCapabilityError || error instanceof HtmlPreviewDeliveryAccessError) return fail(403, API_ERROR_CODE.tenantForbidden, "Recurso no autorizado.");
      try { dependencies.logFailure?.(requestId); } catch { /* Logging never exposes capability or changes the result. */ }
      return fail(503, API_ERROR_CODE.dependencyUnavailable, "No se pudo entregar el recurso del preview.");
    }
  };
}
