import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { htmlSnapshotIntentSchema, htmlSnapshotOperationIdentitySchema } from "./composition-html-editing-snapshot-publication.contract";
import type { HtmlEditingSnapshotPublicationPorts } from "./composition-html-editing-snapshot-publication.server";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";

const ownerSchema = htmlSnapshotOperationIdentitySchema.omit({documentHash:true,projectHash:true}).extend({actorId:z.string().uuid()}).strict();
const readSchema = z.union([htmlSnapshotIntentSchema,z.object({status:z.literal("NOT_FOUND")}).strict()]);

/** Durable locator contains identities/size/CAS, never ZIP/source/credentials or
 * permission grants. Recording it is not upload/commit confirmation. Original
 * actor and current authority are checked by prepared service-only SQL. */
export function createHtmlSnapshotIntentRepository(supabase:SupabaseClient) {
  async function invoke(name:string,args:Record<string,unknown>,parent?:AbortSignal) {
    parent?.throwIfAborted();
    const timeout = AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
    const signal = parent ? AbortSignal.any([parent,timeout]) : timeout;
    try {
      const result = await supabase.rpc(name,args).abortSignal(signal);
      signal.throwIfAborted();
      if (result.error || result.data == null || Buffer.byteLength(JSON.stringify(result.data)) > HTML_EDITING_REPOSITORY_POLICY.acknowledgmentBytes) throw new Error();
      return result.data as unknown;
    } catch {throw new Error("HTML_SNAPSHOT_INTENT_UNCONFIRMED");}
  }
  const recordPublicationIntent:HtmlEditingSnapshotPublicationPorts["recordPublicationIntent"] = async input => {
    const requested = htmlSnapshotIntentSchema.parse({status:"RECORDED",identity:input.identity,
      expectedActiveRevisionId:input.expectedActiveRevisionId,archiveSizeBytes:input.archiveSizeBytes});
    const actorId = z.string().uuid().parse(input.actorId);
    const response = htmlSnapshotIntentSchema.parse(await invoke("record_html_editing_snapshot_intent",{
      p_org:requested.identity.organizationId,p_actor:actorId,p_composition:requested.identity.compositionId,
      p_draft:requested.identity.draftId,p_operation:requested.identity.operationId,p_intent:requested},input.signal));
    if (JSON.stringify(response) !== JSON.stringify(requested)) throw new Error("HTML_SNAPSHOT_INTENT_ACK_INVALID");
    return response;
  };
  async function readPublicationIntent(input:z.infer<typeof ownerSchema> & {signal?:AbortSignal}) {
    const {signal,...raw} = input; const owner = ownerSchema.parse(raw);
    const response = readSchema.parse(await invoke("read_html_editing_snapshot_intent",{p_org:owner.organizationId,
      p_actor:owner.actorId,p_composition:owner.compositionId,p_draft:owner.draftId,p_operation:owner.operationId},signal));
    if (response.status === "RECORDED" && (response.identity.operationId !== owner.operationId
      || response.identity.organizationId !== owner.organizationId || response.identity.compositionId !== owner.compositionId
      || response.identity.draftId !== owner.draftId)) throw new Error("HTML_SNAPSHOT_INTENT_ACK_INVALID");
    return {...response,scope:"DURABLE_IDENTITY_NOT_UPLOAD_OR_COMMIT_CONFIRMATION" as const,automaticRetryAllowed:false as const};
  }
  return {recordPublicationIntent,readPublicationIntent};
}
