"use client";

import { useEffect, useRef, useState } from "react";
import { SESSION_BROLL_MAX_BYTES, type SessionBroll } from "../types/session-broll";
import styles from "./delivery-ui.module.css";

interface Props { artifactId: string; sessionId: string; revision: number; approved: boolean; canReview: boolean }
export function DeliverySessionBrolls({ artifactId, sessionId, revision, approved, canReview }: Props) {
  const endpoint = `/api/artifacts/${artifactId}/delivery/sessions/${sessionId}/broll`;
  const [clips, setClips] = useState<SessionBroll[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(approved);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<{ file: File; id: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const active = useRef(false);
  const uploadAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    if (approved) void fetch(endpoint, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.message); if (!controller.signal.aborted) { setClips(result.clips); setNext(result.next); } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "No se pudieron consultar los clips."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => { alive.current = false; controller.abort(); uploadAbort.current?.abort(); };
  }, [endpoint, approved]);
  async function refresh(after?: string) {
    const response = await fetch(`${endpoint}${after ? `?after=${after}` : ""}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "No se pudo consultar la lista.");
    if (alive.current) { setClips(previous => after ? [...previous, ...result.clips] : result.clips); setNext(result.next); }
  }
  async function post(body: object) {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, revision }), signal: AbortSignal.timeout(60_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "No se pudo completar la operación. Actualiza para comprobar el estado.");
    return result;
  }
  async function run(operation: () => Promise<void>) {
    if (active.current) return;
    active.current = true; setBusy(true); setError("");
    try { await operation(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "La confirmación tardó demasiado. Actualiza o reintenta verificar el mismo clip."); }
    finally { active.current = false; if (alive.current) { setBusy(false); setProgress(""); } }
  }
  async function upload(file: File, id = crypto.randomUUID()) {
    await run(async () => {
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!["mp4", "webm"].includes(extension || "") || !file.size || file.size > SESSION_BROLL_MAX_BYTES) throw new Error("Usa MP4 o WebM de hasta 100 MiB.");
      setPending({ file, id }); setProgress("Preparando carga privada…");
      const result = await post({ action: "INIT", assetId: id, name: file.name, extension, size: file.size });
      if (result.upload) {
        if (!alive.current) return;
        setProgress("Subiendo clip…");
        uploadAbort.current = new AbortController();
        const form = new FormData();
        form.append("cacheControl", "0");
        form.append("", new File([file], file.name, { type: `video/${extension}` }));
        const uploaded = await fetch(result.upload.signedUrl, { method: "PUT", headers: { "x-upsert": "false" }, body: form, credentials: "omit", referrerPolicy: "no-referrer",
          signal: AbortSignal.any([uploadAbort.current.signal, AbortSignal.timeout(180_000)]) });
        // Una respuesta perdida puede dejar el objeto completo. Confirmar comprueba
        // sus bytes; repetir la carga nunca habilita sobrescribir el objeto.
        if (!uploaded.ok) setProgress("Comprobando si la carga anterior ya quedó guardada…");
      }
      if (!alive.current) return;
      setProgress("Verificando formato, duración y resolución…");
      await post({ action: "CONFIRM", assetId: id });
      if (alive.current) { setPending(null); if (input.current) input.current.value = ""; }
      await refresh();
    });
  }
  return <SessionBrollView clips={clips} approved={approved} canReview={canReview} busy={busy} error={error} progress={progress}
    endpoint={endpoint} preview={preview} next={next} inputRef={input} pending={Boolean(pending)}
    onUpload={file => void upload(file)} onRetry={() => { if (pending) void upload(pending.file, pending.id); }}
    onPreview={setPreview} onRefresh={() => void run(() => refresh())} onMore={() => void run(() => refresh(next || undefined))}
    onMediaError={() => setError("No se pudo reproducir el clip. Cierra la vista y vuelve a abrirla para renovar el acceso privado.")}
    onAction={(action, assetId) => void run(async () => { await post({ action, assetId }); setPreview(null); await refresh(); })} />;
}

export function SessionBrollView({ clips, approved, canReview, busy, error, progress, endpoint, preview, next, inputRef, pending,
  onUpload, onRetry, onPreview, onRefresh, onMore, onAction, onMediaError }: {
  clips: SessionBroll[]; approved: boolean; canReview: boolean; busy: boolean; error: string; progress: string;
  endpoint: string; preview: string | null; next: string | null; inputRef: React.RefObject<HTMLInputElement | null>; pending: boolean;
  onUpload: (file: File) => void; onRetry: () => void; onPreview: (id: string | null) => void; onRefresh: () => void; onMore: () => void;
  onAction: (action: "CONFIRM" | "APPROVE" | "ARCHIVE", id: string) => void;
  onMediaError?: () => void;
}) {
  return <section aria-label="B-rolls opcionales de la sesión" className={styles.previewSection}>
    <h3>B-rolls de apoyo · Opcionales</h3>
    <p>Clips para apoyar la sesión en vivo. No requieren avatar, locución ni video final y su ausencia no bloquea el curso.</p>
    {!approved ? <p>Aprueba los materiales vigentes antes de añadir o revisar apoyos.</p> : <>
      <label className={styles.field}>Añadir clip MP4 o WebM<input ref={inputRef} type="file" accept=".mp4,.webm" disabled={busy}
        onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); }} /></label>
      <p>Hasta 100 MiB, 10 minutos y 1920 px en el lado mayor. Almacenamiento privado; reproducción sin audio por defecto.</p>
      <button type="button" disabled={busy} onClick={onRefresh}>Actualizar apoyos</button>
      {pending && <button type="button" disabled={busy} onClick={onRetry}>Reintentar misma carga</button>}
      {!busy && !clips.length && !error && <p>No hay clips añadidos. Puedes continuar sin B-rolls.</p>}
      <ul>{clips.map(clip => <li key={clip.id} className={styles.brollItem}>
        <strong>{clip.name}</strong>
        <span>{!clip.current ? "Requiere validar para la revisión actual" : clip.status === "PENDING" ? "Carga pendiente de verificar" : clip.status === "APPROVED" ? "Apoyo aprobado" : "Validado · revisión pendiente"}{clip.duration ? ` · ${Math.round(clip.duration)} s` : ""}</span>
        <div className={styles.actions}>
          {clip.current && clip.status !== "PENDING" && <button type="button" disabled={busy} onClick={() => onPreview(preview === clip.id ? null : clip.id)}>{preview === clip.id ? "Cerrar vista" : "Revisar clip"}</button>}
          {(!clip.current || clip.status === "PENDING") && <button type="button" disabled={busy} onClick={() => onAction("CONFIRM", clip.id)}>Verificar clip</button>}
          {canReview && clip.current && clip.status === "GENERATED" && <button type="button" disabled={busy} onClick={() => onAction("APPROVE", clip.id)}>Aprobar apoyo</button>}
          <button type="button" disabled={busy} onClick={() => onAction("ARCHIVE", clip.id)}>Retirar apoyo</button>
        </div>
        {preview === clip.id && clip.current && clip.status !== "PENDING" && <video controls muted playsInline preload="metadata" onError={onMediaError} className={styles.brollVideo} src={`${endpoint}?assetId=${clip.id}`} aria-label={`Clip de apoyo: ${clip.name}`} />}
      </li>)}</ul>
      {next && <button type="button" disabled={busy} onClick={onMore}>Cargar más apoyos</button>}
    </>}
    {progress && <p role="status">{progress}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
