import { z } from "zod";
import { NARRATIVE_RANGE_PREVIEW_MAX_SECONDS } from "./composition-narrative-range.service";

export const NARRATIVE_EXTRACTION_QUERY_MAX_BYTES = 8 * 1024;
export const NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS = 15_000;
export const narrativeExtractionQuerySchema = z.object({
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  occurrenceId: z.string().min(1).max(4096),
  firstSourceIndex: z.number().int().nonnegative(),
  lastSourceIndex: z.number().int().nonnegative(),
  adjustedStartSeconds: z.number().finite().nonnegative().optional(),
  adjustedEndSeconds: z.number().finite().nonnegative().optional(),
}).strict();
export type NarrativeExtractionQuery = z.infer<typeof narrativeExtractionQuerySchema>;

export const narrativeExtractionSummarySchema = z.object({
  contract: z.literal("NARRATIVE_VOICE_EXTRACTION_ELIGIBILITY_V2"),
  reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.literal("VOICE_ONLY"), binding: z.literal("REGISTRY_METADATA_MATCH_ONLY"),
  sourceStartSeconds: z.number().finite().nonnegative(), sourceEndSeconds: z.number().finite().positive(),
  destinationStartSeconds: z.number().finite().nonnegative(), destinationEndSeconds: z.number().finite().positive(),
  requiresRevalidationBeforeApply: z.literal(true),
}).strict().superRefine((summary, context) => {
  const sourceDuration = summary.sourceEndSeconds - summary.sourceStartSeconds;
  const destinationDuration = summary.destinationEndSeconds - summary.destinationStartSeconds;
  const TIME_COMPARISON_TOLERANCE_SECONDS = 0.000001;
  if (sourceDuration <= 0 || sourceDuration > NARRATIVE_RANGE_PREVIEW_MAX_SECONDS
    || destinationDuration <= 0 || Math.abs(sourceDuration - destinationDuration) > TIME_COMPARISON_TOLERANCE_SECONDS) {
    context.addIssue({ code: "custom", message: "Invalid extraction intervals" });
  }
});
export type NarrativeExtractionSummary = z.infer<typeof narrativeExtractionSummarySchema>;

export const narrativeExtractionApplyRequestSchema = z.object({
  contract: z.literal("NARRATIVE_VOICE_EXTRACTION_APPLY_V1"),
  commandId: z.string().uuid(),
  selection: narrativeExtractionQuerySchema,
  reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type NarrativeExtractionApplyRequest = z.infer<typeof narrativeExtractionApplyRequestSchema>;

const publicCommandFields = {
  contract: z.literal("NARRATIVE_EXTRACTION_COMMAND_RESULT_V1"), commandId: z.string().uuid(),
  automaticRetryAllowed: z.literal(false),
};
export const narrativeExtractionCommandResultSchema = z.discriminatedUnion("status", [
  z.object({ ...publicCommandFields, status: z.enum(["COMMITTED", "REPLAYED", "CONFIRMED"]),
    documentHash: z.string().regex(/^[a-f0-9]{64}$/), version: z.number().int().positive(),
    newClipId: z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i), scope: z.literal("DATABASE_COMMIT_ONLY"),
    reloadDocumentRequired: z.literal(true), recoveryRequired: z.literal(false), }).strict(),
  z.object({ ...publicCommandFields, status: z.literal("UNCONFIRMED"), recoveryRequired: z.literal(true) }).strict(),
]).superRefine((result, context) => {
  if (result.status !== "UNCONFIRMED" && result.newClipId !== `voice-extract-${result.commandId}`) {
    context.addIssue({ code: "custom", message: "Receipt identity mismatch" });
  }
});
export type NarrativeExtractionCommandResult = z.infer<typeof narrativeExtractionCommandResultSchema>;

/** Explicit negative acknowledgement of this fresh apply; never evidence about a recovered command. */
export const narrativeExtractionRejectionSchema = z.object({
  success: z.literal(false), code: z.string().min(1).max(80), error: z.string(), message: z.string(),
  requestId: z.string().min(1).max(128), correlationId: z.string().min(1).max(128), retryable: z.literal(false),
  details: z.object({ reason: z.string().min(1).max(80), automaticRetryAllowed: z.literal(false),
    recoveryRequired: z.literal(false), requestNotApplied: z.literal(true), commandId: z.string().uuid().optional() }).strict(),
}).strict();

/** Identity of the exact local selection; it carries no authorization. */
export function narrativeExtractionSelectionKey(draftId: string, selection: NarrativeExtractionQuery) {
  const parsed = narrativeExtractionQuerySchema.safeParse(selection);
  if (!z.string().uuid().safeParse(draftId).success || !parsed.success) return null;
  const value = parsed.data;
  return JSON.stringify([draftId, value.documentHash, value.occurrenceId, value.firstSourceIndex,
    value.lastSourceIndex, value.adjustedStartSeconds ?? null, value.adjustedEndSeconds ?? null]);
}
