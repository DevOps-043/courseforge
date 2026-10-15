import {z} from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
const controlledLineageSchema = z.object({
  executionId: uuid, receiptSha256: hash, checksum: hash,
  jobExecutionId: uuid, jobReceiptSha256: hash, jobBackend: z.literal("CONTROLLED"),
  assetBackend: z.literal("CONTROLLED"), assetRevisionId: uuid, revisionId: uuid,
  contractVersion: z.literal(4), contractBackend: z.literal("CONTROLLED"),
  integrityMethod: z.literal("storage-stream-sha256-v1"),
}).strict().superRefine((lineage, context) => {
  if (lineage.executionId !== lineage.jobExecutionId || lineage.receiptSha256 !== lineage.jobReceiptSha256
    || lineage.assetRevisionId !== lineage.revisionId)
    context.addIssue({code: "custom", message: "VIDEO_INTEGRITY_LINEAGE_MISMATCH"});
});

/** Pure projection of stored lineage; neither an unsigned metadata claim nor a conformity approval. */
export function resolveControlledVideoLineage(input: unknown) {
  const parsed = controlledLineageSchema.safeParse(input);
  if (!parsed.success) throw new Error("VIDEO_INTEGRITY_LINEAGE_MISMATCH");
  return parsed.data;
}
