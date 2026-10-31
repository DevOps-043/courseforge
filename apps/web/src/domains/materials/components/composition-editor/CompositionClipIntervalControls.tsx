"use client";

import { useEffect, useRef, useState } from "react";
import type { CompositionClip } from "@/domains/production/composition-editor/composition-document.types";
import { formatCompositionTimecode, parseCompositionTimecode } from "@/domains/production/composition-editor/composition-timecode";
import { buildCompositionClipExportPlan } from "@/domains/production/composition-editor/composition-clip-export-plan";

type ExportSource = { clip: CompositionClip; sourceUrl: string };

export function CompositionClipIntervalControls({ clip, disabled, onRemoveInterval, onPrepareExport }: {
  clip: CompositionClip; disabled: boolean;
  onRemoveInterval: (startSeconds: number, endSeconds: number) => Promise<boolean>;
  onPrepareExport: () => Promise<ExportSource>;
}) {
  const [start, setStart] = useState("00:00");
  const [end, setEnd] = useState(formatCompositionTimecode(clip.durationSeconds));
  const [activity, setActivity] = useState<"IDLE" | "REMOVE" | "EXPORT">("IDLE");
  const busy = activity !== "IDLE";
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);
  const canExport = (clip.kind === "VIDEO" || clip.kind === "AUDIO") && clip.source.type === "PRODUCTION_ASSET";

  async function removeInterval() {
    const first = parseCompositionTimecode(start);
    const last = parseCompositionTimecode(end);
    if (first === null || last === null || first >= last || last > clip.durationSeconds + 0.001) {
      setError("Indica un inicio y un fin válidos dentro de la duración del clip.");
      return;
    }
    setError(null);
    setNotice(null);
    setActivity("REMOVE");
    try { await onRemoveInterval(clip.startSeconds + first, clip.startSeconds + last); }
    catch { setError("No se pudo guardar el intervalo. Revisa el estado de guardado e inténtalo nuevamente."); }
    finally { setActivity("IDLE"); }
  }

  async function downloadClip() {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setNotice(null);
    setProgress(0);
    setActivity("EXPORT");
    try {
      const source = await onPrepareExport();
      controller.signal.throwIfAborted();
      const plan = buildCompositionClipExportPlan(source.clip);
      const { exportCompositionClip } = await import("@/domains/production/composition-editor/composition-clip-export.client");
      const file = await exportCompositionClip({ plan, sourceUrl: source.sourceUrl, signal: controller.signal, onProgress: setProgress });
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice(`Descarga preparada: ${file.name}`);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error && caught.name === "TimeoutError"
        ? "La exportación agotó el tiempo disponible. Reduce la duración e inténtalo nuevamente."
        : "No se pudo exportar el clip. " + (caught instanceof Error && !/https?:\/\//i.test(caught.message) ? caught.message : "Renueva el preview y vuelve a intentarlo."));
    } finally {
      if (!controller.signal.aborted) { setActivity("IDLE"); controllerRef.current = null; }
    }
  }

  return <section aria-label="Intervalos y descarga del clip" className="mb-4 space-y-2 rounded-lg border border-slate-200 p-3 text-xs dark:border-white/10">
    <p className="font-semibold">Recortar y descargar clip</p>
    <p className="text-slate-500 dark:text-gray-400">Intervalo a eliminar desde el inicio de este clip (duración {formatCompositionTimecode(clip.durationSeconds)}). Un corte central deja dos clips independientes.</p>
    <div className="grid grid-cols-2 gap-2">
      <label>Inicio del intervalo<input aria-label="Inicio del intervalo" className="mt-1 w-full rounded border bg-transparent p-1" disabled={disabled || busy} value={start} onChange={event => setStart(event.target.value)} /></label>
      <label>Fin del intervalo<input aria-label="Fin del intervalo" className="mt-1 w-full rounded border bg-transparent p-1" disabled={disabled || busy} value={end} onChange={event => setEnd(event.target.value)} /></label>
    </div>
    <button type="button" className="rounded border px-2 py-1" disabled={disabled || busy} onClick={() => void removeInterval()}>Eliminar intervalo del clip</button>
    {canExport && <>
      <p className="text-slate-500 dark:text-gray-400">Descarga solo el fragmento seleccionado, con sus recortes temporales. No incluye efectos visuales ni mezcla del ensamble. MP4 para video · WAV para audio.</p>
      <button type="button" className="rounded border px-2 py-1" disabled={disabled || busy} onClick={() => void downloadClip()}>Descargar clip recortado</button>
      {activity === "EXPORT" && <div role="status">Exportando… {Math.round(progress * 100)}% <button type="button" className="underline" onClick={() => {
        controllerRef.current?.abort(); controllerRef.current = null; setActivity("IDLE"); setNotice("Exportación cancelada.");
      }}>Cancelar exportación</button></div>}
    </>}
    {error && <p role="alert" className="text-red-600 dark:text-red-300">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
