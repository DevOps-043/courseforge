import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePlatformRole } from "../../../../utils/auth/platform-role";

export interface SlideWorkerScope { componentId: string; jobId: string; organizationId: string; createdBy: string }

export async function assertSlideWorkerMembership(admin: SupabaseClient, scope: SlideWorkerScope, memberships: Array<{ id: string }>) {
  if (!memberships.some(item => item.id === scope.organizationId)) throw new Error("SLIDES_WORKER_ACCESS_DENIED: El creador ya no pertenece a la organización.");
  const { data, error } = await admin.from("organization_user_roles").select("platform_role")
    .eq("user_id", scope.createdBy).eq("organization_id", scope.organizationId).maybeSingle();
  if (error) throw new Error("SLIDES_WORKER_ROLE_UNAVAILABLE: No se pudo verificar el rol vigente del creador.");
  if (!normalizePlatformRole(data?.platform_role)) throw new Error("SLIDES_WORKER_ACCESS_DENIED: El creador no tiene un rol de autoría vigente.");
}

/** Sólo acepta la capacidad firmada si coincide con la reserva autorizada en HTTP. */
export async function assertSlideWorkerJob(admin: SupabaseClient, scope: SlideWorkerScope) {
  const { data, error } = await admin.from("production_jobs")
    .select("id, artifact_id")
    .eq("id", scope.jobId).eq("organization_id", scope.organizationId)
    .eq("created_by", scope.createdBy).eq("material_component_id", scope.componentId)
    .eq("job_type", "SLIDE_DECK_GENERATION").eq("provider", "soflia_engine_slides").maybeSingle();
  if (error) throw new Error("SLIDES_JOB_LOOKUP_UNAVAILABLE: No se pudo verificar la reserva de slides.");
  if (!data?.artifact_id) throw new Error("SLIDES_JOB_SCOPE_MISMATCH: La solicitud no corresponde al trabajo reservado.");
  return data as { id: string; artifact_id: string };
}

/** No usa cookies: el consumidor verifica firma, nonce, reserva y membresía. */
export async function loadSlideWorkerComponent(admin: SupabaseClient, scope: SlideWorkerScope, artifactId: string) {
  const { data: component, error } = await admin.from("material_components")
    .select("id, type, content, assets, material_lesson_id, material_lessons!inner(materials!inner(artifact_id, artifacts!inner(organization_id)))")
    .eq("id", scope.componentId)
    .eq("material_lessons.materials.artifact_id", artifactId)
    .eq("material_lessons.materials.artifacts.organization_id", scope.organizationId).maybeSingle();
  if (error) throw new Error("SLIDES_COMPONENT_LOOKUP_UNAVAILABLE: No se pudo verificar el componente de slides.");
  if (!component) throw new Error("SLIDES_COMPONENT_SCOPE_MISMATCH: El componente no pertenece al curso y organización del trabajo.");
  return { admin, artifactId, component };
}

export async function failSlideWorkerBeforeGeneration(admin: SupabaseClient, scope: SlideWorkerScope) {
  const { error } = await admin.from("production_jobs")
    .update({ status: "FAILED", failed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      provider_error: { code: "SLIDES_WORKER_PREPARATION_FAILED", message: "El worker no pudo verificar el acceso o preparar el componente. Revisa el diagnóstico del worker antes de reintentar." } })
    .eq("id", scope.jobId).eq("organization_id", scope.organizationId).eq("created_by", scope.createdBy)
    .eq("material_component_id", scope.componentId).eq("job_type", "SLIDE_DECK_GENERATION")
    .in("status", ["PENDING", "QUEUED"]);
  if (error) throw new Error("SLIDES_FAILURE_SAVE_UNAVAILABLE: No se pudo guardar el diagnóstico del trabajo.");
}
