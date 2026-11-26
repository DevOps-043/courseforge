"use client";

import { useRef, useState } from "react";
import type { CourseDeliveryController } from "../../course-delivery/hooks/useCourseDelivery";
import type { useMaterials } from "../hooks/useMaterials";

export function HybridMaterialsQaPanel({ delivery, academy }: {
  delivery: CourseDeliveryController; academy: ReturnType<typeof useMaterials>;
}) {
  const pending = useRef(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const snapshot = delivery.snapshot;
  if (!snapshot) return null;
  const document = snapshot.workspace.document;
  const hubReady = document.agenda.length > 0 && document.agenda.every(session =>
    Boolean(document.materials[session.id]?.documents) && !document.staleMaterials.includes(session.id));
  const lessons = academy.materials?.lessons || [];
  const academyReady = academy.isApproved || Boolean(academy.isReadyForQA && lessons.length &&
    lessons.every(lesson => lesson.state === "APPROVABLE"));
  const active = Boolean(snapshot.run && ["QUEUED", "RUNNING", "PAUSED", "FAILED"].includes(snapshot.run.status));
  const blockers = [
    !snapshot.readiness.planReady ? "Aprueba el plan completo y vigente antes de revisar materiales." : "",
    !hubReady ? "Hub: completa o actualiza los materiales y documentos de las sesiones." : "",
    academy.loading ? "Academy: consultando el estado de QA." : !academyReady ? "Academy: valida las lecciones y envíalas a QA desde su apartado." : "",
    active || academy.isGenerating || academy.isValidating || academy.isStartingGeneration ? "Espera a que termine la operación en curso o resuelve la ejecución pendiente." : "",
  ].filter(Boolean);
  async function approve() {
    if (pending.current) return;
    pending.current = true; setReviewing(true); setError("");
    try {
      await delivery.command({ action: "APPROVE", operation: "MATERIALS" });
      await academy.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No se pudo confirmar la revisión. Actualiza el estado antes de reintentar.");
      // Academy puede haberse aprobado antes de un conflicto al confirmar Hub.
      await Promise.allSettled([delivery.refresh(), academy.refresh()]);
    } finally { pending.current = false; setReviewing(false); }
  }
  return <section aria-label="Revisión QA del curso híbrido" className="space-y-3 rounded-2xl border border-purple-300 bg-purple-50 p-5 text-slate-900 dark:border-purple-700 dark:bg-purple-950/30 dark:text-slate-100">
    <h3 className="text-lg font-semibold">Revisión QA de materiales</h3>
    <p className="text-sm">Revisa el contenido de Hub y Academy antes de aprobar el curso. La generación completa no equivale a aprobación.</p>
    <ul className="space-y-1 text-sm">
      <li>Hub: {snapshot.readiness.materialsReady ? "QA aprobado" : hubReady ? "materiales generados para revisión" : "materiales pendientes de completar o actualizar"}.</li>
      <li>Academy: {academy.isApproved ? "QA aprobado" : academyReady ? "listo para revisión QA" : "validación o envío a QA pendiente"}.</li>
    </ul>
    {snapshot.readiness.materialsReady ? <p role="status">Materiales de ambos destinos aprobados y vigentes.</p> : <>
      {blockers.length > 0 && <ul aria-label="Requisitos pendientes de QA" className="list-inside list-disc text-sm">{blockers.map(message => <li key={message}>{message}</li>)}</ul>}
      {snapshot.canReview ? <button type="button" disabled={reviewing || delivery.busy || blockers.length > 0}
        onClick={() => void approve()} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
        {reviewing ? "Confirmando revisión…" : "Aprobar materiales de Hub y Academy"}
      </button> : <p role="status">La aprobación requiere un usuario con permiso de revisión de contenido.</p>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
