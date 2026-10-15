import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { REVIEWER_ROLE_SET } from "../../../../lib/pipeline-constants";
import { HTML_SNAPSHOT_RECOVERY_HTTP_POLICY as policy } from "../composition-html-editing-snapshot-recovery-policy";
import { createHtmlSnapshotRecoveryService, summarizeHtmlSnapshotRecovery } from "../composition-html-editing-snapshot-recovery.server";

type Authentication = {actorId:string | null; tenant:{organizationId:string;userId:string;platformRole:string | null} | null};
type Recovery = ReturnType<typeof createHtmlSnapshotRecoveryService>;
const paramsSchema = z.object({draftId:z.string().uuid(),operationId:z.string().uuid()}).strict();
const rateSchema = z.array(z.object({allowed:z.boolean(),reset_at:z.string().datetime({offset:true})}).passthrough()).length(1);

/** HTTP controller only; auth, SQL policy and recovery remain separate layers.
 * No global-role fallback. Current membership/resources are checked again by SQL.
 * Rate key is per tenant+actor, not attacker-controlled operation/draft values. */
export function createHtmlSnapshotRecoveryHandler(dependencies:{enabled:()=>boolean;
  authenticate:()=>Promise<Authentication>;serviceClient:()=>SupabaseClient;
  recover?:(client:SupabaseClient)=>Recovery;logFailure?:(requestId:string)=>void}) {
  return async (request:Request,rawParams:unknown):Promise<Response> => {
    const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
    const headers = {"Cache-Control":"private, no-store","Vary":"Cookie, Authorization","x-request-id":requestId};
    const fail = (status:number,code:typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE],message:string,extra?:Record<string,string>) =>
      Response.json(createApiErrorBody({code,message,requestId,retryable:false}),{status,headers:{...headers,...extra}});
    try {
      if (!dependencies.enabled()) return fail(503,API_ERROR_CODE.dependencyUnavailable,"La recuperación HTML aún no está habilitada.");
      if (request.method !== "GET") return fail(405,API_ERROR_CODE.invalidRequest,"Método no permitido.",{Allow:"GET"});
      if (request.headers.get("sec-fetch-site") === "cross-site") return fail(403,API_ERROR_CODE.tenantForbidden,"Solicitud no autorizada.");
      const params = paramsSchema.safeParse(rawParams);
      if (!params.success || Buffer.byteLength(request.url) > policy.maximumUrlBytes || new URL(request.url).search)
        return fail(400,API_ERROR_CODE.invalidRequest,"La operación solicitada no es válida.");
      request.signal.throwIfAborted();
      const authentication = await dependencies.authenticate();
      if (!authentication.actorId) return fail(401,API_ERROR_CODE.authRequired,"No autorizado.");
      const tenant = authentication.tenant;
      if (!tenant || tenant.userId !== authentication.actorId || !z.string().uuid().safeParse(authentication.actorId).success
        || !z.string().uuid().safeParse(tenant.organizationId).success)
        return fail(403,API_ERROR_CODE.tenantForbidden,"Empresa no válida o no autorizada.");
      if (!tenant.platformRole || !REVIEWER_ROLE_SET.has(tenant.platformRole))
        return fail(403,API_ERROR_CODE.roleForbidden,"No tienes permisos para recuperar publicaciones.");
      const admin = dependencies.serviceClient();
      const signal = AbortSignal.any([request.signal,AbortSignal.timeout(policy.timeoutMs)]);
      const rate = await admin.rpc("consume_api_rate_limit",{p_rate_key:`html-snapshot-recovery:${tenant.organizationId}:${authentication.actorId}`,
        p_limit:policy.requestsPerWindow,p_window_seconds:policy.windowSeconds}).abortSignal(signal);
      signal.throwIfAborted();
      if (rate.error || rate.data == null || Buffer.byteLength(JSON.stringify(rate.data)) > policy.maximumRateResponseBytes) throw new Error();
      const rateResult = rateSchema.parse(rate.data)[0]!;
      if (!rateResult.allowed) return fail(429,API_ERROR_CODE.rateLimited,"Demasiadas solicitudes. Espera antes de consultar nuevamente.",
        {"Retry-After":String(policy.windowSeconds)});
      const draft = await admin.from("video_composition_drafts").select("composition_id,state").eq("id",params.data.draftId)
        .eq("organization_id",tenant.organizationId).abortSignal(signal).maybeSingle();
      signal.throwIfAborted();
      if (draft.error) throw new Error();
      if (!draft.data || draft.data.state !== "ACTIVE") return fail(404,API_ERROR_CODE.resourceNotFound,"Borrador no encontrado.");
      const compositionId = z.string().uuid().parse(draft.data.composition_id);
      const recover = (dependencies.recover ?? createHtmlSnapshotRecoveryService)(admin);
      const recovered = await recover({actorId:authentication.actorId,organizationId:tenant.organizationId,compositionId,
        draftId:params.data.draftId,operationId:params.data.operationId,signal});
      signal.throwIfAborted();
      const data = summarizeHtmlSnapshotRecovery(params.data.operationId,recovered);
      return Response.json({success:true,data,requestId,correlationId:requestId},{headers});
    } catch {
      dependencies.logFailure?.(requestId);
      return fail(503,API_ERROR_CODE.dependencyUnavailable,"No se pudo confirmar el estado de la publicación. No se ha repetido la operación.");
    }
  };
}
