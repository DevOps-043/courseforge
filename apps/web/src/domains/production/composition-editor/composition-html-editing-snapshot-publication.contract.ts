import { z } from "zod";
import { HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES } from "../hyperframes/hyperframes.types";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const htmlSnapshotOperationIdentitySchema = z.object({operationId:z.string().uuid(), organizationId:z.string().uuid(),
  compositionId:z.string().uuid(), draftId:z.string().uuid(), documentHash:hash, projectHash:hash}).strict();
export type HtmlSnapshotOperationIdentity = z.infer<typeof htmlSnapshotOperationIdentitySchema>;
export const htmlSnapshotIntentSchema = z.object({status:z.literal("RECORDED"), identity:htmlSnapshotOperationIdentitySchema,
  expectedActiveRevisionId:z.string().uuid().nullable(), archiveSizeBytes:z.number().int().positive().max(HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES)}).strict();
export const htmlSnapshotAcknowledgmentSchema = htmlSnapshotOperationIdentitySchema.extend({revisionId:z.string().uuid(),
  revisionNumber:z.number().int().positive(), activeRevisionId:z.string().uuid(), disposition:z.enum(["CREATED","REUSED"])}).strict();

/** A persisted ACK describes the commit instant, not today's active revision.
 * Reconciliation must separately compare its currentActiveRevisionId. */
export function parseHtmlSnapshotAcknowledgment(raw:unknown, expected:HtmlSnapshotOperationIdentity) {
  const acknowledgment = htmlSnapshotAcknowledgmentSchema.parse(raw);
  for (const field of Object.keys(htmlSnapshotOperationIdentitySchema.shape) as Array<keyof HtmlSnapshotOperationIdentity>) {
    if (acknowledgment[field] !== expected[field]) throw new Error("HTML_SNAPSHOT_ACK_INVALID");
  }
  if (acknowledgment.activeRevisionId !== acknowledgment.revisionId) throw new Error("HTML_SNAPSHOT_ACK_INVALID");
  return acknowledgment;
}
