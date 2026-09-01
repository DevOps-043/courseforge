"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    asset_display_name?: string | null;
    detached_from_asset_id?: string | null;
    detached_from_clip_id?: string | null;
    file_name?: string | null;
    source_height?: number | null;
    source_provider?: string | null;
    source_width?: number | null;
  };
  mimeType: string;
  productionAssetId: string;
  fileSizeBytes: number;
  hasAudio?: boolean;
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
type PreparationStep = "SYNCING_ASSETS" | "LOADING_ASSETS" | "PREPARING_COMPOSITION" | "OPENING_EDITOR" | "READY";

export function HyperframesCompositionPanel({
  componentId,
  componentTitle,
  lessonLibrary,
  onContinueToPublication,
  onSelectLesson,
  onVideoCompleted,
  selectedLessonId,
}: {
  componentId: string;
  componentTitle: string;
  lessonLibrary: CompositionStudioLesson[];
  onContinueToPublication?: () => void;
  onSelectLesson: (componentId: string) => void;
  onVideoCompleted?: () => void;
  selectedLessonId: string | null;
}) {
  const [assets, setAssets] = useState<VideoAsset[]>([]);
  const [composition, setComposition] = useState<VideoComposition | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftDocumentVersion, setDraftDocumentVersion] = useState<number | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [renderRequest, setRenderRequest] = useState<RenderRequest | null>(null);
  const [busy, setBusy] = useState<BusyAction>("prepare");
  const [preparationStep, setPreparationStep] = useState<PreparationStep>("SYNCING_ASSETS");
  const [animatedDeck, setAnimatedDeck] = useState<{ animationCount: number; slideCount: number } | null>(null);
  const sceneAssetFingerprintRef = useRef<string | null>(null);
  const sceneAssetRefreshInFlightRef = useRef(false);
  const [pendingHeygenClipCount, setPendingHeygenClipCount] = useState(0);
  const uniqueAssets = useMemo(() => (
    [...new Map(assets.map((asset) => [asset.productionAssetId, asset])).values()]
  ), [assets]);
  const totalAssetBytes = useMemo(() => (
    [...new Map(uniqueAssets.map((asset) => [asset.checksum, asset])).values()]
      .reduce((total, asset) => total + asset.fileSizeBytes, 0)
  ), [uniqueAssets]);
  const blockedAssets = useMemo(() => uniqueAssets.filter((asset) => !asset.eligibleForRevision), [uniqueAssets]);
  const studioAssets = useMemo<CompositionStudioAsset[]>(() => uniqueAssets.filter((asset) => asset.sourceType === "PRODUCTION_MEDIA").map((asset) => ({
    durationSeconds: asset.durationSeconds,
    detachedFromAssetId: asset.metadata.detached_from_asset_id || undefined,
    detachedFromClipId: asset.metadata.detached_from_clip_id || undefined,
    hasAudio: asset.hasAudio,
    id: asset.productionAssetId,
    isEditable: asset.sourceType === "PRODUCTION_MEDIA",
    label: asset.metadata.asset_display_name || asset.metadata.file_name || asset.mimeType,
    mimeType: asset.mimeType,
    previewUrl: draftId ? `/api/production/hyperframes/drafts/${draftId}/assets/${asset.productionAssetId}` : null,
    sourceHeight: typeof asset.metadata.source_height === "number" ? asset.metadata.source_height : undefined,
    sourceWidth: typeof asset.metadata.source_width === "number" ? asset.metadata.source_width : undefined,
    sizeLabel: formatBytes(asset.fileSizeBytes),
    sourceLabel: asset.sourceType === "DECK_DEPENDENCY" ? "Recurso interno del deck" : "Medio de Producción",
    timelineRole: asset.timelineRole,
    timelineVariant: asset.timelineVariant,
    valid: asset.eligibleForRevision,
  })), [draftId, uniqueAssets]);
  const hasAssetSizeErrors = blockedAssets.length > 0;
  const sizeErrorMessage = useMemo(() => {
    const names = blockedAssets.map((asset) => asset.metadata.file_name || asset.mimeType);
    return names.length > 0
      ? `Hay assets que requieren corrección antes de generar el preview: ${names.join(", ")}.`
      : "Hay assets bloqueados que requieren corrección antes de generar el preview.";
  }, [blockedAssets]);

  const refreshAssets = useCallback(async () => {
    const response = await fetch(`/api/production/hyperframes/assets?componentId=${encodeURIComponent(componentId)}&t=${Date.now()}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "No se pudieron actualizar los assets del editor.");
    setAssets(payload.data as VideoAsset[]);
  }, [componentId]);

  const loadInitialData = useCallback(async () => {
    setBusy("prepare");
    setPreparationStep("SYNCING_ASSETS");
    setEditorError(null);
    setSyncWarning(null);
    setAnimatedDeck(null);
    setDraftId(null);
    setDraftDocumentVersion(null);
    sceneAssetFingerprintRef.current = null;
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
        setPendingHeygenClipCount(Number(syncPayload.data?.heygenPendingClipCount) || 0);
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudieron actualizar los assets de Producción.";
        setSyncWarning(message);
        // Existing registry rows remain usable. A failed refresh must not hide
        // the library or prevent an already traceable composition from opening.
        toast.warning(`${message} Se usarán los assets ya vinculados.`);
      }

      // Asset visibility must not depend on creating the editable draft. If a
      // draft needs repair, the author still sees exactly what Production sent.
      setPreparationStep("LOADING_ASSETS");
      await refreshAssets();

      setPreparationStep("PREPARING_COMPOSITION");
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

      setPreparationStep("OPENING_EDITOR");
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
      setDraftDocumentVersion(draftPayload.data.documentVersion as number);
      setPreparationStep("READY");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo abrir el estudio de video.";
      setEditorError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }, [componentId, componentTitle, refreshAssets]);

  useEffect(() => { void loadInitialData(); }, [loadInitialData]);

  const reconcileSceneAssets = useCallback(async () => {
    if (!composition || busy !== null || document.visibilityState === "hidden" || sceneAssetRefreshInFlightRef.current) return;
    sceneAssetRefreshInFlightRef.current = true;
    try {
      const scenesResponse = await fetch(
        `/api/production/heygen/scenes?componentId=${encodeURIComponent(componentId)}&t=${Date.now()}`,
        { cache: "no-store" },
      );
      const scenesPayload = await scenesResponse.json();
      if (!scenesResponse.ok) throw new Error(scenesPayload.error || "No se pudieron consultar los clips de Producción.");
      const fingerprint = buildSceneAssetFingerprint(scenesPayload.data);
      const observedPendingCount = countPendingHeygenClips(scenesPayload.data);
      setPendingHeygenClipCount(observedPendingCount);
      const assetsChanged = fingerprint !== sceneAssetFingerprintRef.current;
      if (!assetsChanged && observedPendingCount === 0) return;

      const syncResponse = await fetch("/api/production/hyperframes/assets/sync", {
        body: JSON.stringify({ componentId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const syncPayload = await syncResponse.json();
      if (!syncResponse.ok) throw new Error(syncPayload.error || "No se pudieron actualizar los clips de HeyGen.");
      const nextPending = Number(syncPayload.data?.heygenPendingClipCount) || 0;
      setPendingHeygenClipCount(nextPending);
      const synchronized = Number(syncPayload.data?.synchronized) || 0;
      if (!assetsChanged && synchronized === 0) return;

      await refreshAssets();
      const draftResponse = await fetch(`/api/production/hyperframes/compositions/${composition.id}/draft`, {
        method: "POST",
      });
      const draftPayload = await draftResponse.json();
      if (!draftResponse.ok) throw new Error(draftPayload.error || "No se pudo actualizar el timeline.");
      setDraftId(draftPayload.data.draftId as string);
      setDraftDocumentVersion(draftPayload.data.documentVersion as number);
      sceneAssetFingerprintRef.current = fingerprint;
    } catch (error) {
      console.warn("[HyperFrames editor] Automatic scene asset reconciliation failed:", error);
    } finally {
      sceneAssetRefreshInFlightRef.current = false;
    }
  }, [busy, componentId, composition, refreshAssets]);

  useEffect(() => {
    if (!draftId) return;
    const timer = window.setTimeout(() => {
      void reconcileSceneAssets();
    }, pendingHeygenClipCount > 0 ? 8_000 : 30_000);
    const handleFocus = () => { void reconcileSceneAssets(); };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", handleFocus);
    };
  }, [draftId, pendingHeygenClipCount, reconcileSceneAssets]);

  const pollRender = useCallback(async (requestId?: string) => {
    const target = requestId || renderRequest?.id;
    if (!target) return;
    setBusy("poll");
    try {
      const response = await fetch(`/api/production/hyperframes/renders/${target}/poll`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo consultar el render.");
      setRenderRequest((current) => current ? { ...current, providerStatus: payload.data.providerStatus } : current);
      if (payload.data.action === "IMPORT_QUEUED") {
        toast.success("Render terminado; SofLIA - Engine importará el video en segundo plano.");
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
        body: JSON.stringify({ generationMode: "AUTOMATIC" }),
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
    <section className={draftId ? "flex h-full min-h-0 flex-col [&>p]:hidden" : "space-y-5 rounded-xl border border-[var(--engine-accent)]/40 bg-[var(--engine-accent)]/5 p-4 dark:border-[var(--engine-accent)]/25 dark:bg-[var(--engine-accent)]/[0.04]"}>
      {!draftId && (
        <CompositionPreparationView
          animatedDeck={animatedDeck}
          assetCount={uniqueAssets.length}
          blockedAssetCount={blockedAssets.length}
          componentTitle={componentTitle}
          error={editorError}
          onRetry={() => void loadInitialData()}
          pendingClipCount={pendingHeygenClipCount}
          step={preparationStep}
          syncWarning={syncWarning}
          totalAssetBytes={totalAssetBytes}
        />
      )}
      {draftId && (
        <div className="min-h-0 flex-1">
          <NativeCompositionPreview key={`${draftId}:${draftDocumentVersion || 0}`} assets={studioAssets} componentId={componentId} compositionId={composition?.id || ""} draftId={draftId} lessons={lessonLibrary} onAssetsChanged={refreshAssets} onContinueToPublication={onContinueToPublication} onRefreshProductionAssets={loadInitialData} onSelectLesson={onSelectLesson} onVideoCompleted={onVideoCompleted} selectedLessonId={selectedLessonId} />
        </div>
      )}
      {renderRequest?.providerStatus.toLowerCase() === "completed" && <p className="flex items-center gap-2 text-xs font-medium text-green-700 dark:text-green-400"><CheckCircle2 size={15} /> Video final importado en SofLIA - Engine.</p>}
    </section>
  );
}

const PREPARATION_STEPS: Array<{ key: Exclude<PreparationStep, "READY">; label: string }> = [
  { key: "SYNCING_ASSETS", label: "Sincronizando" },
  { key: "LOADING_ASSETS", label: "Revisando medios" },
  { key: "PREPARING_COMPOSITION", label: "Creando ensamble" },
  { key: "OPENING_EDITOR", label: "Abriendo editor" },
];

function CompositionPreparationView({
  animatedDeck,
  assetCount,
  blockedAssetCount,
  componentTitle,
  error,
  onRetry,
  pendingClipCount,
  step,
  syncWarning,
  totalAssetBytes,
}: {
  animatedDeck: { animationCount: number; slideCount: number } | null;
  assetCount: number;
  blockedAssetCount: number;
  componentTitle: string;
  error: string | null;
  onRetry: () => void;
  pendingClipCount: number;
  step: PreparationStep;
  syncWarning: string | null;
  totalAssetBytes: number;
}) {
  const activeStepIndex = step === "READY"
    ? PREPARATION_STEPS.length
    : Math.max(0, PREPARATION_STEPS.findIndex((candidate) => candidate.key === step));
  const progress = step === "READY"
    ? 100
    : Math.round(((activeStepIndex + 0.35) / PREPARATION_STEPS.length) * 100);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-cyan-200/80 bg-gradient-to-br from-white via-cyan-50/60 to-emerald-50/70 px-5 py-8 shadow-sm dark:border-cyan-400/15 dark:from-[var(--engine-surface-solid)] dark:via-cyan-950/20 dark:to-emerald-950/20 sm:px-8">
      <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-cyan-300/20 blur-3xl dark:bg-cyan-400/10" />
      <div className="pointer-events-none absolute -bottom-24 -left-20 h-56 w-56 rounded-full bg-emerald-300/20 blur-3xl dark:bg-emerald-400/10" />

      <div className="relative mx-auto max-w-4xl">
        <div className="flex flex-col items-center text-center">
          <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border shadow-sm ${error ? "border-red-200 bg-red-50 text-red-600 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300" : "border-cyan-200 bg-white text-cyan-700 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-200"}`}>
            {error ? <AlertTriangle size={24} /> : <Clapperboard size={25} />}
          </div>
          <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-300">
            {error ? "Preparación interrumpida" : "Preparando ensamble"}
          </p>
          <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">
            {error ? "No pudimos abrir el editor" : "Organizando los assets de tu lección"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            {error
              ? error
              : <>Estamos vinculando <strong>{componentTitle}</strong> con el timeline. El editor se abrirá automáticamente cuando todo esté listo.</>}
          </p>
        </div>

        {!error ? (
          <>
            <div className="mt-7 h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-[width] duration-500" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PREPARATION_STEPS.map((candidate, index) => {
                const completed = index < activeStepIndex || step === "READY";
                const active = index === activeStepIndex && step !== "READY";
                return (
                  <div key={candidate.key} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold ${completed ? "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300" : active ? "border-cyan-200 bg-white text-cyan-700 shadow-sm dark:border-cyan-400/20 dark:bg-white/5 dark:text-cyan-200" : "border-slate-200/80 bg-white/50 text-slate-400 dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-500"}`}>
                    {completed ? <CheckCircle2 size={15} /> : active ? <Loader2 className="animate-spin" size={15} /> : <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full border border-current text-[8px]">{index + 1}</span>}
                    {candidate.label}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="mt-6 flex justify-center">
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-xl bg-[var(--engine-primary)] px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90">
              <RefreshCw size={15} /> Reintentar preparación
            </button>
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/70 px-3 py-1.5 shadow-sm dark:border-white/10 dark:bg-white/5"><Film size={13} className="text-cyan-600" /> {assetCount} assets · {formatBytes(totalAssetBytes)}</span>
          {animatedDeck ? <span className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/70 px-3 py-1.5 shadow-sm dark:border-white/10 dark:bg-white/5"><Sparkles size={13} className="text-violet-500" /> {animatedDeck.slideCount} diapositivas · {animatedDeck.animationCount} animaciones</span> : null}
          {pendingClipCount > 0 ? <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-700 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-300"><Loader2 className="animate-spin" size={13} /> {pendingClipCount} clips procesándose</span> : null}
          {blockedAssetCount > 0 ? <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300"><AlertTriangle size={13} /> {blockedAssetCount} requieren revisión</span> : null}
        </div>

        {syncWarning ? <p role="status" className="mx-auto mt-4 max-w-2xl rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-center text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">{syncWarning} Se usarán los assets vinculados previamente.</p> : null}
      </div>
    </div>
  );
}

function formatBytes(value: number) {
  return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : value ? `${Math.max(1, Math.round(value / 1024))} KB` : "0 KB";
}

function buildSceneAssetFingerprint(rawData: unknown) {
  const data = rawData && typeof rawData === "object" ? rawData as Record<string, unknown> : {};
  const avatarClips = Array.isArray(data.clips) ? data.clips : [];
  const voiceClips = Array.isArray(data.voiceClips) ? data.voiceClips : [];
  const references = [...avatarClips, ...voiceClips].flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const clip = value as Record<string, unknown>;
    const storagePath = typeof clip.storage_path === "string" ? clip.storage_path : "";
    const status = typeof clip.status === "string" ? clip.status : "";
    const id = typeof clip.clip_id === "string"
      ? clip.clip_id
      : typeof clip.id === "string" ? clip.id : storagePath;
    if (!id) return [];
    const jobId = typeof clip.job_id === "string" ? clip.job_id : "";
    return [`${id}:${status}:${jobId}:${storagePath}`];
  });
  return references.sort().join("|");
}

function countPendingHeygenClips(rawData: unknown) {
  const data = rawData && typeof rawData === "object" ? rawData as Record<string, unknown> : {};
  const clips = Array.isArray(data.clips) ? data.clips : [];
  return clips.filter((value) => (
    value && typeof value === "object"
    && (value as Record<string, unknown>).status === "WAITING_PROVIDER"
  )).length;
}
