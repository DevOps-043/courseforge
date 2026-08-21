"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clapperboard, Crop, Eye, EyeOff, FileQuestion, GripHorizontal, Grid3X3, History, Image as ImageIcon, Loader2, Magnet, Maximize2, Minimize2, Minus, MousePointer2, Music2, PanelRight, Pause, Play, Plus, RefreshCw, RotateCcw, Save, Scan, Scissors, Send, Trash2, Video, X } from "lucide-react";
import type { CompositionClip, CompositionEditorDocument, CompositionTrack, CompositionVisualCrop } from "@/domains/production/composition-editor/composition-document.types";
import { formatCompositionTimecode, parseCompositionTimecode } from "@/domains/production/composition-editor/composition-timecode";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import type { CompositionAgentProposalEnvelope } from "@/domains/production/composition-editor/composition-agent-proposal.types";
import type { CompositionAgentRecoveryMetadata } from "@/domains/production/composition-editor/composition-agent-recovery.service";
import { applyCompositionEditorPatches, ensureCanvasDurationForClipPatches } from "@/domains/production/composition-editor/editor-patch.service";
import { resolveCompositionTrackDefinition } from "@/domains/production/composition-editor/composition-track-registry";
import { resolveDefaultCompositionClipLayout } from "@/domains/production/composition-editor/composition-default-layout.service";
import type { CompositionAnimation } from "@/domains/production/composition-editor/composition-motion.types";
import { COMPOSITION_MOTION_ENABLED } from "@/domains/production/composition-editor/composition-motion.config";
import { CompositionTimeline } from "./CompositionTimeline";
import { AudioMixControls } from "./AudioMixControls";
import { VolumeSlider } from "./VolumeSlider";
import { LayerDepthControls } from "./LayerDepthControls";
import { CompositionMotionControls } from "./CompositionMotionControls";
import { buildCompositionAutoOrganizePatch } from "@/domains/production/composition-editor/composition-auto-organize.service";
import {
  COMPOSITION_VERSION_FALLBACK_HEADER,
  formatCompositionDocumentEtag,
  resolveCompositionDocumentVersion,
} from "@/domains/production/composition-editor/composition-document-version";
import { CompositionPreviewTelemetryBuffer } from "@/domains/production/composition-editor/composition-preview-telemetry.client";
import type { CompositionPreviewMetric } from "@/domains/production/composition-editor/composition-preview-telemetry";
import { clampPreviewPlayhead, classifyPreviewTimeMessage, isPreviewRefreshRequired } from "@/domains/production/composition-editor/composition-preview-playhead.service";
import { hasCompositionCrop, normalizeCompositionCropInsets, resolveCompositionCropInsets, type CompositionCropInsets } from "@/domains/production/composition-editor/composition-visual-crop.service";
import { createClient as createBrowserSupabaseClient } from "@/utils/supabase/client";

type PreviewMessage =
  | { type: "courseforge-composition-ready"; duration: number }
  | { type: "courseforge-composition-time"; seconds: number }
  | { type: "courseforge-composition-playback"; playing: boolean }
  | { type: "courseforge-composition-media-state"; state: "BUFFERING" | "PLAYING" | "PREPARING" | "READY"; pendingMediaIds: string[] }
  | { type: "courseforge-composition-media-metric"; metric: CompositionPreviewMetric }
  | { type: "courseforge-composition-media-error"; code: string; mediaId: string; message: string }
  | { type: "courseforge-composition-selection"; hfId: string | null }
  | { type: "courseforge-composition-layout-commit"; hfId: string; layout: { height: number; width: number; x: number; y: number } }
  | { type: "courseforge-composition-crop-commit"; hfId: string; crop: CompositionVisualCrop }
  | { type: "courseforge-composition-aspect-corrections"; corrections: Array<{ hfId: string; layout: { height: number; width: number; x: number; y: number } }> };

type DocumentPayload = { document: CompositionEditorDocument; documentHash: string; version: number };
type DocumentHistoryEntry = DocumentPayload & { createdAt: string };
type CompositionSnapshotEntry = {
  createdAt: string;
  documentHash: string;
  documentVersion: number;
  id: string;
  isActive: boolean;
  projectArchiveSizeBytes: number;
  revisionNumber: number;
};
type AgentProposal = CompositionAgentProposalEnvelope & {
  documentHash: string;
  expiresAt: string;
  model: string;
  recovery: CompositionAgentRecoveryMetadata;
};
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
  onVideoCompleted?: () => void;
  onSelectLesson: (lessonId: string) => void;
  selectedLessonId: string | null;
}

async function readCompositionApiResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(response.status === 404
      ? `${fallbackMessage} El endpoint de snapshots no está disponible en este despliegue.`
      : `${fallbackMessage} El servidor devolvió una respuesta inesperada (${response.status}).`);
  }
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Error(`${fallbackMessage} El servidor devolvió JSON inválido.`);
  }
}

