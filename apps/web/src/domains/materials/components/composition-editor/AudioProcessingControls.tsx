"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { AudioSourceCapability } from "@/domains/production/audio-processing/audio-source-policy";

interface AudioProcessingControlsProps {
  componentId: string;
  disabled: boolean;
  sourceAssetId: string;
  sourcePreviewUrl: string | null;
  onReplaceAudio: (assetId: string, durationSeconds: number) => Promise<boolean>;
}

type AudioJobResponse = {
  data?: {
    capability?: AudioSourceCapability;
    source?: { assetId: string; publicUrl: string | null; durationSeconds: number | null };
    processedAudio?: { assetId: string; publicUrl: string | null; durationSeconds: number | null } | null;
    job?: { id: string; provider_error?: { message?: string } | null; status: string } | null;
    jobId?: string;
    status?: string;
  };
  message?: string;
  success?: boolean;
};

const ACTIVE_STATUSES = new Set(["PENDING", "QUEUED", "RETRY_SCHEDULED", "RUNNING"]);
const WORKER_ERROR_MESSAGES: Record<string, string> = {
  AUDIO_SOURCE_DOWNLOAD_FAILED: "No se pudo descargar la narración. Revisa el almacenamiento y vuelve a intentar.",
  AUDIO_SOURCE_CHECKSUM_MISMATCH: "El archivo cambió y no coincide con su registro de integridad.",
  AUDIO_SOURCE_PROBE_FAILED: "El archivo está dañado o no se puede leer como audio.",
  AUDIO_SOURCE_HAS_NO_AUDIO: "El archivo no contiene una pista de audio.",
  AUDIO_SOURCE_CODEC_UNSUPPORTED: "El códec del archivo no es compatible con el tratamiento de voz.",
  AUDIO_SOURCE_VIDEO_NOT_SUPPORTED: "Separa primero la voz del video para poder procesarla.",
  AUDIO_SOURCE_DURATION_TOO_LARGE: "El tratamiento admite narraciones de hasta 30 minutos.",
  AUDIO_SOURCE_SIZE_INVALID: "La narración debe pesar entre 1 byte y 50 MB.",
};

