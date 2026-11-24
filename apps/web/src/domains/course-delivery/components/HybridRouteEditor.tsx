"use client";

import { useState } from "react";
import type { CourseDeliveryController } from "../hooks/useCourseDelivery";
import type { AgendaSession, HybridRoute } from "../types/delivery.schemas";
import { agendaSchema, hybridRouteSchema } from "../types/delivery.schemas";
import { agendaIssues } from "../lib/delivery-policy";
import { hybridRouteIssues, routeTotals } from "../lib/hybrid-route";
import styles from "./delivery-ui.module.css";
import { HybridLessonAssignments } from "./HybridLessonAssignments";

export function HybridRouteEditor({ controller }: { controller: CourseDeliveryController }) {
  const snapshot = controller.snapshot!;
  const document = snapshot.workspace.document;
  const [agenda, setAgenda] = useState<AgendaSession[]>(document.agenda);
  const [route, setRoute] = useState<HybridRoute>(document.hybridRoute || document.agenda.map(session => ({ kind: "SYNCHRONOUS" as const, sessionId: session.id })));
  const [error, setError] = useState("");
  const totals = routeTotals(route, agenda);
  const issues = [...agendaIssues(agenda, snapshot.lessons, document.config.sessionCount, false), ...hybridRouteIssues(route, agenda, snapshot.lessons)];
  if (!agendaSchema.safeParse(agenda).success || !hybridRouteSchema.safeParse(route).success) issues.push("Completa títulos, objetivos, evidencias, selección de lecciones y duraciones válidas de cada tramo.");
  const updateSession = (id: string, value: Partial<AgendaSession>) => setAgenda(current => current.map(session => session.id === id ? { ...session, ...value } : session));
  const move = (index: number, offset: number) => setRoute(current => { const next = [...current]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
  const setAsync = (index: number, patch: Partial<Extract<HybridRoute[number], { kind: "ASYNCHRONOUS" }>>) => setRoute(current => current.map((item, position) => position === index && item.kind === "ASYNCHRONOUS" ? { ...item, ...patch } : item));
  async function save() {
    setError("");
    try { await controller.command({ action: "SAVE", kind: "HYBRID_ROUTE", value: { agenda, route } }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo guardar el recorrido."); }
  }
  return <section aria-label="Recorrido del curso híbrido" className={styles.editor}>
    <h3>Recorrido del curso híbrido</h3>
    <p>Ordena los encuentros en Hub y los tramos de estudio en Academy. La cobertura de una sesión indica sus temas; no obliga a repetirlos en el estudio asíncrono.</p>
    <p role="status">Hub: {totals.synchronous} min · Academy: {totals.asynchronous} min · Total: {totals.synchronous + totals.asynchronous} min</p>
    <div className={styles.actions}>
      <button type="button" disabled={controller.busy || !snapshot.syllabusApproved || agenda.length >= 24} onClick={() => {
        const id = crypto.randomUUID();
        setAgenda(current => [...current, { id, title: "Sesión en vivo", minutes: document.config.sessionMinutes, objectives: [""], evidence: "", coverage: [] }]);
        setRoute(current => [...current, { kind: "SYNCHRONOUS", sessionId: id }]);
      }}>Añadir sesión en Hub</button>
      <button type="button" disabled={controller.busy || !snapshot.syllabusApproved || route.length >= 324} onClick={() => setRoute(current => [...current, { kind: "ASYNCHRONOUS", id: crypto.randomUUID(), title: "Estudio en Academy", minutes: 60, lessonIds: [] }])}>Añadir tramo en Academy</button>
    </div>
    <HybridLessonAssignments agenda={agenda} route={route} lessons={snapshot.lessons} disabled={controller.busy || !snapshot.syllabusApproved}
      onChange={value => { setAgenda(value.agenda); setRoute(value.route); }} onError={setError} />
    <fieldset className={styles.routeList} disabled={controller.busy || !snapshot.syllabusApproved}>
      {route.map((item, index) => {
        const session = item.kind === "SYNCHRONOUS" ? agenda.find(value => value.id === item.sessionId) : undefined;
        const id = item.kind === "SYNCHRONOUS" ? item.sessionId : item.id;
        const selected = session ? session.coverage.map(coverage => coverage.lessonId) : item.kind === "ASYNCHRONOUS" ? item.lessonIds : [];
        return <details key={`${item.kind}-${id}`} className={styles.session} open={!document.hybridRoute}>
          <summary><span className={styles.sessionTitle}>{index + 1}. {item.kind === "SYNCHRONOUS" ? "Síncrono · Hub" : "Asíncrono · Academy"} · {session?.title || (item.kind === "ASYNCHRONOUS" ? item.title : "Sesión no encontrada")}</span></summary>
          <div className={styles.sessionBody}>
            <label className={styles.field}>Título del tramo {index + 1}<input value={session?.title || (item.kind === "ASYNCHRONOUS" ? item.title : "")} maxLength={8000} onChange={event => session ? updateSession(id, { title: event.target.value }) : setAsync(index, { title: event.target.value })} /></label>
            <label className={styles.field}>Minutos del tramo {index + 1}<input type="number" min={session ? 15 : 1} max={session ? 480 : 4800} value={session?.minutes ?? (item.kind === "ASYNCHRONOUS" ? item.minutes : 0)} onChange={event => session ? updateSession(id, { minutes: Number(event.target.value) }) : setAsync(index, { minutes: Number(event.target.value) })} /></label>
            {session && <>
              <label className={styles.field}>Objetivos de la sesión {index + 1}, uno por línea<textarea value={session.objectives.join("\n")} onChange={event => updateSession(id, { objectives: event.target.value.split("\n") })} /></label>
              <label className={styles.field}>Evidencia de la sesión {index + 1}<textarea value={session.evidence} onChange={event => updateSession(id, { evidence: event.target.value })} /></label>
            </>}
            <div><p>{session ? "Temas que se trabajarán en vivo" : "Lecciones que se estudiarán en Academy"}: {selected.length}</p>
              <ul>{snapshot.lessons.filter(lesson => selected.includes(lesson.id)).map(lesson => <li key={lesson.id}>{lesson.module} · {lesson.title}</li>)}</ul>
              <p>Modifica la selección en «Destino de cada lección», arriba.</p>
            </div>
            <div className={styles.actions}>
              <button type="button" aria-label={`Subir tramo ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}>Subir</button>
              <button type="button" aria-label={`Bajar tramo ${index + 1}`} disabled={index === route.length - 1} onClick={() => move(index, 1)}>Bajar</button>
              <button type="button" aria-label={`Quitar tramo ${index + 1}`} onClick={() => { setRoute(current => current.filter((_, position) => position !== index)); if (session) setAgenda(current => current.filter(value => value.id !== id)); }}>Quitar del borrador</button>
            </div>
          </div>
        </details>;
      })}
      <div className={styles.actions}>
        <button type="button" disabled={Boolean(issues.length)} onClick={() => void save()}>Guardar recorrido híbrido</button>
      </div>
    </fieldset>
    {issues.length > 0 && <ul aria-label="Pendientes del recorrido">{[...new Set(issues)].map(issue => <li key={issue}>{issue}</li>)}</ul>}
    {error && <p role="alert">{error}</p>}
    <p>Guardar actualiza la agenda y deja los planes y materiales pendientes de revisión. Este recorrido se conserva en Architect; su navegación automática en Academy requiere la siguiente ampliación de publicación.</p>
  </section>;
}
