"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clapperboard, Eye, EyeOff, FileQuestion, Image as ImageIcon, Loader2, Music2, PanelRight, Pause, Play, Plus, RefreshCw, Save, Send, Trash2, Video, X } from "lucide-react";
import type { CompositionClip, CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";

type PreviewMessage =
  | { type: "courseforge-composition-ready"; duration: number }
  | { type: "courseforge-composition-time"; seconds: number }
  | { type: "courseforge-composition-playback"; playing: boolean }
  | { type: "courseforge-composition-selection"; hfId: string | null }
  | { type: "courseforge-composition-layout-commit"; hfId: string; layout: { height: number; width: number; x: number; y: number } };

type DocumentPayload = { document: CompositionEditorDocument; documentHash: string; version: number };
type AgentProposal = { documentHash: string; model: string; operations: CompositionEditorPatchOperation[]; source: "AGENT"; summary: string };

export interface CompositionStudioLesson {
  completed: boolean;
  id: string;
  subtitle: string;
  title: string;
}

export interface CompositionStudioAsset {
  durationSeconds?: number;
  id: string;
  isEditable: boolean;
  label: string;
  mimeType: string;
  previewUrl: string | null;
  sizeLabel: string;
  sourceLabel: string;
  timelineRole?: "AUDIO" | "AVATAR" | "BROLL" | "VISUAL";
  valid: boolean;
}

interface NativeCompositionPreviewProps {
  assistantRequestKey?: number;
  assets: CompositionStudioAsset[];
  compositionId: string;
  draftId: string;
  lessons: CompositionStudioLesson[];
  onSelectLesson: (lessonId: string) => void;
  selectedLessonId: string | null;
}

/** The native assembly studio: library, full preview, timeline and contextual inspector. */
export function NativeCompositionPreview({ assistantRequestKey = 0, assets, compositionId, draftId, lessons, onSelectLesson, selectedLessonId }: NativeCompositionPreviewProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const payloadRef = useRef<DocumentPayload | null>(null);
  const saveInFlightRef = useRef(false);
  const [payload, setPayload] = useState<DocumentPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failedSave, setFailedSave] = useState<{ operations: CompositionEditorPatchOperation[]; source: "AGENT" | "USER"; summary: string } | null>(null);
  const [agentProposal, setAgentProposal] = useState<AgentProposal | null>(null);
  const [proposing, setProposing] = useState(false);
  const [assembly, setAssembly] = useState<{ revisionId: string; status: "READY_FOR_PREVIEW" | "READY_FOR_RENDER" } | null>(null);
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [renderStatus, setRenderStatus] = useState<"idle" | "validating" | "sending" | "rendering" | "completed" | "failed">("idle");
  const [seconds, setSeconds] = useState(0);
  const [selectedHfId, setSelectedHfId] = useState<string | null>(null);
  const [manualInspectorOpen, setManualInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"assistant" | "properties">("properties");

  const loadDocument = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/document`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo cargar la composición.");
      const nextPayload = body.data as DocumentPayload;
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      setSeconds(0);
      setSelectedHfId(null);
      setManualInspectorOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar la composición.");
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => { void loadDocument(); }, [loadDocument]);
  useEffect(() => {
    if (assistantRequestKey <= 0) return;
    setManualInspectorOpen(true);
    setInspectorTab("assistant");
  }, [assistantRequestKey]);
  useEffect(() => {
    const onMessage = (event: MessageEvent<PreviewMessage>) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = event.data;
      if (!message || typeof message.type !== "string") return;
      if (message.type === "courseforge-composition-time") setSeconds(message.seconds);
      if (message.type === "courseforge-composition-playback") setPlaying(message.playing);
      if (message.type === "courseforge-composition-selection") {
        setSelectedHfId(message.hfId);
        setManualInspectorOpen(Boolean(message.hfId));
        if (message.hfId) setInspectorTab("properties");
      }
      if (message.type === "courseforge-composition-layout-commit") {
        const clip = payload?.document.clips.find((candidate) => candidate.hfId === message.hfId);
        if (!clip) return;
        void savePatch([{ clipId: clip.id, layout: message.layout, type: "clip.layout" }], `Layout editado desde el preview: ${clip.label}.`);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [payload]);

  const duration = payload?.document.canvas.durationSeconds || 0;
  const previewUrl = useMemo(() => payload ? `/api/production/hyperframes/drafts/${draftId}/preview?v=${encodeURIComponent(payload.documentHash)}` : null, [draftId, payload]);
  const estimatedClipCount = payload?.document.clips.filter((clip) => clip.timingSource === "ESTIMATED").length || 0;
  const selectedClip = payload?.document.clips.find((clip) => clip.hfId === selectedHfId) ?? null;
  const inspectorOpen = manualInspectorOpen || Boolean(selectedClip);

  const postPreviewMessage = (message: Record<string, unknown>) => frameRef.current?.contentWindow?.postMessage(message, "*");
  const seek = (nextSeconds: number) => {
    setSeconds(nextSeconds);
    postPreviewMessage({ type: "courseforge-composition-seek", seconds: nextSeconds });
  };
  const selectClip = (hfId: string) => {
    setSelectedHfId(hfId);
    setManualInspectorOpen(true);
    setInspectorTab("properties");
    postPreviewMessage({ type: "courseforge-composition-select", hfId });
  };
  const clearSelection = () => {
    setSelectedHfId(null);
    setManualInspectorOpen(false);
    postPreviewMessage({ type: "courseforge-composition-select", hfId: null });
  };
  async function savePatch(operations: CompositionEditorPatchOperation[], summary: string, source: "AGENT" | "USER" = "USER"): Promise<boolean> {
    const currentPayload = payloadRef.current;
    if (!currentPayload || saveInFlightRef.current) return false;
    saveInFlightRef.current = true;
    setSaving(true);
    setSaveError(null);
    setFailedSave(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/document`, {
        body: JSON.stringify({ operations, source, summary }),
        headers: { "Content-Type": "application/json", "If-Match": `"${currentPayload.documentHash}"` },
        method: "PUT",
      });
      const body = await response.json();
      if (response.status === 409 && body.data) {
        const nextPayload = body.data as DocumentPayload;
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        setFailedSave({ operations, source, summary });
        setSaveError(body.error || "La composición cambió en otra sesión. El preview se actualizó con la última versión.");
        return false;
      }
      if (!response.ok) throw new Error(body.error || "No se pudo guardar el cambio.");
      const nextPayload = body.data as DocumentPayload;
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      return true;
    } catch (caught) {
      setFailedSave({ operations, source, summary });
      setSaveError(caught instanceof Error ? caught.message : "No se pudo guardar el cambio.");
      return false;
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  async function addAssetToTimeline(asset: CompositionStudioAsset) {
    if (!payload || !asset.isEditable) return;
    const clipId = `asset-${asset.id}`;
    const existing = payload.document.clips.find((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.source.productionAssetId === asset.id);
    if (existing) {
      selectClip(existing.hfId);
      return;
    }

    const isAudio = asset.mimeType.startsWith("audio/") || asset.timelineRole === "AUDIO";
    const trackId = isAudio ? "audio" : asset.timelineRole === "AVATAR" ? "avatar" : asset.timelineRole === "BROLL" ? "broll" : "visual";
    const trackLabels: Record<string, string> = { audio: "Audio", avatar: "Avatar", broll: "B-roll", visual: "Medios visuales" };
    const existingTrack = payload.document.tracks.find((track) => track.id === trackId);
    const isPinnedTrack = trackId === "audio" || trackId === "avatar";
    const preferredDuration = asset.durationSeconds || (isPinnedTrack ? payload.document.canvas.durationSeconds : asset.mimeType.startsWith("image/") ? 5 : 8);
    const occupiedUntil = payload.document.clips
      .filter((candidate) => candidate.trackId === trackId)
      .reduce((latest, candidate) => Math.max(latest, candidate.startSeconds + candidate.durationSeconds), 0);
    const requiredCanvasDuration = Math.min(600, Math.max(
      payload.document.canvas.durationSeconds,
      isPinnedTrack ? preferredDuration : occupiedUntil + preferredDuration,
    ));
    const clipDuration = Math.min(preferredDuration, requiredCanvasDuration - (isPinnedTrack ? 0 : occupiedUntil));
    if (clipDuration < 0.05) {
      setSaveError("No hay espacio disponible para este asset. Aplica la plantilla base o ajusta la duración del video.");
      return;
    }
    const avatarWidth = Math.round(payload.document.canvas.width * 0.32);
    const avatarHeight = Math.round(payload.document.canvas.height * 0.65);
    const clip: CompositionClip = {
      durationSeconds: clipDuration,
      hfId: clipId,
      hidden: false,
      id: clipId,
      kind: isAudio ? "AUDIO" : asset.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE",
      label: asset.label,
      layout: {
        height: isAudio ? 1 : trackId === "avatar" ? avatarHeight : payload.document.canvas.height,
        opacity: 1,
        rotation: 0,
        width: isAudio ? 1 : trackId === "avatar" ? avatarWidth : payload.document.canvas.width,
        x: trackId === "avatar" ? payload.document.canvas.width - avatarWidth - 48 : 0,
        y: trackId === "avatar" ? payload.document.canvas.height - avatarHeight - 48 : 0,
        zIndex: isAudio ? 0 : trackId === "avatar" ? 10 : trackId === "broll" ? 5 : -1,
      },
      source: { productionAssetId: asset.id, type: "PRODUCTION_ASSET" },
      startSeconds: isPinnedTrack ? 0 : occupiedUntil,
      timingSource: "ESTIMATED",
      trackId,
    };
    const operations: CompositionEditorPatchOperation[] = requiredCanvasDuration > payload.document.canvas.durationSeconds
      ? [{ clipId: "canvas", durationSeconds: requiredCanvasDuration, type: "composition.canvas-duration" }]
      : [];
    const added = await savePatch([...operations, {
      clip,
      clipId,
      track: existingTrack ? undefined : {
        id: trackId,
        kind: isAudio ? "AUDIO" : "VISUAL",
        label: trackLabels[trackId],
        locked: false,
        order: payload.document.tracks.reduce((highest, track) => Math.max(highest, track.order), -1) + 1,
      },
      type: "clip.add",
    }], `Agregó ${asset.label} a la línea de tiempo.`);
    if (added) selectClip(clip.hfId);
  }

  async function removeClipFromTimeline(clip: CompositionClip) {
    const removed = await savePatch([{ clipId: clip.id, type: "clip.remove" }], `Quitó ${clip.label} de la línea de tiempo.`);
    if (removed) clearSelection();
  }

  async function applyBaseTemplate() {
    if (!payload) return;
    if (!window.confirm("Esto reorganizará los tiempos y layouts iniciales. Los assets y versiones anteriores se conservarán. ¿Aplicar plantilla base?")) return;
    const sourceById = new Map(assets.map((asset) => [asset.id, asset]));
    const editableAssetIds = new Set(sourceById.keys());
    const sourceDuration = assets.reduce((longest, asset) => Math.max(longest, asset.durationSeconds || 0), 0);
    const canvasDuration = Math.min(600, Math.max(payload.document.canvas.durationSeconds, sourceDuration, 3));
    const operations: CompositionEditorPatchOperation[] = [{ clipId: "canvas", durationSeconds: canvasDuration, type: "composition.canvas-duration" }];
    // Raster files referenced by the editable HTML deck must not also be independent timeline media.
    for (const clip of payload.document.clips) {
      if (clip.source.type === "PRODUCTION_ASSET" && !editableAssetIds.has(clip.source.productionAssetId)) {
        operations.push({ clipId: clip.id, type: "clip.remove" });
      }
    }
    const deckClips = payload.document.clips
      .filter((clip) => clip.source.type === "DECK_SLIDE")
      .sort((left, right) => {
        const leftIndex = left.source.type === "DECK_SLIDE" ? left.source.slideIndex : 0;
        const rightIndex = right.source.type === "DECK_SLIDE" ? right.source.slideIndex : 0;
        return leftIndex - rightIndex;
      });
    for (let index = 0; index < deckClips.length; index++) {
      const clip = deckClips[index]!;
      const startSeconds = Math.round((canvasDuration * index / deckClips.length) * 20) / 20;
      const endSeconds = index === deckClips.length - 1 ? canvasDuration : Math.round((canvasDuration * (index + 1) / deckClips.length) * 20) / 20;
      operations.push({ clipId: clip.id, durationSeconds: Math.max(0.05, endSeconds - startSeconds), layout: { ...clip.layout, height: payload.document.canvas.height, width: payload.document.canvas.width, x: 0, y: 0, zIndex: 0 }, startSeconds, type: "clip.template" });
    }
    for (const trackId of ["avatar", "audio", "broll", "visual"]) {
      const clips = payload.document.clips.filter((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.trackId === trackId);
      let cursor = 0;
      for (let index = 0; index < clips.length; index++) {
        const clip = clips[index]!;
        if (clip.source.type !== "PRODUCTION_ASSET") continue;
        const asset = sourceById.get(clip.source.productionAssetId);
        const preferredDuration = Math.min(canvasDuration, asset?.durationSeconds || (trackId === "audio" || trackId === "avatar" ? canvasDuration : clip.kind === "IMAGE" ? 5 : 8));
        const durationSeconds = trackId === "avatar" || trackId === "audio" ? preferredDuration : Math.max(0.05, Math.min(preferredDuration, (canvasDuration - cursor) / (clips.length - index)));
        const avatarWidth = Math.round(payload.document.canvas.width * 0.32);
        const avatarHeight = Math.round(payload.document.canvas.height * 0.65);
        operations.push({ clipId: clip.id, durationSeconds, layout: trackId === "avatar" ? { ...clip.layout, height: avatarHeight, width: avatarWidth, x: payload.document.canvas.width - avatarWidth - 48, y: payload.document.canvas.height - avatarHeight - 48, zIndex: 10 } : trackId === "audio" ? { ...clip.layout, height: 1, width: 1, x: 0, y: 0, zIndex: 0 } : { ...clip.layout, height: payload.document.canvas.height, width: payload.document.canvas.width, x: 0, y: 0, zIndex: trackId === "broll" ? 5 : 4 }, startSeconds: trackId === "avatar" || trackId === "audio" ? 0 : cursor, type: "clip.template" });
        if (trackId !== "avatar" && trackId !== "audio") cursor += durationSeconds;
      }
    }
    if (operations.length > 100) {
      setSaveError("La composición tiene demasiados clips para aplicar la plantilla en una sola operación.");
      return;
    }
    await savePatch(operations, "Aplicó la plantilla base de tiempos y layout.");
  }

  async function requestAgentProposal(instruction: string) {
    if (!payload) return;
    setProposing(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/agent-proposals`, {
        body: JSON.stringify({ instruction, selectedClipId: selectedClip?.id || null }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo preparar la propuesta.");
      const proposal = body.data as AgentProposal;
      if (proposal.documentHash !== payload.documentHash) throw new Error("La composicion cambio antes de recibir la propuesta. Vuelve a solicitarla.");
      setAgentProposal(proposal);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "No se pudo preparar la propuesta.");
    } finally {
      setProposing(false);
    }
  }

  async function prepareAssembly() {
    setAssembling(true); setAssemblyError(null); setRenderStatus("validating");
    try {
      const response = await fetch(`/api/production/hyperframes/compositions/${compositionId}/snapshot`, { body: JSON.stringify({ draftId }), headers: { "Content-Type": "application/json" }, method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo preparar el ensamble.");
      setAssembly({ revisionId: body.data.id, status: "READY_FOR_PREVIEW" }); setRenderStatus("idle");
    } catch (caught) { setAssemblyError(caught instanceof Error ? caught.message : "No se pudo preparar el ensamble."); setRenderStatus("failed"); }
    finally { setAssembling(false); }
  }
  async function approveAssembly() {
    if (!assembly) return; setAssembling(true); setAssemblyError(null);
    try { const response = await fetch(`/api/production/hyperframes/compositions/${compositionId}/approve`, { method: "POST" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo aprobar el ensamble."); setAssembly({ ...assembly, status: "READY_FOR_RENDER" }); }
    catch (caught) { setAssemblyError(caught instanceof Error ? caught.message : "No se pudo aprobar el ensamble."); }
    finally { setAssembling(false); }
  }
  async function submitAssemblyRender() {
    if (!assembly || assembly.status !== "READY_FOR_RENDER") return; setAssembling(true); setAssemblyError(null); setRenderStatus("sending");
    try { const response = await fetch("/api/production/hyperframes/renders", { body: JSON.stringify({ aspectRatio: "16:9", format: "mp4", quality: "high", resolution: "1080p", revisionId: assembly.revisionId }), headers: { "Content-Type": "application/json" }, method: "POST" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo enviar el render."); setRenderStatus("rendering"); }
    catch (caught) { setAssemblyError(caught instanceof Error ? caught.message : "No se pudo enviar el render."); setRenderStatus("failed"); }
    finally { setAssembling(false); }
  }

  if (loading) return <LoadingPreview />;
  if (error || !payload || !previewUrl) return <PreviewError error={error || "No hay composición disponible."} onRetry={() => void loadDocument()} />;

  const editorColumns = inspectorOpen
    ? "lg:grid-cols-[400px_minmax(360px,1fr)_300px]"
    : "lg:grid-cols-[430px_minmax(0,1fr)]";

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm dark:border-white/10 dark:bg-[#0F1419]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#1E2329]">
        <div>
          <h5 className="text-sm font-bold text-slate-900 dark:text-white">Estudio de edición</h5>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-gray-400">Versión {payload.version} · {formatSeconds(duration)} · cambios guardados por versión</p>
        </div>
        <div className="flex items-center gap-1">
          <span role="status" className={`mr-2 text-[11px] font-medium ${saving ? "text-[#00D4B3]" : saveError ? "text-red-700 dark:text-red-300" : "text-[#10B981]"}`}>{saving ? "Guardando…" : saveError ? "Error al guardar" : "Guardado"}</span>
          <button type="button" onClick={() => setManualInspectorOpen((current) => !current)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${inspectorOpen ? "border-[#00D4B3] bg-[#00D4B3]/10 text-[#0A2540] dark:text-[#00D4B3]" : "border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"}`}><PanelRight size={14} /> {inspectorOpen ? "Ocultar panel" : "Mostrar panel"}</button>
          <button type="button" onClick={() => void loadDocument()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-gray-400 dark:hover:bg-white/10" title="Recargar composición"><RefreshCw size={15} /></button>
        </div>
      </header>

      <div className={`grid min-h-0 flex-1 gap-3 p-3 lg:grid-rows-[minmax(210px,34vh)_minmax(170px,1fr)] ${editorColumns}`}>
        <StudioLibrary assets={assets} lessons={lessons} onAddAsset={addAssetToTimeline} onSelectLesson={onSelectLesson} selectedLessonId={selectedLessonId} onSelectAsset={selectClip} selectedHfId={selectedHfId} timelineAssetIds={new Set(payload.document.clips.flatMap((clip) => clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []))} />

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#0F1419] dark:border-white/10 lg:col-start-2 lg:row-start-1">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-slate-300"><span className="font-semibold">Preview completo</span><span>{formatSeconds(seconds)} / {formatSeconds(duration)}</span></div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-2">
            <div className="relative aspect-video h-full max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-2xl">
              <iframe ref={frameRef} title="Preview completo de composición" src={previewUrl} sandbox="allow-scripts" allow="autoplay" className="absolute inset-0 h-full w-full" />
            </div>
          </div>
          <div className="flex items-center gap-3 border-t border-white/10 bg-[#0A2540] px-3 py-2.5">
            <button type="button" onClick={() => postPreviewMessage({ type: playing ? "courseforge-composition-pause" : "courseforge-composition-play" })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#00D4B3] text-[#0A2540] hover:bg-[#10B981]">{playing ? <Pause size={15} /> : <Play size={15} />}</button>
            <input aria-label="Posición del preview" type="range" min="0" max={duration} step="0.05" value={Math.min(seconds, duration)} onChange={(event) => seek(Number(event.target.value))} className="w-full accent-[#00D4B3]" />
          </div>
        </section>

        <section className="min-h-0 min-w-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-[#101720] lg:col-span-2 lg:row-start-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/5"><span className="text-slate-600 dark:text-gray-300">Plantilla base: avatar y audio respetan su duración real; los medios se distribuyen secuencialmente.</span><button type="button" disabled={saving} onClick={() => void applyBaseTemplate()} className="rounded-md border border-cyan-300 px-2.5 py-1 font-bold text-cyan-800 hover:bg-cyan-50 disabled:opacity-50 dark:border-cyan-400/40 dark:text-cyan-200 dark:hover:bg-cyan-400/10">Aplicar plantilla base</button></div>
          <CompositionTimeline assetLabels={Object.fromEntries(assets.map((asset) => [asset.id, asset.label]))} document={payload.document} currentTime={seconds} selectedHfId={selectedHfId} onClearSelection={clearSelection} onDurationChange={(clip, durationSeconds) => void savePatch([{ clipId: clip.id, durationSeconds, type: "clip.duration" }], `Ajustó la duración de ${clip.label} desde la timeline.`)} onSeek={seek} onSelect={selectClip} />
          {estimatedClipCount > 0 && <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-200"><AlertTriangle className="mt-0.5 shrink-0" size={14} /> {estimatedClipCount} segmentos tienen duración estimada. Arrastra su borde derecho para ajustarlos.</p>}
          {saveError && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-500/10 dark:text-red-100"><span>{saveError}</span>{failedSave && <button type="button" disabled={saving} onClick={() => void savePatch(failedSave.operations, failedSave.summary, failedSave.source)} className="rounded border border-current px-2 py-1 font-bold disabled:opacity-50">Reintentar</button>}</div>}
          <AssemblyActions assembly={assembly} busy={assembling} error={assemblyError} renderStatus={renderStatus} onApprove={approveAssembly} onPrepare={prepareAssembly} onRender={submitAssemblyRender} />
        </section>

        {inspectorOpen && <aside className="min-w-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-[#1E2329] lg:col-start-3 lg:row-span-2 lg:row-start-1">
          <div className="mb-3 flex items-center justify-between gap-2"><div className="flex rounded-lg bg-slate-100 p-1 text-xs dark:bg-white/5"><button type="button" onClick={() => setInspectorTab("properties")} className={`rounded-md px-2 py-1 font-semibold ${inspectorTab === "properties" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white" : "text-slate-500 dark:text-gray-400"}`}>Propiedades</button><button type="button" onClick={() => setInspectorTab("assistant")} className={`rounded-md px-2 py-1 font-semibold ${inspectorTab === "assistant" ? "bg-[#00D4B3] text-[#0A2540] shadow-sm" : "text-slate-500 dark:text-gray-400"}`}>SofLIA</button></div><button type="button" onClick={clearSelection} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-gray-400 dark:hover:bg-white/10" title="Cerrar panel"><X size={15} /></button></div>
          {inspectorTab === "properties" ? <CompositionInspector clip={selectedClip} saving={saving} onPatch={savePatch} onRemove={removeClipFromTimeline} /> : <AgentConversation proposal={agentProposal} proposing={proposing} saving={saving} onDismiss={() => setAgentProposal(null)} onPropose={requestAgentProposal} onApprove={() => { if (!agentProposal) return; void savePatch(agentProposal.operations, agentProposal.summary, "AGENT"); setAgentProposal(null); }} />}
        </aside>}
      </div>
    </section>
  );
}

function AgentEditProposal({ onApprove, onDismiss, onPropose, proposal, proposing, saving }: { onApprove: () => void; onDismiss: () => void; onPropose: (instruction: string) => Promise<void>; proposal: AgentProposal | null; proposing: boolean; saving: boolean }) {
  const [instruction, setInstruction] = useState("");
  return <section className="mt-5 border-t border-slate-200 pt-4 dark:border-white/10"><p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">EdiciÃ³n asistida</p><p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-gray-400">Describe un cambio. Se generarÃ¡ una propuesta antes de modificar la composiciÃ³n.</p><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={1500} rows={3} placeholder="Ej. centra el avatar y deja 6 segundos al inicio" className="mt-2 w-full resize-y rounded-md border border-slate-300 bg-white p-2 text-xs text-slate-900 placeholder:text-slate-400 dark:border-white/15 dark:bg-slate-950 dark:text-white" />{proposal ? <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50 p-2.5 text-xs text-violet-950 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-100"><p className="font-bold">Propuesta lista</p><p className="mt-1 leading-4">{proposal.summary}</p><p className="mt-1 text-[10px] opacity-75">{proposal.operations.length} cambio(s) propuesto(s)</p><div className="mt-2 flex gap-2"><button type="button" disabled={saving} onClick={onApprove} className="rounded bg-violet-700 px-2 py-1 font-bold text-white disabled:opacity-50">Aplicar</button><button type="button" disabled={saving} onClick={onDismiss} className="rounded border border-current px-2 py-1 font-bold disabled:opacity-50">Descartar</button></div></div> : <button type="button" disabled={proposing || instruction.trim().length < 3} onClick={() => void onPropose(instruction)} className="mt-2 inline-flex items-center gap-1 rounded-md border border-violet-300 px-2.5 py-1.5 text-xs font-bold text-violet-800 disabled:opacity-50 dark:border-violet-400/40 dark:text-violet-200">{proposing && <Loader2 className="animate-spin" size={13} />}{proposing ? "Preparando propuesta…" : "Proponer cambios"}</button>}</section>;
}

function AgentChat({ onApprove, onDismiss, onPropose, proposal, proposing, saving }: { onApprove: () => void; onDismiss: () => void; onPropose: (instruction: string) => Promise<void>; proposal: AgentProposal | null; proposing: boolean; saving: boolean }) {
  const [instruction, setInstruction] = useState("");
  const [messages, setMessages] = useState<Array<{ id: string; role: "assistant" | "user"; text: string }>>([
    { id: "welcome", role: "assistant", text: "Cuéntame qué deseas modificar. Primero revisaré la composición y te explicaré el plan; sólo haré cambios cuando los confirmes." },
  ]);
  const lastProposal = useRef<string | null>(null);
  useEffect(() => {
    if (!proposal || lastProposal.current === proposal.summary) return;
    lastProposal.current = proposal.summary;
    setMessages((current) => [...current, { id: `proposal-${proposal.documentHash}`, role: "assistant", text: `Así lo haré: ${proposal.summary} Esto implica ${proposal.operations.length} cambio(s). ¿Confirmas que los aplique?` }]);
  }, [proposal]);
  const send = async () => {
    const text = instruction.trim();
    if (text.length < 3 || proposing || proposal) return;
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", text }]);
    setInstruction("");
    await onPropose(text);
  };
  const approve = () => {
    if (!proposal) return;
    setMessages((current) => [...current, { id: `approve-${Date.now()}`, role: "assistant", text: "Perfecto. Aplicaré los cambios aprobados y actualizaré el preview." }]);
    onApprove();
  };
  const dismiss = () => {
    setMessages((current) => [...current, { id: `reject-${Date.now()}`, role: "assistant", text: "Propuesta descartada. Indícame cómo prefieres modificar la composición." }]);
    lastProposal.current = null;
    onDismiss();
  };
  return <section className="flex min-h-0 flex-1 flex-col"><div className="border-b border-slate-200 pb-3 dark:border-white/10"><p className="text-xs font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">SofLIA · edición asistida</p><p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-gray-400">SofLIA primero propone el plan. El documento sólo se actualiza cuando confirmas.</p></div><div className="min-h-36 flex-1 space-y-2 overflow-y-auto py-3">{messages.map((message) => <div key={message.id} className={`max-w-[94%] rounded-xl px-3 py-2 text-xs leading-5 ${message.role === "user" ? "ml-auto bg-violet-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-gray-100"}`}>{message.text}</div>)}{proposing && <div className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-white/10 dark:text-gray-300"><Loader2 className="animate-spin" size={13} /> Revisando la composición…</div>}{proposal && <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-950 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-100"><p className="font-bold">Esperando tu confirmación</p><div className="mt-2 flex gap-2"><button type="button" disabled={saving} onClick={approve} className="rounded-md bg-violet-700 px-2.5 py-1.5 font-bold text-white disabled:opacity-50">Confirmar y aplicar</button><button type="button" disabled={saving} onClick={dismiss} className="rounded-md border border-current px-2.5 py-1.5 font-bold disabled:opacity-50">Rechazar</button></div></div>}</div><div className="border-t border-slate-200 pt-3 dark:border-white/10"><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} maxLength={1500} rows={3} placeholder="Ej. centra el avatar y deja seis segundos al inicio" className="w-full resize-none rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-900 placeholder:text-slate-400 dark:border-white/15 dark:bg-slate-950 dark:text-white" /><button type="button" disabled={proposing || Boolean(proposal) || instruction.trim().length < 3} onClick={() => void send()} className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"><Send size={13} /> Enviar</button></div></section>;
}

void AgentEditProposal;
void AgentChat;

function AgentConversation({ onApprove, onDismiss, onPropose, proposal, proposing, saving }: { onApprove: () => void; onDismiss: () => void; onPropose: (instruction: string) => Promise<void>; proposal: AgentProposal | null; proposing: boolean; saving: boolean }) {
  type Message = { id: string; role: "assistant" | "user"; text: string };
  const [instruction, setInstruction] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "assistant", text: "Cuéntame qué deseas modificar. Primero revisaré la composición y te explicaré el plan. Sólo aplicaré cambios cuando los confirmes." },
  ]);
  const proposalId = useRef<string | null>(null);

  useEffect(() => {
    if (!proposal || proposalId.current === proposal.documentHash) return;
    proposalId.current = proposal.documentHash;
    setMessages((current) => [...current, {
      id: `proposal-${proposal.documentHash}`,
      role: "assistant",
      text: `Así lo haré: ${proposal.summary} Esto implica ${proposal.operations.length} cambio(s). ¿Confirmas que los aplique?`,
    }]);
  }, [proposal]);

  const send = async () => {
    const text = instruction.trim();
    if (text.length < 3 || proposing || proposal) return;
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", text }]);
    setInstruction("");
    await onPropose(text);
  };

  const reject = () => {
    proposalId.current = null;
    setMessages((current) => [...current, {
      id: `reject-${Date.now()}`,
      role: "assistant",
      text: "Propuesta descartada. Dime cómo prefieres modificar la composición.",
    }]);
    onDismiss();
  };

  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#00D4B3]/30 bg-slate-50 dark:bg-[#0F1419]">
    <div className="flex items-center gap-2.5 border-b border-[#00D4B3]/25 bg-gradient-to-r from-[#00D4B3]/15 to-white px-3 py-3 dark:to-[#1E2329]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#00D4B3] text-xs font-black text-[#0A2540] shadow-sm shadow-[#00D4B3]/30 dark:shadow-none">S</span>
      <div className="min-w-0"><p className="truncate text-xs font-bold text-slate-900 dark:text-white">SofLIA</p><p className="flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Asistente de edición</p></div>
    </div>

    <div className="min-h-40 flex-1 space-y-3 overflow-y-auto px-3 py-4">
      {messages.map((message) => <div key={message.id} className={`flex items-end gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
        {message.role === "assistant" && <span className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#00D4B3] text-[10px] font-black text-[#0A2540]">S</span>}
        <div className={`max-w-[84%] rounded-2xl px-3 py-2.5 text-xs leading-5 shadow-sm ${message.role === "user" ? "rounded-br-md bg-[#0A2540] text-white" : "rounded-bl-md border border-slate-100 bg-white text-slate-700 dark:border-white/10 dark:bg-[#1E2329] dark:text-gray-100"}`}>
          {message.text}
        </div>
      </div>)}
      {proposing && <div className="flex items-end gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#00D4B3] text-[10px] font-black text-[#0A2540]">S</span><div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-100 bg-white px-3 py-2.5 text-xs text-slate-600 shadow-sm dark:border-white/10 dark:bg-[#1E2329] dark:text-gray-300"><Loader2 className="animate-spin text-[#00D4B3]" size={13} /> Revisando la composición...</div></div>}
      {proposal && <div className="ml-8 rounded-xl border border-[#00D4B3]/40 bg-[#00D4B3]/10 p-3 text-xs text-[#0A2540] shadow-sm dark:text-[#E9ECEF]"><p className="font-bold">Esperando tu confirmación</p><p className="mt-1 text-[11px] leading-4 opacity-80">No se guardará nada hasta que confirmes.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={onApprove} className="rounded-lg bg-[#0A2540] px-3 py-1.5 font-bold text-white transition hover:bg-[#0d2f4d] disabled:opacity-50">Confirmar y aplicar</button><button type="button" disabled={saving} onClick={reject} className="rounded-lg border border-[#00D4B3] bg-white px-3 py-1.5 font-bold text-[#0A2540] transition hover:bg-[#00D4B3]/10 disabled:opacity-50 dark:bg-transparent dark:text-[#00D4B3]">Rechazar</button></div></div>}
    </div>

    <div className="border-t border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-[#101720]">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-1.5 transition focus-within:border-[#00D4B3] focus-within:ring-2 focus-within:ring-[#00D4B3]/15 dark:border-white/15 dark:bg-slate-950">
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} maxLength={1500} rows={2} placeholder="Pide un cambio para la composición..." className="w-full resize-none bg-transparent px-1 py-0 text-xs leading-4 text-slate-900 outline-none placeholder:text-slate-400 dark:text-white" />
        <div className="mt-0.5 flex items-center justify-between gap-2"><span className="text-[9px] text-slate-400">Enter para enviar · Shift + Enter para salto</span><button type="button" aria-label="Enviar mensaje" disabled={proposing || Boolean(proposal) || instruction.trim().length < 3} onClick={() => void send()} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#0A2540] text-white transition hover:bg-[#0d2f4d] disabled:cursor-not-allowed disabled:opacity-40"><Send size={12} /></button></div>
      </div>
    </div>
  </section>;
}

function AssemblyActions({ assembly, busy, error, onApprove, onPrepare, onRender, renderStatus }: { assembly: { revisionId: string; status: "READY_FOR_PREVIEW" | "READY_FOR_RENDER" } | null; busy: boolean; error: string | null; onApprove: () => void; onPrepare: () => void; onRender: () => void; renderStatus: "idle" | "validating" | "sending" | "rendering" | "completed" | "failed" }) {
  const label = renderStatus === "validating" ? "Validando snapshot…" : renderStatus === "sending" ? "Enviando render…" : renderStatus === "rendering" ? "Renderizando" : "";
  return <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-400/20 dark:bg-cyan-400/10"><div className="text-xs text-cyan-950 dark:text-cyan-100"><p className="font-bold">Ensamble del video</p><p className="mt-0.5">{assembly ? assembly.status === "READY_FOR_RENDER" ? "Snapshot aprobado. Puedes enviar el render." : "Snapshot listo. Revísalo y apruébalo para renderizar." : "Congela la versión guardada antes de enviar un render."}</p>{label && <p className="mt-1 font-medium">{label}</p>}{error && <p role="alert" className="mt-1 text-red-700 dark:text-red-200">{error}</p>}</div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void onPrepare()} className="inline-flex items-center gap-1.5 rounded-md bg-cyan-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Clapperboard size={14} /> {busy && renderStatus === "validating" ? "Preparando…" : "Preparar ensamble"}</button>{assembly?.status === "READY_FOR_PREVIEW" && <button type="button" disabled={busy} onClick={() => void onApprove()} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-700 px-3 py-2 text-xs font-bold text-cyan-900 disabled:opacity-50 dark:border-cyan-300 dark:text-cyan-100"><CheckCircle2 size={14} /> Aprobar snapshot</button>}{assembly?.status === "READY_FOR_RENDER" && <button type="button" disabled={busy || renderStatus === "rendering"} onClick={() => void onRender()} className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950"><Send size={14} /> Renderizar video</button>}</div></div>;
}

function StudioLibrary({ assets, lessons, onAddAsset, onSelectAsset, onSelectLesson, selectedHfId, selectedLessonId, timelineAssetIds }: {
  assets: CompositionStudioAsset[];
  lessons: CompositionStudioLesson[];
  onAddAsset: (asset: CompositionStudioAsset) => void;
  onSelectAsset: (hfId: string) => void;
  onSelectLesson: (lessonId: string) => void;
  selectedHfId: string | null;
  selectedLessonId: string | null;
  timelineAssetIds: Set<string>;
}) {
  return <aside className="grid min-h-0 grid-cols-2 gap-3 overflow-hidden lg:col-start-1 lg:row-start-1">
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#101720]">
      <div className="border-b border-slate-200 px-3 py-2 dark:border-white/10">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">Videos del curso</p>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 pr-1.5">
        {lessons.map((lesson, index) => <button key={lesson.id} type="button" onClick={() => onSelectLesson(lesson.id)} className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${selectedLessonId === lesson.id ? "border-cyan-400 bg-cyan-50 dark:border-cyan-400/40 dark:bg-cyan-400/10" : "border-transparent hover:bg-slate-100 dark:hover:bg-white/5"}`}><span className="flex items-start gap-2"><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${lesson.completed ? "bg-green-100 text-green-700 dark:bg-green-400/15 dark:text-green-300" : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-gray-400"}`}>{lesson.completed ? "✓" : index + 1}</span><span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-900 dark:text-white">{lesson.title}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500 dark:text-gray-400">{lesson.subtitle}</span></span></span></button>)}
      </div>
    </section>
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#101720]">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-white/10">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">Assets vinculados</p>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-gray-400">{assets.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2 pr-1.5">
        {assets.map((asset) => {
          const hfId = `asset-${asset.id}`;
          const inTimeline = timelineAssetIds.has(asset.id);
          return <div key={asset.id} className={`rounded-lg border p-1.5 ${selectedHfId === hfId ? "border-cyan-400 bg-cyan-50 dark:border-cyan-400/40 dark:bg-cyan-400/10" : asset.valid ? "border-slate-200 dark:border-white/10" : "border-red-200 bg-red-50 dark:border-red-400/30 dark:bg-red-500/10"}`}>
            <button type="button" disabled={!asset.isEditable || !inTimeline} onClick={() => onSelectAsset(hfId)} className="flex w-full items-center gap-2 text-left disabled:cursor-default disabled:opacity-70"><AssetThumbnail asset={asset} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-800 dark:text-gray-100">{asset.label}</span><span className="mt-0.5 flex justify-between gap-2 text-[10px] text-slate-500 dark:text-gray-400"><span className="truncate">{asset.sourceLabel}</span><span>{asset.sizeLabel}</span></span></span></button>
            <button type="button" disabled={!asset.isEditable || !asset.valid || inTimeline} onClick={() => onAddAsset(asset)} title={inTimeline ? "Este asset ya está en la línea de tiempo" : "Añadir a la línea de tiempo"} className={"mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold transition-colors disabled:cursor-default disabled:opacity-60 " + (inTimeline ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200" : "border-cyan-300 text-cyan-800 hover:bg-cyan-50 dark:border-cyan-400/40 dark:text-cyan-200 dark:hover:bg-cyan-400/10")}>{inTimeline ? "En timeline" : <><Plus size={12} /> Añadir a timeline</>}</button>
          </div>;
        })}
      </div>
    </section>
  </aside>;
}

function AssetThumbnail({ asset }: { asset: CompositionStudioAsset }) {
  const [failed, setFailed] = useState(false);
  const commonClass = "relative flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5";
  if (asset.mimeType.startsWith("audio/")) return <span className={commonClass + " text-violet-600 dark:text-violet-300"}><Music2 size={18} /></span>;
  if (asset.mimeType.startsWith("image/") && asset.previewUrl && !failed) return <span className={commonClass}><img src={asset.previewUrl} alt="" onError={() => setFailed(true)} className="h-full w-full object-cover" /></span>;
  if (asset.mimeType.startsWith("video/") && asset.previewUrl && !failed) return <span className={commonClass}><video muted preload="metadata" onError={() => setFailed(true)} className="h-full w-full object-cover"><source src={asset.previewUrl} type={asset.mimeType} /></video><Play className="pointer-events-none absolute text-white drop-shadow" size={15} /></span>;
  const Icon = asset.mimeType.startsWith("image/") ? ImageIcon : asset.mimeType.startsWith("video/") ? Video : FileQuestion;
  return <span className={commonClass + " text-slate-400 dark:text-gray-500"}><Icon size={18} /></span>;
}

function CompositionInspector({ clip, onPatch, onRemove, saving }: { clip: CompositionClip | null; onPatch: (operations: CompositionEditorPatchOperation[], summary: string) => Promise<boolean>; onRemove: (clip: CompositionClip) => Promise<void>; saving: boolean }) {
  const [startSeconds, setStartSeconds] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [rotation, setRotation] = useState("");
  const [opacity, setOpacity] = useState("");
  useEffect(() => { setStartSeconds(clip ? String(clip.startSeconds) : ""); setDurationSeconds(clip ? String(clip.durationSeconds) : ""); setX(clip ? String(clip.layout.x) : ""); setY(clip ? String(clip.layout.y) : ""); }, [clip?.id, clip?.startSeconds, clip?.durationSeconds, clip?.layout.x, clip?.layout.y]);
  useEffect(() => { setWidth(clip ? String(clip.layout.width) : ""); setHeight(clip ? String(clip.layout.height) : ""); setRotation(clip ? String(clip.layout.rotation) : ""); setOpacity(clip ? String(clip.layout.opacity) : ""); }, [clip?.id, clip?.layout.height, clip?.layout.opacity, clip?.layout.rotation, clip?.layout.width]);
  if (!clip) return <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-xs leading-5 text-slate-500 dark:border-white/10 dark:text-gray-400">Selecciona un clip en la timeline o directamente en el preview para editar su layout, visibilidad o duración.</p>;
  const numberOrNull = (value: string) => { const result = Number(value); return Number.isFinite(result) ? result : null; };
  const saveTiming = async () => { const start = numberOrNull(startSeconds); const duration = numberOrNull(durationSeconds); if (start === null || duration === null) return; await onPatch([{ clipId: clip.id, durationSeconds: duration, type: "clip.duration" }, { clipId: clip.id, startSeconds: start, type: "clip.move" }], `Ajustó la ubicación y duración de ${clip.label}.`); };
  const savePosition = async () => { const nextX = numberOrNull(x); const nextY = numberOrNull(y); if (nextX === null || nextY === null) return; await onPatch([{ clipId: clip.id, layout: { x: nextX, y: nextY }, type: "clip.layout" }], `Ajustó la posición de ${clip.label}.`); };
  const saveTransform = async () => { const next = { height: numberOrNull(height), opacity: numberOrNull(opacity), rotation: numberOrNull(rotation), width: numberOrNull(width) }; if (Object.values(next).some((value) => value === null)) return; await onPatch([{ clipId: clip.id, layout: next as { height: number; opacity: number; rotation: number; width: number }, type: "clip.layout" }], `Transformación de ${clip.label}.`); };
  return <div className="space-y-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-slate-900 dark:text-white">{clip.label}</p><p className="mt-0.5 text-[11px] text-slate-500 dark:text-gray-400">{clip.kind} · pista {clip.trackId}</p></div><div className="flex flex-wrap gap-1"><button type="button" disabled={saving} onClick={() => void onPatch([{ clipId: clip.id, hidden: !clip.hidden, type: "clip.visibility" }], `${clip.hidden ? "Mostró" : "Ocultó"} ${clip.label}.`)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50 dark:border-white/15 dark:text-gray-200">{clip.hidden ? <Eye size={13} /> : <EyeOff size={13} />}{clip.hidden ? "Mostrar" : "Ocultar"}</button><button type="button" disabled={saving} onClick={() => void onRemove(clip)} className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-400/40 dark:text-red-200 dark:hover:bg-red-400/10"><Trash2 size={13} /> Quitar</button></div></div><p className="rounded-md bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500 dark:bg-white/5 dark:text-gray-400">Quitar solo retira este clip de la línea de tiempo; los assets y el deck original permanecen disponibles.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><InspectorField label="Inicio (s)" value={startSeconds} onChange={setStartSeconds} min={0} /><InspectorField label="Duración (s)" value={durationSeconds} onChange={setDurationSeconds} min={0.05} /><InspectorField label="Posición X" value={x} onChange={setX} /><InspectorField label="Posición Y" value={y} onChange={setY} /></div><div className="border-t border-slate-200 pt-3 dark:border-white/10"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Transformación</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><InspectorField label="Ancho" value={width} onChange={setWidth} min={1} /><InspectorField label="Alto" value={height} onChange={setHeight} min={1} /><InspectorField label="Rotación" value={rotation} onChange={setRotation} min={-360} /><InspectorField label="Opacidad" value={opacity} onChange={setOpacity} min={0} /></div><p className="mt-2 text-[10px] text-slate-500">Arrastra en el preview para mover; usa el tirador para redimensionar. Mantén Alt para liberar proporciones.</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={() => void saveTiming()} className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50 dark:bg-cyan-400 dark:text-slate-950"><Save size={13} /> Guardar tiempo</button><button type="button" disabled={saving} onClick={() => void savePosition()} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50 dark:border-white/15 dark:text-gray-200">Guardar posición</button><button type="button" disabled={saving} onClick={() => void saveTransform()} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50 dark:border-white/15 dark:text-gray-200">Guardar transformación</button>{saving && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400"><Loader2 className="animate-spin" size={13} /> Actualizando preview…</span>}</div></div>;
}

function InspectorField({ label, min, onChange, value }: { label: string; min?: number; onChange: (value: string) => void; value: string }) { return <label className="text-xs font-medium text-slate-600 dark:text-gray-300"><span>{label}</span><input type="number" step="0.05" min={min} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" /></label>; }

function buildTimelineRuler(durationSeconds: number) {
  const safeDuration = Math.max(durationSeconds, 0.05);
  const majorCandidates = [0.5, 1, 2, 5, 10, 15, 30, 60];
  const majorInterval = majorCandidates.find((candidate) => safeDuration / candidate <= 8) || 60;
  const minorInterval = majorInterval >= 2 ? majorInterval / 2 : majorInterval / 5;
  const major: number[] = [];
  const minor: number[] = [];
  for (let time = 0; time <= safeDuration + 0.001; time += minorInterval) {
    const rounded = Math.round(time * 100) / 100;
    if (Math.abs((rounded / majorInterval) - Math.round(rounded / majorInterval)) < 0.001) major.push(rounded);
    else minor.push(rounded);
  }
  if (major[major.length - 1] !== safeDuration) major.push(safeDuration);
  return { major, minor };
}

function CompositionTimeline({ assetLabels, currentTime, document, onClearSelection, onDurationChange, onSeek, onSelect, selectedHfId }: { assetLabels: Record<string, string>; currentTime: number; document: CompositionEditorDocument; onClearSelection: () => void; onDurationChange: (clip: CompositionClip, durationSeconds: number) => void; onSeek: (seconds: number) => void; onSelect: (hfId: string) => void; selectedHfId: string | null }) {
  const [resizing, setResizing] = useState<{ clip: CompositionClip; durationSeconds: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const tracks = document.tracks.slice().sort((left, right) => left.order - right.order);
  const maxDuration = document.canvas.durationSeconds;
  const ruler = useMemo(() => buildTimelineRuler(maxDuration), [maxDuration]);
  const finishResize = () => {
    if (!resizing) return;
    if (Math.abs(resizing.durationSeconds - resizing.clip.durationSeconds) >= 0.05) onDurationChange(resizing.clip, resizing.durationSeconds);
    setResizing(null);
  };
  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / Math.max(box.width, 1)));
    onSeek(Math.round(ratio * maxDuration * 20) / 20);
  };
  const beginScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrubbing(true);
    seekFromPointer(event);
  };
  const continueScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbing) seekFromPointer(event);
  };
  const endScrub = () => setScrubbing(false);

  return <div className="space-y-2">
    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400"><span>Timeline</span><span>{formatSeconds(currentTime)} · {document.clips.length} clips · arrastra el borde derecho para duración</span></div>
    <div className="grid grid-cols-[105px_minmax(0,1fr)] items-end gap-2"><span className="pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">Tiempo</span><div role="slider" aria-label="Cursor de la composición" aria-valuemax={maxDuration} aria-valuemin={0} aria-valuenow={currentTime} tabIndex={0} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); onSeek(Math.max(0, currentTime - 0.5)); } if (event.key === "ArrowRight") { event.preventDefault(); onSeek(Math.min(maxDuration, currentTime + 0.5)); } }} onPointerDown={beginScrub} onPointerMove={continueScrub} onPointerUp={endScrub} onPointerCancel={endScrub} className="relative h-8 cursor-ew-resize select-none overflow-hidden rounded-t-md border border-b-0 border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5">{ruler.minor.map((time) => <span key={`minor-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute bottom-0 h-2 w-px bg-slate-300 dark:bg-white/20" />)}{ruler.major.map((time) => <span key={`major-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute inset-y-0 w-px bg-slate-300 dark:bg-white/20"><span className="absolute left-1 top-1 whitespace-nowrap font-mono text-[9px] text-slate-500 dark:text-gray-400">{formatSeconds(time)}</span></span>)}<span aria-hidden="true" style={{ left: `${(currentTime / maxDuration) * 100}%` }} className={`absolute inset-y-0 z-30 w-0.5 bg-cyan-600 shadow-[0_0_7px_rgba(8,145,178,0.75)] dark:bg-cyan-300 ${scrubbing ? "opacity-100" : "opacity-90"}`}><span className="absolute -left-1.5 top-0 h-3 w-3 rotate-45 border border-cyan-700 bg-cyan-100 dark:border-cyan-100 dark:bg-cyan-400" /></span></div></div>
    {tracks.map((track) => {
      const clips = document.clips.filter((clip) => clip.trackId === track.id);
      // Visual and audio sources frequently start at the same instant. Showing
      // one lane per source prevents a later clip from hiding an avatar clip.
      const lanes = track.kind === "DECK" ? [clips] : clips.map((clip) => [clip]);
      return <div key={track.id} className="grid grid-cols-[105px_minmax(0,1fr)] items-start gap-2">
        <span className="pt-2 text-xs font-medium text-slate-600 dark:text-gray-300">{track.label}</span>
        <div className="space-y-1">
          {lanes.map((lane, laneIndex) => <div key={`${track.id}-${laneIndex}`} data-timeline-lane onClick={(event) => { if (event.target === event.currentTarget) onClearSelection(); }} onPointerDown={(event) => { if (event.target === event.currentTarget) beginScrub(event); }} onPointerMove={(event) => {
            if (scrubbing) { continueScrub(event); return; }
            if (!resizing) return;
            const box = event.currentTarget.getBoundingClientRect();
            const endSeconds = Math.max(resizing.clip.startSeconds + 0.05, Math.min(maxDuration, ((event.clientX - box.left) / box.width) * maxDuration));
            setResizing({ ...resizing, durationSeconds: Math.round((endSeconds - resizing.clip.startSeconds) * 20) / 20 });
          }} onPointerUp={() => { if (scrubbing) endScrub(); else finishResize(); }} onPointerCancel={() => { if (scrubbing) endScrub(); else finishResize(); }} className="relative h-9 overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5">
            {ruler.minor.map((time) => <span key={`minor-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute inset-y-0 w-px bg-slate-300/50 dark:bg-white/5" />)}
            {ruler.major.map((time) => <span key={`major-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute inset-y-0 w-px bg-slate-300 dark:bg-white/15" />)}
            <span aria-hidden="true" style={{ left: `${(currentTime / maxDuration) * 100}%` }} className="absolute inset-y-0 z-20 w-0.5 bg-[#00D4B3] shadow-[0_0_5px_rgba(0,212,179,0.75)]" />
            {lane.map((clip) => {
              const clipDuration = resizing?.clip.id === clip.id ? resizing.durationSeconds : clip.durationSeconds;
              const label = clip.source.type === "PRODUCTION_ASSET" ? assetLabels[clip.source.productionAssetId] || clip.label : clip.label;
              return <button key={clip.id} type="button" onClick={() => { onSeek(clip.startSeconds); onSelect(clip.hfId); }} title={`${label}: ${formatSeconds(clip.startSeconds)} – ${formatSeconds(clip.startSeconds + clipDuration)}`} style={{ left: `${(clip.startSeconds / maxDuration) * 100}%`, width: `${(clipDuration / maxDuration) * 100}%` }} className={`absolute inset-y-1 min-w-5 truncate rounded border px-2 pr-3 text-left text-[10px] font-semibold shadow-sm transition-colors ${selectedHfId === clip.hfId ? "border-[#0A2540] bg-[#0A2540] text-white" : clip.timingSource === "ESTIMATED" ? "border-[#F59E0B] bg-[#F59E0B]/30 text-[#0A2540] hover:bg-[#F59E0B]/40" : "border-[#00D4B3] bg-[#00D4B3]/20 text-[#0A2540] hover:bg-[#00D4B3]/30 dark:text-[#E9ECEF]"}`}><span>{label}</span><span aria-label={`Cambiar duración de ${label}`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setResizing({ clip, durationSeconds: clip.durationSeconds }); }} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize border-l border-black/20 hover:bg-black/10" /></button>;
            })}
          </div>)}
          {lanes.length === 0 && <div className="flex h-9 items-center rounded-md border border-dashed border-slate-200 px-2 text-[10px] text-slate-400 dark:border-white/10">Sin clips</div>}
        </div>
      </div>;
    })}
  </div>;
}

function LegacyCompositionTimeline({ currentTime, document, onClearSelection, onDurationChange, onSeek, onSelect, selectedHfId }: { currentTime: number; document: CompositionEditorDocument; onClearSelection: () => void; onDurationChange: (clip: CompositionClip, durationSeconds: number) => void; onSeek: (seconds: number) => void; onSelect: (hfId: string) => void; selectedHfId: string | null }) {
  const [resizing, setResizing] = useState<{ clip: CompositionClip; durationSeconds: number } | null>(null);
  const tracks = document.tracks.slice().sort((left, right) => left.order - right.order);
  const maxDuration = document.canvas.durationSeconds;
  const finishResize = () => { if (!resizing) return; if (Math.abs(resizing.durationSeconds - resizing.clip.durationSeconds) >= 0.05) onDurationChange(resizing.clip, resizing.durationSeconds); setResizing(null); };
  return <div className="space-y-2"><div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400"><span>Timeline</span><span>{document.clips.length} clips · arrastra el borde derecho para duración</span></div>{tracks.map((track) => { const clips = document.clips.filter((clip) => clip.trackId === track.id); return <div key={track.id} className="grid grid-cols-[105px_minmax(0,1fr)] items-center gap-2"><span className="truncate text-xs font-medium text-slate-600 dark:text-gray-300">{track.label}</span><div data-timeline-lane onClick={(event) => { if (event.target === event.currentTarget) onClearSelection(); }} onPointerMove={(event) => { if (!resizing) return; const box = event.currentTarget.getBoundingClientRect(); const endSeconds = Math.max(resizing.clip.startSeconds + 0.05, Math.min(maxDuration, ((event.clientX - box.left) / box.width) * maxDuration)); setResizing({ ...resizing, durationSeconds: Math.round((endSeconds - resizing.clip.startSeconds) * 20) / 20 }); }} onPointerUp={finishResize} onPointerCancel={finishResize} className="relative h-10 overflow-hidden rounded-md bg-slate-100 dark:bg-white/5"><span aria-hidden="true" style={{ left: `${(currentTime / maxDuration) * 100}%` }} className="absolute inset-y-0 z-20 w-px bg-cyan-600 dark:bg-cyan-300" />{clips.map((clip) => { const clipDuration = resizing?.clip.id === clip.id ? resizing.durationSeconds : clip.durationSeconds; return <button key={clip.id} type="button" onClick={() => { onSeek(clip.startSeconds); onSelect(clip.hfId); }} title={`${clip.label}: ${formatSeconds(clip.startSeconds)} – ${formatSeconds(clip.startSeconds + clipDuration)}`} style={{ left: `${(clip.startSeconds / maxDuration) * 100}%`, width: `${(clipDuration / maxDuration) * 100}%` }} className={`absolute inset-y-1 min-w-5 truncate rounded px-2 pr-3 text-left text-[10px] font-semibold transition-colors ${selectedHfId === clip.hfId ? "bg-cyan-600 text-white dark:bg-cyan-300 dark:text-slate-950" : clip.timingSource === "ESTIMATED" ? "bg-amber-200 text-amber-950 hover:bg-amber-300 dark:bg-amber-300/30 dark:text-amber-100" : "bg-cyan-200 text-cyan-950 hover:bg-cyan-300 dark:bg-cyan-400/30 dark:text-cyan-100"}`}><span>{clip.label}</span><span aria-label={`Cambiar duración de ${clip.label}`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setResizing({ clip, durationSeconds: clip.durationSeconds }); }} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize border-l border-black/20 hover:bg-black/10" /></button>; })}</div></div>; })}</div>;
}

void LegacyCompositionTimeline;

function LoadingPreview() { return <div className="flex min-h-72 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-600 dark:border-white/10 dark:bg-[#0B1119] dark:text-gray-300"><Loader2 className="mr-2 animate-spin" size={18} /> Preparando editor de composición…</div>; }
function PreviewError({ error, onRetry }: { error: string; onRetry: () => void }) { return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100"><p className="font-bold">No se pudo cargar el preview</p><p className="mt-1">{error}</p><button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-current px-3 py-1.5 text-xs font-bold">Reintentar</button></div>; }
function formatSeconds(value: number) { const seconds = Math.max(0, Math.floor(value)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
