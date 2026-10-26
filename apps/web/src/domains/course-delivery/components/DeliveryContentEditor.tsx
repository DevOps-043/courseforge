"use client";

import { useState } from "react";
import type { CourseDeliveryController } from "../hooks/useCourseDelivery";

const LABELS: Record<string, string> = {
  blocks: "Bloques", purpose: "Propósito", minutes: "Minutos", explanation: "Explicación",
  activity: "Actividad o consigna de conducción", criteria: "Criterios", resources: "Recursos",
  nexusLinks: "Conexión con Nexus", timing: "Momento de uso",
  concepts: "Conceptos", title: "Título", example: "Ejemplo desarrollado", misconceptions: "Confusiones frecuentes",
  activities: "Actividades", instructions: "Consigna", template: "Plantilla", answer: "Respuesta razonada",
  preparation: "Preparación del facilitador", understand: "Qué comprender", explain: "Qué explicar",
  conduct: "Qué conducir", deepen: "Dónde profundizar", expand: "Cómo ampliar",
  slides: "Presentación", points: "Ideas visibles", notes: "Notas del facilitador",
};
type EditableValue = string | number | boolean | null | EditableValue[] | { [key: string]: EditableValue };
function ContentFields({ value, onChange, label }: { value: EditableValue; onChange: (next: EditableValue) => void; label: string }) {
  if (Array.isArray(value)) return <fieldset className="my-3 space-y-2 rounded border p-3"><legend>{label}</legend>{value.map((entry, index) => <ContentFields key={index} label={`${label} ${index + 1}`} value={entry} onChange={next => onChange(value.map((item, position) => position === index ? next : item))} />)}</fieldset>;
  if (value !== null && typeof value === "object") return <fieldset className="my-2 space-y-2 rounded border p-3"><legend>{label}</legend>{Object.entries(value).filter(([key]) => !["id", "sourceRefs", "lessonId"].includes(key)).map(([key, entry]) => <ContentFields key={key} label={LABELS[key] || key} value={entry} onChange={next => onChange({ ...value, [key]: next })} />)}</fieldset>;
  if (typeof value === "number") return <label className="block">{label}<input type="number" min="1" className="block rounded border bg-transparent p-2" value={value} onChange={event => onChange(Number(event.target.value))} /></label>;
  if (typeof value !== "string") return null;
  if (label === "Momento de uso") return <label className="block">{label}<select className="block rounded border bg-transparent p-2" value={value} onChange={event => onChange(event.target.value)}><option value="BEFORE">Antes de la clase</option><option value="AFTER">Después de la clase</option></select></label>;
  return <label className="block">{label}<textarea rows={value.length > 180 ? 5 : 2} className="block w-full rounded border bg-transparent p-2" value={value} onChange={event => onChange(event.target.value)} /></label>;
}
function SessionEditor({ controller, kind, sessionId, initial }: { controller: CourseDeliveryController; kind: "PLAN" | "MATERIALS"; sessionId: string; initial: EditableValue }) {
  const [value, setValue] = useState(initial);
  return <><ContentFields value={value} onChange={setValue} label={kind === "PLAN" ? "Conducción de la sesión" : "Contenido y preparación"} />
    <button disabled={controller.busy} className="rounded border px-4 py-2" onClick={() => { void controller.command({ action: "SAVE", kind, sessionId, value } as Parameters<typeof controller.command>[0]).catch(() => {}); }}>Guardar cambios de sesión</button>
    <button disabled={controller.busy} className="ml-3 rounded border px-4 py-2" onClick={() => { void controller.command({ action: "REGENERATE", operation: kind, sessionId } as Parameters<typeof controller.command>[0]).catch(() => {}); }}>Marcar para regenerar conservando esta versión</button></>;
}
export function DeliveryContentEditor({ controller, kind }: { controller: CourseDeliveryController; kind: "PLAN" | "MATERIALS" }) {
  const document = controller.snapshot!.workspace.document;
  return <div className="space-y-3">{document.agenda.map(session => {
    const content = kind === "PLAN" ? document.plans[session.id] : document.materials[session.id];
    const stale = (kind === "PLAN" ? document.stalePlans : document.staleMaterials).includes(session.id);
    return <details key={session.id} className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">{session.title} · {session.minutes} min · {stale ? "Pendiente de actualizar; versión anterior conservada" : content ? "Generado" : "Pendiente"}</summary>
      {content && <SessionEditor key={controller.snapshot!.workspace.revision} controller={controller} kind={kind} sessionId={session.id} initial={content as unknown as EditableValue} />}
    </details>;
  })}</div>;
}
