import type { AgendaSession, CurriculumLesson, HybridRoute } from "../types/delivery.schemas";

export type LessonDestination = "PENDING" | "SYNCHRONOUS" | "ASYNCHRONOUS" | "SHARED";

export function lessonAssignment(agenda: AgendaSession[], route: HybridRoute, lessonId: string) {
  const sessionIds = agenda.filter(session => session.coverage.some(item => item.lessonId === lessonId)).map(session => session.id);
  const blockIds = route.flatMap(item => item.kind === "ASYNCHRONOUS" && item.lessonIds.includes(lessonId) ? [item.id] : []);
  const destination: LessonDestination = sessionIds.length ? blockIds.length ? "SHARED" : "SYNCHRONOUS" : blockIds.length ? "ASYNCHRONOUS" : "PENDING";
  return { sessionIds, blockIds, destination };
}

/** Edición de borrador; el guardado sigue pasando por validación y revisión del servidor. */
export function assignLessonDestination(agenda: AgendaSession[], route: HybridRoute, lesson: CurriculumLesson,
  destination: Exclude<LessonDestination, "PENDING">, targets?: { sessionIds?: string[]; blockId?: string }) {
  const previous = lessonAssignment(agenda, route, lesson.id);
  const live = destination !== "ASYNCHRONOUS";
  const study = destination !== "SYNCHRONOUS";
  const sessionIds = targets?.sessionIds ?? (previous.sessionIds.length ? previous.sessionIds : agenda.slice(0, 1).map(item => item.id));
  const blockId = targets?.blockId ?? previous.blockIds[0] ?? route.find(item => item.kind === "ASYNCHRONOUS")?.id;
  if (live && (!sessionIds.length || sessionIds.some(id => !agenda.some(session => session.id === id)))) throw new Error("Añade y selecciona una sesión de Hub para esta lección.");
  if (study && !route.some(item => item.kind === "ASYNCHRONOUS" && item.id === blockId)) throw new Error("Añade un tramo de Academy antes de asignar estudio asíncrono.");
  return {
    agenda: agenda.map(session => ({ ...session, coverage: live && sessionIds.includes(session.id)
      ? session.coverage.some(item => item.lessonId === lesson.id) ? session.coverage : [...session.coverage, { lessonId: lesson.id, scope: lesson.objective || lesson.title, review: false }]
      : session.coverage.filter(item => item.lessonId !== lesson.id) })),
    route: route.map(item => item.kind === "ASYNCHRONOUS" ? { ...item, lessonIds: study && item.id === blockId
      ? item.lessonIds.includes(lesson.id) ? item.lessonIds : [...item.lessonIds, lesson.id]
      : item.lessonIds.filter(id => id !== lesson.id) } : item),
  };
}
