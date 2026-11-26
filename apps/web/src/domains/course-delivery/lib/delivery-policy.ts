import type { AgendaSession, CurriculumLesson, DeliveryConfig, DeliveryDocument, SessionMaterials, SessionPlan } from "../types/delivery.schemas";
import { routeIssues, hybridPlanIssues } from "./hybrid-route";

export function deliveryRequirements(mode: DeliveryConfig["mode"]) {
  return { nexus: mode !== "SYNCHRONOUS", sessions: mode !== "NEXUS", assembly: mode !== "SYNCHRONOUS" };
}
export function curriculumLessons(modules: unknown): CurriculumLesson[] {
  if (!Array.isArray(modules)) throw new Error("El temario no contiene módulos válidos.");
  return modules.flatMap((module, mi) => {
    if (!module || !Array.isArray(module.lessons)) throw new Error("El módulo no contiene lecciones válidas.");
    return module.lessons.map((lesson: { id?: string; title: string; objective_specific?: string }, li: number) => ({
      id: lesson.id || `lesson-${mi + 1}-${li + 1}`, title: lesson.title, module: module.title, objective: lesson.objective_specific || lesson.title,
    }));
  });
}
export function agendaIssues(agenda: AgendaSession[], lessons: CurriculumLesson[], count?: number | null, requireFullCoverage = true) {
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
  if (requireFullCoverage) for (const lesson of lessons) if (!covered.has(lesson.id)) issues.push(`Falta cobertura principal para ${lesson.title}.`);
  return issues;
}
export function planIssues(session: AgendaSession, plan: SessionPlan, config: DeliveryConfig) {
  const issues: string[] = [];
  const minutes = plan.blocks.reduce((sum, block) => sum + block.minutes, 0);
  if (minutes !== session.minutes) issues.push(`Los bloques suman ${minutes} minutos; deben distribuir exactamente ${session.minutes} minutos disponibles.`);
  if (new Set(plan.blocks.map(block => block.id)).size !== plan.blocks.length) issues.push("Los bloques repiten identificadores.");
  const covered = new Set(session.coverage.map(item => item.lessonId));
  if (config.mode === "SYNCHRONOUS" && plan.nexusLinks.some(link => !covered.has(link.lessonId))) issues.push("Las referencias de estudio deben pertenecer al recorrido de Academy.");
  // En híbridos, hybridPlanIssues comprueba pertenencia y orden del estudio relacionado.
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
  const documents = material.documents;
  if (documents) {
    const instrumentIds = documents.instruments.map(instrument => instrument.activityId);
    if (new Set(instrumentIds).size !== instrumentIds.length || ids.some(id => !instrumentIds.includes(id)) ||
      instrumentIds.some(id => !ids.includes(id))) issues.push("Cada actividad requiere un instrumento único de la misma sesión.");
    if (documents.instruments.some(instrument => instrument.sourceRefs.some(id => !knownSources.has(id)))) {
      issues.push("Los instrumentos citan fuentes no aprobadas o ajenas.");
    }
    if (documents.contingencies.some(item => !plan.blocks.some(block => block.id === item.blockId))) {
      issues.push("La contingencia debe referenciar un bloque de la sesión.");
    }
  }
  return issues;
}
export function sessionSources<Source extends { id: string; lessonId: string }>(session: AgendaSession, sources: Source[]) {
  return sources.filter(source => session.coverage.some(item => item.lessonId === source.lessonId));
}
/** Proyección explícita: nunca serializar el documento interno para un participante. */
export function participantMaterials(material: SessionMaterials) {
  return {
    ...(material.documents ? { documents: {
      instruments: material.documents.instruments.map(({ activityId, instructions, participantCriteria, sourceRefs }) => ({ activityId, instructions, participantCriteria, sourceRefs })),
      jobAid: material.documents.jobAid.applicable ? material.documents.jobAid.content : null,
      followUp: material.documents.followUp.applicable ? material.documents.followUp.content : null,
      absence: material.documents.absence.applicable ? material.documents.absence.content : null,
    } } : {}),
    concepts: material.concepts.map(({ title, explanation, example, sourceRefs }) => ({ title, explanation, example, sourceRefs })),
    activities: material.activities.map(({ id, title, instructions, template, sourceRefs }) => ({ id, title, instructions, template, sourceRefs })),
    slides: material.slides.map(({ title, points, sourceRefs }) => ({ title, points, sourceRefs })),
  };
}
export function completeSessionPlan(document: DeliveryDocument, lessons: CurriculumLesson[]) {
  return [...agendaIssues(document.agenda, lessons, document.config.sessionCount, document.config.mode !== "HYBRID"), ...routeIssues(document, lessons),
    ...document.agenda.flatMap(session => document.plans[session.id] ? [...planIssues(session, document.plans[session.id], document.config), ...hybridPlanIssues(document, session, document.plans[session.id])] : [`Falta el plan de ${session.title}.`])];
}