/** The native assembly studio: library, full preview, timeline and contextual inspector. */
export function NativeCompositionPreview({ assistantRequestKey = 0, assets, compositionId, draftId, lessons, onSelectLesson, onVideoCompleted, selectedLessonId }: NativeCompositionPreviewProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const studioGridRef = useRef<HTMLDivElement | null>(null);
  const payloadRef = useRef<DocumentPayload | null>(null);
  const saveInFlightRef = useRef(false);
  const renderPollInFlightRef = useRef(false);
  const onVideoCompletedRef = useRef(onVideoCompleted);
  const mediaRecoveryHashRef = useRef<string | null>(null);
  const playheadSecondsRef = useRef(0);
  const pendingSeekSecondsRef = useRef<number | null>(null);
  const pendingPreviewRestoreSecondsRef = useRef<number | null>(null);
  const previewDocumentHashRef = useRef<string | null>(null);
  const autoPlayAfterPreviewRefreshRef = useRef(false);
  const previewTelemetryRef = useRef<CompositionPreviewTelemetryBuffer | null>(null);
  const [payload, setPayload] = useState<DocumentPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewMediaState, setPreviewMediaState] = useState<"BUFFERING" | "PLAYING" | "PREPARING" | "READY">("PREPARING");
  const [pendingPreviewMediaIds, setPendingPreviewMediaIds] = useState<string[]>([]);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewDocumentHash, setPreviewDocumentHash] = useState<string | null>(null);
  const [previewDirty, setPreviewDirty] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failedSave, setFailedSave] = useState<{ operations: CompositionEditorPatchOperation[]; source: "AGENT" | "USER"; summary: string } | null>(null);
  const [agentProposal, setAgentProposal] = useState<AgentProposal | null>(null);
  const [lastAppliedAgentProposal, setLastAppliedAgentProposal] = useState<AgentProposal | null>(null);
  const [proposing, setProposing] = useState(false);
  const [assembly, setAssembly] = useState<{ revisionId: string; status: "READY_FOR_PREVIEW" | "READY_FOR_RENDER" } | null>(null);
  const [snapshotHistory, setSnapshotHistory] = useState<CompositionSnapshotEntry[] | null>(null);
  const [snapshotHistoryOpen, setSnapshotHistoryOpen] = useState(false);
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [renderStatus, setRenderStatus] = useState<"idle" | "validating" | "sending" | "rendering" | "completed" | "failed">("idle");
  const [renderRequestId, setRenderRequestId] = useState<string | null>(null);
  const [renderProviderStatus, setRenderProviderStatus] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const [selectedHfId, setSelectedHfId] = useState<string | null>(null);
  const [selectedAnimationId, setSelectedAnimationId] = useState<string | null>(null);
  const [manualInspectorOpen, setManualInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"assistant" | "properties">("properties");
  const [directEditingEnabled, setDirectEditingEnabled] = useState(true);
  const [gridVisible, setGridVisible] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [trimToolEnabled, setTrimToolEnabled] = useState(false);
  const [visualCropEnabled, setVisualCropEnabled] = useState(false);
  const [removalRangeStart, setRemovalRangeStart] = useState<{ clipId: string; seconds: number } | null>(null);
  const [history, setHistory] = useState<DocumentHistoryEntry[] | null>(null);
  const [studioTopPanePercent, setStudioTopPanePercent] = useState(60);
  const [studioResizing, setStudioResizing] = useState(false);

  useEffect(() => {
    onVideoCompletedRef.current = onVideoCompleted;
  }, [onVideoCompleted]);

  const resizeStudioPanes = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!studioResizing) return;
    const grid = studioGridRef.current;
    if (!grid) return;
    const bounds = grid.getBoundingClientRect();
    const nextPercent = ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 100;
    setStudioTopPanePercent(Math.max(30, Math.min(75, nextPercent)));
  };
  const finishStudioResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!studioResizing) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setStudioResizing(false);
  };

  const loadDocument = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/document`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo cargar la composición.");
      const nextPayload = body.data as DocumentPayload;
      nextPayload.documentHash = resolveCompositionDocumentVersion(nextPayload.documentHash);
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      previewDocumentHashRef.current = nextPayload.documentHash;
      setPreviewDocumentHash(nextPayload.documentHash);
      setPreviewDirty(false);
      setSeconds(0);
      playheadSecondsRef.current = 0;
      pendingPreviewRestoreSecondsRef.current = null;
      setPlaying(false);
      setPreviewReady(false);
      setPlaybackError(null);
      setSelectedHfId(null);
      setSelectedAnimationId(null);
      setManualInspectorOpen(false);
      setRemovalRangeStart(null);
      setHistory(null);
      setAgentProposal(null);
      setLastAppliedAgentProposal(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar la composición.");
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  const loadSnapshotHistory = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/production/hyperframes/compositions/${compositionId}/revisions`, {
      cache: "no-store",
      signal,
    });
    const body = await readCompositionApiResponse<{
      data?: { activeRevisionId: string | null; snapshots: CompositionSnapshotEntry[]; status: string };
      error?: string;
    }>(response, "No se pudo cargar el historial de snapshots.");
    if (!response.ok || !body.data) throw new Error(body.error || "No se pudo cargar el historial de snapshots.");
    if (signal?.aborted) return;
    setSnapshotHistory(body.data.snapshots);
    const activeSnapshot = body.data.snapshots.find((snapshot) => snapshot.id === body.data?.activeRevisionId);
    setAssembly(activeSnapshot ? {
      revisionId: activeSnapshot.id,
      status: body.data.status === "READY_FOR_RENDER" ? "READY_FOR_RENDER" : "READY_FOR_PREVIEW",
    } : null);
  }, [compositionId]);

  useEffect(() => { void loadDocument(); }, [loadDocument]);
  useEffect(() => {
    const controller = new AbortController();
    setAssembly(null);
    setSnapshotHistory(null);
    setSnapshotHistoryOpen(false);
    setAssemblyError(null);
    setRenderStatus("idle");
    setRenderRequestId(null);
    setRenderProviderStatus(null);
    void loadSnapshotHistory(controller.signal).catch((caught) => {
      if (!controller.signal.aborted) {
        setAssemblyError(caught instanceof Error ? caught.message : "No se pudo cargar el historial de snapshots.");
      }
    });
    return () => controller.abort();
  }, [loadSnapshotHistory]);
  useEffect(() => {
    const telemetry = new CompositionPreviewTelemetryBuffer({ draftId });
    previewTelemetryRef.current = telemetry;
    return () => {
      previewTelemetryRef.current = null;
      void telemetry.dispose();
    };
  }, [draftId]);
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
        const pendingSeekSeconds = pendingSeekSecondsRef.current;
        const decision = classifyPreviewTimeMessage({
          pendingRestoreSeconds: pendingPreviewRestoreSecondsRef.current,
          pendingSeekSeconds,
          reportedSeconds: message.seconds,
        });
        if (!decision.accept) return;
        if (decision.completesRestore) pendingPreviewRestoreSecondsRef.current = null;
        pendingSeekSecondsRef.current = null;
        playheadSecondsRef.current = message.seconds;
        setSeconds(message.seconds);
        if (decision.completesRestore && autoPlayAfterPreviewRefreshRef.current) {
          autoPlayAfterPreviewRefreshRef.current = false;
          frameRef.current?.contentWindow?.postMessage({ type: "courseforge-composition-play" }, "*");
        }
      }
      if (message.type === "courseforge-composition-playback") {
        setPlaying(message.playing);
        if (message.playing) setPlaybackError(null);
      }
      if (message.type === "courseforge-composition-media-state") {
        setPreviewMediaState(message.state);
        setPendingPreviewMediaIds(message.pendingMediaIds);
      }
      if (message.type === "courseforge-composition-media-metric") {
        previewTelemetryRef.current?.record(message.metric);
      }
      if (message.type === "courseforge-composition-ready") {
        setPreviewReady(true);
        setPreviewMediaState("READY");
        setPendingPreviewMediaIds([]);
        setPlaybackError(null);
        const restoreSeconds = pendingPreviewRestoreSecondsRef.current;
        if (restoreSeconds !== null) {
          const clampedSeconds = clampPreviewPlayhead(restoreSeconds, message.duration);
          pendingPreviewRestoreSecondsRef.current = clampedSeconds;
          pendingSeekSecondsRef.current = clampedSeconds;
          playheadSecondsRef.current = clampedSeconds;
          setSeconds(clampedSeconds);
          frameRef.current?.contentWindow?.postMessage({ type: "courseforge-composition-seek", seconds: clampedSeconds }, "*");
        } else if (autoPlayAfterPreviewRefreshRef.current) {
          autoPlayAfterPreviewRefreshRef.current = false;
          frameRef.current?.contentWindow?.postMessage({ type: "courseforge-composition-play" }, "*");
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
        setPreviewMediaState("PREPARING");
        if (currentHash && mediaRecoveryHashRef.current !== currentHash) {
          mediaRecoveryHashRef.current = currentHash;
          frameRef.current?.contentWindow?.postMessage({ type: "courseforge-composition-pause" }, "*");
          setPlaying(false);
          setPreviewReady(false);
          setPlaybackError("El enlace del medio dejó de responder. Renovando el acceso al preview…");
          previewDocumentHashRef.current = currentHash;
          setPreviewDocumentHash(currentHash);
          setPreviewDirty(false);
          setPreviewRefreshKey((current) => current + 1);
          return;
        }
        setPlaybackError(`No se pudo reproducir ${message.mediaId}: ${message.message}`);
      }
      if (message.type === "courseforge-composition-selection") {
        setSelectedHfId(message.hfId);
        setSelectedAnimationId(null);
        setManualInspectorOpen(Boolean(message.hfId));
        if (message.hfId) setInspectorTab("properties");
      }
      if (message.type === "courseforge-composition-layout-commit") {
        const clip = payload?.document.clips.find((candidate) => candidate.hfId === message.hfId);
        if (!clip) return;
        void savePatch([{ clipId: clip.id, layout: message.layout, type: "clip.layout" }], `Layout editado desde el preview: ${clip.label}.`, "USER", { preservePreviewRuntime: true });
      }
      if (message.type === "courseforge-composition-crop-commit") {
        const clip = payload?.document.clips.find((candidate) => candidate.hfId === message.hfId);
        if (!clip) return;
        void savePatch([{ clipId: clip.id, crop: message.crop, type: "clip.crop" }], `Ajustó el recorte visual de ${clip.label}.`, "USER", { preservePreviewRuntime: true });
      }
      if (message.type === "courseforge-composition-aspect-corrections") {
        const operations = message.corrections.flatMap((correction) => {
          const clip = payload?.document.clips.find((candidate) => candidate.hfId === correction.hfId);
          return clip ? [{ clipId: clip.id, layout: correction.layout, type: "clip.layout" as const }] : [];
        });
        if (operations.length > 0) {
          void savePatch(operations, `Restauró la proporción original de ${operations.length} avatar(es).`);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [payload]);

  const duration = payload?.document.canvas.durationSeconds || 0;
  const transportActive = playing || previewMediaState === "BUFFERING";
  const durationSourceLabel = payload?.document.canvas.durationSource
    ? DURATION_SOURCE_LABELS[payload.document.canvas.durationSource]
    : null;
  const savedPreviewUrl = useMemo(() => payload && previewDocumentHash ? `/api/production/hyperframes/drafts/${draftId}/preview?v=${encodeURIComponent(previewDocumentHash)}&r=${previewRefreshKey}` : null, [draftId, payload, previewDocumentHash, previewRefreshKey]);
  const previewUrl = agentProposal
    ? `/api/production/hyperframes/drafts/${draftId}/agent-proposals/${agentProposal.proposalId}/preview`
    : savedPreviewUrl;
  useEffect(() => {
    pendingSeekSecondsRef.current = null;
    setPlaying(false);
    setPreviewReady(false);
    setPreviewMediaState("PREPARING");
    setPendingPreviewMediaIds([]);
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
      editingEnabled: directEditingEnabled && !agentProposal,
      cropEnabled: visualCropEnabled && !agentProposal,
      gridVisible,
      snapEnabled,
      type: "courseforge-composition-editor-settings",
    });
  }, [agentProposal, directEditingEnabled, gridVisible, previewReady, snapEnabled, visualCropEnabled]);
  useEffect(() => {
    if (previewReady) postPreviewMessage({ scale: previewZoom, type: "courseforge-composition-preview-zoom" });
  }, [previewReady, previewZoom]);
  useEffect(() => {
    const syncFullscreenState = () => setPreviewFullscreen(document.fullscreenElement === previewShellRef.current);
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);
  const refreshPreviewMedia = () => {
    mediaRecoveryHashRef.current = null;
    refreshPreviewDocument(false);
    setPlaybackError("Renovando el acceso a los medios del preview…");
  };
  const seek = (nextSeconds: number) => {
    pendingSeekSecondsRef.current = nextSeconds;
    playheadSecondsRef.current = nextSeconds;
    setSeconds(nextSeconds);
    postPreviewMessage({ type: "courseforge-composition-seek", seconds: nextSeconds });
  };
  const beginScrub = () => {
    postPreviewMessage({ type: "courseforge-composition-pause" });
    setPlaying(false);
  };
  const selectClip = (hfId: string) => {
    const nextClip = payloadRef.current?.document.clips.find((clip) => clip.hfId === hfId);
    if (removalRangeStart && nextClip?.id !== removalRangeStart.clipId) setRemovalRangeStart(null);
    setSelectedHfId(hfId);
    setSelectedAnimationId(null);
    setManualInspectorOpen(true);
    setInspectorTab("properties");
    postPreviewMessage({ type: "courseforge-composition-select", hfId });
  };
  const selectAnimation = (animationId: string, clipHfId: string) => {
    selectClip(clipHfId);
    setSelectedAnimationId(animationId);
  };
  const clearSelection = () => {
    setSelectedHfId(null);
    setSelectedAnimationId(null);
    setManualInspectorOpen(false);
    postPreviewMessage({ type: "courseforge-composition-select", hfId: null });
  };
  const restoreReadyPreviewState = () => {
    setPreviewReady(true);
    setPreviewMediaState("READY");
    setPendingPreviewMediaIds([]);
  };
  const pausePreviewForMutation = () => {
    pendingPreviewRestoreSecondsRef.current = playheadSecondsRef.current;
    pendingSeekSecondsRef.current = null;
    postPreviewMessage({ type: "courseforge-composition-pause" });
    setPlaying(false);
    setPreviewReady(false);
    setPreviewMediaState("PREPARING");
    setPendingPreviewMediaIds([]);
    setPlaybackError(null);
  };
  const refreshPreviewDocument = (autoPlay = false) => {
    const currentPayload = payloadRef.current;
    if (!currentPayload || agentProposal) return;
    pausePreviewForMutation();
    autoPlayAfterPreviewRefreshRef.current = autoPlay;
    previewDocumentHashRef.current = currentPayload.documentHash;
    setPreviewDocumentHash(currentPayload.documentHash);
    setPreviewDirty(false);
    setPreviewRefreshKey((current) => current + 1);
  };
  const togglePreviewPlayback = () => {
    if (transportActive) {
      postPreviewMessage({ type: "courseforge-composition-pause" });
      return;
    }
    const currentHash = payloadRef.current?.documentHash || null;
    if (isPreviewRefreshRequired({ persistedDocumentHash: currentHash, previewDirty, previewDocumentHash: previewDocumentHashRef.current })) {
      refreshPreviewDocument(true);
      return;
    }
    postPreviewMessage({ type: "courseforge-composition-play" });
  };
  async function savePatch(
    operations: CompositionEditorPatchOperation[],
    summary: string,
    source: "AGENT" | "USER" = "USER",
    options: { preservePreviewRuntime?: boolean } = {},
  ): Promise<boolean> {
    const currentPayload = payloadRef.current;
    if (!currentPayload || saveInFlightRef.current) return false;
    if (agentProposal && source !== "AGENT") {
      setSaveError("Confirma o descarta la propuesta antes de realizar otra edición.");
      return false;
    }
    const effectiveOperations = ensureCanvasDurationForClipPatches(currentPayload.document, operations);
    let optimisticDocument: CompositionEditorDocument;
    try {
      optimisticDocument = applyCompositionEditorPatches(currentPayload.document, effectiveOperations, source);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "El cambio solicitado no es válido.");
      return false;
    }
    postPreviewMessage({ type: "courseforge-composition-pause" });
    setPlaying(false);
    saveInFlightRef.current = true;
    setSaving(true);
    setSaveError(null);
    setFailedSave(null);
    setPreviewDirty(true);
    const optimisticPayload = { ...currentPayload, document: optimisticDocument };
    payloadRef.current = optimisticPayload;
    setPayload(optimisticPayload);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/document`, {
        body: JSON.stringify({ operations: effectiveOperations, source, summary }),
        headers: {
          "Content-Type": "application/json",
          "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash),
          [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash,
        },
        method: "PUT",
      });
      const body = await response.json();
      if (response.status === 409 && body.data) {
        const nextPayload = body.data as DocumentPayload;
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        setPreviewDirty(nextPayload.documentHash !== previewDocumentHashRef.current);
        setFailedSave({ operations: effectiveOperations, source, summary });
        setSaveError(body.error || "La composición cambió en otra sesión. El preview se actualizó con la última versión.");
        return false;
      }
      if (!response.ok) throw new Error(body.error || "No se pudo guardar el cambio.");
      const nextPayload = body.data as DocumentPayload;
      nextPayload.documentHash = resolveCompositionDocumentVersion(nextPayload.documentHash);
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      setPreviewDirty(nextPayload.documentHash !== previewDocumentHashRef.current);
      if (source === "USER") setLastAppliedAgentProposal(null);
      return true;
    } catch (caught) {
      payloadRef.current = currentPayload;
      setPayload(currentPayload);
      setPreviewDirty(currentPayload.documentHash !== previewDocumentHashRef.current);
      if (options.preservePreviewRuntime) {
        refreshPreviewDocument(false);
      }
      setFailedSave({ operations: effectiveOperations, source, summary });
      setSaveError(caught instanceof Error ? caught.message : "No se pudo guardar el cambio.");
      return false;
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  async function addAssetToTimeline(asset: CompositionStudioAsset) {
    const currentPayload = payloadRef.current;
    if (!currentPayload || !asset.isEditable) return;
    const baseClipId = `asset-${asset.id}`;
    const existing = currentPayload.document.clips.find((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.source.productionAssetId === asset.id);
    if (existing) {
      selectClip(existing.hfId);
      return;
    }

    // A removed asset can have derived historical clips with the canonical id.
    // Only the current document matters, but generate a collision-free identity
    // so reinsertion remains valid after split/remove workflows.
    const occupiedIds = new Set(currentPayload.document.clips.flatMap((clip) => [clip.id, clip.hfId]));
    let clipId = baseClipId;
    let identitySuffix = 1;
    while (occupiedIds.has(clipId)) {
      clipId = `${baseClipId}-insert-${identitySuffix}`;
      identitySuffix += 1;
    }

    const trackDefinition = resolveCompositionTrackDefinition(asset);
    const trackId = trackDefinition.id;
    const isAudio = trackDefinition.kind === "AUDIO";
    const isBackgroundAudio = trackDefinition.semanticRole === "MUSIC";
    const isSequential = !isBackgroundAudio;
    const preferredDuration = asset.durationSeconds || (isAudio ? currentPayload.document.canvas.durationSeconds : asset.mimeType.startsWith("image/") ? 5 : 8);
    const occupiedUntil = currentPayload.document.clips
      .filter((candidate) => candidate.trackId === trackId)
      .reduce((latest, candidate) => Math.max(latest, candidate.startSeconds + candidate.durationSeconds), 0);
    const clipDuration = Math.min(
      preferredDuration,
      currentPayload.document.canvas.durationSeconds - (isSequential ? occupiedUntil : 0),
    );
    if (clipDuration < 0.05) {
      setSaveError("No hay espacio disponible para este asset. Aplica la plantilla base o ajusta la duración del video.");
      return;
    }
    const clipKind: CompositionClip["kind"] = isAudio ? "AUDIO" : asset.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE";
    const clip: CompositionClip = {
      durationSeconds: clipDuration,
      hfId: clipId,
      hidden: false,
      id: clipId,
      kind: clipKind,
      label: asset.label,
      layout: resolveDefaultCompositionClipLayout({ canvas: currentPayload.document.canvas, clipKind, track: trackDefinition }),
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
      // The patch service ignores this when the track already exists and uses
      // it when the latest server version no longer contains that track.
      track: trackDefinition,
      type: "clip.add",
    }], `Agregó ${asset.label} a la línea de tiempo.`);
    if (added) selectClip(clip.hfId);
  }

  async function removeClipFromTimeline(clip: CompositionClip) {
    const removed = await savePatch([{ clipId: clip.id, type: "clip.remove" }], `Quitó ${clip.label} de la línea de tiempo.`);
    if (removed) clearSelection();
  }

  async function loadHistory() {
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/document?history=1`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo cargar el historial.");
      setHistory(body.data as DocumentHistoryEntry[]);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "No se pudo cargar el historial.");
    }
  }

  async function restoreHistoryEntry(entry: DocumentHistoryEntry) {
    if (!payload || entry.version === payload.version) return;
    const restored = await savePatch([{ document: entry.document, type: "document.restore" }], `Restauró la versión ${entry.version} de la composición.`);
    if (restored) setHistory(null);
  }

  async function splitSelectedClipAtPlayhead() {
    if (!selectedClip) return;
    const clipEnd = selectedClip.startSeconds + selectedClip.durationSeconds;
    if (seconds <= selectedClip.startSeconds + 0.001 || seconds >= clipEnd - 0.001) {
      setSaveError("Ubica el cursor dentro del clip antes de dividirlo.");
      return;
    }
    const identity = createDerivedClipIdentity(selectedClip.id);
    const saved = await savePatch([{
      atSeconds: seconds,
      clipId: selectedClip.id,
      newClipId: identity.clipId,
      newHfId: identity.hfId,
      type: "clip.split",
    }], `Dividió ${selectedClip.label} en ${formatSeconds(seconds)} sin modificar el asset original.`);
    if (saved) setSelectedHfId(identity.hfId);
  }

  async function removeSelectedInterval() {
    if (!selectedClip || removalRangeStart === null) return;
    if (selectedClip.id !== removalRangeStart.clipId) {
      setSaveError("La marca pertenece a otro clip. Selecciona nuevamente el clip y vuelve a marcar el intervalo.");
      setRemovalRangeStart(null);
      return;
    }
    const rangeStart = Math.min(removalRangeStart.seconds, seconds);
    const rangeEnd = Math.max(removalRangeStart.seconds, seconds);
    const clipEnd = selectedClip.startSeconds + selectedClip.durationSeconds;
    const minimumRange = 1 / (payloadRef.current?.document.canvas.fps || 30);
    if (rangeStart < selectedClip.startSeconds - 0.001 || rangeEnd > clipEnd + 0.001) {
      setSaveError(`El intervalo debe quedar entre ${formatCompositionTimecode(selectedClip.startSeconds)} y ${formatCompositionTimecode(clipEnd)}, que son los límites de ${selectedClip.label}.`);
      return;
    }
    if (rangeEnd - rangeStart < minimumRange - 0.001) {
      setSaveError("Mueve el cursor al menos un frame después de la marca para eliminar un intervalo.");
      return;
    }
    const identity = createDerivedClipIdentity(selectedClip.id);
    const removesWholeClip = rangeStart <= selectedClip.startSeconds + 0.001 && rangeEnd >= clipEnd - 0.001;
    const createsRightClip = rangeStart > selectedClip.startSeconds + 0.001 && rangeEnd < clipEnd - 0.001;
    const saved = await savePatch([{
      clipId: selectedClip.id,
      endSeconds: rangeEnd,
      newClipId: identity.clipId,
      newHfId: identity.hfId,
      ripple: true,
      startSeconds: rangeStart,
      type: "clip.remove-range",
    }], `Eliminó un intervalo de ${selectedClip.label} sin modificar el asset original.`);
    if (saved) {
      setRemovalRangeStart(null);
      if (removesWholeClip) {
        clearSelection();
      } else {
        setSelectedHfId(createsRightClip ? identity.hfId : selectedClip.hfId);
      }
      seek(rangeStart);
    }
  }

  function markSelectedIntervalStart() {
    if (!selectedClip) {
      setSaveError("Selecciona primero el clip de video o audio que deseas recortar.");
      return;
    }
    if (selectedClip.kind !== "VIDEO" && selectedClip.kind !== "AUDIO") {
      setSaveError("La eliminación de intervalos solo está disponible para clips de video o audio.");
      return;
    }
    const clipEnd = selectedClip.startSeconds + selectedClip.durationSeconds;
    if (seconds < selectedClip.startSeconds - 0.001 || seconds > clipEnd + 0.001) {
      setSaveError(`Coloca el cursor dentro de ${selectedClip.label}, entre ${formatCompositionTimecode(selectedClip.startSeconds)} y ${formatCompositionTimecode(clipEnd)}.`);
      return;
    }
    setSaveError(null);
    setRemovalRangeStart({ clipId: selectedClip.id, seconds });
  }

  async function updateTrack(track: CompositionTrack, settings: { hidden?: boolean; locked?: boolean; muted?: boolean; volume?: number }, summary: string) {
    await savePatch([{ settings, trackId: track.id, type: "track.update" }], summary);
  }

  async function applyBaseTemplate() {
    if (!payload) return;
    const hasManualTiming = payload.document.clips.some((clip) => clip.timingSource === "USER_EDITED");
    const confirmation = hasManualTiming
      ? "La composición contiene ajustes manuales. Se calcularán los tiempos estimados y la duración final sin modificar posiciones, tamaños ni tiempos editados manualmente. ¿Continuar?"
      : "Esto calculará la duración por prioridad y organizará únicamente los tiempos estimados. Las posiciones, capas y versiones anteriores se conservarán. ¿Continuar?";
    if (!window.confirm(confirmation)) return;
    let operations: CompositionEditorPatchOperation[];
    try {
      operations = buildCompositionAutoOrganizePatch({ assets, document: payload.document }).operations;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo calcular la duración de la composición.");
      return;
    }
    await savePatch(operations, "Calculó la duración y organizó los tiempos estimados sin reemplazar el layout manual.");
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
      setLastAppliedAgentProposal(null);
      setAgentProposal(proposal);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "No se pudo preparar la propuesta.");
    } finally {
      setProposing(false);
    }
  }

  async function approveAgentProposal() {
    const proposal = agentProposal;
    const currentPayload = payloadRef.current;
    if (!proposal || !currentPayload || saveInFlightRef.current) return;
    let reinforcedConfirmation = false;
    if (proposal.risk.requiresReinforcedConfirmation) {
      reinforcedConfirmation = window.confirm(`Este cambio tiene riesgo alto: ${proposal.risk.reasons.join(" ")} ¿Deseas aplicarlo de todos modos?`);
      const accepted = reinforcedConfirmation;
      if (!accepted) return;
    }
    let optimisticDocument: CompositionEditorDocument;
    try {
      optimisticDocument = applyCompositionEditorPatches(currentPayload.document, proposal.operations, "AGENT");
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "La propuesta ya no puede aplicarse.");
      return;
    }
    pausePreviewForMutation();
    saveInFlightRef.current = true;
    setSaving(true);
    setSaveError(null);
    const optimisticPayload = { ...currentPayload, document: optimisticDocument };
    payloadRef.current = optimisticPayload;
    setPayload(optimisticPayload);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/agent-proposals/${proposal.proposalId}/apply`, {
        body: JSON.stringify({ reinforcedConfirmation }),
        headers: {
          "Content-Type": "application/json",
          "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash),
          [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash,
        },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo aplicar la propuesta.");
      const nextPayload = body.data as DocumentPayload;
      nextPayload.documentHash = resolveCompositionDocumentVersion(nextPayload.documentHash);
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      previewDocumentHashRef.current = nextPayload.documentHash;
      setPreviewDocumentHash(nextPayload.documentHash);
      setPreviewDirty(false);
      setLastAppliedAgentProposal(proposal);
      setAgentProposal(null);
    } catch (caught) {
      pendingPreviewRestoreSecondsRef.current = null;
      payloadRef.current = currentPayload;
      setPayload(currentPayload);
      restoreReadyPreviewState();
      setSaveError(caught instanceof Error ? caught.message : "No se pudo aplicar la propuesta.");
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  async function dismissAgentProposal() {
    const proposal = agentProposal;
    setAgentProposal(null);
    if (!proposal) return;
    try {
      await fetch(`/api/production/hyperframes/drafts/${draftId}/agent-proposals/${proposal.proposalId}`, { method: "DELETE" });
    } catch {
      // Dismissal is best-effort in the UI; the durable proposal expires and
      // cannot be applied without its unguessable id and explicit approval.
    }
  }

  async function undoLastAgentProposal() {
    const proposal = lastAppliedAgentProposal;
    const currentPayload = payloadRef.current;
    if (!proposal || !currentPayload || saveInFlightRef.current) return;
    if (!window.confirm(`¿Deshacer esta edición asistida? ${proposal.summary}`)) return;
    let optimisticDocument: CompositionEditorDocument;
    try {
      optimisticDocument = applyCompositionEditorPatches(currentPayload.document, proposal.inverseOperations, "USER");
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "La edición ya no puede deshacerse automáticamente.");
      return;
    }
    pausePreviewForMutation();
    saveInFlightRef.current = true;
    setSaving(true);
    setSaveError(null);
    const optimisticPayload = { ...currentPayload, document: optimisticDocument };
    payloadRef.current = optimisticPayload;
    setPayload(optimisticPayload);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/agent-proposals/${proposal.proposalId}/undo`, {
        headers: {
          "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash),
          [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash,
        },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo deshacer la edición.");
      const nextPayload = body.data as DocumentPayload;
      nextPayload.documentHash = resolveCompositionDocumentVersion(nextPayload.documentHash);
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      previewDocumentHashRef.current = nextPayload.documentHash;
      setPreviewDocumentHash(nextPayload.documentHash);
      setPreviewDirty(false);
      setLastAppliedAgentProposal(null);
    } catch (caught) {
      pendingPreviewRestoreSecondsRef.current = null;
      payloadRef.current = currentPayload;
      setPayload(currentPayload);
      restoreReadyPreviewState();
      setSaveError(caught instanceof Error ? caught.message : "No se pudo deshacer la edición.");
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  async function prepareAssembly() {
    setAssembling(true); setAssemblyError(null); setRenderStatus("validating");
    try {
      const response = await fetch(`/api/production/hyperframes/compositions/${compositionId}/snapshot`, { body: JSON.stringify({ draftId }), headers: { "Content-Type": "application/json" }, method: "POST" });
      const body = await readCompositionApiResponse<{ data?: { id: string }; error?: string }>(response, "No se pudo preparar el ensamble.");
      if (!response.ok) throw new Error(body.error || "No se pudo preparar el ensamble.");
      if (!body.data?.id) throw new Error("El servidor no devolvió el snapshot creado.");
      setAssembly({ revisionId: body.data.id, status: "READY_FOR_PREVIEW" });
      setRenderStatus("idle");
      await loadSnapshotHistory();
    } catch (caught) { setAssemblyError(caught instanceof Error ? caught.message : "No se pudo preparar el ensamble."); setRenderStatus("failed"); }
    finally { setAssembling(false); }
  }

  async function restoreSnapshot(snapshot: CompositionSnapshotEntry) {
    if (snapshot.isActive || assembling) return;
    setAssembling(true);
    setAssemblyError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/compositions/${compositionId}/revisions`, {
        body: JSON.stringify({ revisionId: snapshot.id }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const body = await readCompositionApiResponse<{ data?: { id: string; status: "READY_FOR_PREVIEW" }; error?: string }>(response, "No se pudo restaurar el snapshot.");
      if (!response.ok || !body.data) throw new Error(body.error || "No se pudo restaurar el snapshot.");
      setAssembly({ revisionId: body.data.id, status: "READY_FOR_PREVIEW" });
      setRenderStatus("idle");
      setRenderRequestId(null);
      setRenderProviderStatus(null);
      await loadSnapshotHistory();
    } catch (caught) {
      setAssemblyError(caught instanceof Error ? caught.message : "No se pudo restaurar el snapshot.");
    } finally {
      setAssembling(false);
    }
  }
  async function approveAssembly() {
    if (!assembly) return; setAssembling(true); setAssemblyError(null);
    try { const response = await fetch(`/api/production/hyperframes/compositions/${compositionId}/approve`, { method: "POST" }); const body = await readCompositionApiResponse<{ error?: string }>(response, "No se pudo aprobar el ensamble."); if (!response.ok) throw new Error(body.error || "No se pudo aprobar el ensamble."); setAssembly({ ...assembly, status: "READY_FOR_RENDER" }); }
    catch (caught) { setAssemblyError(caught instanceof Error ? caught.message : "No se pudo aprobar el ensamble."); }
    finally { setAssembling(false); }
  }
  const pollAssemblyRender = useCallback(async (requestId: string) => {
    if (renderPollInFlightRef.current) return;
    renderPollInFlightRef.current = true;
    try {
      const response = await fetch(`/api/production/hyperframes/renders/${requestId}/poll`, { method: "POST" });
      const body = await readCompositionApiResponse<{ data: { action: string; providerStatus: string }; error?: string }>(response, "No se pudo consultar el render.");
      if (!response.ok) throw new Error(body.error || "No se pudo consultar el render.");

      setRenderProviderStatus(body.data.providerStatus as string);
      if (body.data.action === "FAIL") {
        setRenderStatus("failed");
        setAssemblyError("HeyGen reportó que el render falló. Regenera el snapshot antes de reintentar.");
      } else {
        setRenderStatus("rendering");
        setAssemblyError(null);
      }
    } catch (caught) {
      // A transient polling failure must not turn a running provider job into a
      // failed render. Keep polling and expose the recoverable status to the user.
      setAssemblyError(`${caught instanceof Error ? caught.message : "No se pudo consultar el render."} Se volverá a intentar automáticamente.`);
    } finally {
      renderPollInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/production/hyperframes/renders?compositionId=${encodeURIComponent(compositionId)}`,
          { cache: "no-store" },
        );
        const body = await readCompositionApiResponse<{
          data?: { id: string; importStatus: string; providerStatus: string } | null;
          error?: string;
        }>(response, "No se pudo recuperar el render pendiente.");
        if (!response.ok) {
          throw new Error(body.error || "No se pudo recuperar el render pendiente.");
        }
        if (!active || !body.data?.id) return;

        const requestId = body.data.id as string;
        setRenderRequestId(requestId);
        setRenderProviderStatus(
          body.data.importStatus && body.data.importStatus !== "NONE"
            ? body.data.importStatus
            : body.data.providerStatus,
        );
        setRenderStatus("rendering");
        setAssemblyError(null);
        void pollAssemblyRender(requestId);
      } catch (caught) {
        if (!active) return;
        setAssemblyError(
          caught instanceof Error
            ? caught.message
            : "No se pudo recuperar el render pendiente.",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [compositionId, pollAssemblyRender]);

  useEffect(() => {
    if (!renderRequestId) return;
    const supabase = createBrowserSupabaseClient();
    let active = true;
    let completionNotified = false;
    const applyDurableRenderState = (row: {
      import_status?: string;
      provider_status?: string;
    }) => {
      if (!active) return;
      const providerStatus = row.provider_status || "PENDING";
      const importStatus = row.import_status || "NONE";
      setRenderProviderStatus(importStatus !== "NONE" ? importStatus : providerStatus);

      if (importStatus === "COMPLETED") {
        setRenderStatus("completed");
        setAssemblyError(null);
        if (!completionNotified) {
          completionNotified = true;
          onVideoCompletedRef.current?.();
        }
      } else if (providerStatus === "FAILED" || importStatus === "FAILED") {
        setRenderStatus("failed");
        setAssemblyError("No se pudo completar el render o importar el video final. Revisa el estado antes de reintentar.");
      } else {
        setRenderStatus("rendering");
        setAssemblyError(null);
      }
    };
    const channel = supabase
      .channel(`hyperframes-render:${renderRequestId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          filter: `id=eq.${renderRequestId}`,
          schema: "public",
          table: "hyperframes_render_requests",
        },
        (event: { new: Record<string, unknown> }) => {
          applyDurableRenderState(event.new as {
            import_status?: string;
            provider_status?: string;
          });
        },
      )
      .subscribe((status: string) => {
        if (status !== "SUBSCRIBED") return;
        // Realtime is an invalidation channel, not the source of truth. Read the
        // current row after subscribing so a completion between render submit
        // and channel establishment cannot be missed.
        void supabase
          .from("hyperframes_render_requests")
          .select("import_status, provider_status")
          .eq("id", renderRequestId)
          .single()
          .then(({ data, error }: {
            data: { import_status?: string; provider_status?: string } | null;
            error: unknown;
          }) => {
            if (!error && data) applyDurableRenderState(data);
          });
      });
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [renderRequestId]);

  async function submitAssemblyRender() {
    if (!assembly || assembly.status !== "READY_FOR_RENDER") return; setAssembling(true); setAssemblyError(null); setRenderStatus("sending");
    try {
      const response = await fetch("/api/production/hyperframes/renders", { body: JSON.stringify({ aspectRatio: "16:9", format: "mp4", quality: "high", resolution: "1080p", revisionId: assembly.revisionId }), headers: { "Content-Type": "application/json" }, method: "POST" });
      const body = await readCompositionApiResponse<{ data: { providerStatus: string; renderRequestId: string }; error?: string }>(response, "No se pudo enviar el render.");
      if (!response.ok) throw new Error(body.error || "No se pudo enviar el render.");
      const requestId = body.data.renderRequestId as string;
      setRenderRequestId(requestId);
      setRenderProviderStatus(body.data.providerStatus as string);
      setRenderStatus("rendering");
      void pollAssemblyRender(requestId);
    }
    catch (caught) { setAssemblyError(caught instanceof Error ? caught.message : "No se pudo enviar el render."); setRenderStatus("failed"); }
    finally { setAssembling(false); }
  }

  const changePreviewZoom = (delta: number) => {
    setPreviewZoom((current) => Math.max(0.75, Math.min(1.75, Math.round((current + delta) * 100) / 100)));
  };
  const togglePreviewFullscreen = async () => {
    try {
      if (document.fullscreenElement === previewShellRef.current) await document.exitFullscreen();
      else await previewShellRef.current?.requestFullscreen();
    } catch {
      // Fullscreen may be disabled by an embedded browser or a restrictive policy.
      setPreviewFullscreen(false);
    }
  };

  if (loading) return <LoadingPreview />;
  if (error || !payload || !previewUrl) return <PreviewError error={error || "No hay composición disponible."} onRetry={() => void loadDocument()} />;

  const editorColumns = inspectorOpen
    ? "lg:grid-cols-[340px_minmax(420px,1fr)_280px]"
    : "lg:grid-cols-[360px_minmax(0,1fr)]";

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm dark:border-white/10 dark:bg-[#0F1419]">
      {saveError && (
        <CompositionErrorToast
          message={saveError}
          onDismiss={() => {
            setSaveError(null);
            setFailedSave(null);
          }}
          onRetry={failedSave
            ? () => void savePatch(failedSave.operations, failedSave.summary, failedSave.source)
            : undefined}
          retrying={saving}
        />
      )}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-[#1E2329]">
        <div>
          <h5 className="text-sm font-bold text-slate-900 dark:text-white">Estudio de edición</h5>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-gray-400">Versión {payload.version} · {formatSeconds(duration)} · duración por {durationSourceLabel || "origen no registrado"} · cambios guardados por versión</p>
        </div>
        <div className="flex items-center gap-1">
          <span role="status" className={`mr-2 text-[11px] font-medium ${saving ? "text-[#00D4B3]" : saveError ? "text-red-700 dark:text-red-300" : "text-[#10B981]"}`}>{saving ? "Guardando…" : saveError ? "Error al guardar" : "Guardado"}</span>
          <button type="button" onClick={() => setManualInspectorOpen((current) => !current)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${inspectorOpen ? "border-[#00D4B3] bg-[#00D4B3]/10 text-[#0A2540] dark:text-[#00D4B3]" : "border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"}`}><PanelRight size={14} /> {inspectorOpen ? "Ocultar panel" : "Mostrar panel"}</button>
          <div className="relative">
            <button type="button" disabled={saving} onClick={() => void loadHistory()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5" title="Restaurar una versión editable previa"><History size={14} /> Historial de edición</button>
            {history && <div className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#1E2329]"><div className="flex items-center justify-between px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500"><span>Versiones recientes</span><button type="button" onClick={() => setHistory(null)} className="rounded p-0.5 hover:bg-slate-100 dark:hover:bg-white/10"><X size={12} /></button></div>{history.map((entry) => <button key={entry.documentHash} type="button" disabled={saving || entry.version === payload.version} onClick={() => void restoreHistoryEntry(entry)} className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-xs hover:bg-slate-100 disabled:cursor-default disabled:opacity-50 dark:hover:bg-white/10"><span><span className="block font-semibold">Versión {entry.version}{entry.version === payload.version ? " (actual)" : ""}</span><span className="block text-[10px] text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span></span>{entry.version !== payload.version && <span className="text-[10px] font-bold text-cyan-700 dark:text-cyan-300">Restaurar</span>}</button>)}</div>}
          </div>
          <button type="button" onClick={() => void loadDocument()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-gray-400 dark:hover:bg-white/10" title="Recargar composición"><RefreshCw size={15} /></button>
        </div>
      </header>

      <div
        ref={studioGridRef}
        style={{
          "--studio-preview-row": `${studioTopPanePercent}fr`,
          "--studio-timeline-row": `${100 - studioTopPanePercent}fr`,
        } as CSSProperties}
        className={`grid min-h-0 flex-1 gap-2 p-2 lg:grid-rows-[minmax(220px,var(--studio-preview-row))_10px_minmax(150px,var(--studio-timeline-row))] ${editorColumns}`}
      >
        <StudioLibrary assets={assets} lessons={lessons} onAddAsset={addAssetToTimeline} onSelectLesson={onSelectLesson} selectedLessonId={selectedLessonId} onSelectAsset={selectClip} selectedHfId={selectedHfId} timelineAssetIds={new Set(payload.document.clips.flatMap((clip) => clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []))} />

        <section ref={previewShellRef} className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#0F1419] dark:border-white/10 lg:col-start-2 lg:row-start-1 ${previewFullscreen ? "h-screen w-screen rounded-none" : ""}`}>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-2 py-1.5 text-xs text-slate-300">
            <span className="flex shrink-0 items-center gap-2 font-semibold">{agentProposal ? "Preview de propuesta · no guardado" : "Preview completo"}{!agentProposal && previewDirty && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[9px] font-bold text-amber-200">Cambios pendientes</span>}</span>
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <PreviewToolButton active={directEditingEnabled} label="Editar" title="Activar selección, arrastre y tiradores" onClick={() => setDirectEditingEnabled((current) => !current)}><MousePointer2 size={13} /></PreviewToolButton>
              <PreviewToolButton active={snapEnabled} label="Snap" title="Alinear clips y recortes con el cursor y con los bordes de otros clips" onClick={() => setSnapEnabled((current) => !current)}><Magnet size={13} /></PreviewToolButton>
              <PreviewToolButton active={gridVisible} label="Rejilla" title="Mostrar guías visuales en el canvas" onClick={() => setGridVisible((current) => !current)}><Grid3X3 size={13} /></PreviewToolButton>
              <PreviewToolButton active={visualCropEnabled} label="Recorte" title="Recorta el contenido sin modificar el tamaño ni la posición del asset" onClick={() => { setDirectEditingEnabled(true); setSaveError(null); setVisualCropEnabled((current) => !current); }}><Scan size={13} /></PreviewToolButton>
              <PreviewToolButton active={trimToolEnabled} label="Tiempo" title="Activar el recorte temporal de inicio y duración en la timeline" onClick={() => setTrimToolEnabled((current) => !current)}><Crop size={13} /></PreviewToolButton>
              <PreviewToolButton active={false} label="Dividir" title="Dividir el clip seleccionado en el cursor" onClick={() => void splitSelectedClipAtPlayhead()}><Scissors size={13} /></PreviewToolButton>
              <PreviewToolButton active={removalRangeStart !== null} label={removalRangeStart === null ? "Marcar intervalo" : "Eliminar intervalo"} title={removalRangeStart === null ? "Marcar el inicio del intervalo temporal dentro del clip seleccionado" : `Eliminar desde ${formatCompositionTimecode(removalRangeStart.seconds)} hasta el cursor`} onClick={() => {
                if (removalRangeStart === null) markSelectedIntervalStart();
                else void removeSelectedInterval();
              }}><Trash2 size={13} /></PreviewToolButton>
              <span className="mx-1 h-5 w-px bg-white/15" />
              <button type="button" disabled={previewZoom <= 0.75} onClick={() => changePreviewZoom(-0.1)} title="Alejar preview" aria-label="Alejar preview" className="rounded p-1.5 hover:bg-white/10 disabled:opacity-30"><Minus size={13} /></button>
              <span className="min-w-10 text-center font-mono text-[10px] text-slate-400">{Math.round(previewZoom * 100)}%</span>
              <button type="button" disabled={previewZoom >= 1.75} onClick={() => changePreviewZoom(0.1)} title="Acercar preview" aria-label="Acercar preview" className="rounded p-1.5 hover:bg-white/10 disabled:opacity-30"><Plus size={13} /></button>
              <button type="button" onClick={() => void togglePreviewFullscreen()} title={previewFullscreen ? "Salir de pantalla completa" : "Abrir preview en pantalla completa"} aria-label={previewFullscreen ? "Salir de pantalla completa" : "Abrir preview en pantalla completa"} className="rounded p-1.5 hover:bg-white/10">{previewFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
              <span className="ml-1 font-mono text-[10px] text-slate-400">{formatSeconds(seconds)} / {formatSeconds(duration)}</span>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-1.5">
            <div className="relative aspect-video h-full max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-2xl">
              <iframe ref={frameRef} title="Preview completo de composición" src={previewUrl} sandbox="allow-scripts" allow="autoplay" className="absolute inset-0 h-full w-full" />
              {previewMediaState === "PREPARING" && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/70 text-white"><div className="flex items-center gap-2 rounded-full bg-slate-900/90 px-4 py-2 text-xs font-semibold shadow-xl"><Loader2 className="animate-spin" size={15} /> Preparando medios{pendingPreviewMediaIds.length > 0 ? ` (${pendingPreviewMediaIds.length})` : ""}…</div></div>}
              {previewMediaState === "BUFFERING" && <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-950/90 px-3 py-1.5 text-[11px] font-semibold text-white shadow-xl"><span className="inline-flex items-center gap-2"><Loader2 className="animate-spin" size={13} /> Cargando el siguiente medio{pendingPreviewMediaIds.length > 1 ? ` (${pendingPreviewMediaIds.length})` : ""}…</span></div>}
            </div>
          </div>
          {playbackError && <div role="alert" className="flex items-center justify-between gap-3 border-t border-amber-300/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100"><span>{playbackError}</span><button type="button" onClick={refreshPreviewMedia} className="shrink-0 rounded border border-amber-200/50 px-2 py-1 font-semibold hover:bg-amber-200/10">Recargar medios</button></div>}
          <div className="flex shrink-0 items-center gap-2 border-t border-white/10 bg-[#0A2540] px-2 py-1.5">
            <button type="button" disabled={saving || !previewReady || previewMediaState === "PREPARING"} onClick={togglePreviewPlayback} title={previewDirty ? "Actualizar el preview y reproducir" : transportActive ? "Pausar" : "Reproducir"} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#00D4B3] text-[#0A2540] hover:bg-[#10B981] disabled:cursor-wait disabled:opacity-50">{transportActive ? <Pause size={14} /> : <Play size={14} />}</button>
            <button type="button" disabled={saving || !previewReady || Boolean(agentProposal)} onClick={() => refreshPreviewDocument(false)} title="Actualizar el preview con los cambios guardados" aria-label="Actualizar preview" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border disabled:cursor-wait disabled:opacity-50 ${previewDirty ? "border-amber-300/50 bg-amber-400/15 text-amber-200" : "border-white/15 text-slate-300 hover:bg-white/10"}`}><RefreshCw size={13} /></button>
            <input aria-label="Posición del preview" disabled={saving || !previewReady} type="range" min="0" max={duration} step="0.05" value={Math.min(seconds, duration)} onPointerDown={beginScrub} onChange={(event) => seek(Number(event.target.value))} className="w-full accent-[#00D4B3] disabled:cursor-wait disabled:opacity-50" />
          </div>
        </section>

        <div
          role="separator"
          aria-label="Redimensionar preview y timeline"
          aria-orientation="horizontal"
          aria-valuemin={30}
          aria-valuemax={75}
          aria-valuenow={Math.round(studioTopPanePercent)}
          tabIndex={0}
          onDoubleClick={() => setStudioTopPanePercent(60)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setStudioTopPanePercent((current) => Math.max(30, current - 5));
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setStudioTopPanePercent((current) => Math.min(75, current + 5));
            }
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setStudioResizing(true);
          }}
          onPointerMove={resizeStudioPanes}
          onPointerUp={finishStudioResize}
          onPointerCancel={finishStudioResize}
          title="Arrastra para cambiar el tamaño del preview y la timeline. Doble clic para restablecer."
          className={`group hidden cursor-row-resize touch-none items-center gap-2 rounded-md outline-none lg:col-span-2 lg:row-start-2 lg:flex ${studioResizing ? "bg-cyan-100 dark:bg-cyan-400/10" : "hover:bg-slate-100 focus:bg-slate-100 dark:hover:bg-white/5 dark:focus:bg-white/5"}`}
        >
          <span className="h-px flex-1 bg-slate-300 group-hover:bg-cyan-400 dark:bg-white/15" />
          <span className="flex h-5 items-center rounded-full border border-slate-300 bg-white px-2 text-slate-500 shadow-sm group-hover:border-cyan-400 group-hover:text-cyan-600 dark:border-white/20 dark:bg-[#1E2329] dark:text-gray-400"><GripHorizontal size={14} /></span>
          <span className="h-px flex-1 bg-slate-300 group-hover:bg-cyan-400 dark:bg-white/15" />
        </div>

        <section className="min-h-0 min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#101720] lg:col-span-2 lg:row-start-3">
          <div className="h-full min-h-0 snap-y snap-proximity scroll-pt-2 overflow-y-auto overscroll-contain p-2 pb-6 [scrollbar-gutter:stable]">
          <div className={`mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${durationSourceLabel ? "border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5" : "border-amber-300 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-400/10"}`}><span className="text-slate-600 dark:text-gray-300">{durationSourceLabel ? `Duración final: ${formatCompositionTimecode(duration)} determinada por ${durationSourceLabel}.` : "Esta composición aún no registra qué asset determina su duración. Aplica el cálculo automático para normalizarla."}</span><button type="button" disabled={saving} onClick={() => void applyBaseTemplate()} className="rounded-md border border-[#00D4B3] px-2 py-0.5 font-bold text-[#0A2540] hover:bg-[#00D4B3]/10 disabled:opacity-50 dark:text-[#00D4B3]">Calcular y organizar</button></div>
          <AudioMixControls audioMix={payload.document.audioMix} disabled={saving} onUpdate={(settings, summary) => void savePatch([{ settings, type: "audio-mix.update" }], summary)} />
          <CompositionTimeline assetLabels={Object.fromEntries(assets.map((asset) => [asset.id, asset.label]))} document={payload.document} currentTime={seconds} saving={saving} selectedAnimationId={selectedAnimationId} selectedHfId={selectedHfId} snapEnabled={snapEnabled} trimMode={trimToolEnabled} onAnimationSelect={selectAnimation} onAnimationTimingChange={(animation, timing) => void savePatch([{ animationId: animation.id, timing, type: "animation.update-timing" }], `Ajustó ${animation.preset?.id || animation.propertyGroup} desde la timeline.`)} onClearSelection={clearSelection} onDurationChange={(clip, durationSeconds) => void savePatch([{ clipId: clip.id, durationSeconds, type: "clip.duration" }], `Ajustó la duración de ${clip.label} desde la timeline.`)} onMove={(clip, startSeconds) => void savePatch([{ clipId: clip.id, startSeconds, type: "clip.move" }], `Movió ${clip.label} a ${startSeconds} segundos.`)} onSeek={seek} onSelect={selectClip} onTrackUpdate={(track, settings, summary) => void updateTrack(track, settings, summary)} onTrim={(clip, startSeconds, durationSeconds, sourceOffsetSeconds) => void savePatch([{ clipId: clip.id, durationSeconds, sourceOffsetSeconds, startSeconds, type: "clip.trim" }], `Recortó el inicio de ${clip.label} desde la timeline.`)} />
          {estimatedClipCount > 0 && <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-200"><AlertTriangle className="mt-0.5 shrink-0" size={14} /> {estimatedClipCount} segmentos tienen duración estimada. Arrastra su borde derecho para ajustarlos.</p>}
          <AssemblyActions assembly={assembly} busy={assembling} error={assemblyError} history={snapshotHistory} historyOpen={snapshotHistoryOpen} providerStatus={renderProviderStatus} renderStatus={renderStatus} onApprove={approveAssembly} onHistoryToggle={() => setSnapshotHistoryOpen((current) => !current)} onPrepare={prepareAssembly} onRender={submitAssemblyRender} onRestore={restoreSnapshot} />
          </div>
        </section>

        {inspectorOpen && <aside className="min-w-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-[#1E2329] lg:col-start-3 lg:row-span-3 lg:row-start-1">
          <div className="mb-3 flex items-center justify-between gap-2"><div className="flex rounded-lg bg-slate-100 p-1 text-xs dark:bg-white/5"><button type="button" onClick={() => setInspectorTab("properties")} className={`rounded-md px-2 py-1 font-semibold ${inspectorTab === "properties" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white" : "text-slate-500 dark:text-gray-400"}`}>Propiedades</button><button type="button" onClick={() => setInspectorTab("assistant")} className={`rounded-md px-2 py-1 font-semibold ${inspectorTab === "assistant" ? "bg-[#00D4B3] text-[#0A2540] shadow-sm" : "text-slate-500 dark:text-gray-400"}`}>SofLIA</button></div><button type="button" onClick={clearSelection} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-gray-400 dark:hover:bg-white/10" title="Cerrar panel"><X size={15} /></button></div>
          {inspectorTab === "properties" ? <CompositionInspector animations={selectedClip ? payload.document.motion.animations.filter((animation) => animation.target.clipId === selectedClip.id) : []} clip={selectedClip} track={selectedClip ? payload.document.tracks.find((track) => track.id === selectedClip.trackId) || null : null} cropModeEnabled={visualCropEnabled} saving={saving} selectedAnimationId={selectedAnimationId} onAnimationSelect={setSelectedAnimationId} onPatch={savePatch} onPreviewCrop={(hfId, crop) => postPreviewMessage({ type: "courseforge-composition-preview-crop", hfId, crop })} onRemove={removeClipFromTimeline} /> : <AgentConversation lastAppliedProposal={lastAppliedAgentProposal} proposal={agentProposal} proposing={proposing} saving={saving} onDismiss={() => void dismissAgentProposal()} onPropose={requestAgentProposal} onApprove={() => void approveAgentProposal()} onUndo={() => void undoLastAgentProposal()} />}
        </aside>}
      </div>
    </section>
  );
}

function CompositionErrorToast({
  message,
  onDismiss,
  onRetry,
  retrying,
}: {
  message: string;
  onDismiss: () => void;
  onRetry?: () => void;
  retrying: boolean;
}) {
  return (
    <div
      aria-atomic="true"
      aria-live="assertive"
      role="alert"
      className="fixed right-4 top-20 z-[100] w-[calc(100vw-2rem)] max-w-md overflow-hidden rounded-xl border border-red-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-red-400/30 dark:bg-[#1E2329]"
    >
      <div className="h-1 bg-red-500" />
      <div className="flex items-start gap-3 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300">
          <AlertTriangle aria-hidden="true" size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[#0A2540] dark:text-white">No se pudo completar el cambio</p>
          <p className="mt-1 break-words text-xs leading-5 text-slate-600 dark:text-gray-300">{message}</p>
          {onRetry && (
            <button
              type="button"
              disabled={retrying}
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#0A2540] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#0d2f4d] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#00D4B3] dark:text-[#0A2540] dark:hover:bg-[#18e0c0]"
            >
              {retrying && <Loader2 aria-hidden="true" className="animate-spin" size={13} />}
              {retrying ? "Reintentando…" : "Reintentar"}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar mensaje de error"
          title="Cerrar"
          className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#0A2540] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4B3] dark:hover:bg-white/10 dark:hover:text-white"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
    </div>
  );
}

function PreviewToolButton({ active, children, label, onClick, title }: { active: boolean; children: ReactNode; label: string; onClick: () => void; title: string }) {
  return <button type="button" aria-pressed={active} onClick={onClick} title={title} className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 font-semibold transition-colors ${active ? "bg-cyan-400 text-slate-950" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}>{children}<span className="hidden 2xl:inline">{label}</span></button>;
}


function AgentConversation({ lastAppliedProposal, onApprove, onDismiss, onPropose, onUndo, proposal, proposing, saving }: { lastAppliedProposal: AgentProposal | null; onApprove: () => void; onDismiss: () => void; onPropose: (instruction: string) => Promise<void>; onUndo: () => void; proposal: AgentProposal | null; proposing: boolean; saving: boolean }) {
  type Message = { id: string; role: "assistant" | "user"; text: string };
  const [instruction, setInstruction] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "assistant", text: "Cuéntame qué deseas modificar. Primero revisaré la composición y te explicaré el plan. Sólo aplicaré cambios cuando los confirmes." },
  ]);
  const proposalId = useRef<string | null>(null);

  useEffect(() => {
    if (!proposal || proposalId.current === proposal.proposalId) return;
    proposalId.current = proposal.proposalId;
    const recoveryMessage = proposal.recovery.usedFallback
      ? ` El modelo principal no pudo completar el contrato; usé el respaldo ${proposal.model}.`
      : proposal.recovery.repaired
        ? " El primer intento no cumplió el contrato y lo corregí automáticamente."
        : "";
    setMessages((current) => [...current, {
      id: `proposal-${proposal.proposalId}`,
      role: "assistant",
      text: `Así lo haré: ${proposal.summary} Esto implica ${proposal.operations.length} cambio(s).${recoveryMessage} ¿Confirmas que los aplique?`,
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
      {proposal && <div className="ml-8 rounded-xl border border-[#00D4B3]/40 bg-[#00D4B3]/10 p-3 text-xs text-[#0A2540] shadow-sm dark:text-[#E9ECEF]"><div className="flex items-center justify-between gap-2"><p className="font-bold">Esperando tu confirmación</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${proposal.risk.level === "HIGH" ? "bg-red-100 text-red-700" : proposal.risk.level === "MEDIUM" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>Riesgo {proposal.risk.level.toLowerCase()}</span></div><p className="mt-1 text-[11px] leading-4 opacity-80">No se guardará nada hasta que confirmes.</p><ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-[10px] opacity-80">{proposal.diff.slice(0, 8).map((change, index) => <li key={`${change.entityType}-${change.entityId}-${change.path}-${index}`}>• {change.entityType.toLowerCase()} {change.entityId}: {change.path}</li>)}</ul>{proposal.validation.issues.length > 0 && <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">{proposal.validation.issues.map((issue) => issue.message).join(" ")}</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={onApprove} className="rounded-lg bg-[#0A2540] px-3 py-1.5 font-bold text-white transition hover:bg-[#0d2f4d] disabled:opacity-50">Confirmar y aplicar</button><button type="button" disabled={saving} onClick={reject} className="rounded-lg border border-[#00D4B3] bg-white px-3 py-1.5 font-bold text-[#0A2540] transition hover:bg-[#00D4B3]/10 disabled:opacity-50 dark:bg-transparent dark:text-[#00D4B3]">Rechazar</button></div></div>}
      {!proposal && lastAppliedProposal && <div className="ml-8 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-sm dark:border-white/10 dark:bg-[#1E2329] dark:text-gray-200"><p className="font-bold">Edición aplicada</p><p className="mt-1 text-[10px] opacity-75">Puedes deshacerla mientras no se guarden cambios posteriores.</p><button type="button" disabled={saving} onClick={onUndo} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 font-bold hover:bg-slate-50 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5">Deshacer edición</button></div>}
    </div>

    <div className="border-t border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-[#101720]">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-1.5 transition focus-within:border-[#00D4B3] focus-within:ring-2 focus-within:ring-[#00D4B3]/15 dark:border-white/15 dark:bg-slate-950">
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} maxLength={1500} rows={2} placeholder="Pide un cambio para la composición..." className="w-full resize-none bg-transparent px-1 py-0 text-xs leading-4 text-slate-900 outline-none placeholder:text-slate-400 dark:text-white" />
        <div className="mt-0.5 flex items-center justify-between gap-2"><span className="text-[9px] text-slate-400">Enter para enviar · Shift + Enter para salto</span><button type="button" aria-label="Enviar mensaje" disabled={proposing || Boolean(proposal) || instruction.trim().length < 3} onClick={() => void send()} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#0A2540] text-white transition hover:bg-[#0d2f4d] disabled:cursor-not-allowed disabled:opacity-40"><Send size={12} /></button></div>
      </div>
    </div>
  </section>;
}

function AssemblyActions({ assembly, busy, error, history, historyOpen, onApprove, onHistoryToggle, onPrepare, onRender, onRestore, providerStatus, renderStatus }: {
  assembly: { revisionId: string; status: "READY_FOR_PREVIEW" | "READY_FOR_RENDER" } | null;
  busy: boolean;
  error: string | null;
  history: CompositionSnapshotEntry[] | null;
  historyOpen: boolean;
  onApprove: () => void;
  onHistoryToggle: () => void;
  onPrepare: () => void;
  onRender: () => void;
  onRestore: (snapshot: CompositionSnapshotEntry) => void;
  providerStatus: string | null;
  renderStatus: "idle" | "validating" | "sending" | "rendering" | "completed" | "failed";
}) {
  const label = renderStatus === "validating" ? "Validando snapshot…" : renderStatus === "sending" ? "Subiendo proyecto y enviando a HeyGen…" : renderStatus === "rendering" ? `Proceso durable activo${providerStatus ? ` (${providerStatus.toLowerCase()})` : ""}. Puedes cerrar o recargar esta página sin interrumpirlo.` : renderStatus === "completed" ? "Video completado e importado en Courseforge." : "";
  const summary = renderStatus === "completed"
    ? "El video final ya está disponible."
    : assembly
      ? assembly.status === "READY_FOR_RENDER"
        ? "Snapshot aprobado. Puedes enviar el render."
        : "Snapshot listo. Revísalo y apruébalo para renderizar."
      : "Congela la versión guardada antes de enviar un render.";
  return <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-400/20 dark:bg-cyan-400/10">
    <div className="text-xs text-cyan-950 dark:text-cyan-100"><p className="font-bold">Ensamble del video</p><p className="mt-0.5">{summary}</p>{label && <p className="mt-1 font-medium">{label}</p>}{error && <p role="alert" className="mt-1 text-red-700 dark:text-red-200">{error}</p>}</div>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void onPrepare()} className="inline-flex items-center gap-1.5 rounded-md bg-cyan-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Clapperboard size={14} /> {busy && renderStatus === "validating" ? "Congelando…" : assembly ? "Regenerar snapshot" : "Congelar snapshot"}</button>
      <button type="button" disabled={busy || history === null} onClick={onHistoryToggle} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-700 px-3 py-2 text-xs font-bold text-cyan-900 disabled:opacity-50 dark:border-cyan-300 dark:text-cyan-100"><History size={14} /> Snapshots {history ? `(${history.length})` : ""}</button>
      {assembly?.status === "READY_FOR_PREVIEW" && <button type="button" disabled={busy} onClick={() => void onApprove()} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-700 px-3 py-2 text-xs font-bold text-cyan-900 disabled:opacity-50 dark:border-cyan-300 dark:text-cyan-100"><CheckCircle2 size={14} /> Aprobar snapshot</button>}
      {assembly?.status === "READY_FOR_RENDER" && <button type="button" disabled={busy || renderStatus === "sending" || renderStatus === "rendering" || renderStatus === "completed"} onClick={() => void onRender()} className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950"><Send size={14} /> Renderizar video</button>}
    </div>
    {historyOpen && <div className="w-full rounded-lg border border-cyan-200 bg-white/80 p-2 dark:border-cyan-400/20 dark:bg-slate-950/40">
      <p className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wide text-cyan-900/70 dark:text-cyan-100/70">Snapshots congelados</p>
      {history && history.length > 0 ? <div className="max-h-44 space-y-1 overflow-y-auto">{history.map((snapshot) => <div key={snapshot.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-xs hover:bg-cyan-50 dark:hover:bg-white/5"><span><span className="block font-semibold">Snapshot {snapshot.revisionNumber}{snapshot.isActive ? " (activo)" : ""}</span><span className="block text-[10px] text-slate-500">Documento v{snapshot.documentVersion} · {new Date(snapshot.createdAt).toLocaleString()}</span></span><button type="button" disabled={busy || snapshot.isActive} onClick={() => void onRestore(snapshot)} className="rounded-md border border-cyan-600 px-2 py-1 text-[10px] font-bold text-cyan-800 disabled:cursor-default disabled:opacity-50 dark:text-cyan-200">{snapshot.isActive ? "Activo" : "Restaurar"}</button></div>)}</div> : <p className="px-1 py-2 text-xs text-slate-500">Todavía no hay snapshots congelados.</p>}
    </div>}
  </div>;
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
  return <aside className="grid min-h-0 grid-cols-2 gap-2 overflow-hidden lg:col-start-1 lg:row-start-1">
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#101720]">
      <div className="border-b border-slate-200 px-2.5 py-1.5 dark:border-white/10">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">Videos del curso</p>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 pr-1.5">
        {lessons.map((lesson, index) => <button key={lesson.id} type="button" onClick={() => onSelectLesson(lesson.id)} className={`w-full rounded-lg border px-2 py-1.5 text-left transition-colors ${selectedLessonId === lesson.id ? "border-cyan-400 bg-cyan-50 dark:border-cyan-400/40 dark:bg-cyan-400/10" : "border-transparent hover:bg-slate-100 dark:hover:bg-white/5"}`}><span className="flex items-start gap-1.5"><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${lesson.completed ? "bg-green-100 text-green-700 dark:bg-green-400/15 dark:text-green-300" : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-gray-400"}`}>{lesson.completed ? "✓" : index + 1}</span><span className="min-w-0"><span className="block truncate text-[11px] font-semibold text-slate-900 dark:text-white">{lesson.title}</span><span className="block truncate text-[9px] text-slate-500 dark:text-gray-400">{lesson.subtitle}</span></span></span></button>)}
      </div>
    </section>
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#101720]">
      <div className="flex items-center justify-between border-b border-slate-200 px-2.5 py-1.5 dark:border-white/10">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">Assets vinculados</p>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-gray-400">{assets.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2 pr-1.5">
        {assets.map((asset) => {
          const hfId = `asset-${asset.id}`;
          const inTimeline = timelineAssetIds.has(asset.id);
          return <div key={asset.id} className={`rounded-lg border p-1.5 ${selectedHfId === hfId ? "border-cyan-400 bg-cyan-50 dark:border-cyan-400/40 dark:bg-cyan-400/10" : asset.valid ? "border-slate-200 dark:border-white/10" : "border-red-200 bg-red-50 dark:border-red-400/30 dark:bg-red-500/10"}`}>
            <button type="button" disabled={!asset.isEditable || !inTimeline} onClick={() => onSelectAsset(hfId)} className="flex w-full items-center gap-1.5 text-left disabled:cursor-default disabled:opacity-70"><AssetThumbnail asset={asset} /><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium text-slate-800 dark:text-gray-100">{asset.label}</span><span className="flex justify-between gap-1 text-[9px] text-slate-500 dark:text-gray-400"><span className="truncate">{asset.sourceLabel}</span><span>{asset.sizeLabel}</span></span></span></button>
            <button type="button" disabled={!asset.isEditable || !asset.valid || inTimeline} onClick={() => onAddAsset(asset)} title={inTimeline ? "Este asset ya está en la línea de tiempo" : "Añadir a la línea de tiempo"} className={"mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold transition-colors disabled:cursor-default disabled:opacity-60 " + (inTimeline ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200" : "border-cyan-300 text-cyan-800 hover:bg-cyan-50 dark:border-cyan-400/40 dark:text-cyan-200 dark:hover:bg-cyan-400/10")}>{inTimeline ? "En timeline" : <><Plus size={12} /> Añadir a timeline</>}</button>
          </div>;
        })}
      </div>
    </section>
  </aside>;
}

function AssetThumbnail({ asset }: { asset: CompositionStudioAsset }) {
  const [failed, setFailed] = useState(false);
  const commonClass = "relative flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5";
  if (asset.mimeType.startsWith("audio/")) return <span className={commonClass + " text-violet-600 dark:text-violet-300"}><Music2 size={18} /></span>;
  if (asset.mimeType.startsWith("image/") && asset.previewUrl && !failed) return <span className={commonClass}><img src={asset.previewUrl} alt="" onError={() => setFailed(true)} className="h-full w-full object-cover" /></span>;
  if (asset.mimeType.startsWith("video/") && asset.previewUrl && !failed) return <span className={commonClass}><video muted preload="metadata" onError={() => setFailed(true)} className="h-full w-full object-cover"><source src={asset.previewUrl} type={asset.mimeType} /></video><Play className="pointer-events-none absolute text-white drop-shadow" size={15} /></span>;
  const Icon = asset.mimeType.startsWith("image/") ? ImageIcon : asset.mimeType.startsWith("video/") ? Video : FileQuestion;
  return <span className={commonClass + " text-slate-400 dark:text-gray-500"}><Icon size={18} /></span>;
}

function CompositionInspector({ animations, clip, cropModeEnabled, onAnimationSelect, onPatch, onPreviewCrop, onRemove, saving, selectedAnimationId, track }: { animations: CompositionAnimation[]; clip: CompositionClip | null; cropModeEnabled: boolean; onAnimationSelect: (animationId: string | null) => void; onPatch: (operations: CompositionEditorPatchOperation[], summary: string) => Promise<boolean>; onPreviewCrop: (hfId: string, crop: CompositionVisualCrop) => void; onRemove: (clip: CompositionClip) => Promise<void>; saving: boolean; selectedAnimationId: string | null; track: CompositionTrack | null }) {
  const [startSeconds, setStartSeconds] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [rotation, setRotation] = useState("");
  const [opacity, setOpacity] = useState("");
  const [volume, setVolume] = useState(1);
  const [validationError, setValidationError] = useState<string | null>(null);
  useEffect(() => { setStartSeconds(clip ? formatCompositionTimecode(clip.startSeconds) : ""); setDurationSeconds(clip ? formatCompositionTimecode(clip.durationSeconds) : ""); setX(clip ? String(clip.layout.x) : ""); setY(clip ? String(clip.layout.y) : ""); }, [clip?.id, clip?.startSeconds, clip?.durationSeconds, clip?.layout.x, clip?.layout.y]);
  useEffect(() => { setWidth(clip ? String(clip.layout.width) : ""); setHeight(clip ? String(clip.layout.height) : ""); setRotation(clip ? String(clip.layout.rotation) : ""); setOpacity(clip ? String(clip.layout.opacity) : ""); }, [clip?.id, clip?.layout.height, clip?.layout.opacity, clip?.layout.rotation, clip?.layout.width]);
  useEffect(() => {
    const isBrollVideo = clip?.kind === "VIDEO"
      && (track?.semanticRole === "BROLL" || track?.id === "broll");
    setVolume(isBrollVideo ? clip.volume ?? 0 : track?.volume ?? 1);
  }, [clip?.id, clip?.kind, clip?.volume, track?.id, track?.semanticRole, track?.volume]);
  if (!clip) return <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-xs leading-5 text-slate-500 dark:border-white/10 dark:text-gray-400">Selecciona un clip en la timeline o directamente en el preview para editar su layout, visibilidad o duración.</p>;
  const numberOrNull = (value: string) => { const result = Number(value); return Number.isFinite(result) ? result : null; };
  const isMusicClip = clip.kind === "AUDIO" && track?.semanticRole === "MUSIC";
  if (isMusicClip && track) {
    const saveMusicChanges = async () => {
      const duration = parseCompositionTimecode(durationSeconds);
      if (duration === null || duration < 0.05 || volume < 0 || volume > 1) {
        setValidationError("Revisa la duración y el volumen de la música.");
        return;
      }
      setValidationError(null);
      await onPatch([
        { clipId: clip.id, durationSeconds: duration, type: "clip.duration" },
        { settings: { volume }, trackId: track.id, type: "track.update" },
      ], `Ajustó la duración y el volumen de ${clip.label}.`);
    };
    return <div className="space-y-3"><div className="flex items-start gap-2"><span className="rounded-md bg-violet-100 p-1.5 text-violet-700 dark:bg-violet-400/10 dark:text-violet-200"><Music2 size={16} /></span><div><p className="text-sm font-semibold text-slate-900 dark:text-white">{clip.label}</p><p className="mt-0.5 text-[11px] text-slate-500 dark:text-gray-400">Música · ajustes de audio</p></div></div><TimecodeField label="Duración (mm:ss)" value={durationSeconds} onChange={setDurationSeconds} /><VolumeSlider accentClassName="accent-violet-500" ariaLabel="Volumen de la música" disabled={saving} label="Volumen" onChange={setVolume} value={volume} /><p className="text-[10px] leading-4 text-slate-500 dark:text-gray-400">Estos ajustes modifican la duración real del clip y el volumen base de la música. El ducking se configura por separado.</p>{validationError && <p role="alert" className="rounded-md bg-red-50 px-2 py-1.5 text-[10px] text-red-700 dark:bg-red-500/10 dark:text-red-200">{validationError}</p>}<button type="button" disabled={saving} onClick={() => void saveMusicChanges()} className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Save size={13} /> Guardar audio</button></div>;
  }
  const isBrollVideo = clip.kind === "VIDEO"
    && (track?.semanticRole === "BROLL" || track?.id === "broll");
  const saveAllChanges = async () => {
    const start = parseCompositionTimecode(startSeconds);
    const duration = parseCompositionTimecode(durationSeconds);
    const layout = {
      height: numberOrNull(height),
      opacity: numberOrNull(opacity),
      rotation: numberOrNull(rotation),
      width: numberOrNull(width),
      x: numberOrNull(x),
      y: numberOrNull(y),
    };
    if (start === null || duration === null || duration < 0.05 || Object.values(layout).some((value) => value === null) || (isBrollVideo && (volume < 0 || volume > 1))) {
      setValidationError("Revisa tiempo, posición y transformación. Todos los valores deben ser válidos y la duración debe ser mayor a cero.");
      return;
    }
    setValidationError(null);
    const operations: CompositionEditorPatchOperation[] = [
      { clipId: clip.id, durationSeconds: duration, type: "clip.duration" },
      { clipId: clip.id, startSeconds: start, type: "clip.move" },
      { clipId: clip.id, layout: layout as { height: number; opacity: number; rotation: number; width: number; x: number; y: number }, type: "clip.layout" },
    ];
    if (isBrollVideo) operations.push({ clipId: clip.id, type: "clip.volume", volume });
    await onPatch(operations, `Guardó tiempo, posición, transformación${isBrollVideo ? " y volumen" : ""} de ${clip.label}.`);
  };
  const resetAsset = async () => {
    const confirmed = window.confirm(`¿Reiniciar ${clip.label}? Se restaurarán su tamaño, tiempo y encuadre originales; también se quitarán sus animaciones y fragmentos derivados.`);
    if (!confirmed) return;
    await onPatch([{ clipId: clip.id, type: "clip.reset-asset" }], `Reinició ${clip.label} a su estado base.`);
  };
  return <div className="space-y-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-slate-900 dark:text-white">{clip.label}</p><p className="mt-0.5 text-[11px] text-slate-500 dark:text-gray-400">{clip.kind} · pista {clip.trackId}</p></div><div className="flex flex-wrap gap-1"><button type="button" disabled={saving} onClick={() => void onPatch([{ clipId: clip.id, hidden: !clip.hidden, type: "clip.visibility" }], `${clip.hidden ? "Mostró" : "Ocultó"} ${clip.label}.`)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50 dark:border-white/15 dark:text-gray-200">{clip.hidden ? <Eye size={13} /> : <EyeOff size={13} />}{clip.hidden ? "Mostrar" : "Ocultar"}</button><button type="button" disabled={saving} onClick={() => void onRemove(clip)} className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-400/40 dark:text-red-200 dark:hover:bg-red-400/10"><Trash2 size={13} /> Quitar</button></div></div><p className="rounded-md bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500 dark:bg-white/5 dark:text-gray-400">Quitar solo retira este clip de la línea de tiempo; los assets y el deck original permanecen disponibles.</p>{clip.kind !== "AUDIO" && <LayerDepthControls clip={clip} disabled={saving} onPatch={onPatch} />}<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><TimecodeField label="Inicio (mm:ss)" value={startSeconds} onChange={setStartSeconds} /><TimecodeField label="Duración (mm:ss)" value={durationSeconds} onChange={setDurationSeconds} /><InspectorField label="Posición X" value={x} onChange={setX} /><InspectorField label="Posición Y" value={y} onChange={setY} /></div><p className="text-[10px] text-slate-500 dark:text-gray-400">Formato: 01:05 = 1 minuto y 5 segundos; 00:01.050 incluye milisegundos.</p>{isBrollVideo && <section className="border-t border-slate-200 pt-3 dark:border-white/10"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Audio del asset</p><VolumeSlider accentClassName="accent-cyan-500" ariaLabel={`Volumen de ${clip.label}`} disabled={saving} label="Volumen del B-roll" onChange={setVolume} value={volume} /><p className="mt-2 text-[10px] leading-4 text-slate-500 dark:text-gray-400">Este volumen pertenece sólo a este clip. En 0% conserva el B-roll silenciado.</p></section>}<div className="border-t border-slate-200 pt-3 dark:border-white/10"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Transformación</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><InspectorField label="Ancho" value={width} onChange={setWidth} min={1} /><InspectorField label="Alto" value={height} onChange={setHeight} min={1} /><InspectorField label="Rotación" value={rotation} onChange={setRotation} min={-360} /><InspectorField label="Opacidad" value={opacity} onChange={setOpacity} min={0} /></div><p className="mt-2 text-[10px] text-slate-500">Arrastra en el preview para mover; usa el tirador para redimensionar. Mantén Alt para liberar proporciones.</p></div>{(clip.kind === "VIDEO" || clip.kind === "IMAGE") && <VisualCropControls clip={clip} cropModeEnabled={cropModeEnabled} disabled={saving} onPatch={onPatch} onPreviewCrop={onPreviewCrop} />}{COMPOSITION_MOTION_ENABLED && clip.kind !== "AUDIO" && <CompositionMotionControls animations={animations} clip={clip} disabled={saving} selectedAnimationId={selectedAnimationId} onSelectAnimation={onAnimationSelect} onPatch={onPatch} />}{validationError && <p role="alert" className="rounded-md bg-red-50 px-2 py-1.5 text-[10px] text-red-700 dark:bg-red-500/10 dark:text-red-200">{validationError}</p>}<div className="flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={() => void saveAllChanges()} className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50 dark:bg-cyan-400 dark:text-slate-950"><Save size={13} /> Guardar cambios</button><button type="button" disabled={saving || clip.source.type !== "PRODUCTION_ASSET"} onClick={() => void resetAsset()} className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2.5 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-400/40 dark:text-amber-200 dark:hover:bg-amber-400/10" title="Restaurar tiempo, tamaño, encuadre y animaciones del asset"><RotateCcw size={13} /> Reiniciar asset</button>{saving && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400"><Loader2 className="animate-spin" size={13} /> Actualizando preview…</span>}</div></div>;
}

function VisualCropControls({ clip, cropModeEnabled, disabled, onPatch, onPreviewCrop }: { clip: CompositionClip; cropModeEnabled: boolean; disabled: boolean; onPatch: (operations: CompositionEditorPatchOperation[], summary: string) => Promise<boolean>; onPreviewCrop: (hfId: string, crop: CompositionVisualCrop) => void }) {
  const [crop, setCrop] = useState<CompositionCropInsets>(() => resolveCompositionCropInsets(clip.crop, clip.layout));
  useEffect(() => {
    setCrop(resolveCompositionCropInsets(clip.crop, clip.layout));
  }, [clip.id, clip.crop, clip.layout.height, clip.layout.width]);
  const preview = (next: CompositionCropInsets) => {
    const normalized = normalizeCompositionCropInsets(next, clip.layout);
    setCrop(normalized);
    onPreviewCrop(clip.hfId, normalized);
  };
  const save = (next = crop) => onPatch([{ clipId: clip.id, crop: hasCompositionCrop(next) ? next : null, type: "clip.crop" }], `Ajustó el recorte visual de ${clip.label}.`);
  const clear = () => {
    const empty = { bottom: 0, left: 0, right: 0, top: 0 };
    preview(empty);
    return save(empty);
  };
  const fields: Array<{ key: keyof CompositionCropInsets; label: string; maximum: number }> = [
    { key: "top", label: "Superior", maximum: clip.layout.height - crop.bottom - 1 },
    { key: "right", label: "Derecho", maximum: clip.layout.width - crop.left - 1 },
    { key: "bottom", label: "Inferior", maximum: clip.layout.height - crop.top - 1 },
    { key: "left", label: "Izquierdo", maximum: clip.layout.width - crop.right - 1 },
  ];
  return <section className={`border-t pt-3 ${cropModeEnabled ? "border-amber-300" : "border-slate-200 dark:border-white/10"}`}>
    <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Recorte visual</p>{cropModeEnabled && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-800">Recorte activo</span>}</div>
    <p className="mt-1 text-[10px] leading-4 text-slate-500">Cada borde oculta píxeles únicamente desde su dirección. No escala el contenido ni modifica ancho, alto, X o Y.</p>
    <div className="mt-2 grid grid-cols-2 gap-2">{fields.map((field) => <label key={field.key} className="text-[10px] font-medium text-slate-600 dark:text-gray-300"><span className="flex justify-between gap-2"><span>{field.label}</span><span className="font-mono">{Math.round(crop[field.key])} px</span></span><input type="range" min="0" max={Math.max(0, field.maximum)} step="1" value={crop[field.key]} disabled={disabled} onChange={(event) => preview({ ...crop, [field.key]: Number(event.target.value) })} className="mt-1 w-full accent-amber-500" /></label>)}</div>
    <div className="mt-2 flex flex-wrap gap-1.5"><button type="button" disabled={disabled} onClick={() => void save()} className="rounded-md bg-amber-500 px-2 py-1 text-[10px] font-bold text-slate-950 disabled:opacity-50">Guardar recorte</button><button type="button" disabled={disabled} onClick={() => void clear()} className="rounded-md border border-slate-300 px-2 py-1 text-[10px] font-bold text-slate-600 disabled:opacity-50 dark:border-white/15 dark:text-gray-300">Quitar recorte</button></div>
  </section>;
}

function TimecodeField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) { return <label className="text-xs font-medium text-slate-600 dark:text-gray-300"><span>{label}</span><input type="text" inputMode="decimal" placeholder="00:00" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" /></label>; }

function InspectorField({ label, min, onChange, value }: { label: string; min?: number; onChange: (value: string) => void; value: string }) { return <label className="text-xs font-medium text-slate-600 dark:text-gray-300"><span>{label}</span><input type="number" step="0.05" min={min} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" /></label>; }


function LoadingPreview() { return <div className="flex min-h-72 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-600 dark:border-white/10 dark:bg-[#0B1119] dark:text-gray-300"><Loader2 className="mr-2 animate-spin" size={18} /> Preparando editor de composición…</div>; }
function PreviewError({ error, onRetry }: { error: string; onRetry: () => void }) { return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100"><p className="font-bold">No se pudo cargar el preview</p><p className="mt-1">{error}</p><button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-current px-3 py-1.5 text-xs font-bold">Reintentar</button></div>; }
function formatSeconds(value: number) { const seconds = Math.max(0, Math.floor(value)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

function createDerivedClipIdentity(sourceClipId: string) {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const base = sourceClipId.slice(0, 100).replace(/[^a-z0-9-]/gi, "-");
  return {
    clipId: `${base}-cut-${suffix}`,
    hfId: `${base}-cut-${suffix}-hf`,
  };
}
