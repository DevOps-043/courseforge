import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveVideoDurationPolicy } from "../video-duration/video-duration-policy";
import { CourseSourceError, sourcePersistenceError } from "./course-source-error";
import { readCourseSourcePolicy } from "./course-source-settings";
import { BASE_CONTINUATION_LIFETIME_MS, canRetryUnclaimedDocumentaryBase } from "./course-source-base-progress";

export const documentaryBaseSchema = z.object({
  artifactId: z.uuid(),
  runId: z.uuid(),
  description: z.string().trim().min(1).max(3000),
}).strict();

export async function reserveDocumentaryBase(
  admin: SupabaseClient,
  organizationId: string,
  input: z.infer<typeof documentaryBaseSchema>,
  queue?: { scope: string; userId: string },
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
  const startedAt = Date.now();
  const originalMetadata = { ...generation_metadata };
  delete originalMetadata.base_queue;
  const reservation = await admin.from("artifacts").update({
    state: "GENERATING",
    generation_metadata: {
      ...originalMetadata,
      run_id: runId,
      base_progress: null,
      started_at: new Date(startedAt).toISOString(),
      ...(queue ? { base_queue: {
        scope: queue.scope, user_id: queue.userId, due_at: new Date(startedAt).toISOString(),
        expires_at: new Date(startedAt + BASE_CONTINUATION_LIFETIME_MS).toISOString(),
        revision: settings.revision, invocations: 0, recover_expired_batch: state === "ESCALATED",
      } } : {}),
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

export async function retryUnclaimedDocumentaryBase(
  admin: SupabaseClient, organizationId: string, artifactId: string, runId: string, scope: string,
) {
  const artifact = await admin.from("artifacts").select("generation_metadata")
    .eq("id", artifactId).eq("organization_id", organizationId)
    .eq("course_id", `DOC-${artifactId}`).eq("state", "GENERATING").maybeSingle();
  if (artifact.error) sourcePersistenceError(artifact.error);
  const metadata = artifact.data?.generation_metadata;
  if (metadata?.run_id !== runId || !canRetryUnclaimedDocumentaryBase(metadata)) return false;

  const now = Date.now();
  const reservation = await admin.from("artifacts").update({
    generation_metadata: {
      ...metadata,
      started_at: new Date(now).toISOString(),
      base_queue: { ...metadata.base_queue, scope, due_at: new Date(now).toISOString() },
    },
  }).eq("id", artifactId).eq("organization_id", organizationId).eq("state", "GENERATING")
    .eq("course_id", `DOC-${artifactId}`)
    .eq("generation_metadata->>run_id", runId).eq("generation_metadata->>started_at", metadata.started_at)
    .eq("generation_metadata->base_queue->>invocations", "0").select("id").maybeSingle();
  if (reservation.error) sourcePersistenceError(reservation.error);
  return Boolean(reservation.data);
}
