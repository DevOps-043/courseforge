import { z } from "zod";
import { narrativeExtractionQuerySchema, narrativeExtractionSelectionKey } from "./composition-narrative-extraction-contract";
import { NARRATIVE_FRAGMENT_MAX_TRACKS, NARRATIVE_FRAGMENT_MAX_CLIPS } from "./composition-narrative-fragment.types";
import { NARRATIVE_RANGE_PREVIEW_MAX_SECONDS } from "./composition-narrative-range.service";

export const narrativeFragmentQuerySchema = z.object({ contract: z.literal("NARRATIVE_FRAGMENT_QUERY_V1"), selection: narrativeExtractionQuerySchema,
  selectedTrackIds: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i)).min(2).max(NARRATIVE_FRAGMENT_MAX_TRACKS) }).strict()
  .refine(value => new Set(value.selectedTrackIds).size === value.selectedTrackIds.length, "Duplicate tracks");
export type NarrativeFragmentQuery = z.infer<typeof narrativeFragmentQuerySchema>;
export const narrativeFragmentSummarySchema = z.object({ contract: z.literal("NARRATIVE_FRAGMENT_ELIGIBILITY_V1"),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/), reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.literal("AUDIOVISUAL"), binding: z.literal("REGISTRY_METADATA_MATCH_ONLY"), requiresRevalidationBeforeApply: z.literal(true),
  sourceStartSeconds: z.number().finite().nonnegative(), sourceEndSeconds: z.number().finite().positive(),
  destinationStartSeconds: z.number().finite().nonnegative(), destinationEndSeconds: z.number().finite().positive(),
  clipCount: z.number().int().min(2).max(NARRATIVE_FRAGMENT_MAX_CLIPS), trackCount: z.number().int().min(2).max(NARRATIVE_FRAGMENT_MAX_TRACKS),
  captionCuts: z.number().int().nonnegative(), wordCuts: z.number().int().nonnegative(),
}).strict().superRefine((summary, context) => {
  const duration = summary.sourceEndSeconds - summary.sourceStartSeconds;
  if (duration <= 0 || duration > NARRATIVE_RANGE_PREVIEW_MAX_SECONDS
    || Math.abs(duration - (summary.destinationEndSeconds - summary.destinationStartSeconds)) > 0.000001) {
    context.addIssue({ code: "custom", message: "Invalid fragment interval" });
  }
});
export type NarrativeFragmentSummary = z.infer<typeof narrativeFragmentSummarySchema>;

/** Local review identity, never authority to apply. Track order does not change the selected set. */
export function narrativeFragmentSelectionKey(draftId: string, request: NarrativeFragmentQuery) {
  const parsed = narrativeFragmentQuerySchema.safeParse(request);
  if (!parsed.success) return null;
  const selection = narrativeExtractionSelectionKey(draftId, parsed.data.selection);
  return selection ? JSON.stringify([selection, [...parsed.data.selectedTrackIds].sort()]) : null;
}
