"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Loader2, Square, Timer } from "lucide-react";
import {
  formatRenderElapsed, isRenderTerminal, renderElapsedSeconds, renderStageLabel,
  type HyperframesRenderDiagnostics,
} from "@/domains/production/hyperframes/hyperframes-render-diagnostics";

const STAGES: Record<string, string> = {
  created: "Solicitud registrada", queued: "En cola de HeyGen", pending: "En cola de HeyGen",
  uploading: "Subiendo ZIP", submitting: "Creando render", rendering: "Renderizando en HeyGen",
  running: "Renderizando en HeyGen", provider_completed: "HeyGen terminó el render",
  importing: "Importando video", import_queued: "Importación en cola", import_uploading: "Guardando video",
  import_retry_scheduled: "Reintento de importación programado", import_failed: "Falló la importación",
  failed: "Render fallido", completed: "Video disponible", import_completed: "Video importado", cancelled: "Cancelado",
};
const bytes = (value: number) => value < 1024 * 1024
  ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 / 1024).toFixed(1)} MiB`;

type KnownRenderStatus = "idle" | "validating" | "sending" | "rendering" | "completed" | "failed" | "cancelled";

export function RenderDiagnosticsPanel({ requestId, pendingStartedAt, knownStatus, onCancelled }: {
  requestId: string | null;
  pendingStartedAt: string | null;
  knownStatus: KnownRenderStatus;
  onCancelled: () => void;
}) {
  const [data, setData] = useState<HyperframesRenderDiagnostics | null>(null);
  const [now, setNow] = useState(Date.now);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const generation = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    const version = ++generation.current;
    setData(null); setConnectionError(null); setCancelError(null); setCancelling(false);
    if (!requestId) return;
    let inFlight = false;
    let terminal = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (inFlight || terminal || controller.signal.aborted) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/production/hyperframes/renders/${encodeURIComponent(requestId)}/diagnostics`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
        });
        const body = await response.json();
        if (!response.ok || !body.data) throw new Error(body.error || `Error HTTP ${response.status}`);
        if (generation.current !== version || controller.signal.aborted) return;
        setData(body.data); setConnectionError(null);
        terminal = isRenderTerminal(body.data);
      } catch (error) {
        if (!controller.signal.aborted && generation.current === version) {
          setConnectionError(error instanceof Error ? error.message : "No se pudo actualizar el diagnóstico.");
        }
      } finally { inFlight = false; }
    };
    refreshRef.current = refresh;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [requestId]);

  const terminal = data
    ? isRenderTerminal(data)
    : knownStatus === "completed" || knownStatus === "failed" || knownStatus === "cancelled";
  useEffect(() => {
    if (terminal || (!requestId && !pendingStartedAt)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [terminal, requestId, pendingStartedAt]);

  const cancel = useCallback(async () => {
    if (!requestId || cancelling) return;
    const version = generation.current;
    setCancelling(true); setCancelError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/renders/${encodeURIComponent(requestId)}/cancel`, {
        method: "POST", signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json();
      if (generation.current !== version) return;
      if (!response.ok) throw new Error(body.error || "No se pudo cancelar el proceso.");
      onCancelled();
      await refreshRef.current();
    } catch (error) {
      if (generation.current !== version) return;
      setCancelError(error instanceof Error ? error.message : "No se pudo cancelar el proceso.");
      await refreshRef.current();
    } finally { if (generation.current === version) setCancelling(false); }
  }, [requestId, cancelling, onCancelled]);

  if (!requestId && !pendingStartedAt) return null;
  const elapsed = renderElapsedSeconds(data?.createdAt || pendingStartedAt || "", data?.finishedAt || null, now);
  const silence = data ? renderElapsedSeconds(data.lastActivityAt, null, now) : 0;
  const stalled = !terminal && silence >= 300;
  const longRunning = !terminal && elapsed >= 1800;
  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...data, observedAt: new Date(now).toISOString(), connectionError }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `render-${data.requestId}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return <section aria-label="Diagnóstico del render" className="mt-3 min-w-0 rounded-xl border border-slate-300/50 bg-slate-50/80 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5"><Timer size={14} /> Tiempo total</span>
      <output aria-label="Tiempo de render" className="font-mono text-base font-semibold tabular-nums">{formatRenderElapsed(elapsed)}</output>
    </div>
    <p className="mt-1 font-medium">{data
      ? renderStageLabel(data.providerStatus, data.importStatus, data.cancelledAt)
      : knownStatus === "failed"
        ? "Recuperando el diagnóstico del fallo…"
        : knownStatus === "completed"
          ? "Recuperando el diagnóstico final…"
          : knownStatus === "cancelled"
            ? "Recuperando el diagnóstico de la cancelación…"
            : "Recuperando estado del proceso…"}</p>
    {data && <div className="mt-2 space-y-1 text-[11px]">
      <p>ZIP: {bytes(data.archiveSizeBytes)} · Intentos de importación: {data.attempts} · Fallos: {data.failures}</p>
      {data.sourceSizeBytes !== null && <>
        <p>Video guardado: {bytes(data.uploadedBytes)} / {bytes(data.sourceSizeBytes)}</p>
        <progress aria-label="Video importado" value={data.uploadedBytes} max={data.sourceSizeBytes} className="h-1.5 w-full accent-teal-500" />
      </>}
      <p>Última actividad: {new Date(data.lastActivityAt).toLocaleTimeString()}</p>
      {!terminal && data.nextAttemptAt && <p>Próximo intento: {new Date(data.nextAttemptAt).toLocaleTimeString()}</p>}
    </div>}
    {(stalled || longRunning) && <p role="status" className="mt-2 flex gap-1 text-amber-700 dark:text-amber-300"><AlertTriangle size={14} className="shrink-0" />{stalled ? "Sin actividad registrada durante al menos 5 minutos." : "El proceso lleva más de 30 minutos."} Puedes revisar la consola o cancelar.</p>}
    {data?.error && !data.cancelledAt && <p role="alert" className="mt-2 break-words text-red-700 dark:text-red-300">
      {data.importStatus.toUpperCase() === "FAILED" && data.providerStatus.toUpperCase() === "COMPLETED"
        ? `HeyGen terminó el render, pero la importación del video fue rechazada: ${data.error}`
        : data.error}
    </p>}
    {connectionError && <p role="alert" className="mt-2 break-words text-amber-700 dark:text-amber-300">Estado sin confirmar: {connectionError} Se volverá a consultar.</p>}
    {cancelError && <p role="alert" className="mt-2 text-red-700 dark:text-red-300">{cancelError}</p>}
    {requestId && !terminal && <>
      <button type="button" onClick={() => void cancel()} disabled={cancelling} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-red-700 disabled:opacity-50 dark:text-red-300">
        {cancelling ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />} {cancelling ? "Cancelando…" : "Cancelar proceso"}
      </button>
      <p className="mt-1 text-[10px] opacity-75">SofLIA Engine detendrá la importación y los reintentos. Un procesamiento remoto ya iniciado puede continuar.</p>
    </>}
    <details className="mt-3" open={Boolean(data?.error || connectionError)}>
      <summary className="cursor-pointer font-medium">Consola de diagnóstico ({data?.events.length || 0})</summary>
      <div role="log" aria-label="Eventos del render" aria-live="off" className="mt-2 max-h-52 overflow-auto rounded-lg bg-slate-950 p-2 font-mono text-[10px] text-slate-200">
        {data?.events.map((event, index) => <p key={`${event.at}-${index}`} className={`mb-1 break-words ${event.level === "error" ? "text-red-300" : ""}`}>
          {new Date(event.at).toLocaleTimeString()} [{STAGES[event.stage] || event.stage}] {STAGES[event.message] || event.message}
        </p>)}
        {!data && <p>Esperando diagnóstico del servidor.</p>}
      </div>
      {data && <>
        <p className="mt-1 break-all text-[10px] opacity-70">Solicitud: {data.requestId}<br />HeyGen: {data.providerRenderId || "Todavía no asignado"}</p>
        <button type="button" onClick={download} className="mt-2 flex items-center gap-1 underline"><Download size={12} /> Descargar diagnóstico</button>
      </>}
    </details>
  </section>;
}
