"use client";

import { EngineSelect } from "@/components/ui/EngineSelect";
import { useState } from "react";
import type { CourseDeliveryController } from "../hooks/useCourseDelivery";
import styles from "./delivery-ui.module.css";

const LABELS: Record<string, string> = {
  blocks: "Bloques", purpose: "Propósito", minutes: "Minutos", explanation: "Explicación",
  activity: "Actividad o consigna de conducción", criteria: "Criterios", resources: "Recursos",
  nexusLinks: "Conexión con Nexus", timing: "Momento de uso",
  concepts: "Conceptos", title: "Título", example: "Ejemplo desarrollado", misconceptions: "Confusiones frecuentes",
  activities: "Actividades", instructions: "Consigna", template: "Plantilla", answer: "Respuesta razonada",
  preparation: "Preparación del facilitador", understand: "Qué comprender", explain: "Qué explicar",
  conduct: "Qué conducir", deepen: "Dónde profundizar", expand: "Cómo ampliar",
  slides: "Presentación", points: "Ideas visibles", notes: "Notas del facilitador",
  documents: "Documentos de la sesión", instruments: "Instrumentos de evaluación",
  participantCriteria: "Criterios para el participante", expectedAnswer: "Respuesta esperada reservada",
  feedback: "Retroalimentación", criticalErrors: "Errores críticos", retry: "Reglas de reintento",
  contingencies: "Contingencias", situation: "Situación", trigger: "Cuándo activar",
  action: "Acción", timeImpact: "Impacto en tiempos", evidenceImpact: "Impacto en evidencias",
  objectiveLimit: "Cuándo se pierde el objetivo", recordTemplate: "Formato de registro",
  sessionFields: "Campos de sesión", participantFields: "Campos por participante",
  jobAid: "Ayuda de trabajo", followUp: "Refuerzo posterior", absence: "Alternativa por ausencia",
  applicable: "Aplica", reason: "Justificación", content: "Contenido",
};
type EditableValue = string | number | boolean | null | EditableValue[] | { [key: string]: EditableValue };
function ContentFields({ value, onChange, label }: { value: EditableValue; onChange: (next: EditableValue) => void; label: string }) {
  if (Array.isArray(value)) return <details className={styles.fieldGroup}><summary>{label} <span>{value.length} {value.length === 1 ? "elemento" : "elementos"}</span></summary><div className={styles.fieldGrid}>{value.length ? value.map((entry, index) => <ContentFields key={index} label={`${label} ${index + 1}`} value={entry} onChange={next => onChange(value.map((item, position) => position === index ? next : item))} />) : <p>Sin elementos en esta sección.</p>}</div></details>;
  if (value !== null && typeof value === "object") return <fieldset className={styles.fieldGroup}><legend>{label}</legend><div className={styles.fieldGrid}>{Object.entries(value).filter(([key]) => !["id", "sourceRefs", "lessonId", "activityId", "blockId"].includes(key)).map(([key, entry]) => <ContentFields key={key} label={LABELS[key] || key} value={entry} onChange={next => onChange({ ...value, [key]: next })} />)}</div></fieldset>;
  if (typeof value === "number") return <label className={styles.field}>{label}<input type="number" min="1" value={value} onChange={event => onChange(Number(event.target.value))} /></label>;
  if (typeof value === "boolean") return <label className={styles.field}><input type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} /> {label}</label>;
  if (typeof value !== "string") return null;
  if (label === "Momento de uso") return <label className={styles.field}>{label}
    <EngineSelect
      aria-label={label}
      className={styles.selectField}
      value={value}
      onValueChange={onChange}
      options={[
        { value: "BEFORE", label: "Antes de la clase" },
        { value: "AFTER", label: "Después de la clase" },
      ]}
    />
  </label>;
  return <label className={styles.field}>{label}<textarea rows={value.length > 180 ? 5 : 2} value={value} onChange={event => onChange(event.target.value)} /></label>;
}
function SessionEditor({ controller, kind, sessionId, initial }: { controller: CourseDeliveryController; kind: "PLAN" | "MATERIALS"; sessionId: string; initial: EditableValue }) {
  const [value, setValue] = useState(initial);
  return <div className={styles.sessionBody}><ContentFields value={value} onChange={setValue} label={kind === "PLAN" ? "Conducción de la sesión" : "Contenido y preparación"} />
    <div className={styles.actions}><button type="button" disabled={controller.busy} onClick={() => { void controller.command({ action: "SAVE", kind, sessionId, value } as Parameters<typeof controller.command>[0]).catch(() => {}); }}>Guardar cambios de sesión</button>
    <button type="button" disabled={controller.busy} onClick={() => { void controller.command({ action: "REGENERATE", operation: kind, sessionId } as Parameters<typeof controller.command>[0]).catch(() => {}); }}>Marcar para regenerar conservando esta versión</button></div></div>;
}
export function DeliveryContentEditor({ controller, kind }: { controller: CourseDeliveryController; kind: "PLAN" | "MATERIALS" }) {
  const document = controller.snapshot!.workspace.document;
  return <div className={styles.editor}>{!document.agenda.length && <p>La edición estará disponible cuando generes la agenda de sesiones.</p>}{document.agenda.map(session => {
    const content = kind === "PLAN" ? document.plans[session.id] : document.materials[session.id];
    const stale = (kind === "PLAN" ? document.stalePlans : document.staleMaterials).includes(session.id);
    return <details key={session.id} className={styles.session}><summary><span className={styles.sessionTitle}>{session.title}<small>{session.minutes} min</small></span><span className={styles.status}>{stale ? "Pendiente de actualizar; versión anterior conservada" : content ? "Generado" : "Pendiente"}</span></summary>
      {content && <SessionEditor key={controller.snapshot!.workspace.revision} controller={controller} kind={kind} sessionId={session.id} initial={content as unknown as EditableValue} />}
    </details>;
  })}</div>;
}
