import type { AgendaSession, DeliveryConfig, DeliveryDocument, SessionMaterials, SessionPlan } from "../types/delivery.schemas";

export function deliveryRequirements(mode: DeliveryConfig["mode"]) {
  return { nexus: mode !== "SYNCHRONOUS", sessions: mode !== "NEXUS", assembly: mode !== "SYNCHRONOUS" };
}
export interface CurriculumLesson { id: string; title: string; module: string; objective: string }
export function curriculumLessons(modules: unknown): CurriculumLesson[] {
  if (!Array.isArray(modules)) throw new Error("El temario no contiene módulos válidos.");
  return modules.flatMap((module, mi) => {
    if (!module || !Array.isArray(module.lessons)) throw new Error("El módulo no contiene lecciones válidas.");
    return module.lessons.map((lesson: { id?: string; title: string; objective_specific?: string }, li: number) => ({
      id: lesson.id || `lesson-${mi + 1}-${li + 1}`, title: lesson.title, module: module.title, objective: lesson.objective_specific || lesson.title,
    }));
  });
}
export function agendaIssues(agenda: AgendaSession[], lessons: CurriculumLesson[], count?: number | null) {
  const issues: string[] = [];
  const known = new Set(lessons.map(lesson => lesson.id));
  if (!agenda.length) issues.push("Falta la agenda de sesiones.");
  if (count && agenda.length !== count) issues.push("La agenda no respeta la cantidad de sesiones configurada.");
  if (new Set(agenda.map(session => session.id)).size !== agenda.length) issues.push("La agenda repite identificadores de sesión.");
  const covered = new Set<string>();
  for (const session of agenda) {
    for (const item of session.coverage) {
      if (!known.has(item.lessonId)) issues.push(`Referencia de lección ajena: ${item.lessonId}.`);
      if (!item.review) covered.add(item.lessonId);
    }
    if (new Set(session.coverage.map(item => item.lessonId)).size !== session.coverage.length) issues.push(`La sesión ${session.title} repite referencias.`);
  }
  for (const lesson of lessons) if (!covered.has(lesson.id)) issues.push(`Falta cobertura principal para ${lesson.title}.`);
  return issues;
}
export function planIssues(session: AgendaSession, plan: SessionPlan, config: DeliveryConfig) {
  const issues: string[] = [];
  const minutes = plan.blocks.reduce((sum, block) => sum + block.minutes, 0);
  if (minutes !== session.minutes) issues.push(`Los bloques de ${session.title} suman ${minutes} minutos; deben distribuir sus ${session.minutes} minutos disponibles.`);
  if (new Set(plan.blocks.map(block => block.id)).size !== plan.blocks.length) issues.push("Los bloques repiten identificadores.");
  const covered = new Set(session.coverage.map(item => item.lessonId));
  if (plan.nexusLinks.some(link => !covered.has(link.lessonId))) issues.push("Las referencias Nexus deben pertenecer a la sesión.");
  if (config.mode === "HYBRID" && [...covered].some(id => !plan.nexusLinks.some(link => link.lessonId === id))) issues.push("Falta coordinación Nexus para las lecciones de la sesión.");
  return issues;
}
export function materialIssues(plan: SessionPlan, material: SessionMaterials, sourceIds: string[]) {
  const issues: string[] = [];
  const knownSources = new Set(sourceIds);
  const refs = [...material.concepts, ...material.activities, ...material.slides].flatMap(item => item.sourceRefs);
  if (refs.some(ref => !knownSources.has(ref))) issues.push("El contenido cita fuentes no aprobadas o ajenas.");
  const ids = material.activities.map(activity => activity.id);
  if (new Set(ids).size !== ids.length) issues.push("Las actividades repiten identificadores.");
  if (plan.blocks.some(block => !ids.includes(block.id))) issues.push("Cada bloque debe conservar su identificador en una actividad o consigna de conducción.");
  return issues;
}
export function sessionSources<Source extends { id: string; lessonId: string }>(session: AgendaSession, sources: Source[]) {
  return sources.filter(source => session.coverage.some(item => item.lessonId === source.lessonId));
}
/** Proyección explícita: nunca serializar el documento interno para un participante. */
export function participantMaterials(material: SessionMaterials) {
  return {
    concepts: material.concepts.map(({ title, explanation, example, sourceRefs }) => ({ title, explanation, example, sourceRefs })),
    activities: material.activities.map(({ id, title, instructions, template, sourceRefs }) => ({ id, title, instructions, template, sourceRefs })),
    slides: material.slides.map(({ title, points, sourceRefs }) => ({ title, points, sourceRefs })),
  };
}
export function completeSessionPlan(document: DeliveryDocument, lessons: CurriculumLesson[]) {
  return [...agendaIssues(document.agenda, lessons, document.config.sessionCount),
    ...document.agenda.flatMap(session => document.plans[session.id] ? planIssues(session, document.plans[session.id], document.config) : [`Falta el plan de ${session.title}.`])];
}
