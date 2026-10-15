import { z } from "zod";
import { narrativeFragmentQuerySchema } from "./composition-narrative-fragment-contract";
import { NARRATIVE_FRAGMENT_MAX_CLIPS } from "./composition-narrative-fragment.types";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const clipId = z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i);
export const narrativeFragmentApplyRequestSchema = z.object({ contract: z.literal("NARRATIVE_FRAGMENT_APPLY_V1"),
  commandId: z.string().uuid(), query: narrativeFragmentQuerySchema, reviewFingerprint: hash }).strict();
export type NarrativeFragmentApplyRequest = z.infer<typeof narrativeFragmentApplyRequestSchema>;

function hasValidFragmentIdentities(receipt: { commandId: string; anchorClipId: string; newClipIds: string[] }) {
  return receipt.anchorClipId === `voice-extract-${receipt.commandId}` && receipt.newClipIds.includes(receipt.anchorClipId)
    && new Set(receipt.newClipIds).size === receipt.newClipIds.length
    && receipt.newClipIds.every(id => {
      if (id === receipt.anchorClipId) return true;
      const prefix = `fragment-${receipt.commandId}-`;
      const ordinal = id.slice(prefix.length);
      return id.startsWith(prefix) && /^(0|[1-9]\d*)$/.test(ordinal) && Number(ordinal) < NARRATIVE_FRAGMENT_MAX_CLIPS;
    });
}
export const narrativeFragmentReceiptSchema = z.object({ contract: z.literal("NARRATIVE_FRAGMENT_RECEIPT_V1"),
  commandId: z.string().uuid(), requestFingerprint: hash, documentHash: hash, version: z.number().int().positive(),
  anchorClipId: clipId, newClipIds: z.array(clipId).min(2).max(NARRATIVE_FRAGMENT_MAX_CLIPS),
}).strict().superRefine((receipt, context) => {
  if (!hasValidFragmentIdentities(receipt)) {
    context.addIssue({ code: "custom", message: "Invalid fragment receipt identities" });
  }
});
export type NarrativeFragmentReceipt = z.infer<typeof narrativeFragmentReceiptSchema>;

const commandResultFields = { contract: z.literal("NARRATIVE_FRAGMENT_COMMAND_RESULT_V1"), commandId: z.string().uuid(),
  automaticRetryAllowed: z.literal(false) };
export const narrativeFragmentCommandResultSchema = z.discriminatedUnion("status", [
  z.object({ ...commandResultFields, status: z.enum(["COMMITTED", "REPLAYED", "CONFIRMED"]),
    documentHash: hash, version: z.number().int().positive(), anchorClipId: clipId,
    newClipIds: z.array(clipId).min(2).max(NARRATIVE_FRAGMENT_MAX_CLIPS),
    scope: z.literal("DATABASE_COMMIT_ONLY"), reloadDocumentRequired: z.literal(true), recoveryRequired: z.literal(false) }).strict(),
  z.object({ ...commandResultFields, status: z.literal("UNCONFIRMED"), recoveryRequired: z.literal(true) }).strict(),
]).superRefine((result, context) => {
  if (result.status !== "UNCONFIRMED" && !hasValidFragmentIdentities(result)) {
    context.addIssue({ code: "custom", message: "Invalid fragment result identities" });
  }
});
export type NarrativeFragmentCommandResult = z.infer<typeof narrativeFragmentCommandResultSchema>;
