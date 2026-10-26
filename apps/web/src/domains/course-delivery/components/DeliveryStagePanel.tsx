"use client";

import { useState } from "react";
import type { CourseDeliveryController } from "../hooks/useCourseDelivery";
import { DeliveryAgendaEditor } from "./DeliveryAgendaEditor";
import { DeliveryContentEditor } from "./DeliveryContentEditor";
import type { DeliveryConfig } from "../types/delivery.schemas";
import { DELIVERY_LIMITS } from "../config/delivery.config";
const RUN_LABELS: Record<string, string> = { QUEUED: "En cola", RUNNING: "Generando", PAUSED: "En pausa", FAILED: "Requiere atención", COMPLETED: "Completado", CANCELLED: "Cancelado", AGENDA: "Agenda", PLAN: "Plan", MATERIALS: "Materiales" };

function Configuration({ controller }: { controller: CourseDeliveryController }) {
  const [config, setConfig] = useState<DeliveryConfig>(controller.snapshot!.workspace.document.config);
  return <div className="grid gap-3 sm:grid-cols-2">
    <label>Modalidad<select className="block w-full rounded border bg-transparent p-2" value={config.mode} onChange={event => setConfig({ ...config, mode: event.target.value as DeliveryConfig["mode"] })}><option value="NEXUS">Nexus</option><option value="SYNCHRONOUS">Sincrónico</option><option value="HYBRID">Híbrido</option></select></label>
    {config.mode !== "NEXUS" && <>
      <label>Cantidad de sesiones (vacío: una por módulo)<input type="number" min="1" max={DELIVERY_LIMITS.sessions} className="block w-full rounded border bg-transparent p-2" value={config.sessionCount ?? ""} onChange={event => setConfig({ ...config, sessionCount: event.target.value ? Number(event.target.value) : null })} /></label>
      <label>Duración inicial en minutos<input type="number" min="15" max={DELIVERY_LIMITS.sessionMinutes} className="block w-full rounded border bg-transparent p-2" value={config.sessionMinutes} onChange={event => setConfig({ ...config, sessionMinutes: Number(event.target.value) })} /></label>
      <label>Enfoque<select className="block w-full rounded border bg-transparent p-2" value={config.balance} onChange={event => setConfig({ ...config, balance: event.target.value as DeliveryConfig["balance"] })}><option value="EXPLANATION">Más explicación</option><option value="BALANCED">Equilibrio</option><option value="PRACTICE">Más práctica</option></select></label>
      {config.mode === "HYBRID" && <label>Relación con Nexus<select className="block w-full rounded border bg-transparent p-2" value={config.approach} onChange={event => setConfig({ ...config, approach: event.target.value as DeliveryConfig["approach"] })}><option value="COMPLEMENTARY">Complementario</option><option value="CLASS_VERSION">Versión de la clase</option></select></label>}
    </>}
    <button disabled={controller.busy} className="rounded border px-4 py-2" onClick={() => { void controller.command({ action: "SAVE", kind: "CONFIG", value: config } as Parameters<typeof controller.command>[0]).catch(() => {}); }}>Guardar modalidad y preferencias</button>
  </div>;
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
  return <section className="mb-6 space-y-4 rounded-xl border border-cyan-700/30 bg-cyan-500/5 p-5">
    <h2 className="text-lg font-bold">{stage === 1 ? "Modalidad del curso" : stage === 2 ? "Agenda de sesiones" : stage === 3 ? "Plan de sesiones" : stage === 5 ? "Materiales para impartir" : stage === 6 ? "Presentación y documentos" : "Entrega del paquete sincrónico"}</h2>
    {controller.error && <p role="alert">{controller.error}</p>}{localError && <p role="alert">{localError}</p>}
    {stage === 1 ? <Configuration key={snapshot.workspace.revision} controller={controller} /> : <>
      {snapshot.settings.length > 0 && <p className="text-sm">Configuración para nuevas ejecuciones: {snapshot.settings.filter(setting => setting.operation === operation).map(setting => `${setting.model}${setting.inherited ? " (heredado)" : ""} · prompt ${setting.version}`).join("")}. Modificable en Configuración.</p>}
      {[2, 3, 5].includes(stage) && <>
        <button disabled={controller.busy || active || !snapshot.syllabusApproved || (stage === 3 && !document.agenda.length) || (stage === 5 && !snapshot.readiness.planReady)} onClick={generate} className="rounded bg-cyan-700 px-4 py-2 text-white">{controller.busy ? "Procesando…" : stage === 2 ? "Proponer agenda" : stage === 3 ? "Generar plan completo" : "Generar materiales completos"}</button>
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
        {snapshot.canReview && <button disabled={controller.busy || active} className="rounded bg-emerald-700 px-4 py-2 text-white" onClick={() => { void controller.command({ action: "APPROVE", operation: stage === 3 ? "PLAN" : "MATERIALS" } as Parameters<typeof controller.command>[0]).catch(() => {}); }}>{stage === 3 ? "Aprobar plan completo" : "Aprobar materiales completos"}</button>}
        <p role="status">{(stage === 3 ? snapshot.readiness.planReady : snapshot.readiness.materialsReady) ? "Aprobado y vigente." : "Pendiente de revisión o reconciliación."}</p>
      </>}
      {(stage === 6 || stage === 8) && <><p>{stage === 6 ? "Revisa las salidas del contenido generado. Puedes volver a Materiales para corregirlo." : "Descarga el paquete aprobado. Abre la guía o el cuaderno y utiliza Imprimir para obtener una copia."}</p>
        <div className="flex flex-wrap gap-3">{[["presentation", "Presentación web"], ["facilitator", "Guía del facilitador"], ["participant", "Material del participante"]].map(([audience, label]) => <div key={audience} className="rounded border p-3">
          <a className="text-cyan-700 underline" href={exportUrl(audience, false, stage === 6)} target="_blank" rel="noreferrer">{label}{stage === 6 ? " (borrador)" : ""}</a>
          {stage === 8 && snapshot.readiness.materialsReady && <a className="ml-3 underline" href={exportUrl(audience, true)}>Descargar HTML</a>}
        </div>)}</div>
        {stage === 8 && !snapshot.readiness.materialsReady && <p role="status">La entrega se habilita cuando los materiales requeridos estén aprobados y vigentes.</p>}
      </>}
    </>}
  </section>;
}
