"use client";
import { useCallback, useEffect, useState } from "react";
import { COURSE_SOURCE_FORMATS } from "./course-source-policy";
import { reserveSourceUploadSchema } from "./course-source.schema";

type DocumentSummary = { id: string; filename: string; status: string };
const STATUS_LABELS: Record<string, string> = { RESERVED: "Carga pendiente", UPLOADED: "Recibido", PROCESSING: "Procesando", READY: "Texto disponible", FAILED: "Extracción fallida: revisa el archivo o aplica OCR", RETIRED: "Retirado" };
async function jsonRequest(url: string, body?: object) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "No se pudo completar la operación documental.");
  return result;
}
export function CourseSourceLibrary({ artifactId }: { artifactId: string }) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const root = `/api/artifacts/${artifactId}/sources`;
  const refresh = useCallback(async () => {
    const result = await jsonRequest(`${root}?limit=50`); setDocuments(result.documents);
  }, [root]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh().catch(() => setMessage("Biblioteca no disponible. Verifica que las migraciones documentales estén aplicadas.")), 0);
    const timer = setInterval(() => void refresh().catch(() => undefined), 5000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [refresh]);
  async function processDocument(documentId: string) {
    await jsonRequest(`${root}/documents/${documentId}`, {});
    setMessage("Extracción solicitada. Puedes recargar la página y consultar el estado.");
  }
  async function upload(files: File[]) {
    setBusy(true); setMessage("");
    try {
      if (files.length > 8 || files.reduce((sum, file) => sum + file.size, 0) > 40 * 1024 * 1024) throw new Error("Selecciona hasta 8 archivos y 40 MB por lote.");
      for (const file of files) {
        if (file.size < 1 || file.size > 15 * 1024 * 1024) throw new Error("Cada archivo debe pesar entre 1 byte y 15 MB.");
        setMessage(`Preparando ${file.name}…`);
        const extension = file.name.split(".").pop()?.toLowerCase() as keyof typeof COURSE_SOURCE_FORMATS;
        const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        const input = reserveSourceUploadSchema.parse({ idempotencyKey: crypto.randomUUID(), filename: file.name,
          mimeType: COURSE_SOURCE_FORMATS[extension], sizeBytes: file.size,
          sha256: Array.from(new Uint8Array(hash)).map(value => value.toString(16).padStart(2, "0")).join("") });
        const retryKey = `course-source-upload:${artifactId}:${input.sha256}`;
        const previousKey = sessionStorage.getItem(retryKey);
        if (previousKey) input.idempotencyKey = previousKey;
        else sessionStorage.setItem(retryKey, input.idempotencyKey);
        const reserved = await jsonRequest(`${root}/uploads`, input);
        if (reserved.upload) {
          setMessage(`Subiendo ${file.name}…`);
          const response = await fetch(reserved.upload.signedUrl, { method: "PUT", headers: { "Content-Type": input.mimeType }, body: file });
          if (!response.ok) throw new Error("Carga interrumpida. Consulta la reserva antes de repetirla.");
          await jsonRequest(`${root}/uploads/confirm`, { documentId: reserved.document.id });
        }
        await processDocument(reserved.document.id);
      }
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo procesar el archivo."); }
    finally { setBusy(false); }
  }
  return <details className="mb-5 rounded-xl border border-gray-300 p-4 dark:border-white/20">
    <summary className="cursor-pointer font-semibold">Mis documentos del curso</summary>
    <p className="my-3 text-sm">PDF, DOCX, PPTX o TXT · 15 MB por archivo. Se extrae texto sin OCR. La integración con generación se habilitará en las siguientes fases.</p>
    <label className="block rounded border border-dashed p-4" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) void upload(Array.from(event.dataTransfer.files)); }}>
      Selecciona o arrastra tus archivos
      <input type="file" multiple accept=".pdf,.docx,.pptx,.txt" disabled={busy} onChange={event => { void upload(Array.from(event.target.files || [])); event.target.value = ""; }} />
    </label>
    <p role="status" className="my-2 text-sm">{message}</p>
    <ul>{documents.map(document => <li key={document.id} className="flex flex-wrap items-center gap-3 border-b py-3">
      <span>{document.filename} · {STATUS_LABELS[document.status] || document.status}</span>
      {document.status === "RESERVED" && <button disabled={busy} onClick={() => void jsonRequest(`${root}/uploads/confirm`, { documentId: document.id }).then(() => processDocument(document.id)).then(refresh).catch(error => setMessage(error.message))}>Confirmar carga</button>}
      {["UPLOADED", "FAILED", "PROCESSING"].includes(document.status) && <button disabled={busy} onClick={() => void processDocument(document.id).catch(error => setMessage(error.message))}>Procesar / recuperar</button>}
      {document.status === "READY" && <button onClick={() => void jsonRequest(`${root}/documents/${document.id}`).then(result => setText(result.fragments.map((fragment: { text_content: string }) => fragment.text_content).join(""))).catch(error => setMessage(error.message))}>Ver texto</button>}
      {document.status !== "RESERVED" && <button onClick={() => void jsonRequest(`${root}/documents/${document.id}?download=1`).then(result => { window.location.assign(result.url); }).catch(error => setMessage(error.message))}>Descargar original</button>}
      {!["RESERVED", "RETIRED"].includes(document.status) && <button onClick={() => { if (window.confirm("¿Retirar este documento de la biblioteca activa? Se conservará el original.")) void jsonRequest(`${root}/documents/${document.id}?action=retire`, {}).then(refresh).catch(error => setMessage(error.message)); }}>Retirar</button>}
    </li>)}</ul>
    {text && <div><button onClick={() => setText("")}>Cerrar texto</button><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{text}</pre></div>}
  </details>;
}
