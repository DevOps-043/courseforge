import type { DeliveryDocument } from "../types/delivery.schemas";
import { curriculumLessons } from "./delivery-policy";
import { routeIssues } from "./hybrid-route";
import { deliveryHash } from "./delivery-hash";
import { getInstructionalPlanCompletenessIssues } from "../../plan/lib/plan-completeness";

type Module = { lessons: Array<{ id?: string; [key: string]: unknown }>; [key: string]: unknown };
export interface AcademyScope {
  modules: Module[];
  lessonIds: string[];
  routeHash: string | null;
}

/** Los materiales existentes añaden un sufijo de generación al ID curricular. */
export function academyLessonId(id: string) { return id.replace(/-G\d+$/i, ""); }

/** Asigna IDs con las posiciones originales antes de eliminar temas de Hub. */
export function academyScope(document: DeliveryDocument, rawModules: unknown): AcademyScope {
  const lessons = curriculumLessons(rawModules);
  if (new Set(lessons.map(lesson => lesson.id)).size !== lessons.length) throw new Error("El temario repite identificadores de lección.");
  const modules = (rawModules as Module[]).map((module, mi) => ({ ...module,
    ...(document.config.mode === "HYBRID" ? { id: module.id || `mod-${mi}`, delivery_module_index: mi } : {}),
    lessons: module.lessons.map((lesson, li) => ({ ...lesson, id: lesson.id || `lesson-${mi + 1}-${li + 1}` })),
  }));
  if (document.config.mode === "SYNCHRONOUS") return { modules: [], lessonIds: [], routeHash: null };
  if (document.config.mode === "NEXUS") return { modules, lessonIds: lessons.map(lesson => lesson.id), routeHash: null };
  const issues = routeIssues(document, lessons);
  if (issues.length) throw new Error(`Completa el recorrido híbrido antes de continuar. ${issues.join(" ")}`);
  if (document.syllabusHash !== deliveryHash(rawModules)) throw new Error("El recorrido no corresponde al temario vigente. Actualiza su distribución.");
  const ids = document.hybridRoute!.flatMap(item => item.kind === "ASYNCHRONOUS" ? item.lessonIds : []);
  const selected = new Set(ids);
  return {
    modules: modules.map(module => ({ ...module, lessons: module.lessons.filter(lesson => selected.has(lesson.id)) })).filter(module => module.lessons.length),
    lessonIds: ids,
    routeHash: deliveryHash({ syllabus: document.syllabusHash, route: document.hybridRoute, agenda: document.agenda }),
  };
}

export function assertAcademyPlans(scope: AcademyScope, plans: unknown) {
  const issues = getInstructionalPlanCompletenessIssues(scope.modules, plans);
  if (issues.length) throw new Error(`El plan de Academy no corresponde a la distribución. ${issues.join(" ")}`);
  if (scope.routeHash && (plans as Array<{ delivery_route_hash?: unknown }>).some(plan => plan.delivery_route_hash !== scope.routeHash)) {
    throw new Error("Regenera el plan de Academy: pertenece a otra distribución del recorrido híbrido.");
  }
}

export function assertAcademyLesson(scope: AcademyScope, lessonId: string) {
  if (!scope.lessonIds.includes(academyLessonId(lessonId))) throw new Error("La lección no pertenece al estudio asíncrono de Academy en el recorrido vigente.");
}
