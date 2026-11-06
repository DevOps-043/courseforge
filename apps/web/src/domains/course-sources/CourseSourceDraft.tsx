"use client";
import { useRef, useState } from "react";
import { CourseSourceLibrary } from "./CourseSourceLibrary";

export function CourseSourceDraft() {
  const [title, setTitle] = useState("");
  const [artifactId, setArtifactId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef("");
  async function createDraft() {
    setBusy(true); setError(""); key.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/artifacts/drafts", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, idempotencyKey: key.current }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message);
      setArtifactId(result.artifactId);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo crear el borrador."); }
    finally { setBusy(false); }
  }
  return <details className="my-4 rounded-xl border p-4">
    <summary className="cursor-pointer font-semibold">Preparar documentos antes de generar</summary>
    <p className="my-2 text-sm">Guarda un borrador y carga tus archivos sin iniciar IA. La generación basada en estos documentos todavía no está habilitada.</p>
    {!artifactId ? <div><input aria-label="Título del borrador documental" maxLength={300} value={title} onChange={event => setTitle(event.target.value)} className="rounded border p-2" />
      <button disabled={busy || !title.trim()} onClick={() => void createDraft()} className="ml-3 rounded border p-2">Crear borrador sin IA</button></div>
      : <><p className="text-sm">Borrador guardado: {artifactId}. Puedes retomarlo desde la lista de cursos.</p><CourseSourceLibrary artifactId={artifactId} /></>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
