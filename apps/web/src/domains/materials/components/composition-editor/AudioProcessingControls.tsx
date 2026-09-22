"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

interface AudioProcessingControlsProps {
  componentId: string;
  disabled: boolean;
  sourceAssetId: string;
  sourcePreviewUrl: string | null;
}

type AudioJobResponse = {
  data?: {
    processedAudio?: { assetId: string; publicUrl: string | null } | null;
    job?: { id: string; provider_error?: { message?: string } | null; status: string } | null;
    status?: string;
  };
  message?: string;
  success?: boolean;
};

const ACTIVE_STATUSES = new Set(["PENDING", "QUEUED", "RETRY_SCHEDULED", "RUNNING"]);

export function AudioProcessingControls({ componentId, disabled, sourceAssetId, sourcePreviewUrl }: AudioProcessingControlsProps) {
  const [response, setResponse] = useState<AudioJobResponse["data"]>();
  const [requesting, setRequesting] = useState(false);
  const [pollRequest, setPollRequest] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const jobStatus = response?.status || response?.job?.status || "NOT_REQUESTED";

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const result = await fetchJob(componentId, sourceAssetId);
        if (cancelled) return;
        setResponse(result.data);
        if (ACTIVE_STATUSES.has(result.data?.status || result.data?.job?.status || "")) timer = setTimeout(load, 4_000);
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "No se pudo consultar el procesamiento de audio.");
      }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [componentId, pollRequest, sourceAssetId]);

  const requestProcessing = async () => {
    setRequesting(true);
    setError(null);
    try {
      const result = await fetch("/api/production/audio-processing/jobs", {
        body: JSON.stringify({ componentId, profileId: "voice-course-v1", sourceAssetId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = await result.json() as AudioJobResponse;
      if (!result.ok || !body.success) throw new Error(body.message || "No se pudo encolar el procesamiento de audio.");
      setResponse({ job: { id: body.data?.job?.id || "", status: body.data?.status || "PENDING" }, status: body.data?.status || "PENDING" });
      setPollRequest((value) => value + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo encolar el procesamiento de audio.");
    } finally {
      setRequesting(false);
    }
  };

  const processedUrl = response?.processedAudio?.publicUrl || null;
  return <section className="border-t border-slate-200 pt-3 dark:border-white/10">
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Tratamiento de voz</p>
    <p className="mt-1 text-[10px] leading-4 text-slate-500 dark:text-gray-400">Voz de curso aplica filtro de graves, compresión, limitador y normalización a −16 LUFS. No modifica el original.</p>
    <button type="button" disabled={disabled || requesting || ACTIVE_STATUSES.has(jobStatus)} onClick={() => void requestProcessing()} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-cyan-300 bg-cyan-50 px-2.5 py-1.5 text-xs font-bold text-cyan-800 disabled:opacity-50 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200">
      {requesting || ACTIVE_STATUSES.has(jobStatus) ? <Loader2 className="animate-spin" size={13} /> : <Sparkles size={13} />}
      {requesting ? "Encolando…" : ACTIVE_STATUSES.has(jobStatus) ? `Procesando · ${jobStatus}` : "Procesar voz"}
    </button>
    {jobStatus === "FAILED" && <p role="alert" className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-[10px] text-red-700 dark:bg-red-500/10 dark:text-red-200">{response?.job?.provider_error?.message || "El procesamiento falló. Puedes reintentarlo."}</p>}
    {error && <p role="alert" className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-[10px] text-red-700 dark:bg-red-500/10 dark:text-red-200">{error}</p>}
    {(sourcePreviewUrl || processedUrl) && <div className="mt-3 grid gap-2"><AudioPreview label="Original" url={sourcePreviewUrl} />{processedUrl && <AudioPreview label="Procesado" url={processedUrl} />}</div>}
    {processedUrl && <p className="mt-2 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">Resultado listo para QA. Compáralo con el original antes de usarlo en la composición.</p>}
  </section>;
}

function AudioPreview({ label, url }: { label: string; url: string | null }) {
  if (!url) return null;
  return <label className="text-[10px] font-medium text-slate-600 dark:text-gray-300"><span>{label}</span><audio className="mt-1 h-7 w-full" controls preload="metadata" src={url} /></label>;
}

async function fetchJob(componentId: string, sourceAssetId: string): Promise<AudioJobResponse> {
  const query = new URLSearchParams({ componentId, sourceAssetId });
  const response = await fetch(`/api/production/audio-processing/jobs?${query.toString()}`, { cache: "no-store" });
  const body = await response.json() as AudioJobResponse;
  if (!response.ok || !body.success) throw new Error(body.message || "No se pudo consultar el procesamiento de audio.");
  return body;
}
