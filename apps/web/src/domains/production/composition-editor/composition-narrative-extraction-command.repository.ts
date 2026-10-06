import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { narrativeExtractionReceiptSchema, type NarrativeExtractionCommandRepository } from "./composition-narrative-extraction-apply.service";
import type { NarrativeExtractionReadRepository } from "./composition-narrative-extraction-query";
import { applyCompositionEditorPatches } from "./editor-patch.service";
import { hashCompositionDocument } from "./composition-document-hash";
import { preservesCompositionHtmlRevisionReferences } from "./composition-html-editing-reference-policy";

const commitResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["COMMITTED", "REPLAYED"]), receipt: narrativeExtractionReceiptSchema }).strict(),
  z.object({ status: z.enum(["CONFLICT", "ASSET_CHANGED", "COMMAND_REUSED", "BUSY"]) }).strict(),
]);
export interface NarrativeExtractionRpcTransport {
  /** Implementation must disable retries and pass the request cancellation signal. */
  invoke(name: "read_narrative_extraction_receipt" | "commit_narrative_voice_extraction",
    parameters: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export function createSupabaseNarrativeExtractionRpcTransport(supabase: SupabaseClient, signal: AbortSignal): NarrativeExtractionRpcTransport {
  return { invoke: (name, parameters) => supabase.rpc(name, parameters).retry(false).abortSignal(signal) };
}

/** Not wired to a route. Requires the prepared additive SQL migration before use. */
export function createNarrativeExtractionCommandRepository(
  reads: NarrativeExtractionReadRepository, transport: NarrativeExtractionRpcTransport,
): NarrativeExtractionCommandRepository {
  const readReceipt: NarrativeExtractionCommandRepository["readReceipt"] = async (scope) => {
    const response = await transport.invoke("read_narrative_extraction_receipt", {
      p_draft_id: scope.draftId, p_organization_id: scope.organizationId, p_actor_id: scope.userId, p_command_id: scope.commandId,
    });
    if (response.error) throw response.error;
    if (response.data === null) return null;
    return narrativeExtractionReceiptSchema.parse(response.data);
  };
  return {
    readReceipt,
    async commit(scope) {
      const current = await reads.readDocument(scope.draftId, scope.organizationId);
      if (current.documentHash !== scope.plan.documentHash) {
        // Another instance may have completed this command after the coordinator's first lookup.
        const prior = await readReceipt(scope);
        if (prior === null) return { status: "CONFLICT" };
        const receipt = narrativeExtractionReceiptSchema.parse(prior);
        return receipt.requestFingerprint === scope.requestFingerprint
          ? { status: "REPLAYED", receipt } : { status: "COMMAND_REUSED" };
      }
      const next = applyCompositionEditorPatches(current.document, scope.plan.operations, "USER");
      if (!preservesCompositionHtmlRevisionReferences(current.document, next)) throw new Error("Extraction cannot retarget HTML references");
      const response = await transport.invoke("commit_narrative_voice_extraction", {
        p_draft_id: scope.draftId, p_organization_id: scope.organizationId, p_actor_id: scope.userId,
        p_command_id: scope.commandId, p_request_fingerprint: scope.requestFingerprint,
        p_plan: scope.plan, p_document: next, p_document_hash: hashCompositionDocument(next),
      });
      if (response.error) throw response.error;
      return commitResponseSchema.parse(response.data);
    },
  };
}
