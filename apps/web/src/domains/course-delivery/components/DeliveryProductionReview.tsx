"use client";

import { useId, useState } from "react";
import type { CourseDeliveryController } from "../hooks/useCourseDelivery";
import type { DeliveryAudience } from "../services/delivery-export";
import { deliverySessionPreview } from "../lib/delivery-session-preview";
import { DeliverySessionDeck } from "./DeliverySessionDeck";
import styles from "./delivery-ui.module.css";

const AUDIENCES: Array<{ id: DeliveryAudience; label: string }> = [
  { id: "presentation", label: "Presentación" },
  { id: "facilitator", label: "Guía del facilitador" },
  { id: "participant", label: "Material del participante" },
];

function SessionPreview({ controller, sessionId, expanded }: { controller: CourseDeliveryController; sessionId: string; expanded: boolean }) {
  const [audience, setAudience] = useState<DeliveryAudience>("presentation");
  const panelId = useId();
  const workspace = controller.snapshot!.workspace;
  const sections = deliverySessionPreview(workspace, sessionId, audience);
  const label = AUDIENCES.find(item => item.id === audience)!.label;
  const content = sections.map((item, index) => <article key={`${audience}-${index}`} className={styles.previewSection}>
    <h4>{item.title}</h4>
    {item.reserved && <span className={styles.status}>Reservado para el facilitador</span>}
    {item.body && <p>{item.body}</p>}
    {item.points && <ul>{item.points.map((point, position) => <li key={position}>{point}</li>)}</ul>}
  </article>);
  return <div className={styles.sessionBody}>
    <div className={styles.previewAudiences} role="group" aria-label="Vista del material">
      {AUDIENCES.map(item => <button key={item.id} type="button" aria-pressed={audience === item.id} aria-controls={panelId} onClick={() => setAudience(item.id)}>{item.label}</button>)}
    </div>
    <section id={panelId} aria-label={label} className={styles.previewContent}>
      <h3>{label}</h3>
      {expanded && audience === "presentation" && <DeliverySessionDeck key={workspace.revision} artifactId={controller.artifactId} sessionId={sessionId}
        revision={workspace.revision} approved={controller.snapshot!.readiness.materialsReady} />}
      {!sections.length && <p role="status">Falta generar el plan o los materiales de esta sesión. Vuelve a Materiales para revisar el diagnóstico.</p>}
      {audience === "presentation" && sections.length > 0
        ? <details><summary>Ver contenido base de las diapositivas</summary>{content}</details> : content}
    </section>
  </div>;
}

export function DeliveryProductionReview({ controller }: { controller: CourseDeliveryController }) {
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  const snapshot = controller.snapshot!;
  const document = snapshot.workspace.document;
  const readyCount = document.agenda.filter(session => document.materials[session.id] && document.plans[session.id] && !document.staleMaterials.includes(session.id) && !document.stalePlans.includes(session.id)).length;
  return <div aria-label="Revisión de materiales síncronos" className={styles.editor}>
    <p role="status">{readyCount}/{document.agenda.length} sesiones con materiales vigentes · Revisión {snapshot.workspace.revision} · {snapshot.readiness.materialsReady ? "Aprobado y vigente" : "Pendiente de QA o actualización"}</p>
    {!document.agenda.length && <p>No hay sesiones disponibles. Completa la agenda y los materiales.</p>}
    {document.agenda.map(session => {
      const stale = document.staleMaterials.includes(session.id) || document.stalePlans.includes(session.id);
      const status = stale ? "Requiere actualización" : document.materials[session.id] && document.plans[session.id] ? "Disponible para revisión" : "Pendiente";
      return <details key={session.id} className={styles.session} onToggle={event => {
        const expanded = event.currentTarget.open;
        setExpandedSessions(previous => previous[session.id] === expanded ? previous : { ...previous, [session.id]: expanded });
      }}>
        <summary><span className={styles.sessionTitle}>{session.title}<small>{session.minutes} min</small></span><span className={styles.status}>{status}</span></summary>
        <SessionPreview controller={controller} sessionId={session.id} expanded={Boolean(expandedSessions[session.id])} />
      </details>;
    })}
    <p>La revisión se realiza aquí. Para corregir contenido o aprobarlo, vuelve al paso Materiales. La bibliografía está en Fuentes y en las exportaciones del curso completo.</p>
    <details className={styles.fieldGroup}><summary>Exportar documentos del curso</summary>
      <div className={styles.exports}>{AUDIENCES.map(item => <a key={item.id} className={styles.exportDownload} href={`/api/artifacts/${controller.artifactId}/delivery/export?audience=${item.id}${snapshot.readiness.materialsReady ? "" : "&draft=1"}&download=1`}>Descargar HTML · {item.label}{snapshot.readiness.materialsReady ? "" : " (borrador)"}</a>)}</div>
    </details>
  </div>;
}
