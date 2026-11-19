"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { CourseSourceLibrary } from "./CourseSourceLibrary";
import { CourseSourceBaseStart } from "./CourseSourceBaseStart";
import type { DeliveryConfig } from "../course-delivery/types/delivery.schemas";

export function CourseSourceDraft({ basePath = "/admin", title, deliveryConfig, onCreated }: {
  basePath?: string; title: string; deliveryConfig?: DeliveryConfig; onCreated?: (artifactId: string) => void;
}) {
  const router = useRouter();
  const [artifactId, setArtifactId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef("");
  async function createDraft() {
    setBusy(true); setError(""); key.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/artifacts/drafts", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, deliveryConfig: deliveryConfig?.mode === "NEXUS" ? { mode: "NEXUS" } : deliveryConfig, idempotencyKey: key.current }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message);
      setArtifactId(result.artifactId);
      onCreated?.(result.artifactId);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo crear el borrador."); }
    finally { setBusy(false); }
  }
  return <details className="my-4 rounded-xl border border-[var(--engine-border)] bg-[var(--engine-canvas)] p-4">
    <summary className="cursor-pointer font-semibold">Preparar documentos antes de generar</summary>
    <div className="flex items-start justify-between gap-3"><p className="my-2 text-sm">Guarda un borrador y carga tus archivos sin iniciar IA. Elige la política y procesa los documentos antes de generar la base del curso.</p>
      <FieldHelp label="Preparar documentos" description="Crea un borrador con el título y modalidad del formulario para cargar y revisar documentos antes de iniciar IA. Continúa desde ese borrador para trabajar sobre el mismo curso." /></div>
    {!artifactId ? <div><p className="mb-3 text-sm text-[var(--engine-text-muted)]">{title.trim() ? `Se utilizará el título: ${title}` : "Escribe el título del curso en el formulario para preparar tus documentos."}</p>
      <button type="button" disabled={busy || !title.trim()} onClick={() => void createDraft()} className="rounded-lg border border-[var(--engine-border)] bg-[var(--engine-surface-solid)] px-4 py-2 text-sm disabled:opacity-50">{busy ? "Guardando borrador…" : "Crear borrador sin IA"}</button></div>
      : <><p className="text-sm">Borrador guardado. Puedes retomarlo desde la lista de cursos.</p><CourseSourceLibrary artifactId={artifactId} />
        <CourseSourceBaseStart artifactId={artifactId} onStarted={() => router.push(`${basePath}/artifacts/${artifactId}`)} /></>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
