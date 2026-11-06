import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  CourseSourceError,
  sourcePersistenceError,
} from "./course-source-error";
export async function readCourseSourcePolicy(
  admin: SupabaseClient,
  artifactId: string,
) {
  const result = await admin
    .from("course_source_settings")
    .select("policy,revision,approved_revision,organization_id")
    .eq("artifact_id", artifactId)
    .maybeSingle();
  if (result.error) {
    // Compatibilidad explícita solo mientras la migración de la biblioteca no existe.
    if (["42P01", "PGRST205"].includes(result.error.code)) return null;
    sourcePersistenceError(result.error);
  }
  if (!result.data) return null;
  const settings = z
    .object({
      policy: z
        .enum(["DOCUMENTS_ONLY", "DOCUMENTS_AND_WEB", "WEB_ONLY"])
        .nullable(),
      revision: z.number().int(),
      approved_revision: z.number().nullable(),
      organization_id: z.uuid(),
    })
    .parse(result.data);
  const artifact = await admin
    .from("artifacts")
    .select("organization_id")
    .eq("id", artifactId)
    .maybeSingle();
  if (artifact.error) sourcePersistenceError(artifact.error);
  if (
    !artifact.data ||
    artifact.data.organization_id !== settings.organization_id
  )
    throw new CourseSourceError(
      404,
      "La configuración documental no corresponde a la organización actual del curso.",
    );
  return settings;
}
