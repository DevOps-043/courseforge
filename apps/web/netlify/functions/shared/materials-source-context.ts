import type { SupabaseClient } from "@supabase/supabase-js";
import { readCourseSourcePolicy, readSourceReview } from "../../../src/domains/course-sources/course-source-review.service";
import { getLessonSourceRequirement } from "../../../src/domains/curation/lib/lesson-source-requirement";
import {
  findLessonSources,
  findPlanDetails,
  type CurationRowRecord,
  type LessonPlanRecord,
} from "./materials-generation-helpers";
import type { MaterialSourceValidationContext } from "./materials-lesson-validation";

type LessonReference = { lesson_id: string; lesson_title?: string | null };

export async function loadAptaSources(
  supabase: SupabaseClient,
  artifactId: string,
): Promise<CurationRowRecord[]> {
  const { data: curation, error: curationError } = await supabase
    .from("curation").select("id").eq("artifact_id", artifactId).maybeSingle();
  if (curationError) throw curationError;
  if (!curation) return [];

  const { data: rows, error } = await supabase.from("curation_rows")
    .select("id, lesson_id, lesson_title, source_title, source_ref, cobertura_completa, source_kind, validation_report")
    .eq("curation_id", curation.id).eq("apta", true);
  if (error) throw error;
  return (rows || []).filter((row) =>
    !row.validation_report?.status || row.validation_report.status === "valid",
  ) as CurationRowRecord[];
}

export function buildMaterialSourceValidationContext(
  lessons: LessonReference[],
  lessonPlans: LessonPlanRecord[],
  sources: CurationRowRecord[],
  requiresSources: boolean,
): MaterialSourceValidationContext {
  const requiredSourcesByLesson = new Map<string, number>();
  const validSourceIdsByLesson = new Map<string, Set<string>>();
  for (const lesson of lessons) {
    const reference = { ...lesson, lesson_title: lesson.lesson_title || "" };
    // Key by the persisted material ID (including -Gn), while resolving both
    // sources and plan requirements with the same matching rules as generation.
    requiredSourcesByLesson.set(lesson.lesson_id,
      getLessonSourceRequirement(findPlanDetails(lessonPlans, reference)).requiredSources);
    validSourceIdsByLesson.set(lesson.lesson_id,
      new Set(findLessonSources(sources, reference).map((source) => source.id)));
  }
  return { requiresSources, requiredSourcesByLesson, validSourceIdsByLesson };
}

export async function loadMaterialSourceValidationContext(
  supabase: SupabaseClient,
  artifactId: string,
  lessons: LessonReference[],
): Promise<MaterialSourceValidationContext> {
  const settings = await readCourseSourcePolicy(supabase, artifactId);
  if (settings && settings.policy !== "WEB_ONLY") {
    const review = await readSourceReview(supabase, artifactId);
    if (!review.approved || !review.coverage.length || !review.coverage.every(item => item.complete)) throw new Error("Revisa y aprueba las fuentes vigentes antes de validar materiales.");
    const receipts = await supabase.rpc("current_course_source_component_ids", { p_artifact: artifactId });
    if (receipts.error) throw new Error("No se pudo verificar el respaldo vigente de los componentes.");
    return {
      validComponentIds: new Set<string>(receipts.data || []),
      requiresSources: true,
      requiredSourcesByLesson: new Map(lessons.map(lesson => [lesson.lesson_id, 1])),
      validSourceIdsByLesson: new Map(lessons.map(lesson => [lesson.lesson_id, new Set(review.associations.filter(item => item.lessonId === lesson.lesson_id.replace(/-G\d+$/i, "")).map(item => item.evidenceId))])),
    };
  }
  const [syllabus, plan, sources] = await Promise.all([
    supabase.from("syllabus").select("route").eq("artifact_id", artifactId).single(),
    supabase.from("instructional_plans").select("lesson_plans").eq("artifact_id", artifactId).single(),
    loadAptaSources(supabase, artifactId),
  ]);
  if (syllabus.error) throw syllabus.error;
  if (plan.error) throw plan.error;
  return buildMaterialSourceValidationContext(
    lessons, plan.data.lesson_plans || [], sources, syllabus.data.route !== "B_NO_SOURCE",
  );
}
