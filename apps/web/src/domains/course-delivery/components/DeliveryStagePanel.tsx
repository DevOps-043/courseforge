"use client";

import { useState } from "react";
import type { CourseDeliveryController } from "../hooks/useCourseDelivery";
import { DeliveryAgendaEditor } from "./DeliveryAgendaEditor";
import { DeliveryContentEditor } from "./DeliveryContentEditor";
import type { DeliveryConfig } from "../types/delivery.schemas";
import { DeliveryConfigurationFields } from "./DeliveryConfigurationFields";
import { DeliveryLivePanel } from "./DeliveryLivePanel";
import styles from "./delivery-ui.module.css";
const RUN_LABELS: Record<string, string> = { QUEUED: "En cola", RUNNING: "Generando", PAUSED: "En pausa", FAILED: "Requiere atención", COMPLETED: "Completado", CANCELLED: "Cancelado", AGENDA: "Agenda", PLAN: "Plan", MATERIALS: "Materiales" };

function Configuration({ controller }: { controller: CourseDeliveryController }) {
  const [config, setConfig] = useState<DeliveryConfig>(controller.snapshot!.workspace.document.config);
  return <details className={styles.configurationSummary}>
    <summary>Modalidad actual: {config.mode === "NEXUS" ? "Asíncrono" : config.mode === "SYNCHRONOUS" ? "Síncrono" : "Híbrido"}<span>Editar ajustes</span></summary>
    <div><DeliveryConfigurationFields value={config} onChange={setConfig} disabled={controller.busy} sessionsEnabled={controller.snapshot!.enabled} />
      <button type="button" disabled={controller.busy} onClick={() => { void controller.command({ action: "SAVE", kind: "CONFIG", value: config.mode === "NEXUS" ? { mode: "NEXUS" } : config } as Parameters<typeof controller.command>[0]).catch(() => {}); }}>Guardar modalidad y preferencias</button>
    </div>
  </details>;
}
export function DeliveryStagePanel({ controller, stage }: { controller: CourseDeliveryController; stage: number }) {
  const snapshot = controller.snapshot;
  const [localError, setLocalError] = useState("");
  if (!snapshot) return stage === 1 ? <p role="status">{controller.error || "Cargando modalidad…"}</p> : null;
  const document = snapshot.workspace.document;
  if (stage !== 1 && document.config.mode === "NEXUS") return null;
  if (!snapshot.enabled) return <p role="status" className="rounded border p-4">La autoría sincrónica no está habilitada en este entorno. Los datos existentes se conservan.</p>;
  const operation = stage === 2 ? "AGENDA" : stage === 3 ? "PLAN" : "MATERIALS";
  const run = snapshot.run;
  const active = Boolean(run && ["QUEUED", "RUNNING", "PAUSED", "FAILED"].includes(run.status));
  const generate = async () => {
    setLocalError("");
    try {
      await controller.command({ action: "GENERATE", operation } as Parameters<typeof controller.command>[0]);
    } catch (failure) { setLocalError(failure instanceof Error ? failure.message : "No se pudo iniciar."); }
  };
  const exportUrl = (audience: string, download = false, draft = false) => `/api/artifacts/${controller.artifactId}/delivery/export?audience=${audience}${download ? "&download=1" : ""}${draft ? "&draft=1" : ""}`;
  return <section className={`${styles.panel} space-y-4`}>
    <header className={styles.panelHeader}><p className={styles.eyebrow}>Impartición · {document.config.mode === "HYBRID" ? "Curso híbrido" : document.config.mode === "NEXUS" ? "Modalidad del curso" : "Sesiones en vivo"}</p>
    <h2>{stage === 1 ? "Modalidad del curso" : stage === 2 ? "Agenda de sesiones" : stage === 3 ? "Plan de sesiones" : stage === 5 ? "Materiales para impartir" : stage === 6 ? "Presentación y documentos" : "Entrega del paquete sincrónico"}</h2></header>
    {controller.error && <p role="alert">{controller.error}</p>}{localError && <p role="alert">{localError}</p>}
    {stage === 1 ? <Configuration key={snapshot.workspace.revision} controller={controller} /> : <>
      {snapshot.settings.length > 0 && <p className="text-sm">Configuración para nuevas ejecuciones: {snapshot.settings.filter(setting => setting.operation === operation).map(setting => `${setting.model}${setting.inherited ? " (heredado)" : ""} · prompt ${setting.version}`).join("")}. Modificable en Configuración.</p>}
      {[2, 3, 5].includes(stage) && <>
        <button disabled={controller.busy || active || !snapshot.syllabusApproved || (stage === 3 && !document.agenda.length) || (stage === 5 && !snapshot.readiness.planReady)} onClick={generate} className={styles.primary}>{controller.busy ? "Procesando…" : stage === 2 ? "Proponer agenda" : stage === 3 ? "Generar plan completo" : "Generar materiales completos"}</button>
        {active && run && <div role="status" className="space-y-2">
          <p>{RUN_LABELS[run.operation]} · {RUN_LABELS[run.status]} · {run.units.filter((unit: { ready: boolean }) => unit.ready).length}/{run.units.length} unidades guardadas.</p>
          {run.last_error && <p>{run.last_error}</p>}
          {run.status !== "RUNNING" && <button disabled={controller.busy} className="mr-3 rounded border px-3 py-1" onClick={() => { void controller.command({ action: "RESUME", runId: run.id } as Parameters<typeof controller.command>[0]).catch(() => {}); }}>Reanudar pendientes</button>}
          <button disabled={controller.busy} className="rounded border px-3 py-1" onClick={() => { void controller.command({ action: "CANCEL", runId: run.id } as Parameters<typeof controller.command>[0]).catch(() => {}); }}>Cancelar ejecución</button>
        </div>}
      </>}
      {stage === 2 && <DeliveryAgendaEditor key={snapshot.workspace.revision} controller={controller} />}
      {(stage === 3 || stage === 5) && <><DeliveryContentEditor controller={controller} kind={stage === 3 ? "PLAN" : "MATERIALS"} />
        <p>La aprobación confirma todas las partes requeridas por la modalidad y sus versiones actuales.</p>
        {snapshot.canReview && <button disabled={controller.busy || active} className={styles.approve} onClick={() => { void controller.command({ action: "APPROVE", operation: stage === 3 ? "PLAN" : "MATERIALS" } as Parameters<typeof controller.command>[0]).catch(() => {}); }}>{stage === 3 ? "Aprobar plan completo" : "Aprobar materiales completos"}</button>}
        <p role="status">{(stage === 3 ? snapshot.readiness.planReady : snapshot.readiness.materialsReady) ? "Aprobado y vigente." : "Pendiente de revisión o reconciliación."}</p>
      </>}
      {(stage === 6 || stage === 8) && <><p>{stage === 6 ? "Revisa las salidas del contenido generado. Puedes volver a Materiales para corregirlo." : "Descarga el paquete aprobado. Abre la guía o el cuaderno y utiliza Imprimir para obtener una copia."}</p>
        {!snapshot.readiness.documentsReady && <p role="status">Genera y aprueba los materiales para completar los instrumentos, contingencias y documentos de la sesión.</p>}
        <div className={styles.exports}>{[["presentation", "Presentación web", "Láminas para revisar y presentar."], ["facilitator", "Guía del facilitador", "Preparación y respuestas reservadas."], ["participant", "Material del participante", "Consignas y material para el grupo."]].map(([audience, label, description]) => <div key={audience} className={styles.exportCard}>
          <a className={styles.exportLink} href={exportUrl(audience, false, stage === 6)} target="_blank" rel="noreferrer">{label}{stage === 6 ? " (borrador)" : ""}<span aria-hidden="true">↗</span></a>
          <p>{description}</p>
          {stage === 8 && snapshot.readiness.materialsReady && <a className={styles.exportDownload} aria-label={`Descargar HTML · ${label}`} href={exportUrl(audience, true)}>Descargar HTML</a>}
        </div>)}</div>
        {stage === 8 && !snapshot.readiness.materialsReady && <p role="status">La entrega se habilita cuando los materiales requeridos estén aprobados y vigentes.</p>}
        {stage === 8 && <DeliveryLivePanel controller={controller}/>}
      </>}
    </>}
  </section>;
}
