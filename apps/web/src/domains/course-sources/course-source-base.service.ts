import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveVideoDurationPolicy } from "../video-duration/video-duration-policy";
import { CourseSourceError, sourcePersistenceError } from "./course-source-error";
import { readCourseSourcePolicy } from "./course-source-settings";

export const documentaryBaseSchema = z.object({
  artifactId: z.uuid(),
  runId: z.uuid(),
  description: z.string().trim().min(1).max(3000),
}).strict();

export async function reserveDocumentaryBase(
  admin: SupabaseClient,
  organizationId: string,
  input: z.infer<typeof documentaryBaseSchema>,
) {
  const { artifactId, runId, description } = input;
  const draft = await admin.from("course_source_drafts").select("artifact_id")
    .eq("artifact_id", artifactId).eq("organization_id", organizationId).maybeSingle();
  if (draft.error) sourcePersistenceError(draft.error);
  if (!draft.data) throw new CourseSourceError(404, "No se encontró el borrador documental.");

  const artifact = await admin.from("artifacts")
    .select("idea_central,state,updated_at,generation_metadata,source_evidence_id")
    .eq("id", artifactId).eq("organization_id", organizationId).maybeSingle();
  if (artifact.error) sourcePersistenceError(artifact.error);
  if (!artifact.data) throw new CourseSourceError(404, "No se encontró el borrador documental.");
  const { state, updated_at, idea_central, generation_metadata, source_evidence_id } = artifact.data;
  if (generation_metadata?.run_id === runId || state === "GENERATING") return null;
  if (!["DRAFT", "ESCALATED"].includes(state) || source_evidence_id) {
    throw new CourseSourceError(409, "Este curso ya tiene una Base. Usa la revisión de Base para regenerarla.");
  }

  const settings = await readCourseSourcePolicy(admin, artifactId);
  if (!settings?.policy || settings.policy === "WEB_ONLY") {
    throw new CourseSourceError(409, "Guarda una política que use tus archivos antes de generar Base.");
  }
  const ready = await admin.from("course_source_documents").select("id")
    .eq("artifact_id", artifactId).eq("organization_id", organizationId)
    .eq("status", "READY").limit(1).maybeSingle();
  if (ready.error) sourcePersistenceError(ready.error);
  if (!ready.data) throw new CourseSourceError(409, "Procesa al menos un documento hasta que muestre «Texto disponible».");

  const videoDurationPolicy = resolveVideoDurationPolicy(undefined);
  const formData = { title: idea_central as string, description, videoDurationPolicy };
  const reservation = await admin.from("artifacts").update({
    state: "GENERATING",
    generation_metadata: {
      ...generation_metadata,
      run_id: runId,
      started_at: new Date().toISOString(),
      original_input: formData,
      video_duration_policy: videoDurationPolicy,
    },
  }).eq("id", artifactId).eq("organization_id", organizationId)
    .eq("state", state).eq("updated_at", updated_at).select("id").maybeSingle();
  if (reservation.error?.message.includes("SOURCE_REVIEW_REQUIRED")) {
    throw new CourseSourceError(409, "Las fuentes cambiaron. Comprueba la política y el texto disponible antes de reintentar.");
  }
  if (reservation.error) sourcePersistenceError(reservation.error);
  if (!reservation.data) throw new CourseSourceError(409, "El borrador cambió. Actualiza el curso para consultar su estado.");
  return formData;
}
