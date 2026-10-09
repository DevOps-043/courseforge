import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { SyllabusRow } from "../types/syllabus.types";

/** Select only workflow fields, with a compatibility fallback during rollout. */
export async function readSyllabusWithOrigin(
  admin: SupabaseClient,
  artifactId: string,
  fields: string,
): Promise<{ data: SyllabusRow | null; error: PostgrestError | null }> {
  const baseFields = `id,artifact_id,${fields}`;
  let result = await admin
    .from("syllabus")
    .select(`${baseFields},input_mode,content_version,active_import_id`)
    .eq("artifact_id", artifactId)
    .maybeSingle();
  if (result.error && ["42703", "PGRST204"].includes(result.error.code)) {
    result = await admin
      .from("syllabus")
      .select(baseFields)
      .eq("artifact_id", artifactId)
      .maybeSingle();
  }
  return {
    data: result.data as unknown as SyllabusRow | null,
    error: result.error,
  };
}
