"use client";

import { useEffect, useRef, useState } from "react";
import type { CompositionHtmlEditorialHost } from "@/domains/production/composition-editor/composition-html-editing-native-host.client";
import type { HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { HtmlEditingRecoveryError } from "@/domains/production/composition-editor/composition-html-editing-recovery.client";

/** Explicit receipt/ACK recovery only. No polling, retry, overwrite or journal
 * deletion without correlated evidence. This panel never adopts native content. */
export function CompositionHtmlEditorialRecoveryPanel({ scope, host }: {
  scope: HtmlSnapshotLocatorScope; host: CompositionHtmlEditorialHost;
}) {
  const [, refresh] = useState(0), [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  const tracking = host.tracking?.(scope);
  async function recover(historicalOnly = false) {
    if (requestRef.current || !host.recover) return;
    const current = host.tracking?.(scope);
    if (current?.status !== "PENDING" || (!current.entry.acknowledgment && !current.entry.requestSha256)) return;
    if (historicalOnly && !current.entry.requestSha256) return;
    const controller = new AbortController(); requestRef.current = controller; setBusy(true); setMessage(null);
    try {
      await host.recover({ scope, operationId: current.entry.operationId, signal: controller.signal, historicalOnly });
      if (!controller.signal.aborted) setMessage(historicalOnly
        ? "Operación histórica confirmada; seguimiento cerrado. No se restauró su revisión ni se confirmó que siga vigente. No se recreó el historial local."
        : "Seguimiento confirmado cerrado. Consulta nuevamente los campos; no se recreó el historial local.");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof HtmlEditingRecoveryError && error.code === "RECEIPT_NOT_FOUND"
        ? "No se encontró un recibo verificable. El resultado sigue desconocido: conserva el seguimiento; no repitas la escritura ni borres su identidad."
        : "No se pudo verificar el cierre. Recarga explícitamente la composición guardada y revisa el seguimiento; no repitas la escritura.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) { setBusy(false); refresh(value => value + 1); }
      }
    }
  }
  if (!tracking || (tracking.status === "EMPTY" && !message)) return null;
  return <section className="space-y-2 rounded border p-3 text-xs" aria-label="Recuperación HTML editorial">
    <h3>Seguimiento HTML editorial</h3>
    {tracking.status === "UNAVAILABLE" && <p role="alert">El seguimiento no está disponible o está dañado. No se borrará ni se repetirá la escritura.</p>}
    {tracking.status === "PENDING" && <>
      <p>Operación {tracking.entry.operationId} · clip {tracking.entry.clipId}.</p>
      <p>{tracking.entry.acknowledgment
        ? "Hay confirmación de escritura. Recarga la composición guardada antes de verificar y cerrar su seguimiento."
        : tracking.entry.requestSha256
          ? "Resultado desconocido con identidad durable. Consulta su recibo explícitamente; si no existe, conserva el seguimiento y no reenvíes. Recarga la composición guardada para verificar el cierre."
          : "Resultado desconocido legacy: falta confirmación directa y hash de operación. Una lectura actual no prueba esta escritura; no reenvíes ni borres el seguimiento."}</p>
      <button type="button" disabled={busy || (!tracking.entry.acknowledgment && !tracking.entry.requestSha256) || !host.recover} onClick={() => void recover()}>
        {tracking.entry.acknowledgment ? "Verificar y cerrar confirmación" : "Consultar recibo y verificar cierre"}
      </button>
      {tracking.entry.requestSha256 && <>
        <p>Si la revisión ya cambió, puedes cerrar solo la confirmación histórica después de recargar. Se verificará su recibo nuevamente; no se restaurará esa revisión ni se acreditará como vigente o renderizada.</p>
        <button type="button" disabled={busy || !host.recover} onClick={() => void recover(true)}>Verificar recibo y cerrar solo seguimiento histórico</button>
      </>}
    </>}
    <button type="button" disabled={busy} onClick={() => refresh(value => value + 1)}>Releer seguimiento local</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