export function AudioProcessingControls({ componentId, disabled, sourceAssetId, sourcePreviewUrl, onReplaceAudio }: AudioProcessingControlsProps) {
  const [response, setResponse] = useState<AudioJobResponse["data"]>();
  const [requesting, setRequesting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [jobId, setJobId] = useState<string>();
  const [pollRequest, setPollRequest] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const jobStatus = response?.status || response?.job?.status || "NOT_REQUESTED";

  useEffect(() => () => requestController.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const query = new URLSearchParams({ componentId, sourceAssetId, ...(jobId ? { jobId } : {}) });
        const result = await fetch(`/api/production/audio-processing/jobs?${query}`, { cache: "no-store", signal: controller.signal });
        const body = await result.json() as AudioJobResponse;
        if (!result.ok || !body.success) throw new Error(body.message || "No se pudo consultar el procesamiento de audio.");
        if (controller.signal.aborted) return;
        setResponse(body.data);
        setError(null);
        if (ACTIVE_STATUSES.has(body.data?.status || body.data?.job?.status || "")) timer = setTimeout(load, 4_000);
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "No se pudo consultar el procesamiento de audio.");
      }
    };
    void load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [componentId, jobId, pollRequest, sourceAssetId]);

  const requestProcessing = async () => {
    if (requestController.current) return;
    const controller = new AbortController();
    requestController.current = controller;
    setRequesting(true);
    setError(null);
    try {
      const result = await fetch("/api/production/audio-processing/jobs", {
        body: JSON.stringify({ componentId, profileId: "voice-course-v1", sourceAssetId, retryFailed: jobStatus === "FAILED" }),
        headers: { "Content-Type": "application/json" }, method: "POST", signal: controller.signal,
      });
      const body = await result.json() as AudioJobResponse;
      if (!result.ok || !body.success || !body.data?.jobId) throw new Error(body.message || "No se pudo encolar el procesamiento de audio.");
      if (controller.signal.aborted) return;
      setJobId(body.data.jobId);
      setResponse((previous) => ({ ...previous, processedAudio: null, job: { id: body.data!.jobId!, status: body.data?.status || "PENDING" }, status: body.data?.status || "PENDING" }));
      setPollRequest((value) => value + 1);
    } catch (requestError) {
      if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "No se pudo encolar el procesamiento de audio.");
    } finally {
      requestController.current = null;
      if (!controller.signal.aborted) setRequesting(false);
    }
  };

  const replaceAudio = async (assetId: string, durationSeconds: number) => {
    setApplying(true);
    try {
      const applied = await onReplaceAudio(assetId, durationSeconds);
      if (!applied) setError("No se pudo cambiar el audio. Revisa el mensaje del editor.");
    } catch { setError("No se pudo cambiar el audio. Vuelve a intentar."); }
    finally { setApplying(false); }
  };
  const original = response?.source;
  const processed = response?.processedAudio;
  const isProcessedSelected = original && sourceAssetId !== original.assetId;
  const processedUrl = processed?.publicUrl || null;
  const busy = disabled || requesting || applying;
  const workerErrorCode = response?.job?.provider_error?.message || "";
  return <section className="border-t border-slate-200 pt-3 dark:border-white/10">
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Tratamiento de voz</p>
    <p className="mt-1 text-[10px] leading-4 text-slate-500 dark:text-gray-400">Voz de curso aplica filtro de graves, compresión, limitador y normalización a −16 LUFS. Procesa la narración original completa y conserva los recortes al aplicarla.</p>
    <button type="button" disabled={busy || response?.capability?.eligible !== true || ACTIVE_STATUSES.has(jobStatus)} onClick={() => void requestProcessing()} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-cyan-300 bg-cyan-50 px-2.5 py-1.5 text-xs font-bold text-cyan-800 disabled:opacity-50 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200">
      {requesting || ACTIVE_STATUSES.has(jobStatus) ? <Loader2 className="animate-spin" size={13} /> : <Sparkles size={13} />}
      {requesting ? "Encolando…" : ACTIVE_STATUSES.has(jobStatus) ? `Procesando · ${jobStatus}` : jobStatus === "FAILED" ? "Reintentar tratamiento" : "Procesar voz"}
    </button>
    {response?.capability?.eligible === false && <p role="status" className="mt-2 text-[10px] text-amber-700 dark:text-amber-200">{response.capability.reason}</p>}
    {jobStatus === "FAILED" && <p role="alert" className="mt-2 text-[10px] text-red-700 dark:text-red-200">{WORKER_ERROR_MESSAGES[workerErrorCode] || "El procesamiento falló. Revisa el archivo original antes de reintentar."}</p>}
    {error && <p role="alert" className="mt-2 text-[10px] text-red-700 dark:text-red-200">{error}<button type="button" disabled={busy} className="ml-2 underline" onClick={() => setPollRequest((value) => value + 1)}>Volver a consultar</button></p>}
    <div className="mt-3 grid gap-2"><AudioPreview label="Original" url={original?.publicUrl || (!isProcessedSelected ? sourcePreviewUrl : null)} />{processedUrl && <AudioPreview label="Procesado" url={processedUrl} />}</div>
    {processed && processed.assetId !== sourceAssetId && processed.durationSeconds && <button type="button" disabled={busy} onClick={() => void replaceAudio(processed.assetId, processed.durationSeconds!)} className="mt-2 text-xs font-bold text-cyan-700 dark:text-cyan-200">Usar audio procesado</button>}
    {isProcessedSelected && original.durationSeconds && <button type="button" disabled={busy} onClick={() => void replaceAudio(original.assetId, original.durationSeconds!)} className="mt-2 text-xs font-bold text-amber-700 dark:text-amber-200">Restaurar voz original conservando ediciones</button>}
    {processedUrl && <p className="mt-2 text-[10px] text-emerald-700 dark:text-emerald-300">Compara ambos audios antes de usar el resultado. El original permanece disponible.</p>}
  </section>;
}

function AudioPreview({ label, url }: { label: string; url: string | null }) {
  if (!url) return null;
  return <label className="text-[10px] font-medium text-slate-600 dark:text-gray-300"><span>{label}</span><audio className="mt-1 h-7 w-full" controls preload="metadata" src={url} /></label>;
}
