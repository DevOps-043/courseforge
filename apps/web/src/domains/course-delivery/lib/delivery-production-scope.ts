import type { DeliveryDocument } from "../types/delivery.schemas";
import { academyLessonId } from "./academy-scope";

/** La cobertura en vivo no retira el estudio asignado explícitamente a Academy. */
export function deliveryProductionScope(document: DeliveryDocument) {
  const liveIds = [...new Set(document.agenda.flatMap(session => session.coverage.map(item => item.lessonId)))];
  const academyIds = document.config.mode === "NEXUS" ? null
    : document.config.mode === "SYNCHRONOUS" ? []
    : [...new Set((document.hybridRoute || []).flatMap(item => item.kind === "ASYNCHRONOUS" ? item.lessonIds : []))];
  return { academyIds, sharedIds: academyIds?.filter(id => liveIds.includes(id)) || [],
    liveOnlyIds: liveIds.filter(id => !academyIds?.includes(id)) };
}

export function isAcademyProductionLesson(lessonId: string, academyIds?: readonly string[] | null) {
  return academyIds == null || academyIds.includes(academyLessonId(lessonId));
}
