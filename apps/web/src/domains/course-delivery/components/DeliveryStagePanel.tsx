"use client";

import { useState } from "react";
import type { CourseDeliveryController } from "../hooks/useCourseDelivery";
import { DeliveryAgendaEditor } from "./DeliveryAgendaEditor";
import { DeliveryContentEditor } from "./DeliveryContentEditor";
import type { DeliveryConfig } from "../types/delivery.schemas";
import { DeliveryConfigurationFields } from "./DeliveryConfigurationFields";
import { DeliveryLivePanel } from "./DeliveryLivePanel";
import styles from "./delivery-ui.module.css";
import { HybridRouteEditor } from "./HybridRouteEditor";
import { routeIssues } from "../lib/hybrid-route";
import type { DeliveryRunUnit } from "../services/delivery-commands";
import { DELIVERY_LIMITS } from "../config/delivery.config";
import { DeliveryMaterialRunStatus } from "./DeliveryMaterialRunStatus";
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
  const materialRun = stage === 5 && run?.operation === "MATERIALS";
  const canResume = !materialRun || (run!.units as DeliveryRunUnit[]).some(unit=>!unit.ready && unit.retryable !== false && (unit.attempts || 0) < DELIVERY_LIMITS.unitAttempts);
  const setting = snapshot.settings.find(item => item.operation === operation);
  const settingError = setting && "configurationError" in setting ? setting.configurationError : "";
  const blockers = [
    controller.busy ? "Hay una operación en curso." : "",
    active ? run?.status === "FAILED" ? "La ejecución terminó con errores. Revisa el diagnóstico; cancela esta ejecución si necesitas iniciar una nueva con entradas corregidas." : "Reanuda o cancela la ejecución pendiente antes de iniciar otra." : "",
    !snapshot.syllabusApproved ? "Aprueba el temario y actualiza el estado antes de generar la agenda." : "",
    settingError || "",
    stage === 3 && !document.agenda.length ? "Guarda primero la agenda de sesiones." : "",
    stage === 3 && routeIssues(document, snapshot.lessons).length ? "Completa y guarda el recorrido híbrido en Temario." : "",
    stage === 5 && !snapshot.readiness.planReady ? "Aprueba el plan completo y vigente antes de generar materiales." : "",
  ].filter(Boolean);
  const generate = async () => {
    setLocalError("");
    try {
      await controller.command({ action: "GENERATE", operation } as Parameters<typeof controller.command>[0]);
    } catch (failure) { setLocalError(failure instanceof Error ? failure.message : "No se pudo iniciar."); }
  };
  const exportUrl = (audience: string, download = false, draft = false) => `/api/artifacts/${controller.artifactId}/delivery/export?audience=${audience}${download ? "&download=1" : ""}${draft ? "&draft=1" : ""}`;
  return <section className={`${styles.panel} space-y-4`}>
    <header className={styles.panelHeader}><p className={styles.eyebrow}>Impartición · {document.config.mode === "HYBRID" ? "Curso híbrido" : document.config.mode === "NEXUS" ? "Modalidad del curso" : "Sesiones en vivo"}</p>
    <h2>{stage === 1 ? "Modalidad del curso" : stage === 2 ? "Agenda de sesiones" : stage === 3 ? "Planes de sesiones en vivo · Hub" : stage === 5 ? "Materiales para impartir · Hub" : stage === 6 ? "Presentación y documentos · Hub" : "Entrega del paquete sincrónico · Hub"}</h2></header>
    {document.config.mode === "HYBRID" && [3, 5].includes(stage) && <p>Este apartado genera únicamente la preparación de las sesiones en vivo. El estudio asíncrono se prepara en el apartado de Academy. La aprobación conjunta verifica ambas partes.</p>}
    {document.config.mode === "HYBRID" && stage === 8 && <p role="status">La publicación del recorrido en Academy requiere ampliar su contrato receptor. La entrega de preparación a sesiones programadas de Hub utiliza el flujo independiente de abajo.</p>}
    {controller.error && <p role="alert">{controller.error}</p>}{localError && <p role="alert">{localError}</p>}
    {materialRun && <DeliveryMaterialRunStatus status={run!.status} units={run!.units as DeliveryRunUnit[]} />}
    <button type="button" className="block" disabled={controller.busy} onClick={() => void controller.refresh()}>Actualizar estado</button>
    {stage === 1 ? <Configuration key={snapshot.workspace.revision} controller={controller} /> : <>
      {snapshot.settings.length > 0 && <p className="text-sm">Configuración para nuevas ejecuciones: {snapshot.settings.filter(setting => setting.operation === operation).map(setting => `${setting.model}${setting.inherited ? " (heredado)" : ""} · prompt ${setting.version}`).join("")}. Modificable en Configuración.</p>}
      {[2, 3, 5].includes(stage) && <>
        {blockers.length > 0 && <ul aria-label="Requisitos pendientes">{blockers.map(message => <li key={message}>{message}</li>)}</ul>}
        {stage === 2 && document.config.mode === "HYBRID" && document.hybridRoute
          ? <p role="status">Agenda definida por el recorrido guardado. Puedes editar su distribución abajo.</p>
          : <button disabled={blockers.length > 0} onClick={generate} className={styles.primary}>{controller.busy ? "Procesando…" : stage === 2 ? "Proponer agenda" : stage === 3 ? "Generar planes de sesiones en vivo" : "Generar materiales de sesiones en vivo"}</button>}
        {active && run && <div role="status" className="space-y-2">
          <p>{RUN_LABELS[run.operation]} · {RUN_LABELS[run.status]} · {run.units.filter((unit: { ready: boolean }) => unit.ready).length}/{run.units.length} unidades guardadas.</p>
          {run.last_error && <p>{run.last_error}</p>}
          {run.status !== "RUNNING" && <button disabled={controller.busy || !canResume} className="mr-3 rounded border px-3 py-1" onClick={() => { void controller.command({ action: "RESUME", runId: run.id } as Parameters<typeof controller.command>[0]).catch(() => {}); }}>Reanudar pendientes</button>}
          {!canResume && <p>No hay unidades que admitan reintento directo. Revisa las fuentes y el contenido señalado, o el límite de intentos, antes de iniciar otra generación.</p>}
          <button disabled={controller.busy} className="rounded border px-3 py-1" onClick={() => { void controller.command({ action: "CANCEL", runId: run.id } as Parameters<typeof controller.command>[0]).catch(() => {}); }}>Cancelar ejecución</button>
        </div>}
        {stage === 5 && run?.operation === "MATERIALS" && <div className="space-y-3" aria-label="Progreso de sesiones">
          {(run.units as DeliveryRunUnit[]).map(unit => <article key={unit.id} className="space-y-2 rounded-xl border border-[var(--engine-border)] bg-[var(--engine-surface-solid)] p-4">
            <p className="font-semibold">{document.agenda.find(session => session.id === unit.id)?.title || "Sesión"}</p>
            <p>{unit.ready ? "Guardado" : unit.generating && run.status === "RUNNING" ? "Generando…" : unit.error ? "Requiere atención" : "Pendiente"} · Intentos: {unit.attempts || 0}/{DELIVERY_LIMITS.unitAttempts}</p>
            {unit.error && <p>{unit.error}</p>}
            {unit.error && !unit.ready && <button type="button" disabled={controller.busy || unit.retryable === false || (unit.attempts || 0) >= DELIVERY_LIMITS.unitAttempts || run.retry_units?.includes(unit.id) || !["RUNNING", "QUEUED", "PAUSED", "FAILED"].includes(run.status)}
              onClick={() => { void controller.command({ action: "RETRY_UNIT", runId: run.id, unitId: unit.id }).catch(() => {}); }}>
              {run.retry_units?.includes(unit.id) ? "Reintento en cola" : "Reintentar esta sesión"}</button>}
          </article>)}
          <p className="text-sm">Los reintentos se atienden después de la sesión en curso, antes de la siguiente pendiente. No detienen Academy.</p>
        </div>}
      </>}
      {stage === 2 && (document.config.mode === "HYBRID"
        ? <HybridRouteEditor key={snapshot.workspace.revision} controller={controller} />
        : <DeliveryAgendaEditor key={snapshot.workspace.revision} controller={controller} />)}
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
