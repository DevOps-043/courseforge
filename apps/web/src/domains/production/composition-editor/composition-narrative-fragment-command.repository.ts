import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NarrativeFragmentCommandRepository } from "./composition-narrative-fragment-apply.server";
import type { NarrativeFragmentReadRepository } from "./composition-narrative-fragment-query.server";
import { narrativeFragmentReceiptSchema } from "./composition-narrative-fragment-command-contract";
import { applyCompositionEditorPatches } from "./editor-patch.service";
import { hashCompositionDocument } from "./composition-document-hash";
import { preservesCompositionHtmlRevisionReferences } from "./composition-html-editing-reference-policy";

const commitResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["COMMITTED", "REPLAYED"]), receipt: narrativeFragmentReceiptSchema }).strict(),
  z.object({ status: z.enum(["CONFLICT", "ASSET_CHANGED", "FONT_CHANGED", "COMMAND_REUSED", "BUSY"]) }).strict(),
]);
export interface NarrativeFragmentRpcTransport {
  invoke(name: "read_narrative_fragment_receipt" | "commit_narrative_fragment",
    parameters: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export function createSupabaseNarrativeFragmentRpcTransport(supabase: SupabaseClient, signal: AbortSignal): NarrativeFragmentRpcTransport {
  return { invoke: (name, parameters) => supabase.rpc(name, parameters).retry(false).abortSignal(signal) };
}

/** Requires audiovisual RPCs. Never falls back to voice RPC, generic append or sequential clip writes. */
export function createNarrativeFragmentCommandRepository(reads: Pick<NarrativeFragmentReadRepository, "readDocument">,
  transport: NarrativeFragmentRpcTransport): NarrativeFragmentCommandRepository {
  const readReceipt: NarrativeFragmentCommandRepository["readReceipt"] = async scope => {
    const response = await transport.invoke("read_narrative_fragment_receipt", {
      p_draft_id: scope.draftId, p_organization_id: scope.organizationId, p_actor_id: scope.userId, p_command_id: scope.commandId,
    });
    if (response.error) throw response.error;
    return response.data === null ? null : narrativeFragmentReceiptSchema.parse(response.data);
  };
  return { readReceipt, async commit(scope) {
    const current = await reads.readDocument(scope.draftId, scope.organizationId);
    if (current.documentHash !== scope.plan.documentHash) {
      // A concurrent identical command may have committed since the coordinator's receipt lookup.
      const prior = await readReceipt(scope);
      if (prior === null) return { status: "CONFLICT" };
      const receipt = narrativeFragmentReceiptSchema.parse(prior);
      if (receipt.commandId !== scope.commandId) throw new Error("NARRATIVE_FRAGMENT_RECEIPT_MISMATCH");
      return receipt.requestFingerprint === scope.requestFingerprint ? { status: "REPLAYED", receipt } : { status: "COMMAND_REUSED" };
    }
    const operations = scope.plan.operations;
    const addedIds = operations.flatMap(operation => operation.type === "clip.add" ? [operation.clip.id] : []);
    if (operations[0]?.type !== "composition.canvas-duration"
      || operations.filter(operation => operation.type === "composition.canvas-duration").length !== 1
      || operations.some(operation => !["composition.canvas-duration", "clip.add", "group.create"].includes(operation.type))
      || JSON.stringify([...addedIds].sort()) !== JSON.stringify(scope.plan.copies.map(copy => copy.newClipId).sort())) {
      throw new Error("NARRATIVE_FRAGMENT_APPEND_BATCH_INVALID");
    }
    const next = applyCompositionEditorPatches(current.document, operations, "USER");
    if (!preservesCompositionHtmlRevisionReferences(current.document, next)) throw new Error("Fragment cannot retarget HTML references");
    const response = await transport.invoke("commit_narrative_fragment", {
      p_draft_id: scope.draftId, p_organization_id: scope.organizationId, p_actor_id: scope.userId, p_command_id: scope.commandId,
      p_request_fingerprint: scope.requestFingerprint, p_plan: scope.plan, p_document: next, p_document_hash: hashCompositionDocument(next),
    });
    if (response.error) throw response.error;
    return commitResponseSchema.parse(response.data);
  } };
}
