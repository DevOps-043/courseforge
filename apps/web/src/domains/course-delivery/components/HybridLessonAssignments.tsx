"use client";

import { useState } from "react";
import type { AgendaSession, CurriculumLesson, HybridRoute } from "../types/delivery.schemas";
import { assignLessonDestination, lessonAssignment, type LessonDestination } from "../lib/hybrid-lesson-assignment";
import styles from "./delivery-ui.module.css";

export function HybridLessonAssignments({ agenda, route, lessons, disabled, onChange, onError }: {
  agenda: AgendaSession[]; route: HybridRoute; lessons: CurriculumLesson[]; disabled: boolean;
  onChange: (value: { agenda: AgendaSession[]; route: HybridRoute }) => void; onError: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LessonDestination | "ALL">("ALL");
  const counts = lessons.map(lesson => lessonAssignment(agenda, route, lesson.id).destination);
  const visible = lessons.filter(lesson => `${lesson.module} ${lesson.title}`.toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es"))
    && (filter === "ALL" || lessonAssignment(agenda, route, lesson.id).destination === filter));
  function assign(lesson: CurriculumLesson, destination: Exclude<LessonDestination, "PENDING">, targets?: { sessionIds?: string[]; blockId?: string }) {
    try { onChange(assignLessonDestination(agenda, route, lesson, destination, targets)); onError(""); }
    catch (error) { onError(error instanceof Error ? error.message : "No se pudo cambiar la asignación."); }
  }
  return <fieldset disabled={disabled} className={styles.assignmentList}>
    <legend>Destino de cada lección</legend>
    <p>Elige dónde se estudia cada tema. Solo Hub prepara materiales de la sesión y no exige video final. Academy prepara estudio con video. Compartida habilita ambos destinos de forma explícita.</p>
    <p role="status">Solo Hub: {counts.filter(item => item === "SYNCHRONOUS").length} · Solo Academy: {counts.filter(item => item === "ASYNCHRONOUS").length} · Compartidas: {counts.filter(item => item === "SHARED").length} · Sin asignar: {counts.filter(item => item === "PENDING").length}</p>
    <label className={styles.field}>Buscar lección<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
    <label className={styles.field}>Filtrar por destino<select value={filter} onChange={event => setFilter(event.target.value as LessonDestination | "ALL")}>
      <option value="ALL">Todos los destinos</option><option value="SYNCHRONOUS">Solo síncronas</option><option value="ASYNCHRONOUS">Solo asíncronas</option><option value="SHARED">Compartidas</option><option value="PENDING">Sin asignar</option>
    </select></label>
    {!visible.length && <p role="status">No hay lecciones que coincidan con estos filtros.</p>}
    {visible.map(lesson => {
      const assignment = lessonAssignment(agenda, route, lesson.id);
      return <div key={lesson.id} className={styles.assignmentRow}>
        <strong>{lesson.module} · {lesson.title}</strong>
        <label className={styles.field}>Destino de {lesson.title}
          <select value={assignment.destination} onChange={event => assign(lesson, event.target.value as Exclude<LessonDestination, "PENDING">)}>
            <option value="PENDING" disabled>Sin asignar</option>
            <option value="SYNCHRONOUS">Solo síncrona · Hub · sin video final</option>
            <option value="ASYNCHRONOUS">Solo asíncrona · Academy</option>
            <option value="SHARED">Compartida · Hub y Academy</option>
          </select>
        </label>
        {assignment.sessionIds.length > 0 && <fieldset><legend>Sesiones de Hub · {lesson.title}</legend>
          {agenda.map(session => <label key={session.id} className={styles.field}><span><input type="checkbox"
            checked={assignment.sessionIds.includes(session.id)} onChange={event => assign(lesson, assignment.destination as "SYNCHRONOUS" | "SHARED", {
              sessionIds: event.target.checked ? [...assignment.sessionIds, session.id] : assignment.sessionIds.filter(id => id !== session.id),
            })} /> {session.title}</span></label>)}
        </fieldset>}
        {assignment.blockIds.length > 0 && <label className={styles.field}>Tramo de Academy · {lesson.title}
          <select value={assignment.blockIds[0]} onChange={event => assign(lesson, assignment.destination as "ASYNCHRONOUS" | "SHARED", { blockId: event.target.value })}>
            {route.flatMap(item => item.kind === "ASYNCHRONOUS" ? [<option key={item.id} value={item.id}>{item.title}</option>] : [])}
          </select>
        </label>}
      </div>;
    })}
    <p>Los cambios son un borrador hasta pulsar Guardar recorrido híbrido. Guardar invalida planes y materiales dependientes para volver a revisarlos; conserva el contenido anterior.</p>
  </fieldset>;
}
