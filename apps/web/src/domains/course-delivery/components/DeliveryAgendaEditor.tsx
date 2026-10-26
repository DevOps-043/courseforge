"use client";

import { useState } from "react";
import type { CourseDeliveryController } from "../hooks/useCourseDelivery";
import type { AgendaSession } from "../types/delivery.schemas";

export function DeliveryAgendaEditor({ controller }: { controller: CourseDeliveryController }) {
  const snapshot = controller.snapshot!;
  const [agenda, setAgenda] = useState(snapshot.workspace.document.agenda);
  const update = (id: string, patch: Partial<AgendaSession>) => setAgenda(current => current.map(session => session.id === id ? { ...session, ...patch } : session));
  if (!agenda.length) return <p>Genera la propuesta inicial para distribuir el temario.</p>;
  return <div className="space-y-3">
    {agenda.map((session, index) => <details key={session.id} className="rounded-lg border p-3">
      <summary className="cursor-pointer font-semibold">{index + 1}. {session.title} · {session.minutes} min</summary>
      <label className="mt-3 block">Título<input className="block w-full rounded border bg-transparent p-2" value={session.title} onChange={event => update(session.id, { title: event.target.value })} /></label>
      <label className="block">Duración en minutos<input type="number" min="15" max="480" className="block rounded border bg-transparent p-2" value={session.minutes} onChange={event => update(session.id, { minutes: Number(event.target.value) })} /></label>
      <label className="block">Objetivos, uno por línea<textarea className="block w-full rounded border bg-transparent p-2" value={session.objectives.join("\n")} onChange={event => update(session.id, { objectives: event.target.value.split("\n") })} /></label>
      <label className="block">Evidencia principal<textarea className="block w-full rounded border bg-transparent p-2" value={session.evidence} onChange={event => update(session.id, { evidence: event.target.value })} /></label>
      <fieldset className="my-3 space-y-2"><legend className="font-medium">Cobertura del temario</legend>
        {snapshot.lessons.map(lesson => {
          const coverage = session.coverage.find(item => item.lessonId === lesson.id);
          return <div key={lesson.id} className="rounded border p-2">
            <label><input type="checkbox" checked={Boolean(coverage)} onChange={event => update(session.id, { coverage: event.target.checked ? [...session.coverage, { lessonId: lesson.id, scope: lesson.objective, review: false }] : session.coverage.filter(item => item.lessonId !== lesson.id) })} /> {lesson.module} · {lesson.title}</label>
            {coverage && <><label className="block text-sm">Alcance<textarea className="block w-full rounded border bg-transparent p-2" value={coverage.scope} onChange={event => update(session.id, { coverage: session.coverage.map(item => item.lessonId === lesson.id ? { ...item, scope: event.target.value } : item) })} /></label>
              <label><input type="checkbox" checked={coverage.review} onChange={event => update(session.id, { coverage: session.coverage.map(item => item.lessonId === lesson.id ? { ...item, review: event.target.checked } : item) })} /> Repaso de contenido cubierto en otra sesión</label></>}
          </div>;
        })}
      </fieldset>
      <button disabled={index === 0} className="rounded border px-3 py-1" onClick={() => setAgenda(current => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>Subir sesión</button>
    </details>)}
    <button disabled={controller.busy} className="rounded border px-4 py-2" onClick={() => { void controller.command({ action: "SAVE", kind: "AGENDA", value: agenda } as Parameters<typeof controller.command>[0]).catch(() => {}); }}>Guardar distribución</button>
  </div>;
}
