"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { COURSE_SOURCE_FORMATS } from "./course-source-policy";
import { reserveSourceUploadSchema } from "./course-source.schema";
import { sourceJsonRequest as jsonRequest, uploadSourceBytes } from "./course-source.client";
import { CourseSourceReconciliation } from "./CourseSourceReconciliation";

type DocumentSummary = { id: string; filename: string; status: string; supersedesId?: string | null };
const STATUS_LABELS: Record<string, string> = { RESERVED: "Carga pendiente", UPLOADED: "Recibido", PROCESSING: "Procesando", READY: "Texto disponible", FAILED: "Extracción fallida: revisa el archivo o aplica OCR", RETIRED: "Retirado" };
export function CourseSourceLibrary({ artifactId }: { artifactId: string }) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [replacement, setReplacement] = useState<DocumentSummary | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const root = `/api/artifacts/${artifactId}/sources`;
  const refresh = useCallback(async () => {
    const result = await jsonRequest(`${root}?limit=50`); setDocuments(result.documents);
  }, [root]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh().catch(() => setMessage("Biblioteca no disponible temporalmente. Intenta actualizar más tarde.")), 0);
    const timer = setInterval(() => void refresh().catch(() => undefined), 5000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [refresh]);
  async function processDocument(documentId: string) {
    await jsonRequest(`${root}/documents/${documentId}`, {});
    setMessage("Extracción solicitada. Puedes recargar la página y consultar el estado.");
  }
  async function upload(files: File[]) {
    if (busy) return;
    setBusy(true); setMessage("");
    const controller = new AbortController(); uploadController.current = controller;
    try {
      if (files.length > 8 || files.reduce((sum, file) => sum + file.size, 0) > 40 * 1024 * 1024) throw new Error("Selecciona hasta 8 archivos y 40 MB por lote.");
      if (replacement && files.length !== 1) throw new Error("Selecciona un único archivo para sustituir esta versión.");
      for (const file of files) {
        if (file.size < 1 || file.size > 15 * 1024 * 1024) throw new Error("Cada archivo debe pesar entre 1 byte y 15 MB.");
        setMessage(`Preparando ${file.name}…`);
        const extension = file.name.split(".").pop()?.toLowerCase() as keyof typeof COURSE_SOURCE_FORMATS;
        const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        const parsed = reserveSourceUploadSchema.safeParse({ idempotencyKey: crypto.randomUUID(), filename: file.name,
          ...(replacement ? { supersedesId: replacement.id } : {}),
          mimeType: COURSE_SOURCE_FORMATS[extension], sizeBytes: file.size,
          sha256: Array.from(new Uint8Array(hash)).map(value => value.toString(16).padStart(2, "0")).join("") });
        if (!parsed.success) throw new Error("Archivo no compatible. Usa PDF, DOCX, PPTX o TXT de hasta 15 MB con un nombre válido.");
        const input = parsed.data;
        const retryKey = `course-source-upload:${artifactId}:${input.sha256}:${replacement?.id || "original"}`;
        const previousKey = sessionStorage.getItem(retryKey);
        if (previousKey) input.idempotencyKey = previousKey;
        else sessionStorage.setItem(retryKey, input.idempotencyKey);
        const reserved = await jsonRequest(`${root}/uploads`, input);
        if (reserved.upload) {
          setMessage(`Subiendo ${file.name}…`);
          setProgress(0);
          await uploadSourceBytes(reserved.upload.signedUrl, file, input.mimeType, setProgress, controller.signal);
          await jsonRequest(`${root}/uploads/confirm`, { documentId: reserved.document.id });
        }
        if (["UPLOADED", "FAILED", "PROCESSING"].includes(reserved.document.status) || reserved.upload) await processDocument(reserved.document.id);
      }
      setReplacement(null);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo procesar el archivo."); }
    finally { setBusy(false); setProgress(null); uploadController.current = null; }
  }
  return <details aria-busy={busy} className="mb-5 rounded-xl border border-gray-300 bg-[var(--engine-surface)] p-4 font-sans dark:border-white/20 [&_button]:min-h-10 [&_button]:rounded-md [&_button]:border [&_button]:border-gray-300 [&_button]:px-3 [&_button]:py-2 [&_button]:text-sm [&_button]:font-medium [&_button]:disabled:opacity-50 [&_button]:hover:bg-gray-100 dark:[&_button]:border-white/20 dark:[&_button]:hover:bg-white/10">
    <summary className="cursor-pointer font-semibold">Mis documentos del curso</summary>
    <p className="my-3 text-sm">PDF, DOCX, PPTX o TXT · 15 MB por archivo. Se extrae texto sin OCR. La integración con generación se habilitará en las siguientes fases.</p>
    {replacement && <p role="status">Sustituyendo: {replacement.filename}. El original se conserva hasta que termine la extracción. <button type="button" disabled={busy} onClick={() => setReplacement(null)}>Cancelar sustitución</button></p>}
    <label className="block rounded border border-dashed p-4" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) void upload(Array.from(event.dataTransfer.files)); }}>
      <span className="mb-2 block">Selecciona o arrastra tus archivos</span>
      <input className="block w-full min-w-0 text-sm" type="file" multiple={!replacement} accept=".pdf,.docx,.pptx,.txt" disabled={busy} onChange={event => { void upload(Array.from(event.target.files || [])); event.target.value = ""; }} />
    </label>
    {busy && <button type="button" onClick={() => uploadController.current?.abort()}>Cancelar transferencia</button>}
    {progress !== null && <progress aria-label="Progreso de carga" value={progress} max={100}>{progress}%</progress>}
    <p role="status" className="my-2 text-sm">{message}</p>
    <ul aria-label="Versiones documentales">{documents.map(document => <li key={document.id} className="flex flex-wrap items-center gap-3 border-b py-3">
      <span className="min-w-0 break-words">{document.filename} · {STATUS_LABELS[document.status] || document.status}{document.supersedesId && ` · sustituye ${documents.find(item => item.id === document.supersedesId)?.filename || document.supersedesId}`}</span>
      {document.status === "READY" && !documents.some(item => item.supersedesId === document.id && item.status !== "RETIRED") && <button type="button" disabled={busy} onClick={() => setReplacement(document)}>Sustituir archivo</button>}
      {document.status === "RESERVED" && <button disabled={busy} onClick={() => void jsonRequest(`${root}/uploads/confirm`, { documentId: document.id }).then(() => processDocument(document.id)).then(refresh).catch(error => setMessage(error.message))}>Confirmar carga</button>}
      {["UPLOADED", "FAILED", "PROCESSING"].includes(document.status) && <button disabled={busy} onClick={() => void processDocument(document.id).catch(error => setMessage(error.message))}>Procesar / recuperar</button>}
      {document.status === "READY" && <button onClick={() => void jsonRequest(`${root}/documents/${document.id}`).then(result => setText(result.fragments.map((fragment: { text_content: string }) => fragment.text_content).join(""))).catch(error => setMessage(error.message))}>Ver texto</button>}
      {document.status !== "RESERVED" && <button onClick={() => void jsonRequest(`${root}/documents/${document.id}?download=1`).then(result => { window.location.assign(result.url); }).catch(error => setMessage(error.message))}>Descargar original</button>}
      {!["RESERVED", "RETIRED"].includes(document.status) && <button onClick={() => { if (window.confirm("¿Retirar este documento de la biblioteca activa? Se conservará el original.")) void jsonRequest(`${root}/documents/${document.id}?action=retire`, {}).then(refresh).catch(error => setMessage(error.message)); }}>Retirar</button>}
    </li>)}</ul>
    {text && <div><button onClick={() => setText("")}>Cerrar texto</button><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{text}</pre></div>}
    <CourseSourceReconciliation root={root} />
  </details>;
}
