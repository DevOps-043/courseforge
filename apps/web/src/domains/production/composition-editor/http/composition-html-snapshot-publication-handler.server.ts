import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { API_ERROR_CODE,createApiErrorBody } from "../../../../lib/server/api-contract";
import { resolveCorrelationId } from "../../../../lib/server/operational-logger";
import { REVIEWER_ROLE_SET } from "../../../../lib/pipeline-constants";
import { htmlSnapshotPublicationRequestSchema,HTML_SNAPSHOT_PUBLICATION_HTTP_POLICY as policy } from "../composition-html-snapshot-publication-http.contract";
import { readHtmlSnapshotRequestBody } from "./composition-html-snapshot-request-body.server";
import { createHtmlSnapshotIntentRepository } from "../composition-html-editing-snapshot-intent.server";
import { createHtmlSnapshotRecoveryService,summarizeHtmlSnapshotRecovery } from "../composition-html-editing-snapshot-recovery.server";
import { htmlSnapshotAcknowledgmentSchema } from "../composition-html-editing-snapshot-publication.contract";
import { hyperframesCompositionStatusSchema } from "../../hyperframes/hyperframes.types";

type Authentication={actorId:string | null;tenant:{organizationId:string;userId:string;platformRole:string | null} | null};
type Body=z.infer<typeof htmlSnapshotPublicationRequestSchema>;
export type HtmlSnapshotPublicationHttpInput=Body & {actorId:string;organizationId:string;compositionId:string;draftId:string;signal:AbortSignal};
const uuid=z.string().uuid();
const rateSchema=z.array(z.object({allowed:z.boolean(),reset_at:z.string().datetime({offset:true})}).passthrough()).length(1);
const acknowledgmentSchema=htmlSnapshotAcknowledgmentSchema.extend({scope:z.literal("REGISTERED_BY_HOST_PORT_NOT_RENDERED")}).strict();

/** Mutation controller: same-origin JSON, explicit current reviewer tenant,
 * shared org+actor quotas, server-derived composition/current state. All failures
 * disallow automatic retry. Database commit rechecks authorization and CAS. */
