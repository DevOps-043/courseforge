import type { AgendaSession, DeliveryDocument, HybridRoute, SessionPlan } from "../types/delivery.schemas";
import type { CurriculumLesson } from "./delivery-policy";

export function hybridRouteIssues(route: HybridRoute, agenda: AgendaSession[], lessons: CurriculumLesson[]) {
  const issues: string[] = [];
  const known = new Set(lessons.map(lesson => lesson.id));
  const sessions = new Set(agenda.map(session => session.id));
  const seenSessions = new Set<string>(), asyncLessons = new Set<string>(), blockIds = new Set<string>();
  for (const item of route) {
    if (item.kind === "SYNCHRONOUS") {
      if (!sessions.has(item.sessionId)) issues.push("El recorrido referencia una sesión ajena.");
      if (seenSessions.has(item.sessionId)) issues.push("El recorrido repite una sesión síncrona.");
      seenSessions.add(item.sessionId);
    } else {
      if (blockIds.has(item.id)) issues.push("El recorrido repite un identificador de tramo.");
      blockIds.add(item.id);
      for (const id of item.lessonIds) {
        if (!known.has(id)) issues.push("El recorrido referencia una lección ajena.");
        if (asyncLessons.has(id)) issues.push("Una lección asíncrona está asignada a más de un tramo.");
        asyncLessons.add(id);
      }
    }
  }
  if (!asyncLessons.size) issues.push("Añade al menos un tramo asíncrono con lecciones.");
  if (!agenda.length || seenSessions.size !== sessions.size || agenda.some(session => !seenSessions.has(session.id))) issues.push("Incluye todas las sesiones en vivo una sola vez en el recorrido.");
  const liveLessons = new Set(agenda.flatMap(session => session.coverage.filter(item => !item.review).map(item => item.lessonId)));
  if (lessons.some(lesson => !asyncLessons.has(lesson.id) && !liveLessons.has(lesson.id))) issues.push("Distribuye todas las lecciones entre Academy y las sesiones de Hub.");
  return [...new Set(issues)];
}

export function routeTotals(route: HybridRoute, agenda: AgendaSession[]) {
  return route.reduce((total, item) => ({
    synchronous: total.synchronous + (item.kind === "SYNCHRONOUS" ? agenda.find(session => session.id === item.sessionId)?.minutes || 0 : 0),
    asynchronous: total.asynchronous + (item.kind === "ASYNCHRONOUS" ? item.minutes : 0),
  }), { synchronous: 0, asynchronous: 0 });
}

export function routeIssues(document: DeliveryDocument, lessons: CurriculumLesson[]) {
  return document.config.mode === "HYBRID" ? hybridRouteIssues(document.hybridRoute || [], document.agenda, lessons) : [];
}

export function hybridPlanIssues(document: DeliveryDocument, session: AgendaSession, plan: SessionPlan) {
  if (document.config.mode !== "HYBRID" || !document.hybridRoute) return [];
  const route = document.hybridRoute;
  const position = route.findIndex(item => item.kind === "SYNCHRONOUS" && item.sessionId === session.id);
  const issues: string[] = [];
  for (const link of plan.nexusLinks) {
    const study = route.findIndex(item => item.kind === "ASYNCHRONOUS" && item.lessonIds.includes(link.lessonId));
    if (study < 0 || position < 0 || (link.timing === "BEFORE" ? study >= position : study <= position)) issues.push("Los vínculos de estudio antes/después deben coincidir con el orden del recorrido híbrido.");
  }
  for (const coverage of session.coverage) {
    if (route.some(item => item.kind === "ASYNCHRONOUS" && item.lessonIds.includes(coverage.lessonId)) && !plan.nexusLinks.some(link => link.lessonId === coverage.lessonId)) issues.push("Relaciona con el estudio asíncrono los temas compartidos por ambas modalidades.");
  }
  return [...new Set(issues)];
}
