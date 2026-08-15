"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clapperboard, Crop, Eye, EyeOff, FileQuestion, Grid3X3, Image as ImageIcon, Loader2, Magnet, Maximize2, Minus, MousePointer2, Music2, PanelRight, Pause, Play, Plus, RefreshCw, Save, Send, Trash2, Video, X } from "lucide-react";
import type { CompositionClip, CompositionEditorDocument, CompositionTrack } from "@/domains/production/composition-editor/composition-document.types";
import { formatCompositionTimecode, parseCompositionTimecode } from "@/domains/production/composition-editor/composition-timecode";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import { applyCompositionEditorPatches, ensureCanvasDurationForClipPatches } from "@/domains/production/composition-editor/editor-patch.service";
import { resolveCompositionTrackDefinition } from "@/domains/production/composition-editor/composition-track-registry";
import { CompositionTimeline } from "./CompositionTimeline";
import { AudioMixControls } from "./AudioMixControls";
import { LayerDepthControls } from "./LayerDepthControls";
import {
  CompositionDurationResolutionError,
  resolveCompositionDuration,
} from "@/domains/production/composition-editor/composition-duration.service";

type PreviewMessage =
  | { type: "courseforge-composition-ready"; duration: number }
  | { type: "courseforge-composition-time"; seconds: number }
  | { type: "courseforge-composition-playback"; playing: boolean }
  | { type: "courseforge-composition-media-error"; code: string; mediaId: string; message: string }
  | { type: "courseforge-composition-selection"; hfId: string | null }
  | { type: "courseforge-composition-layout-commit"; hfId: string; layout: { height: number; width: number; x: number; y: number } };

