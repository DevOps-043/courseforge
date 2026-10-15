import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { htmlSnapshotOperationIdentitySchema, htmlSnapshotAcknowledgmentSchema, parseHtmlSnapshotAcknowledgment } from "./composition-html-editing-snapshot-publication.contract";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";

const requestSchema = htmlSnapshotOperationIdentitySchema.extend({actorId:z.string().uuid()}).strict();
const responseSchema = z.discriminatedUnion("status", [
  z.object({status:z.literal("NOT_FOUND")}).strict(),
  z.object({status:z.literal("COMMITTED"), acknowledgment:htmlSnapshotAcknowledgmentSchema,
    currentActiveRevisionId:z.string().uuid().nullable()}).strict(),
]);
export class HtmlSnapshotReconciliationError extends Error {
  constructor(readonly code:"INVALID_RESPONSE" | "READ_UNAVAILABLE") {super(code); this.name = "HtmlSnapshotReconciliationError";}
}

/** Read-only service adapter. No upload/commit/delete/retry/re-activation.
 * Actor/scope must come from authenticated host context. SQL checks original
 * actor, current tenant permissions, resources and stored revision under locks.
 * NOT_FOUND is only a transactional observation, never permission to repeat a
 * write: Storage-only or concurrent/unobserved outcomes still need resolution.
 * This reports DB registration, not current archive bytes or render success. */
export function createHtmlSnapshotReconciler(supabase:SupabaseClient) {
  return async (params:z.infer<typeof requestSchema> & {signal?:AbortSignal}) => {
    const {signal:parentSignal, ...raw} = params;
    const request = requestSchema.parse(raw);
    parentSignal?.throwIfAborted();
    const timeout = AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
    const signal = parentSignal ? AbortSignal.any([parentSignal,timeout]) : timeout;
    let data:unknown;
    try {
      const result = await supabase.rpc("read_html_editing_snapshot_operation", {p_org:request.organizationId,
        p_actor:request.actorId, p_composition:request.compositionId, p_draft:request.draftId,
        p_operation:request.operationId, p_document_hash:request.documentHash, p_project_hash:request.projectHash}).abortSignal(signal);
      signal.throwIfAborted();
      if (result.error) throw new Error();
      data = result.data;
    } catch {throw new HtmlSnapshotReconciliationError("READ_UNAVAILABLE");}
    let response:z.infer<typeof responseSchema>;
    try {
      if (data == null || Buffer.byteLength(JSON.stringify(data)) > HTML_EDITING_REPOSITORY_POLICY.acknowledgmentBytes) throw new Error();
      response = responseSchema.parse(data);
    } catch {throw new HtmlSnapshotReconciliationError("INVALID_RESPONSE");}
    const base = {operationId:request.operationId, scope:"DATABASE_REGISTRATION_NOT_STORAGE_OR_RENDER_ATTESTATION" as const,
      automaticRetryAllowed:false as const};
    if (response.status === "NOT_FOUND") return {...base, status:"NOT_FOUND" as const};
    try {
      const acknowledgment = parseHtmlSnapshotAcknowledgment(response.acknowledgment, request);
      return {...base, status:response.currentActiveRevisionId === acknowledgment.revisionId
        ? "COMMITTED_ACTIVE" as const : "COMMITTED_SUPERSEDED" as const,
        acknowledgment, currentActiveRevisionId:response.currentActiveRevisionId};
    } catch {throw new HtmlSnapshotReconciliationError("INVALID_RESPONSE");}
  };
}
