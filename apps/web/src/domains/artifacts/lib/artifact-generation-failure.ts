import type { SupabaseClient } from "@supabase/supabase-js";
import { generationFailureMessage } from "../../../lib/pipeline-generation-policy";
import { CourseSourceError } from "../../course-sources/course-source-error";

export async function markArtifactGenerationFailed(
  supabase: SupabaseClient,
  artifactId: string,
  runId: string | undefined,
  error: unknown,
  updatedAt?: string,
  diagnostics?: { stage: string; model?: string; errorName?: string; status?: number; batchReason?: string },
  invocation?: { execution: { organizationId: string }; owner: string },
) {
  const sourceError = error instanceof CourseSourceError ? error : undefined;
  const groundingReason = sourceError?.groundingReason;
  let query = supabase.from("artifacts").update({
    state: "ESCALATED",
    validation_report: {
      all_passed: false,
      results: [{
        code: "GENERATION_FAILED",
        passed: false,
        message: sourceError?.message ?? generationFailureMessage(error),
      }],
      ...(diagnostics ? {
        diagnostics: {
          ...diagnostics,
          ...(groundingReason ? { groundingReason } : {}),
        },
      } : {}),
    },
  }).eq("id", artifactId).eq("state", "GENERATING");
  query = runId ? query.eq("generation_metadata->>run_id", runId) : query.is("generation_metadata->>run_id", null);
  if (updatedAt) query = query.eq("updated_at", updatedAt);
  if (invocation) query = query.eq("organization_id", invocation.execution.organizationId)
    .eq("generation_metadata->base_queue->>owner", invocation.owner);
  const { error: updateError } = await query;
  if (updateError) throw updateError;
}
