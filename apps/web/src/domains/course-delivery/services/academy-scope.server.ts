import type { SupabaseClient } from "@supabase/supabase-js";
import { academyScope, assertAcademyPlans, assertAcademyLesson, academyLessonId } from "../lib/academy-scope";
import { selectLatestComponentsByType } from "../../materials/lib/material-component-versions";
import { readDeliveryWorkspace } from "./delivery-repository";

/** El consumidor debe autorizar el artefacto antes de llamar con cliente privilegiado. */
export async function readAcademyScope(admin: SupabaseClient, artifactId: string, organizationId?: string) {
  const { data: artifact, error } = await admin.from("artifacts").select("organization_id").eq("id", artifactId).single();
  if (error || !artifact?.organization_id || (organizationId && organizationId !== artifact.organization_id)) throw new Error("No se pudo verificar el curso de Academy para esta organización.");
  const [workspace, syllabus] = await Promise.all([
    readDeliveryWorkspace(admin, artifactId, artifact.organization_id),
    admin.from("syllabus").select("modules,state").eq("artifact_id", artifactId).single(),
  ]);
  if (syllabus.error || !syllabus.data) throw new Error("No se pudo verificar el temario del curso.");
  if (workspace.document.config.mode !== "NEXUS" && syllabus.data.state !== "STEP_APPROVED") throw new Error("Aprueba el temario antes de preparar Academy.");
  return academyScope(workspace.document, syllabus.data.modules);
}

export async function assertAcademyMaterialsCurrent(admin: SupabaseClient, artifactId: string) {
  const scope = await readAcademyScope(admin, artifactId);
  if (!scope.routeHash) return;
  const [plan, materials] = await Promise.all([
    admin.from("instructional_plans").select("lesson_plans").eq("artifact_id", artifactId).single(),
    admin.from("materials").select("id").eq("artifact_id", artifactId).single(),
  ]);
  if (plan.error || materials.error) throw new Error("No se pudieron verificar los materiales de Academy.");
  assertAcademyPlans(scope, plan.data.lesson_plans);
  const { data: lessons, error } = await admin.from("material_lessons")
    .select("lesson_id,state,expected_components,material_components(type,iteration_number,assets)").eq("materials_id", materials.data.id);
  if (error || !lessons) throw new Error("No se pudo verificar la distribución de materiales.");
  if (lessons.length !== scope.lessonIds.length || new Set(lessons.map(lesson => academyLessonId(lesson.lesson_id))).size !== scope.lessonIds.length || lessons.some(lesson => !scope.lessonIds.includes(academyLessonId(lesson.lesson_id)))) {
    throw new Error("Los materiales conservan otra distribución. Revisa y reinicia su generación desde el plan vigente; el contenido anterior no se elimina automáticamente.");
  }
  for (const lesson of lessons) {
    const components = selectLatestComponentsByType(lesson.material_components);
    if (lesson.state !== "APPROVABLE" || !components.length || components.some(component => component.assets?.delivery_route_hash !== scope.routeHash) ||
      (lesson.expected_components || []).some((type: string) => !components.some(component => component.type === type))) {
      throw new Error("Hay materiales de Academy incompletos o de otra distribución. Regenera y valida las lecciones pendientes.");
    }
  }
}

export async function assertAcademyComponentCurrent(admin: SupabaseClient, artifactId: string, lessonId: string, assets: unknown) {
  const scope = await readAcademyScope(admin, artifactId);
  assertAcademyLesson(scope, lessonId);
  if (scope.routeHash && (!assets || typeof assets !== "object" || !("delivery_route_hash" in assets) || assets.delivery_route_hash !== scope.routeHash)) {
    throw new Error("Regenera este recurso desde los materiales de Academy: la distribución híbrida cambió.");
  }
}