type DocumentPayload = { document: CompositionEditorDocument; documentHash: string; version: number };
type AgentProposal = { documentHash: string; model: string; operations: CompositionEditorPatchOperation[]; source: "AGENT"; summary: string };
const DURATION_SOURCE_LABELS: Record<NonNullable<CompositionEditorDocument["canvas"]["durationSource"]>, string> = {
  avatar_clips: "clips de avatar",
  avatar_full: "avatar completo",
  b_roll: "B-roll",
  slides: "diapositivas",
  voice: "voz",
};

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
  timelineRole?: "AUDIO" | "AVATAR" | "BROLL" | "VISUAL" | "VOICE";
  timelineVariant?: "CLIP" | "FULL";
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
  const mediaRecoveryHashRef = useRef<string | null>(null);
  const playheadSecondsRef = useRef(0);
  const pendingPreviewRestoreSecondsRef = useRef<number | null>(null);
  const [payload, setPayload] = useState<DocumentPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
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
  const [directEditingEnabled, setDirectEditingEnabled] = useState(true);
  const [gridVisible, setGridVisible] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [trimToolEnabled, setTrimToolEnabled] = useState(false);

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
      playheadSecondsRef.current = 0;
      pendingPreviewRestoreSecondsRef.current = null;
      setPlaying(false);
      setPreviewReady(false);
      setPlaybackError(null);
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
      if (message.type === "courseforge-composition-time") {
        playheadSecondsRef.current = message.seconds;
        setSeconds(message.seconds);
      }
      if (message.type === "courseforge-composition-playback") {
        setPlaying(message.playing);
        if (message.playing) setPlaybackError(null);
      }
      if (message.type === "courseforge-composition-ready") {
        setPreviewReady(true);
        setPlaybackError(null);
        const restoreSeconds = pendingPreviewRestoreSecondsRef.current;
        if (restoreSeconds !== null) {
          pendingPreviewRestoreSecondsRef.current = null;
          const clampedSeconds = Math.max(0, Math.min(message.duration, restoreSeconds));
          playheadSecondsRef.current = clampedSeconds;
          setSeconds(clampedSeconds);
          frameRef.current?.contentWindow?.postMessage({ type: "courseforge-composition-seek", seconds: clampedSeconds }, "*");
        }
        if (selectedHfId) {
          frameRef.current?.contentWindow?.postMessage({ type: "courseforge-composition-select", hfId: selectedHfId }, "*");
        }
      }
      if (message.type === "courseforge-composition-media-error") {
        if (message.code === "AbortError") return;
        if (message.code === "NotAllowedError") {
          setPlaybackError("El navegador bloqueó el audio. Pulsa “Activar audio y reproducir” dentro del preview.");
          return;
        }
        const currentHash = payloadRef.current?.documentHash || null;
        if (currentHash && mediaRecoveryHashRef.current !== currentHash) {
          mediaRecoveryHashRef.current = currentHash;
          frameRef.current?.contentWindow?.postMessage({ type: "courseforge-composition-pause" }, "*");
          setPlaying(false);
          setPreviewReady(false);
          setPlaybackError("El enlace del medio dejó de responder. Renovando el acceso al preview…");
          setPreviewRefreshKey((current) => current + 1);
          return;
        }
        setPlaybackError(`No se pudo reproducir ${message.mediaId}: ${message.message}`);
      }
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
  const durationSourceLabel = payload?.document.canvas.durationSource
    ? DURATION_SOURCE_LABELS[payload.document.canvas.durationSource]
    : null;
  const previewUrl = useMemo(() => payload ? `/api/production/hyperframes/drafts/${draftId}/preview?v=${encodeURIComponent(payload.documentHash)}&r=${previewRefreshKey}` : null, [draftId, payload?.documentHash, previewRefreshKey]);
  useEffect(() => {
    setPlaying(false);
    setPreviewReady(false);
  }, [previewUrl]);
  useEffect(() => {
    mediaRecoveryHashRef.current = null;
  }, [payload?.documentHash]);
  const estimatedClipCount = payload?.document.clips.filter((clip) => clip.timingSource === "ESTIMATED").length || 0;
  const selectedClip = payload?.document.clips.find((clip) => clip.hfId === selectedHfId) ?? null;
  const inspectorOpen = manualInspectorOpen || Boolean(selectedClip);

  const postPreviewMessage = (message: Record<string, unknown>) => frameRef.current?.contentWindow?.postMessage(message, "*");
  useEffect(() => {
    if (!previewReady) return;
    postPreviewMessage({
      editingEnabled: directEditingEnabled,
      gridVisible,
      snapEnabled,
      type: "courseforge-composition-editor-settings",
    });
  }, [directEditingEnabled, gridVisible, previewReady, snapEnabled]);
  const refreshPreviewMedia = () => {
    postPreviewMessage({ type: "courseforge-composition-pause" });
    mediaRecoveryHashRef.current = null;
    setPlaying(false);
    setPreviewReady(false);
    setPlaybackError("Renovando el acceso a los medios del preview…");
    setPreviewRefreshKey((current) => current + 1);
  };
  const seek = (nextSeconds: number) => {
    playheadSecondsRef.current = nextSeconds;
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
  const pausePreviewForMutation = () => {
    pendingPreviewRestoreSecondsRef.current = playheadSecondsRef.current;
    postPreviewMessage({ type: "courseforge-composition-pause" });
    setPlaying(false);
    setPreviewReady(false);
    setPlaybackError(null);
  };
  async function savePatch(operations: CompositionEditorPatchOperation[], summary: string, source: "AGENT" | "USER" = "USER"): Promise<boolean> {
    const currentPayload = payloadRef.current;
    if (!currentPayload || saveInFlightRef.current) return false;
    const effectiveOperations = ensureCanvasDurationForClipPatches(currentPayload.document, operations);
    let optimisticDocument: CompositionEditorDocument;
    try {
      optimisticDocument = applyCompositionEditorPatches(currentPayload.document, effectiveOperations);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "El cambio solicitado no es válido.");
      return false;
    }
    pausePreviewForMutation();
    saveInFlightRef.current = true;
    setSaving(true);
    setSaveError(null);
    setFailedSave(null);
    const optimisticPayload = { ...currentPayload, document: optimisticDocument };
    payloadRef.current = optimisticPayload;
    setPayload(optimisticPayload);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/document`, {
        body: JSON.stringify({ operations: effectiveOperations, source, summary }),
        headers: { "Content-Type": "application/json", "If-Match": `"${currentPayload.documentHash}"` },
        method: "PUT",
      });
      const body = await response.json();
      if (response.status === 409 && body.data) {
        const nextPayload = body.data as DocumentPayload;
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        setFailedSave({ operations: effectiveOperations, source, summary });
        setSaveError(body.error || "La composición cambió en otra sesión. El preview se actualizó con la última versión.");
        return false;
      }
      if (!response.ok) throw new Error(body.error || "No se pudo guardar el cambio.");
      const nextPayload = body.data as DocumentPayload;
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      if (nextPayload.documentHash === currentPayload.documentHash) {
        pendingPreviewRestoreSecondsRef.current = null;
        setPreviewReady(true);
      }
      return true;
    } catch (caught) {
      pendingPreviewRestoreSecondsRef.current = null;
      payloadRef.current = currentPayload;
      setPayload(currentPayload);
      setPreviewReady(true);
      setFailedSave({ operations: effectiveOperations, source, summary });
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

    const trackDefinition = resolveCompositionTrackDefinition(asset);
    const trackId = trackDefinition.id;
    const isAudio = trackDefinition.kind === "AUDIO";
    const existingTrack = payload.document.tracks.find((track) => track.id === trackId);
    const isBackgroundAudio = trackDefinition.semanticRole === "MUSIC";
    const isSequential = !isBackgroundAudio;
    const preferredDuration = asset.durationSeconds || (isAudio ? payload.document.canvas.durationSeconds : asset.mimeType.startsWith("image/") ? 5 : 8);
    const occupiedUntil = payload.document.clips
      .filter((candidate) => candidate.trackId === trackId)
      .reduce((latest, candidate) => Math.max(latest, candidate.startSeconds + candidate.durationSeconds), 0);
    const clipDuration = Math.min(
      preferredDuration,
      payload.document.canvas.durationSeconds - (isSequential ? occupiedUntil : 0),
    );
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
      ...(asset.durationSeconds && asset.durationSeconds > 0 ? { sourceDurationSeconds: asset.durationSeconds } : {}),
      sourceOffsetSeconds: 0,
      startSeconds: isSequential ? occupiedUntil : 0,
      timingSource: "ESTIMATED",
      trackId,
    };
    const added = await savePatch([{
      clip,
      clipId,
      track: existingTrack ? undefined : trackDefinition,
      type: "clip.add",
    }], `Agregó ${asset.label} a la línea de tiempo.`);
    if (added) selectClip(clip.hfId);
  }

  async function removeClipFromTimeline(clip: CompositionClip) {
    const removed = await savePatch([{ clipId: clip.id, type: "clip.remove" }], `Quitó ${clip.label} de la línea de tiempo.`);
    if (removed) clearSelection();
  }

  async function updateTrack(track: CompositionTrack, settings: { hidden?: boolean; locked?: boolean; muted?: boolean; volume?: number }, summary: string) {
    await savePatch([{ settings, trackId: track.id, type: "track.update" }], summary);
  }

  async function applyBaseTemplate() {
    if (!payload) return;
    const hasManualTiming = payload.document.clips.some((clip) => clip.timingSource === "USER_EDITED");
    const confirmation = hasManualTiming
      ? "La composición contiene ajustes manuales. Aplicar la duración automática reorganizará sus tiempos y layouts, pero conservará los assets y las versiones anteriores. ¿Continuar?"
      : "Esto calculará la duración por prioridad y organizará los clips. Los assets y versiones anteriores se conservarán. ¿Aplicar plantilla base?";
    if (!window.confirm(confirmation)) return;
    const sourceById = new Map(assets.map((asset) => [asset.id, asset]));
    const editableAssetIds = new Set(sourceById.keys());
    const deckClips = payload.document.clips
      .filter((clip) => clip.source.type === "DECK_SLIDE")
      .sort((left, right) => {
        const leftIndex = left.source.type === "DECK_SLIDE" ? left.source.slideIndex : 0;
        const rightIndex = right.source.type === "DECK_SLIDE" ? right.source.slideIndex : 0;
        return leftIndex - rightIndex;
      });
    let resolution;
    try {
      resolution = resolveCompositionDuration({ assets, slideCount: deckClips.length });
    } catch (error) {
      setSaveError(error instanceof CompositionDurationResolutionError
        ? error.message
        : "No se pudo calcular la duración de la composición.");
      return;
    }
    const canvasDuration = resolution.durationSeconds;
    const timelineAssetIds = new Set(payload.document.clips.flatMap((clip) => (
      clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []
    )));
    const requiredDurationAssets = resolution.source === "voice"
      ? assets.filter((asset) => asset.timelineRole === "VOICE")
      : resolution.source === "avatar_full"
        ? assets.filter((asset) => asset.timelineRole === "AVATAR" && asset.timelineVariant === "FULL")
          .sort((left, right) => (right.durationSeconds || 0) - (left.durationSeconds || 0)).slice(0, 1)
        : resolution.source === "avatar_clips"
          ? assets.filter((asset) => asset.timelineRole === "AVATAR" && asset.timelineVariant !== "FULL")
          : resolution.source === "b_roll"
            ? assets.filter((asset) => asset.timelineRole === "BROLL")
            : [];
    const missingDurationAssets = requiredDurationAssets.filter((asset) => !timelineAssetIds.has(asset.id));
    if (missingDurationAssets.length > 0) {
      setSaveError(`Agrega primero al timeline ${missingDurationAssets.map((asset) => asset.label).join(", ")}. Es el material que determina la duración por ${DURATION_SOURCE_LABELS[resolution.source]}.`);
      return;
    }
    const canvasOperation: CompositionEditorPatchOperation = {
      clipId: "canvas",
      durationMode: "AUTO",
      durationSeconds: canvasDuration,
      durationSource: resolution.source,
      type: "composition.canvas-duration",
    };
    const clipOperations: CompositionEditorPatchOperation[] = [];
    const authoritativeFullAvatar = assets
      .filter((asset) => asset.timelineRole === "AVATAR" && asset.timelineVariant === "FULL")
      .sort((left, right) => (right.durationSeconds || 0) - (left.durationSeconds || 0))[0];
    const fullAvatarIds = new Set(authoritativeFullAvatar ? [authoritativeFullAvatar.id] : []);
    // Raster files referenced by the editable HTML deck must not also be independent timeline media.
    for (const clip of payload.document.clips) {
      if (clip.source.type === "PRODUCTION_ASSET" && !editableAssetIds.has(clip.source.productionAssetId)) {
        clipOperations.push({ clipId: clip.id, type: "clip.remove" });
      } else if (
        fullAvatarIds.size > 0
        && clip.trackId === "avatar"
        && clip.source.type === "PRODUCTION_ASSET"
        && !fullAvatarIds.has(clip.source.productionAssetId)
      ) {
        clipOperations.push({ clipId: clip.id, type: "clip.remove" });
      }
    }
    for (let index = 0; index < deckClips.length; index++) {
      const clip = deckClips[index]!;
      const startSeconds = Math.round((canvasDuration * index / deckClips.length) * 20) / 20;
      const endSeconds = index === deckClips.length - 1 ? canvasDuration : Math.round((canvasDuration * (index + 1) / deckClips.length) * 20) / 20;
      clipOperations.push({ clipId: clip.id, durationSeconds: Math.max(0.05, endSeconds - startSeconds), layout: { ...clip.layout, height: payload.document.canvas.height, width: payload.document.canvas.width, x: 0, y: 0, zIndex: 0 }, startSeconds, timingSource: "ESTIMATED", type: "clip.template" });
    }
    for (const trackId of ["avatar", "voice", "music", "broll", "visual"]) {
      const clips = payload.document.clips.filter((clip) => (
        clip.source.type === "PRODUCTION_ASSET"
        && clip.trackId === trackId
        && editableAssetIds.has(clip.source.productionAssetId)
        && !(trackId === "avatar" && fullAvatarIds.size > 0 && !fullAvatarIds.has(clip.source.productionAssetId))
      ));
      const preferredDurations = clips.map((clip) => {
        if (clip.source.type !== "PRODUCTION_ASSET") return clip.durationSeconds;
        const asset = sourceById.get(clip.source.productionAssetId);
        return Math.min(canvasDuration, asset?.durationSeconds || (trackId === "voice" || trackId === "music" || trackId === "avatar" ? canvasDuration : clip.kind === "IMAGE" ? 5 : 8));
      });
      const totalPreferredDuration = preferredDurations.reduce((total, value) => total + value, 0);
      const durationScale = trackId !== "music" && totalPreferredDuration > canvasDuration
        ? canvasDuration / totalPreferredDuration
        : 1;
      let cursor = 0;
      for (let index = 0; index < clips.length; index++) {
        const clip = clips[index]!;
        if (clip.source.type !== "PRODUCTION_ASSET") continue;
        const preferredDuration = preferredDurations[index]!;
        const isSequential = trackId !== "music";
        const durationSeconds = isSequential
          ? Math.max(0.05, Math.min(preferredDuration * durationScale, canvasDuration - cursor))
          : preferredDuration;
        const avatarWidth = Math.round(payload.document.canvas.width * 0.32);
        const avatarHeight = Math.round(payload.document.canvas.height * 0.65);
        clipOperations.push({ clipId: clip.id, durationSeconds, layout: trackId === "avatar" ? { ...clip.layout, height: avatarHeight, width: avatarWidth, x: payload.document.canvas.width - avatarWidth - 48, y: payload.document.canvas.height - avatarHeight - 48, zIndex: 10 } : trackId === "voice" || trackId === "music" ? { ...clip.layout, height: 1, width: 1, x: 0, y: 0, zIndex: 0 } : { ...clip.layout, height: payload.document.canvas.height, width: payload.document.canvas.width, x: 0, y: 0, zIndex: trackId === "broll" ? 5 : 4 }, startSeconds: isSequential ? cursor : 0, timingSource: "ESTIMATED", type: "clip.template" });
        if (isSequential) cursor += durationSeconds;
      }
    }
    const operations = canvasDuration < payload.document.canvas.durationSeconds
      ? [...clipOperations, canvasOperation]
      : [canvasOperation, ...clipOperations];
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

  async function scaleSelectedClip(factor: number) {
    if (!selectedClip || selectedClip.kind === "AUDIO" || !payload) return;
    const centerX = selectedClip.layout.x + selectedClip.layout.width / 2;
    const centerY = selectedClip.layout.y + selectedClip.layout.height / 2;
    const width = Math.max(24, Math.min(8_192, Math.round(selectedClip.layout.width * factor)));
    const height = Math.max(24, Math.min(8_192, Math.round(selectedClip.layout.height * factor)));
    await savePatch([{ clipId: selectedClip.id, layout: {
      height,
      width,
      x: Math.round(centerX - width / 2),
      y: Math.round(centerY - height / 2),
    }, type: "clip.layout" }], `${factor > 1 ? "Aumentó" : "Redujo"} el tamaño de ${selectedClip.label}.`);
  }

  async function fitSelectedClip() {
    if (!selectedClip || selectedClip.kind === "AUDIO" || !payload) return;
    const { height: canvasHeight, width: canvasWidth } = payload.document.canvas;
    const scale = Math.min((canvasWidth * 0.9) / selectedClip.layout.width, (canvasHeight * 0.9) / selectedClip.layout.height);
    const width = Math.max(24, Math.round(selectedClip.layout.width * scale));
    const height = Math.max(24, Math.round(selectedClip.layout.height * scale));
    await savePatch([{ clipId: selectedClip.id, layout: {
      height,
      width,
      x: Math.round((canvasWidth - width) / 2),
      y: Math.round((canvasHeight - height) / 2),
    }, type: "clip.layout" }], `Ajustó ${selectedClip.label} al canvas.`);
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
          <p className="mt-0.5 text-xs text-slate-500 dark:text-gray-400">Versión {payload.version} · {formatSeconds(duration)} · duración por {durationSourceLabel || "origen no registrado"} · cambios guardados por versión</p>
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs text-slate-300">
            <span className="font-semibold">Preview completo</span>
            <div className="flex flex-wrap items-center gap-1">
              <PreviewToolButton active={directEditingEnabled} label="Editar" title="Activar selección, arrastre y tiradores" onClick={() => setDirectEditingEnabled((current) => !current)}><MousePointer2 size={13} /></PreviewToolButton>
              <PreviewToolButton active={snapEnabled} label="Snap" title="Ajustar movimientos y tamaños a la rejilla" onClick={() => setSnapEnabled((current) => !current)}><Magnet size={13} /></PreviewToolButton>
              <PreviewToolButton active={gridVisible} label="Rejilla" title="Mostrar guías visuales en el canvas" onClick={() => setGridVisible((current) => !current)}><Grid3X3 size={13} /></PreviewToolButton>
              <PreviewToolButton active={trimToolEnabled} label="Recorte" title="Resaltar los tiradores de recorte temporal en la timeline" onClick={() => setTrimToolEnabled((current) => !current)}><Crop size={13} /></PreviewToolButton>
              <span className="mx-1 h-5 w-px bg-white/15" />
              <button type="button" disabled={!selectedClip || selectedClip.kind === "AUDIO" || saving} onClick={() => void scaleSelectedClip(0.9)} title="Reducir 10%" className="rounded p-1.5 hover:bg-white/10 disabled:opacity-30"><Minus size={13} /></button>
              <button type="button" disabled={!selectedClip || selectedClip.kind === "AUDIO" || saving} onClick={() => void scaleSelectedClip(1.1)} title="Aumentar 10%" className="rounded p-1.5 hover:bg-white/10 disabled:opacity-30"><Plus size={13} /></button>
              <button type="button" disabled={!selectedClip || selectedClip.kind === "AUDIO" || saving} onClick={() => void fitSelectedClip()} title="Ajustar y centrar en el canvas" className="rounded p-1.5 hover:bg-white/10 disabled:opacity-30"><Maximize2 size={13} /></button>
              <span className="ml-1 font-mono text-[10px] text-slate-400">{formatSeconds(seconds)} / {formatSeconds(duration)}</span>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-2">
            <div className="relative aspect-video h-full max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-2xl">
              <iframe ref={frameRef} title="Preview completo de composición" src={previewUrl} sandbox="allow-scripts" allow="autoplay" className="absolute inset-0 h-full w-full" />
            </div>
          </div>
          {playbackError && <div role="alert" className="flex items-center justify-between gap-3 border-t border-amber-300/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100"><span>{playbackError}</span><button type="button" onClick={refreshPreviewMedia} className="shrink-0 rounded border border-amber-200/50 px-2 py-1 font-semibold hover:bg-amber-200/10">Recargar medios</button></div>}
          <div className="flex items-center gap-3 border-t border-white/10 bg-[#0A2540] px-3 py-2.5">
            <button type="button" disabled={saving || !previewReady} onClick={() => postPreviewMessage({ type: playing ? "courseforge-composition-pause" : "courseforge-composition-play" })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#00D4B3] text-[#0A2540] hover:bg-[#10B981] disabled:cursor-wait disabled:opacity-50">{playing ? <Pause size={15} /> : <Play size={15} />}</button>
            <input aria-label="Posición del preview" disabled={saving || !previewReady} type="range" min="0" max={duration} step="0.05" value={Math.min(seconds, duration)} onChange={(event) => seek(Number(event.target.value))} className="w-full accent-[#00D4B3] disabled:cursor-wait disabled:opacity-50" />
          </div>
        </section>

        <section className="min-h-0 min-w-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-[#101720] lg:col-span-2 lg:row-start-2">
          <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${durationSourceLabel ? "border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5" : "border-amber-300 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-400/10"}`}><span className="text-slate-600 dark:text-gray-300">{durationSourceLabel ? `Duración final: ${formatCompositionTimecode(duration)} determinada por ${durationSourceLabel}.` : "Esta composición aún no registra qué asset determina su duración. Aplica el cálculo automático para normalizarla."}</span><button type="button" disabled={saving} onClick={() => void applyBaseTemplate()} className="rounded-md border border-[#00D4B3] px-2.5 py-1 font-bold text-[#0A2540] hover:bg-[#00D4B3]/10 disabled:opacity-50 dark:text-[#00D4B3]">Calcular y organizar</button></div>
          <AudioMixControls audioMix={payload.document.audioMix} disabled={saving} onUpdate={(settings, summary) => void savePatch([{ settings, type: "audio-mix.update" }], summary)} />
          <CompositionTimeline assetLabels={Object.fromEntries(assets.map((asset) => [asset.id, asset.label]))} document={payload.document} currentTime={seconds} saving={saving} selectedHfId={selectedHfId} snapEnabled={snapEnabled} trimMode={trimToolEnabled} onClearSelection={clearSelection} onDurationChange={(clip, durationSeconds) => void savePatch([{ clipId: clip.id, durationSeconds, type: "clip.duration" }], `Ajustó la duración de ${clip.label} desde la timeline.`)} onMove={(clip, startSeconds) => void savePatch([{ clipId: clip.id, startSeconds, type: "clip.move" }], `Movió ${clip.label} a ${startSeconds} segundos.`)} onSeek={seek} onSelect={selectClip} onTrackUpdate={(track, settings, summary) => void updateTrack(track, settings, summary)} onTrim={(clip, startSeconds, durationSeconds, sourceOffsetSeconds) => void savePatch([{ clipId: clip.id, durationSeconds, sourceOffsetSeconds, startSeconds, type: "clip.trim" }], `Recortó el inicio de ${clip.label} desde la timeline.`)} />
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

