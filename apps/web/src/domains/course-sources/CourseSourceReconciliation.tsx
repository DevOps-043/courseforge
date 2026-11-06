"use client";
import { useState } from "react";
import { sourceJsonRequest } from "./course-source.client";

type Observation = { documentId: string; observation: "PRESENT" | "MISSING" | "UNKNOWN" };
export function CourseSourceReconciliation({ root }: { root: string }) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function inspect() {
    setBusy(true);
    try { const result = await sourceJsonRequest(`${root}/reconciliation`, { action: "inspect" }); setObservations(result.observations); setMessage("Conciliación completada sin borrar archivos."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo conciliar."); }
    finally { setBusy(false); }
  }
  async function purge(documentId: string) {
    const confirmation = window.prompt(`Operación irreversible sobre una carga abandonada. Solo procede tras 7 días y sin referencias. Escribe el ID para autorizar: ${documentId}`);
    if (confirmation !== documentId) return;
    setBusy(true);
    try { await sourceJsonRequest(`${root}/reconciliation`, { action: "purge", documentId, confirmDocumentId: confirmation }); setMessage("Purga confirmada; el registro de auditoría se conserva."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Resultado incierto; consulta el estado."); }
    finally { setBusy(false); }
  }
  return <details className="mt-4 rounded border p-3"><summary>Administrar cargas abandonadas</summary>
    <p className="my-2 text-sm">Solo revisores. Se inspeccionan reservas vencidas hace más de 24 horas. No se borra nada automáticamente.</p>
    <button type="button" disabled={busy} onClick={() => void inspect()}>Conciliar sin borrar</button>
    <p role="status">{message}</p>
    <ul>{observations.map(item => <li key={item.documentId} className="break-all py-2">{item.documentId} · {item.observation === "PRESENT" ? "Objeto presente" : item.observation === "MISSING" ? "Objeto ausente" : "Estado incierto"}
      {item.observation !== "UNKNOWN" && <button type="button" disabled={busy} onClick={() => void purge(item.documentId)}>Autorizar purga de esta carga</button>}
    </li>)}</ul>
  </details>;
}
