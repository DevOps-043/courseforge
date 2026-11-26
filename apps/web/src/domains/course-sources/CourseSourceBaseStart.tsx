"use client";

import { useRef, useState } from "react";
import { startDocumentaryBaseAction } from "./course-source-base.action";

export function CourseSourceBaseStart({ artifactId, initialDescription = "", retry = false, onStarted }: {
  artifactId: string;
  initialDescription?: string;
  retry?: boolean;
  onStarted: () => void;
}) {
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const runId = useRef("");

  async function start() {
    if (pending.current || !description.trim()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      runId.current ||= crypto.randomUUID();
      const result = await startDocumentaryBaseAction({ artifactId, runId: runId.current, description });
      if (result.success) onStarted();
      else {
        runId.current = "";
        setError(result.error || "No se pudo iniciar Base.");
      }
    } catch {
      setError("No se pudo confirmar el inicio. Vuelve a consultar el curso o reintenta.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <div className="space-y-3 rounded-xl border p-4">
    <p className="text-sm">{retry
      ? "Mantén el propósito y las fuentes para reutilizar los lotes que ya se guardaron."
      : "Guarda la política de fuentes y comprueba que al menos un archivo muestre «Texto disponible»."}</p>
    <label className="block text-sm">
      Propósito del curso
      <textarea className="mt-1 block w-full rounded-md border bg-transparent p-2" rows={3} maxLength={3000}
        placeholder="¿A quién va dirigido y qué debe aprender?"
        disabled={busy} value={description} onChange={event => setDescription(event.target.value)} />
    </label>
    <button type="button" className="rounded-md border px-4 py-2 disabled:opacity-50"
      disabled={busy || !description.trim()} onClick={() => void start()}>
      {busy ? "Iniciando Base…" : retry ? "Reintentar Base" : "Generar Base"}
    </button>
    {error && <p role="alert" className="text-sm">{error}</p>}
  </div>;
}