function PreviewToolButton({ active, children, label, onClick, title }: { active: boolean; children: ReactNode; label: string; onClick: () => void; title: string }) {
  return <button type="button" aria-pressed={active} onClick={onClick} title={title} className={`inline-flex items-center gap-1 rounded px-1.5 py-1 font-semibold transition-colors ${active ? "bg-cyan-400 text-slate-950" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}>{children}<span className="hidden xl:inline">{label}</span></button>;
}


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
  return <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-400/20 dark:bg-cyan-400/10"><div className="text-xs text-cyan-950 dark:text-cyan-100"><p className="font-bold">Ensamble del video</p><p className="mt-0.5">{assembly ? assembly.status === "READY_FOR_RENDER" ? "Snapshot aprobado. Puedes enviar el render." : "Snapshot listo. Revísalo y apruébalo para renderizar." : "Congela la versión guardada antes de enviar un render."}</p>{label && <p className="mt-1 font-medium">{label}</p>}{error && <p role="alert" className="mt-1 text-red-700 dark:text-red-200">{error}</p>}</div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void onPrepare()} className="inline-flex items-center gap-1.5 rounded-md bg-cyan-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Clapperboard size={14} /> {busy && renderStatus === "validating" ? "Congelando…" : assembly ? "Regenerar snapshot" : "Congelar snapshot"}</button>{assembly?.status === "READY_FOR_PREVIEW" && <button type="button" disabled={busy} onClick={() => void onApprove()} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-700 px-3 py-2 text-xs font-bold text-cyan-900 disabled:opacity-50 dark:border-cyan-300 dark:text-cyan-100"><CheckCircle2 size={14} /> Aprobar snapshot</button>}{assembly?.status === "READY_FOR_RENDER" && <button type="button" disabled={busy || renderStatus === "rendering"} onClick={() => void onRender()} className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950"><Send size={14} /> Renderizar video</button>}</div></div>;
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
  useEffect(() => { setStartSeconds(clip ? formatCompositionTimecode(clip.startSeconds) : ""); setDurationSeconds(clip ? formatCompositionTimecode(clip.durationSeconds) : ""); setX(clip ? String(clip.layout.x) : ""); setY(clip ? String(clip.layout.y) : ""); }, [clip?.id, clip?.startSeconds, clip?.durationSeconds, clip?.layout.x, clip?.layout.y]);
  useEffect(() => { setWidth(clip ? String(clip.layout.width) : ""); setHeight(clip ? String(clip.layout.height) : ""); setRotation(clip ? String(clip.layout.rotation) : ""); setOpacity(clip ? String(clip.layout.opacity) : ""); }, [clip?.id, clip?.layout.height, clip?.layout.opacity, clip?.layout.rotation, clip?.layout.width]);
  if (!clip) return <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-xs leading-5 text-slate-500 dark:border-white/10 dark:text-gray-400">Selecciona un clip en la timeline o directamente en el preview para editar su layout, visibilidad o duración.</p>;
  const numberOrNull = (value: string) => { const result = Number(value); return Number.isFinite(result) ? result : null; };
  const saveTiming = async () => { const start = parseCompositionTimecode(startSeconds); const duration = parseCompositionTimecode(durationSeconds); if (start === null || duration === null || duration < 0.05) return; await onPatch([{ clipId: clip.id, durationSeconds: duration, type: "clip.duration" }, { clipId: clip.id, startSeconds: start, type: "clip.move" }], `Ajustó la ubicación y duración de ${clip.label}.`); };
  const savePosition = async () => { const nextX = numberOrNull(x); const nextY = numberOrNull(y); if (nextX === null || nextY === null) return; await onPatch([{ clipId: clip.id, layout: { x: nextX, y: nextY }, type: "clip.layout" }], `Ajustó la posición de ${clip.label}.`); };
  const saveTransform = async () => { const next = { height: numberOrNull(height), opacity: numberOrNull(opacity), rotation: numberOrNull(rotation), width: numberOrNull(width) }; if (Object.values(next).some((value) => value === null)) return; await onPatch([{ clipId: clip.id, layout: next as { height: number; opacity: number; rotation: number; width: number }, type: "clip.layout" }], `Transformación de ${clip.label}.`); };
  return <div className="space-y-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-slate-900 dark:text-white">{clip.label}</p><p className="mt-0.5 text-[11px] text-slate-500 dark:text-gray-400">{clip.kind} · pista {clip.trackId}</p></div><div className="flex flex-wrap gap-1"><button type="button" disabled={saving} onClick={() => void onPatch([{ clipId: clip.id, hidden: !clip.hidden, type: "clip.visibility" }], `${clip.hidden ? "Mostró" : "Ocultó"} ${clip.label}.`)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50 dark:border-white/15 dark:text-gray-200">{clip.hidden ? <Eye size={13} /> : <EyeOff size={13} />}{clip.hidden ? "Mostrar" : "Ocultar"}</button><button type="button" disabled={saving} onClick={() => void onRemove(clip)} className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-400/40 dark:text-red-200 dark:hover:bg-red-400/10"><Trash2 size={13} /> Quitar</button></div></div><p className="rounded-md bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500 dark:bg-white/5 dark:text-gray-400">Quitar solo retira este clip de la línea de tiempo; los assets y el deck original permanecen disponibles.</p>{clip.kind !== "AUDIO" && <LayerDepthControls clip={clip} disabled={saving} onPatch={onPatch} />}<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><TimecodeField label="Inicio (mm:ss)" value={startSeconds} onChange={setStartSeconds} /><TimecodeField label="Duración (mm:ss)" value={durationSeconds} onChange={setDurationSeconds} /><InspectorField label="Posición X" value={x} onChange={setX} /><InspectorField label="Posición Y" value={y} onChange={setY} /></div><p className="text-[10px] text-slate-500 dark:text-gray-400">Formato: 01:05 = 1 minuto y 5 segundos; 00:01.050 incluye milisegundos.</p><div className="border-t border-slate-200 pt-3 dark:border-white/10"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Transformación</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><InspectorField label="Ancho" value={width} onChange={setWidth} min={1} /><InspectorField label="Alto" value={height} onChange={setHeight} min={1} /><InspectorField label="Rotación" value={rotation} onChange={setRotation} min={-360} /><InspectorField label="Opacidad" value={opacity} onChange={setOpacity} min={0} /></div><p className="mt-2 text-[10px] text-slate-500">Arrastra en el preview para mover; usa el tirador para redimensionar. Mantén Alt para liberar proporciones.</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={() => void saveTiming()} className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50 dark:bg-cyan-400 dark:text-slate-950"><Save size={13} /> Guardar tiempo</button><button type="button" disabled={saving} onClick={() => void savePosition()} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50 dark:border-white/15 dark:text-gray-200">Guardar posición</button><button type="button" disabled={saving} onClick={() => void saveTransform()} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50 dark:border-white/15 dark:text-gray-200">Guardar transformación</button>{saving && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400"><Loader2 className="animate-spin" size={13} /> Actualizando preview…</span>}</div></div>;
}

function TimecodeField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) { return <label className="text-xs font-medium text-slate-600 dark:text-gray-300"><span>{label}</span><input type="text" inputMode="decimal" placeholder="00:00" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" /></label>; }

function InspectorField({ label, min, onChange, value }: { label: string; min?: number; onChange: (value: string) => void; value: string }) { return <label className="text-xs font-medium text-slate-600 dark:text-gray-300"><span>{label}</span><input type="number" step="0.05" min={min} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" /></label>; }


function LoadingPreview() { return <div className="flex min-h-72 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-600 dark:border-white/10 dark:bg-[#0B1119] dark:text-gray-300"><Loader2 className="mr-2 animate-spin" size={18} /> Preparando editor de composición…</div>; }
function PreviewError({ error, onRetry }: { error: string; onRetry: () => void }) { return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100"><p className="font-bold">No se pudo cargar el preview</p><p className="mt-1">{error}</p><button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-current px-3 py-1.5 text-xs font-bold">Reintentar</button></div>; }
function formatSeconds(value: number) { const seconds = Math.max(0, Math.floor(value)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
