"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clapperboard, Film, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  NativeCompositionPreview,
  type CompositionStudioAsset,
  type CompositionStudioLesson,
} from "./composition-editor/NativeCompositionPreview";

interface VideoAsset {
  checksum: string;
  durationSeconds?: number;
  eligibleForRevision: boolean;
  metadata: {
    file_name?: string | null;
    source_height?: number | null;
    source_provider?: string | null;
    source_width?: number | null;
  };
  mimeType: string;
  productionAssetId: string;
  fileSizeBytes: number;
  sourceType: "DECK_DEPENDENCY" | "PRODUCTION_MEDIA";
  timelineRole?: "AUDIO" | "AVATAR" | "BROLL" | "VISUAL" | "VOICE";
  timelineVariant?: "CLIP" | "FULL";
  validationErrors: string[];
}

interface VideoComposition {
  active_revision_id: string | null;
  id: string;
  status: "DRAFT" | "READY_FOR_PREVIEW" | "READY_FOR_RENDER" | "ARCHIVED";
}

interface RenderRequest {
  id: string;
  providerStatus: string;
}

type BusyAction = "approve" | "generate" | "render" | "poll" | "prepare" | null;
const CLOUD_ASSET_LIMIT_BYTES = 200 * 1024 * 1024;

export function HyperframesCompositionPanel({
  assistantRequestKey,
  componentId,
  componentTitle,
  lessonLibrary,
  onSelectLesson,
  onVideoCompleted,
  selectedLessonId,
}: {
  assistantRequestKey?: number;
  componentId: string;
  componentTitle: string;
  lessonLibrary: CompositionStudioLesson[];
  onSelectLesson: (componentId: string) => void;
  onVideoCompleted?: () => void;
  selectedLessonId: string | null;
}) {
  const [assets, setAssets] = useState<VideoAsset[]>([]);
  const [composition, setComposition] = useState<VideoComposition | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [renderRequest, setRenderRequest] = useState<RenderRequest | null>(null);
  const [busy, setBusy] = useState<BusyAction>("prepare");
  const [agentInstruction, setAgentInstruction] = useState("");
  const [generationMode, setGenerationMode] = useState<"AUTOMATIC" | "AGENT_ASSISTED">("AUTOMATIC");
  const [animatedDeck, setAnimatedDeck] = useState<{ animationCount: number; slideCount: number } | null>(null);
  const totalAssetBytes = useMemo(() => (
    [...new Map(assets.map((asset) => [asset.checksum, asset])).values()]
      .reduce((total, asset) => total + asset.fileSizeBytes, 0)
  ), [assets]);
  const blockedAssets = useMemo(() => assets.filter((asset) => !asset.eligibleForRevision), [assets]);
  const hasAggregateSizeError = totalAssetBytes > CLOUD_ASSET_LIMIT_BYTES;
  const studioAssets = useMemo<CompositionStudioAsset[]>(() => assets.filter((asset) => asset.sourceType === "PRODUCTION_MEDIA").map((asset) => ({
    durationSeconds: asset.durationSeconds,
    id: asset.productionAssetId,
    isEditable: asset.sourceType === "PRODUCTION_MEDIA",
    label: asset.metadata.file_name || asset.mimeType,
    mimeType: asset.mimeType,
    previewUrl: draftId ? `/api/production/hyperframes/drafts/${draftId}/assets/${asset.productionAssetId}` : null,
    sourceHeight: typeof asset.metadata.source_height === "number" ? asset.metadata.source_height : undefined,
    sourceWidth: typeof asset.metadata.source_width === "number" ? asset.metadata.source_width : undefined,
    sizeLabel: formatBytes(asset.fileSizeBytes),
    sourceLabel: asset.sourceType === "DECK_DEPENDENCY" ? "Recurso interno del deck" : "Medio de Producción",
    timelineRole: asset.timelineRole,
    timelineVariant: asset.timelineVariant,
    valid: asset.eligibleForRevision,
  })), [assets, draftId]);
  const hasAssetSizeErrors = blockedAssets.some((asset) => asset.fileSizeBytes > CLOUD_ASSET_LIMIT_BYTES) || hasAggregateSizeError;
  const sizeErrorMessage = useMemo(() => {
    const names = blockedAssets
      .filter((asset) => asset.fileSizeBytes > CLOUD_ASSET_LIMIT_BYTES)
      .map((asset) => `${asset.metadata.file_name || asset.mimeType} (${formatBytes(asset.fileSizeBytes)})`);
    if (names.length > 0) return `No se puede generar el preview. Exceden el máximo individual de 200 MB: ${names.join(", ")}.`;
    if (hasAggregateSizeError) return `No se puede generar el preview. Los assets suman ${formatBytes(totalAssetBytes)} y el máximo es 200 MB.`;
    return "Hay assets bloqueados que requieren corrección antes de generar el preview.";
  }, [blockedAssets, hasAggregateSizeError, totalAssetBytes]);

  const loadInitialData = useCallback(async () => {
    setBusy("prepare");
    setEditorError(null);
    setSyncWarning(null);
    setAnimatedDeck(null);
    setDraftId(null);
    try {
      try {
        const syncResponse = await fetch("/api/production/hyperframes/assets/sync", {
          body: JSON.stringify({ componentId }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const syncPayload = await syncResponse.json();
        if (!syncResponse.ok) throw new Error(syncPayload.error || "No se pudieron actualizar los assets de Producción.");
        setAnimatedDeck(syncPayload.data?.animatedDeck || null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudieron actualizar los assets de Producción.";
        setSyncWarning(message);
        // Existing registry rows remain usable. A failed refresh must not hide
        // the library or prevent an already traceable composition from opening.
        toast.warning(`${message} Se usarán los assets ya vinculados.`);
      }

      // Asset visibility must not depend on creating the editable draft. If a
      // draft needs repair, the author still sees exactly what Production sent.
      const assetsResponse = await fetch(`/api/production/hyperframes/assets?componentId=${encodeURIComponent(componentId)}&t=${Date.now()}`, { cache: "no-store" });
      const assetsPayload = await assetsResponse.json();
      if (!assetsResponse.ok) throw new Error(assetsPayload.error || "No se pudieron cargar los assets.");
      setAssets(assetsPayload.data as VideoAsset[]);

      const compositionResponse = await fetch("/api/production/hyperframes/compositions", {
        body: JSON.stringify({ componentId, name: componentTitle }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const compositionPayload = await compositionResponse.json();
      if (!compositionResponse.ok) throw new Error(compositionPayload.error || "No se pudo preparar la composición.");
      const nextComposition = compositionPayload.data as VideoComposition;
      setComposition(nextComposition);
      setRevisionId(nextComposition.active_revision_id || null);

      const draftResponse = await fetch(`/api/production/hyperframes/compositions/${nextComposition.id}/draft`, {
        method: "POST",
      });
      const draftPayload = await draftResponse.json();
      if (!draftResponse.ok) {
        const message = draftPayload.error || "No se pudo preparar el proyecto de edición.";
        setEditorError(message);
        toast.error(message);
        return;
      }
      setDraftId(draftPayload.data.draftId as string);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo abrir el estudio de video.";
      setEditorError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }, [componentId, componentTitle]);

  useEffect(() => { void loadInitialData(); }, [loadInitialData]);

  const pollRender = useCallback(async (requestId?: string) => {
    const target = requestId || renderRequest?.id;
    if (!target) return;
    setBusy("poll");
    try {
      const response = await fetch(`/api/production/hyperframes/renders/${target}/poll`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo consultar el render.");
      setRenderRequest((current) => current ? { ...current, providerStatus: payload.data.providerStatus } : current);
      if (payload.data.action === "COMPLETE") {
        toast.success("Video final guardado en Courseforge.");
        onVideoCompleted?.();
      } else if (payload.data.action === "FAIL") {
        toast.error("El servicio de render reportó un fallo.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo consultar el render.");
    } finally {
      setBusy(null);
    }
  }, [onVideoCompleted, renderRequest?.id]);

  useEffect(() => {
    if (!renderRequest || ["completed", "failed", "COMPLETED", "FAILED"].includes(renderRequest.providerStatus)) return;
    const timer = window.setInterval(() => { void pollRender(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [pollRender, renderRequest]);

  const generateRevision = async () => {
    if (!composition) return;
    if (assets.length === 0 && !animatedDeck) return void toast.error("Este video aún no tiene assets válidos desde Producción.");
    if (hasAssetSizeErrors) return void toast.error(sizeErrorMessage);
    setBusy("generate");
    try {
      const response = await fetch(`/api/production/hyperframes/compositions/${composition.id}/revisions`, {
        body: JSON.stringify({ agentInstruction: agentInstruction || undefined, generationMode }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo generar la revisión.");
      setRevisionId(payload.data.id as string);
      setComposition((current) => current ? { ...current, active_revision_id: payload.data.id, status: "READY_FOR_PREVIEW" } : current);
      toast.success(payload.data.warning || "Preview listo para revisión.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo generar la revisión.");
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!composition) return;
    setBusy("approve");
    try {
      const response = await fetch(`/api/production/hyperframes/compositions/${composition.id}/approve`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo aprobar la composición.");
      setComposition((current) => current ? { ...current, status: "READY_FOR_RENDER" } : current);
      toast.success("Composición aprobada para renderizado en la nube.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo aprobar la composición.");
    } finally {
      setBusy(null);
    }
  };

  const submitRender = async () => {
    if (!revisionId || composition?.status !== "READY_FOR_RENDER") return void toast.error("Aprueba el preview antes de enviar un render.");
    setBusy("render");
    try {
      const response = await fetch("/api/production/hyperframes/renders", {
        body: JSON.stringify({ aspectRatio: "16:9", format: "mp4", quality: "high", resolution: "1080p", revisionId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo enviar el render.");
      const request = { id: payload.data.renderRequestId as string, providerStatus: payload.data.providerStatus as string };
      setRenderRequest(request);
      toast.success(payload.data.reused ? "Render existente recuperado." : "Render enviado.");
      void pollRender(request.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo enviar el render.");
    } finally {
      setBusy(null);
    }
  };

  // Render submission is deliberately held for the publishing phase; retain these
  // handlers while the native editor supplies the versioned composition snapshot.
  void generateRevision;
  void approve;
  void submitRender;

  return (
    <section className={draftId ? "flex h-full min-h-0 flex-col [&>p]:hidden" : "space-y-5 rounded-xl border border-[#00D4B3]/40 bg-[#00D4B3]/5 p-4 dark:border-[#00D4B3]/25 dark:bg-[#00D4B3]/[0.04]"}>
      <div className={draftId ? "hidden" : "flex flex-wrap items-start justify-between gap-3"}>
        <div>
          <h4 className="flex items-center gap-2 text-base font-bold text-[#0A2540] dark:text-[#00D4B3]"><Sparkles size={17} /> Estudio de video</h4>
          <p className="mt-1 text-xs text-slate-600 dark:text-gray-400">Los assets vienen del paso de Producción y se vinculan automáticamente al video seleccionado.</p>
        </div>
        <button type="button" onClick={() => void loadInitialData()} disabled={busy !== null} className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white" title="Actualizar assets"><RefreshCw className={busy === "prepare" ? "animate-spin" : ""} size={15} /></button>
      </div>

      <div className={draftId ? "hidden" : "rounded-lg border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-[#0F1419]"}>
        <div className="mb-2 flex items-center justify-between gap-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-gray-400">Assets vinculados ({assets.length})</p><span className={`text-[11px] ${hasAggregateSizeError ? "font-semibold text-red-700 dark:text-red-300" : "text-slate-500 dark:text-gray-500"}`}>{formatBytes(totalAssetBytes)} en total</span></div>
        {busy === "prepare" ? <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400"><Loader2 className="animate-spin" size={14} /> Preparando assets de Producción…</p> : assets.length === 0 && !animatedDeck ? <p className="text-xs text-amber-700 dark:text-amber-300">No hay medios internos compatibles para este video. Agrégalos en el paso de Producción y vuelve aquí.</p> : <><div className="grid max-h-44 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">{assets.map((asset) => <div key={asset.productionAssetId} className={`rounded-lg border p-2 text-xs ${asset.eligibleForRevision ? "border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-300" : "border-red-300 bg-red-50 text-red-900 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-100"}`}><div className="flex items-center gap-2"><Film size={13} className={`shrink-0 ${asset.eligibleForRevision ? "text-cyan-600 dark:text-cyan-300" : "text-red-600 dark:text-red-300"}`} /><span className="min-w-0 flex-1 truncate">{asset.metadata.file_name || asset.mimeType}</span><span className="text-[10px]">{formatBytes(asset.fileSizeBytes)}</span></div><p className="mt-1 text-[10px] text-slate-500 dark:text-gray-400">{asset.sourceType === "DECK_DEPENDENCY" ? "Recurso interno del deck HTML" : "Medio cargado en Producción"}</p>{asset.validationErrors.map((error) => <p key={error} className="mt-1 text-[10px] leading-4 text-red-700 dark:text-red-200">{error}</p>)}</div>)}</div>{hasAssetSizeErrors && <div role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-100"><p className="flex items-center gap-2 font-bold"><AlertTriangle size={15} /> Preview bloqueado por límite de espacio</p><p className="mt-1 leading-5">{sizeErrorMessage}</p>{hasAggregateSizeError && <p className="mt-1 leading-5">El conjunto trazable ocupa {formatBytes(totalAssetBytes)}; el límite del render es 200 MB.</p>}</div>}{animatedDeck && <p className="mt-2 text-xs text-cyan-700 dark:text-cyan-300">Deck HTML animado: {animatedDeck.slideCount} diapositivas · {animatedDeck.animationCount} animaciones. Se mantiene como HTML, no se rasteriza.</p>}</>}
      </div>

      <div className={draftId ? "hidden" : "grid gap-3 md:grid-cols-2"}>
        <label className="text-xs text-slate-600 dark:text-gray-400">Modo de creación<select value={generationMode} onChange={(event) => setGenerationMode(event.target.value as "AUTOMATIC" | "AGENT_ASSISTED")} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"><option value="AUTOMATIC">Automático</option><option value="AGENT_ASSISTED">Asistido por agente</option></select></label>
        <label className="text-xs text-slate-600 dark:text-gray-400">Instrucción al agente (opcional)<input value={agentInstruction} onChange={(event) => setAgentInstruction(event.target.value)} maxLength={1000} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-white/10 dark:bg-[#0F1419] dark:text-white" placeholder="Ej. tono sobrio y directo" /></label>
      </div>

      <p className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-100">El preview completo se actualiza automáticamente después de cada edición. El envío a render se volverá a conectar en la siguiente fase, cuando pueda generar un snapshot exacto de esta versión.</p>

      {syncWarning && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">No se pudo actualizar el registro de assets: {syncWarning} Se muestran los assets vinculados previamente.</p>}
      {editorError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-100">No se pudo preparar el editor: {editorError}</p>}
      {draftId && (
        <div className="min-h-0 flex-1">
          <NativeCompositionPreview assistantRequestKey={assistantRequestKey} assets={studioAssets} compositionId={composition?.id || ""} draftId={draftId} lessons={lessonLibrary} onSelectLesson={onSelectLesson} onVideoCompleted={onVideoCompleted} selectedLessonId={selectedLessonId} />
        </div>
      )}
      {renderRequest?.providerStatus.toLowerCase() === "completed" && <p className="flex items-center gap-2 text-xs font-medium text-green-700 dark:text-green-400"><CheckCircle2 size={15} /> Video final importado en Courseforge.</p>}
    </section>
  );
}

function ActionButton({ active, disabled, label, onClick, primary = false }: { active: boolean; disabled: boolean; label: string; onClick: () => void; primary?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${primary ? "bg-[#0A2540] text-white hover:bg-[#0d2f4d]" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-white/10 dark:bg-[#0F1419] dark:text-gray-200 dark:hover:bg-white/10"}`}>{active ? <Loader2 className="animate-spin" size={14} /> : <Clapperboard size={14} />}{label}</button>;
}

void ActionButton;

function formatBytes(value: number) {
  return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : value ? `${Math.max(1, Math.round(value / 1024))} KB` : "0 KB";
}
