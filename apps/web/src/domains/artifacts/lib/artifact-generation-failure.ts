import type { SupabaseClient } from "@supabase/supabase-js";
import { generationFailureMessage } from "../../../lib/pipeline-generation-policy";

export async function markArtifactGenerationFailed(
  supabase: SupabaseClient,
  artifactId: string,
  runId: string | undefined,
  error: unknown,
  updatedAt?: string,
) {
  let query = supabase.from("artifacts").update({
    state: "ESCALATED",
    validation_report: {
      all_passed: false,
      results: [{ code: "GENERATION_FAILED", passed: false, message: generationFailureMessage(error) }],
    },
  }).eq("id", artifactId).eq("state", "GENERATING");
  query = runId ? query.eq("generation_metadata->>run_id", runId) : query.is("generation_metadata->>run_id", null);
  if (updatedAt) query = query.eq("updated_at", updatedAt);
  const { error: updateError } = await query;
  if (updateError) throw updateError;
}
