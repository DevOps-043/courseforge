import type { SupabaseClient } from "@supabase/supabase-js";
import { COURSE_SOURCE_BUCKET } from "./course-source-policy";
import { CourseSourceError, sourcePersistenceError } from "./course-source-error";

export const SOURCE_RETENTION = { graceMs: 24 * 60 * 60 * 1000, purgeMs: 7 * 24 * 60 * 60 * 1000 } as const;
type StorageObservation = { observation: "PRESENT" | "MISSING" | "UNKNOWN"; objectVersion: string | null };

export async function observeSourceObject(admin: SupabaseClient, path: string): Promise<StorageObservation> {
  const { data, error } = await admin.storage.from(COURSE_SOURCE_BUCKET).info(path);
  if (error) return { observation: String(error.statusCode) === "404" ? "MISSING" : "UNKNOWN", objectVersion: null };
  return data?.version ? { observation: "PRESENT", objectVersion: data.version } : { observation: "UNKNOWN", objectVersion: null };
}

export async function reconcileCourseUploads(admin: SupabaseClient, artifactId: string, organizationId: string, actorId: string) {
  const cutoff = new Date(Date.now() - SOURCE_RETENTION.graceMs).toISOString();
  const { data, error } = await admin.from("course_source_documents").select("id,storage_path,expires_at")
    .eq("artifact_id", artifactId).eq("organization_id", organizationId).eq("status", "RESERVED")
    .lt("expires_at", cutoff).order("expires_at").order("id").limit(50);
  if (error) sourcePersistenceError(error);
  const observations = [];
  for (const document of data || []) {
    const observed = await observeSourceObject(admin, document.storage_path);
    const result = await admin.from("course_source_upload_reconciliation").upsert({ document_id: document.id,
      observation: observed.observation, object_version: observed.objectVersion, observed_by: actorId,
      observed_at: new Date().toISOString() }, { onConflict: "document_id" });
    if (result.error) sourcePersistenceError(result.error);
    observations.push({ documentId: document.id, observation: observed.observation });
  }
  return { observations, limit: 50, graceHours: 24, purgeAfterDays: 7 };
}

/** Operación separada: invocador debe autorizar revisor/curso y confirmar el ID exacto. */
export async function purgeAbandonedSource(admin: SupabaseClient, artifactId: string, organizationId: string,
  actorId: string, documentId: string) {
  const { data: document, error } = await admin.from("course_source_documents").select("id,status,expires_at,storage_path")
    .eq("id", documentId).eq("artifact_id", artifactId).eq("organization_id", organizationId).maybeSingle();
  if (error) sourcePersistenceError(error);
  if (!document || document.status !== "RESERVED" || Date.parse(document.expires_at) > Date.now() - SOURCE_RETENTION.purgeMs) {
    throw new CourseSourceError(409, "La reserva no cumple el período de retención de siete días.");
  }
  const observation = await admin.from("course_source_upload_reconciliation").select("observation,object_version,purged_at")
    .eq("document_id", documentId).maybeSingle();
  if (observation.error) sourcePersistenceError(observation.error);
  if (!observation.data || observation.data.observation === "UNKNOWN") throw new CourseSourceError(409, "Conciliación pendiente o incierta.");
  const fragments = await admin.from("course_source_fragments").select("id").eq("document_id", documentId).limit(1);
  const successors = await admin.from("course_source_documents").select("id").eq("supersedes_id", documentId).limit(1);
  if (fragments.error || successors.error) throw new CourseSourceError(503, "No se pudieron verificar las referencias.");
  if (fragments.data?.length || successors.data?.length) throw new CourseSourceError(409, "La fuente conserva referencias; no se puede purgar.");
  const current = await observeSourceObject(admin, document.storage_path);
  if (current.observation === "UNKNOWN" || (current.observation === "PRESENT" && current.objectVersion !== observation.data.object_version)) {
    throw new CourseSourceError(409, "El objeto cambió o su estado no es verificable. Concilia de nuevo.");
  }
  if (current.observation === "PRESENT") {
    const removal = await admin.storage.from(COURSE_SOURCE_BUCKET).remove([document.storage_path]);
    if (removal.error) throw new CourseSourceError(503, "Resultado de borrado incierto. Consulta el estado antes de reintentar.");
    if ((await observeSourceObject(admin, document.storage_path)).observation !== "MISSING") throw new CourseSourceError(503, "No se pudo confirmar la ausencia del objeto.");
  }
  const saved = await admin.from("course_source_upload_reconciliation").update({ purge_authorized_by: actorId, purged_at: new Date().toISOString(), observation: "MISSING" }).eq("document_id", documentId);
  if (saved.error) sourcePersistenceError(saved.error);
  return { purged: true, documentId };
}