export function createHtmlSnapshotPublicationHandler(dependencies:{enabled:()=>boolean;authenticate:()=>Promise<Authentication>;
  serviceClient:()=>SupabaseClient;publish:(client:SupabaseClient,input:HtmlSnapshotPublicationHttpInput)=>Promise<unknown>;
  recover?:(client:SupabaseClient)=>ReturnType<typeof createHtmlSnapshotRecoveryService>;
  logFailure?:(requestId:string)=>void}) {
  return async (request:Request,rawParams:unknown):Promise<Response> => {
    const requestId=resolveCorrelationId(request.headers.get("x-request-id"));
    const headers={"Cache-Control":"private, no-store","Vary":"Cookie, Authorization, Origin","x-request-id":requestId};
    const fail=(status:number,code:typeof API_ERROR_CODE[keyof typeof API_ERROR_CODE],message:string,extra?:Record<string,string>) =>
      Response.json(createApiErrorBody({code,message,requestId,retryable:false}),{status,headers:{...headers,...extra}});
    try {
      if (!dependencies.enabled()) return fail(503,API_ERROR_CODE.dependencyUnavailable,"La publicación HTML aún no está habilitada.");
      if (request.method !== "POST") return fail(405,API_ERROR_CODE.invalidRequest,"Método no permitido.",{Allow:"POST"});
      const url=new URL(request.url);
      if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site")
        return fail(403,API_ERROR_CODE.tenantForbidden,"Solicitud no autorizada.");
      const params=z.object({draftId:uuid}).strict().safeParse(rawParams);
      if (!params.success || url.search || Buffer.byteLength(request.url)>policy.maximumUrlBytes)
        return fail(400,API_ERROR_CODE.invalidRequest,"La solicitud no es válida.");
      if (request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase() !== "application/json")
        return fail(415,API_ERROR_CODE.unsupportedMediaType,"Se requiere una solicitud JSON.");
      const signal=AbortSignal.any([request.signal,AbortSignal.timeout(policy.timeoutMs)]);
      signal.throwIfAborted();
      const authentication=await dependencies.authenticate();signal.throwIfAborted();
      if (!authentication.actorId) return fail(401,API_ERROR_CODE.authRequired,"No autorizado.");
      const tenant=authentication.tenant;
      if (!tenant || tenant.userId !== authentication.actorId || !uuid.safeParse(authentication.actorId).success || !uuid.safeParse(tenant.organizationId).success)
        return fail(403,API_ERROR_CODE.tenantForbidden,"Empresa no válida o no autorizada.");
      if (!tenant.platformRole || !REVIEWER_ROLE_SET.has(tenant.platformRole))
        return fail(403,API_ERROR_CODE.roleForbidden,"No tienes permisos para publicar snapshots.");
      const admin=dependencies.serviceClient();
      for (const [key,limit] of [[`html-snapshot-publication:org:${tenant.organizationId}`,policy.organizationRequestsPerWindow],
        [`html-snapshot-publication:actor:${tenant.organizationId}:${authentication.actorId}`,policy.actorRequestsPerWindow]] as const) {
        const rate=await admin.rpc("consume_api_rate_limit",{p_rate_key:key,p_limit:limit,p_window_seconds:policy.windowSeconds}).abortSignal(signal);
        signal.throwIfAborted();
        if (rate.error || rate.data == null || Buffer.byteLength(JSON.stringify(rate.data))>policy.maximumRateResponseBytes) throw new Error();
        if (!rateSchema.parse(rate.data)[0]!.allowed) return fail(429,API_ERROR_CODE.rateLimited,"Demasiadas solicitudes. Consulta el seguimiento antes de continuar.",
          {"Retry-After":String(policy.windowSeconds)});
      }
      const bodySignal=AbortSignal.any([signal,AbortSignal.timeout(policy.bodyTimeoutMs)]);
      const parsed=await readHtmlSnapshotRequestBody(request,htmlSnapshotPublicationRequestSchema,policy.maximumRequestBytes,bodySignal);
      signal.throwIfAborted();
      if (!parsed.success) return fail(parsed.reason === "too_large" ? 413 : 400,
        parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,"La solicitud de publicación no es válida.");
      const draft=await admin.from("video_composition_drafts").select("composition_id,state").eq("id",params.data.draftId)
        .eq("organization_id",tenant.organizationId).abortSignal(signal).maybeSingle();
      signal.throwIfAborted();if (draft.error) throw new Error();
      if (!draft.data || draft.data.state !== "ACTIVE") return fail(404,API_ERROR_CODE.resourceNotFound,"Borrador no encontrado.");
      const compositionId=uuid.parse(draft.data.composition_id);
      const composition=await admin.from("video_compositions").select("active_revision_id,status").eq("id",compositionId)
        .eq("organization_id",tenant.organizationId).abortSignal(signal).maybeSingle();
      signal.throwIfAborted();if (composition.error) throw new Error();
      if (!composition.data || composition.data.status === "ARCHIVED") return fail(404,API_ERROR_CODE.resourceNotFound,"Composición no encontrada.");
      const compositionState=z.object({active_revision_id:uuid.nullable(),status:hyperframesCompositionStatusSchema}).strict().parse(composition.data);
      const active=compositionState.active_revision_id;
      const latest=await admin.from("video_composition_draft_documents").select("document_hash").eq("draft_id",params.data.draftId)
        .eq("organization_id",tenant.organizationId).order("version",{ascending:false}).limit(1).abortSignal(signal).maybeSingle();
      signal.throwIfAborted();if (latest.error) throw new Error();
      if (!latest.data || latest.data.document_hash !== parsed.data.documentHash || active !== parsed.data.expectedActiveRevisionId)
        return fail(409,API_ERROR_CODE.conflict,"El documento o la revisión activa cambió. Revisa el seguimiento antes de continuar.");
      const owner={actorId:authentication.actorId,organizationId:tenant.organizationId,compositionId,draftId:params.data.draftId,operationId:parsed.data.operationId,signal};
      const intent=await createHtmlSnapshotIntentRepository(admin).readPublicationIntent(owner);signal.throwIfAborted();
      if (intent.status !== "NOT_FOUND") return fail(409,API_ERROR_CODE.conflict,"Esta operación ya tiene seguimiento. Consulta su estado; no se ha repetido.");
      const ack=acknowledgmentSchema.parse(await dependencies.publish(admin,{...owner,...parsed.data}));signal.throwIfAborted();
      if (ack.operationId !== owner.operationId || ack.organizationId !== owner.organizationId || ack.compositionId !== compositionId
        || ack.draftId !== owner.draftId || ack.documentHash !== parsed.data.documentHash || ack.activeRevisionId !== ack.revisionId) throw new Error();
      // Commit ACK is historical. Independently observe current registration,
      // rather than relabel its active-at-commit ID as today's active revision.
      const recovered=await (dependencies.recover ?? createHtmlSnapshotRecoveryService)(admin)(owner);signal.throwIfAborted();
      if (recovered.status !== "LOCATED" || recovered.intent.identity.documentHash !== ack.documentHash
        || recovered.intent.identity.projectHash !== ack.projectHash || recovered.registration.status === "NOT_FOUND"
        || recovered.registration.acknowledgment.revisionId !== ack.revisionId) throw new Error();
      const data=summarizeHtmlSnapshotRecovery(owner.operationId,recovered);
      if (data.status !== "COMMITTED_ACTIVE" && data.status !== "COMMITTED_SUPERSEDED") throw new Error();
      return Response.json({success:true,data,requestId,correlationId:requestId},{status:201,headers});
    } catch {
      dependencies.logFailure?.(requestId);
      return fail(503,API_ERROR_CODE.dependencyUnavailable,"No se pudo confirmar la publicación. Consulta su estado; no repitas el envío automáticamente.");
    }
  };
}
