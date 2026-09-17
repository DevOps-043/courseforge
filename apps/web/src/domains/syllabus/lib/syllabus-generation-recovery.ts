import type { SupabaseClient } from "@supabase/supabase-js";
import { SYLLABUS_STATES } from "../../../lib/pipeline-constants";
import { isGenerationStale } from "../../../lib/pipeline-generation-policy";
import type { SyllabusRow } from "../types/syllabus.types";

export const STALE_SYLLABUS_GENERATION_MESSAGE =
  "La generación del temario no reportó avance dentro del tiempo permitido. Puedes reintentarla.";

/**
 * A background job that dies before its `try` block (invalid signature, unavailable
 * dependency) never writes state, leaving the syllabus in STEP_GENERATING forever.
 * This applies the same lease-expiry recovery artifacts, curation and materials already
 * use, always from an authenticated read — never from the unverified background request.
 */
export async function recoverStaleSyllabusGeneration(
  database: SupabaseClient,
  artifactId: string,
  syllabus: SyllabusRow | null,
  now = Date.now(),
): Promise<SyllabusRow | null> {
  if (
    !syllabus ||
    syllabus.state !== SYLLABUS_STATES.GENERATING ||
    !syllabus.updated_at ||
    !isGenerationStale(syllabus.updated_at, now)
  ) {
    return syllabus;
  }

  const { data, error } = await database
    .from("syllabus")
    .update({
      state: SYLLABUS_STATES.ESCALATED,
      source_summary: {
        ...(syllabus.source_summary || {}),
        error: STALE_SYLLABUS_GENERATION_MESSAGE,
      },
      updated_at: new Date(now).toISOString(),
    })
    .eq("artifact_id", artifactId)
    .eq("state", SYLLABUS_STATES.GENERATING)
    .eq("iteration_count", syllabus.iteration_count)
    .eq("updated_at", syllabus.updated_at)
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  // If the job finished between the read and this update, the updated_at guard matches
  // no row: return what was read and let the next poll surface the real result.
  if (!data) {
    return syllabus;
  }

  return data as SyllabusRow;
}
