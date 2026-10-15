"use client";

import { useEffect, useRef, useState } from "react";
import type { CompositionHtmlEditorialHost } from "@/domains/production/composition-editor/composition-html-editing-native-host.client";
import type { HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { HtmlLegacyAdoptionCoordinatorError } from "@/domains/production/composition-editor/composition-html-editing-legacy-adoption-coordinator.client";

/** Recovery only. Persisted tracking remains visible with new adoption disabled;
 * neither button sends a new mutation or installs an unreviewed candidate. */
export function CompositionHtmlLegacyAdoptionRecoveryPanel({ scope, host }: {
  scope: HtmlSnapshotLocatorScope; host: CompositionHtmlEditorialHost;
}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [, refresh] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  const tracking = host.legacyAdoptionTracking?.(scope);
  async function recover(operationId: string, historicalOnly: boolean) {
    if (requestRef.current || !host.adoptLegacy) return;
    const controller = new AbortController(); requestRef.current = controller; setBusy(true); setMessage(null);
    try {
      await host.adoptLegacy({ scope, action: { mode: "RECOVER", operationId, historicalOnly }, signal: controller.signal });
      if (!controller.signal.aborted) setMessage(historicalOnly
        ? "Recibo histórico confirmado. No se restauró el HTML ni se adoptó una revisión anterior."
        : "Adopción confirmada y estado actual verificado. El editor cargó la composición autorizada; esto no confirma paridad de render.");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof HtmlLegacyAdoptionCoordinatorError && error.code === "ACK_REQUIRED"
        ? "No hay recibo confirmado. Conserva el seguimiento; no repitas la adopción ni interpretes el estado actual como confirmación."
        : "No se pudo verificar la adopción. Conserva el seguimiento y recarga explícitamente la composición antes de volver a consultar; no reenvíes la operación.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) { setBusy(false); refresh(value => value + 1); }
      }
    }
  }
  if (!tracking || (tracking.status === "EMPTY" && !message)) return null;
  return <section className="space-y-2 rounded border p-3 text-xs" aria-label="Recuperación de adopción HTML" aria-busy={busy}>
    <h3>Seguimiento de adopción HTML</h3>
    {tracking.status === "UNAVAILABLE" && <p role="alert">Seguimiento no disponible o dañado. No se borrará ni se reenviará.</p>}
    {tracking.status === "PENDING" && <>
      <p>Intento {tracking.entry.command.operationId} · clip {tracking.entry.command.clipId}.</p>
      <p>{tracking.entry.receipt
        ? "Recibo guardado. Verifica de nuevo el resultado autorizado antes de cerrar el seguimiento."
        : "Resultado desconocido. Consulta esta operación sin reenviar ni borrar el seguimiento."}</p>
      <button type="button" disabled={busy || !host.adoptLegacy}
        onClick={() => void recover(tracking.entry.command.operationId, false)}>Verificar adopción sin reenviar</button>
      <p>Si el documento cambió, confirma únicamente el registro histórico. No restaura HTML ni acredita los campos actuales.</p>
      <button type="button" disabled={busy || !host.adoptLegacy}
        onClick={() => void recover(tracking.entry.command.operationId, true)}>Confirmar solo el registro histórico sin restaurar</button>
    </>}
    <button type="button" disabled={busy} onClick={() => refresh(value => value + 1)}>Releer seguimiento de adopción</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
