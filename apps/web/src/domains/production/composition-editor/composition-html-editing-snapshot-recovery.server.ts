import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlSnapshotIntentRepository } from "./composition-html-editing-snapshot-intent.server";
import { createHtmlSnapshotReconciler } from "./composition-html-editing-snapshot-reconciliation.server";
import { htmlSnapshotRecoverySummarySchema } from "./composition-html-snapshot-recovery.contract";

/** Recovery composition has no Storage credentials or writer ports. */
export function createHtmlSnapshotRecoveryService(supabase:SupabaseClient) {
  const intents = createHtmlSnapshotIntentRepository(supabase);
  const reconcile = createHtmlSnapshotReconciler(supabase);
  return async (input:Parameters<typeof intents.readPublicationIntent>[0]) => {
    const intent = await intents.readPublicationIntent(input);
    if (intent.status === "NOT_FOUND") return {...intent,status:"NO_INTENT" as const};
    const registration = await reconcile({...intent.identity,actorId:input.actorId,signal:input.signal});
    return {status:"LOCATED" as const,intent,registration,automaticRetryAllowed:false as const};
  };
}

/** Public projection shared by read-only recovery and post-commit observation.
 * Excludes intent payload, HTML, storage paths, hashes and credentials. */
export function summarizeHtmlSnapshotRecovery(operationId:string,recovered:Awaited<ReturnType<ReturnType<typeof createHtmlSnapshotRecoveryService>>>) {
  const base={operationId,automaticRetryAllowed:false,scope:"DATABASE_REGISTRATION_NOT_STORAGE_OR_RENDER_ATTESTATION"};
  const data=recovered.status === "NO_INTENT" ? {...base,status:"NO_INTENT"} : {
    ...base,status:recovered.registration.status === "NOT_FOUND" ? "INTENT_ONLY" : recovered.registration.status,
    ...("acknowledgment" in recovered.registration ? {revisionId:recovered.registration.acknowledgment.revisionId,
      revisionNumber:recovered.registration.acknowledgment.revisionNumber,currentActiveRevisionId:recovered.registration.currentActiveRevisionId} : {}),
  };
  return htmlSnapshotRecoverySummarySchema.parse(data);
}
