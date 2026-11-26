"use client";

import { useRef, useState } from "react";
import { useMaterials } from "../hooks/useMaterials";
import { MaterialsContent } from "./MaterialsForm";
import { DeliveryStagePanel } from "../../course-delivery/components/DeliveryStagePanel";
import type { CourseDeliveryController } from "../../course-delivery/hooks/useCourseDelivery";
import type { DeliveryRunUnit } from "../../course-delivery/services/delivery-commands";
import { HybridMaterialsQaPanel } from "./HybridMaterialsQaPanel";

const RUN_STATES: Record<string,string> = { RUNNING: "Generando", QUEUED: "En cola", FAILED: "Finalizado con errores", COMPLETED: "Completado", PAUSED: "En pausa", CANCELLED: "Cancelado" };

export function HybridMaterialsWorkspace({ artifactId, delivery, profile }: {
  artifactId: string; delivery: CourseDeliveryController; profile?: { platform_role?: string | null };
}) {
  const academy = useMaterials(artifactId);
  const [destination, setDestination] = useState<"hub" | "academy">("hub");
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const [startError, setStartError] = useState("");
  const run = delivery.snapshot?.run;
  const hubUnits: DeliveryRunUnit[] = run?.operation === "MATERIALS" ? run.units : [];
  const hubActive = Boolean(run && ["RUNNING", "QUEUED", "PAUSED", "FAILED"].includes(run.status));
  const canStartHub = Boolean(delivery.snapshot?.enabled && delivery.snapshot.readiness.planReady && !hubActive && !delivery.snapshot.readiness.materialsReady);
  const canStartAcademy = !academy.loading && !academy.isGenerating && !academy.isValidating &&
    (!academy.materials || ["PHASE3_DRAFT", "PHASE3_NEEDS_FIX"].includes(academy.materials.state));
  const start = async () => {
    if (startingRef.current) return;
    startingRef.current = true; setStarting(true); setStartError("");
    try {
      const tasks: Promise<unknown>[] = [];
      if (canStartHub) tasks.push(delivery.command({ action: "GENERATE", operation: "MATERIALS" }));
      if (canStartAcademy) tasks.push(academy.startGeneration());
      const results = await Promise.allSettled(tasks);
      if (results.some(result => result.status === "rejected")) setStartError("Uno de los destinos no pudo iniciar. Revisa su diagnóstico; el otro continúa de forma independiente.");
    } finally { startingRef.current = false; setStarting(false); }
  };
  return <div className="space-y-6">
    <header className="space-y-5 rounded-2xl border border-[var(--engine-border)] bg-[var(--engine-surface-solid)] p-5 sm:p-6">
      <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--engine-accent)]">Curso híbrido · Paso 5</p>
        <h2 className="text-2xl text-[var(--engine-text)]">Generación de materiales</h2>
        <p className="text-sm leading-relaxed text-[var(--engine-text-muted)]">Inicia los dos destinos y revisa su avance por separado. Un fallo conserva el trabajo guardado y permite reintentar la unidad sin cancelar el otro flujo.</p></div>
      <button type="button" disabled={starting || delivery.busy || academy.isStartingGeneration || (!canStartHub && !canStartAcademy)} onClick={() => void start()}
        className="rounded-xl bg-[var(--engine-accent)] px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">{starting ? "Iniciando destinos…" : "Generar materiales pendientes"}</button>
      {(startError || academy.actionError) && <p role="alert">{startError || academy.actionError}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <button type="button" aria-pressed={destination === "hub"} onClick={() => setDestination("hub")} className={`space-y-2 rounded-xl border p-4 text-left focus-visible:outline-2 focus-visible:outline-[var(--engine-accent)] ${destination === "hub" ? "border-[var(--engine-accent)]" : "border-[var(--engine-border)]"}`}>
          <strong className="block">Síncronos · Hub</strong><span className="block text-sm">{hubUnits.filter(unit => unit.ready).length} guardadas · {hubUnits.filter(unit => unit.error && !unit.ready).length} con error · {run?.operation === "MATERIALS" ? RUN_STATES[run.status] || "Estado desconocido" : "Sin iniciar"}</span></button>
        <button type="button" aria-pressed={destination === "academy"} onClick={() => setDestination("academy")} className={`space-y-2 rounded-xl border p-4 text-left focus-visible:outline-2 focus-visible:outline-[var(--engine-accent)] ${destination === "academy" ? "border-[var(--engine-accent)]" : "border-[var(--engine-border)]"}`}>
          <strong className="block">Asíncronos · Academy</strong><span className="block text-sm">{academy.materials?.lessons.filter(lesson => ["GENERATED", "APPROVABLE"].includes(lesson.state)).length || 0} generadas · {academy.materials?.lessons.filter(lesson => ["NEEDS_FIX", "BLOCKED"].includes(lesson.state)).length || 0} con error · {academy.isGenerating ? "Generando" : academy.loading ? "Consultando…" : "Disponible"}</span></button>
      </div>
    </header>
    <HybridMaterialsQaPanel delivery={delivery} academy={academy} />
    <section hidden={destination !== "hub"} aria-label="Materiales síncronos de Hub"><DeliveryStagePanel controller={delivery} stage={5} coordinatedReview /></section>
    <section hidden={destination !== "academy"} aria-label="Materiales asíncronos de Academy"><MaterialsContent controller={academy} artifactId={artifactId} profile={profile} /></section>
  </div>;
}
