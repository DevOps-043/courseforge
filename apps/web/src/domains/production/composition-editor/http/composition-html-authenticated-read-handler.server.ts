import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { REVIEWER_ROLE_SET } from "../../../../lib/pipeline-constants";

export type HtmlReadAuthentication = { actorId: string | null;
  tenant: { organizationId: string; userId: string; platformRole: string | null } | null };
export type HtmlReadOwner = { actorId: string; organizationId: string };
type Policy = { maximumUrlBytes: number; timeoutMs: number; windowSeconds: number;
  organizationRequests: number; actorRequests: number; maximumRateResponseBytes: number };
const uuid = z.string().uuid();
const rateSchema = z.array(z.object({ allowed: z.boolean(), reset_at: z.string().datetime({ offset: true }) }).passthrough()).length(1);

/** Shared transport/security only. Domain adapters own commands and integrity.
 * GET never accepts a browser actor/tenant, performs a mutation or retries. */
export function createHtmlAuthenticatedReadHandler<Params, Query, Command, Result>(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<HtmlReadAuthentication>; serviceClient: () => SupabaseClient;
  paramsSchema: z.ZodType<Params>; querySchema: z.ZodType<Query>; resultSchema: z.ZodType<Result>;
  policy: Policy; ratePrefix: string; maximumResponseBytes: number;
  command: (params: Params, query: Query, owner: HtmlReadOwner) => Command;
  read: (client: SupabaseClient, command: Command, signal: AbortSignal) => Promise<unknown>;
  matches: (result: Result, command: Command) => boolean;
  isConflict?: (error: unknown) => boolean; logFailure?: (requestId: string) => void;
}) {
  return async (request: Request, rawParams: unknown) => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, Origin", "x-request-id": requestId };
    const fail = (status: number, code: typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE], message: string, extra?: Record<string, string>) =>
      Response.json(createApiErrorBody({ code, message, requestId, retryable: false }), { status, headers: { ...headers, ...extra } });
    try {
      if (request.method !== "GET") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.", { Allow: "GET" });
      if (!dependencies.enabled()) return fail(503, API_ERROR_CODE.dependencyUnavailable, "La consulta HTML no está habilitada.");
      const url = new URL(request.url), origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
      if ((origin !== null && origin !== url.origin) || (site !== null && site !== "same-origin" && site !== "none"))
        return fail(403, API_ERROR_CODE.tenantForbidden, "Solicitud no autorizada.");
      const params = dependencies.paramsSchema.safeParse(rawParams), entries = [...url.searchParams.entries()];
      const query = dependencies.querySchema.safeParse(Object.fromEntries(entries)), policy = dependencies.policy;
      if (!params.success || !query.success || new Set(entries.map(([key]) => key)).size !== entries.length
        || Buffer.byteLength(request.url, "utf8") > policy.maximumUrlBytes) return fail(400, API_ERROR_CODE.invalidRequest, "La solicitud no es válida.");
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(policy.timeoutMs)]); signal.throwIfAborted();
      const authentication = await dependencies.authenticate(); signal.throwIfAborted();
      if (!authentication.actorId) return fail(401, API_ERROR_CODE.authRequired, "No autorizado.");
      const tenant = authentication.tenant;
      if (!tenant || tenant.userId !== authentication.actorId || !uuid.safeParse(authentication.actorId).success
        || !uuid.safeParse(tenant.organizationId).success) return fail(403, API_ERROR_CODE.tenantForbidden, "Empresa no válida o no autorizada.");
      if (!tenant.platformRole || !REVIEWER_ROLE_SET.has(tenant.platformRole)) return fail(403, API_ERROR_CODE.roleForbidden, "No tienes permisos para consultar HTML.");
      const client = dependencies.serviceClient();
      for (const [key, limit] of [[`${dependencies.ratePrefix}:org:${tenant.organizationId}`, policy.organizationRequests],
        [`${dependencies.ratePrefix}:actor:${tenant.organizationId}:${authentication.actorId}`, policy.actorRequests]] as const) {
        const rate = await client.rpc("consume_api_rate_limit", { p_rate_key: key, p_limit: limit, p_window_seconds: policy.windowSeconds }).abortSignal(signal);
        signal.throwIfAborted();
        if (rate.error || rate.data == null || Buffer.byteLength(JSON.stringify(rate.data), "utf8") > policy.maximumRateResponseBytes) throw new Error();
        if (!rateSchema.parse(rate.data)[0]!.allowed) return fail(429, API_ERROR_CODE.rateLimited, "Demasiadas solicitudes.", { "Retry-After": String(policy.windowSeconds) });
      }
      const command = dependencies.command(params.data, query.data, { actorId: authentication.actorId, organizationId: tenant.organizationId });
      const raw = await dependencies.read(client, command, signal); signal.throwIfAborted();
      if (Buffer.byteLength(JSON.stringify(raw) ?? "", "utf8") > dependencies.maximumResponseBytes) throw new Error();
      const data = dependencies.resultSchema.parse(raw);
      if (!dependencies.matches(data, command)) throw new Error();
      return Response.json({ success: true, data, requestId, correlationId: requestId }, { headers });
    } catch (error) {
      if (dependencies.isConflict?.(error)) return fail(409, API_ERROR_CODE.conflict, "La base o el candidato revisado cambió.");
      try { dependencies.logFailure?.(requestId); } catch { /* Only correlation metadata. */ }
      return fail(503, API_ERROR_CODE.dependencyUnavailable, "No se pudo realizar la consulta autorizada.");
    }
  };
}
