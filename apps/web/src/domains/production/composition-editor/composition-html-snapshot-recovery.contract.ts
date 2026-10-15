import { z } from "zod";

const base = z.object({operationId:z.string().uuid(),automaticRetryAllowed:z.literal(false),
  scope:z.literal("DATABASE_REGISTRATION_NOT_STORAGE_OR_RENDER_ATTESTATION")});
export const htmlSnapshotRecoverySummarySchema = z.discriminatedUnion("status",[
  base.extend({status:z.enum(["NO_INTENT","INTENT_ONLY"])}).strict(),
  base.extend({status:z.enum(["COMMITTED_ACTIVE","COMMITTED_SUPERSEDED"]),revisionId:z.string().uuid(),
    revisionNumber:z.number().int().positive(),currentActiveRevisionId:z.string().uuid().nullable()}).strict(),
]).superRefine((summary,context) => {
  if (summary.status === "COMMITTED_ACTIVE" && summary.currentActiveRevisionId !== summary.revisionId
    || summary.status === "COMMITTED_SUPERSEDED" && summary.currentActiveRevisionId === summary.revisionId)
    context.addIssue({code:"custom",message:"HTML_RECOVERY_ACTIVE_STATE_INVALID"});
});
export type HtmlSnapshotRecoverySummary = z.infer<typeof htmlSnapshotRecoverySummarySchema>;

/** A terminal result for one operation cannot close a different local locator. */
export function canCloseHtmlSnapshotTracking(locatorOperationId:string | null,summary:HtmlSnapshotRecoverySummary | null) {
  return Boolean(summary && locatorOperationId === summary.operationId
    && (summary.status === "COMMITTED_ACTIVE" || summary.status === "COMMITTED_SUPERSEDED"));
}
