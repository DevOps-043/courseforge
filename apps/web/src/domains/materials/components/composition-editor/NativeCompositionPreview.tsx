"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Clapperboard, Crop, Eye, EyeOff, FileQuestion, GripHorizontal, Grid3X3, History, Image as ImageIcon, Loader2, Magnet, Maximize2, Minimize2, Minus, MousePointer2, Music2, PanelRight, Pause, Play, Plus, RefreshCw, RotateCcw, Save, Scan, Scissors, Send, SlidersHorizontal, Sparkles, Trash2, Video, X } from "lucide-react";
import { toast } from "sonner";
import type { CompositionClip, CompositionEditorDocument, CompositionTrack, CompositionVisualCrop } from "@/domains/production/composition-editor/composition-document.types";
import { formatCompositionTimecode, parseCompositionTimecode } from "@/domains/production/composition-editor/composition-timecode";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import type { CompositionAgentProposalEnvelope } from "@/domains/production/composition-editor/composition-agent-proposal.types";
import type { CompositionAgentRecoveryMetadata } from "@/domains/production/composition-editor/composition-agent-recovery.service";
import type { CompositionPresetCatalogEntry } from "@/domains/production/composition-editor/composition-preset.types";
import { applyCompositionEditorPatches, ensureCanvasDurationForClipPatches } from "@/domains/production/composition-editor/editor-patch.service";
import { resolveCompositionTrackDefinition } from "@/domains/production/composition-editor/composition-track-registry";
import {
  resolveDefaultCompositionClipLayout,
  resolveDefaultCompositionMediaFit,
} from "@/domains/production/composition-editor/composition-default-layout.service";
import type { CompositionAnimation } from "@/domains/production/composition-editor/composition-motion.types";
import { COMPOSITION_MOTION_ENABLED } from "@/domains/production/composition-editor/composition-motion.config";
import {
  compositionClipHasConfigurableAudio,
  resolveCompositionClipDefaultVolume,
} from "@/domains/production/composition-editor/composition-clip-audio.service";
import { CompositionTimeline } from "./CompositionTimeline";
import { AudioMixControls } from "./AudioMixControls";
import { VolumeSlider } from "./VolumeSlider";
import { LayerDepthControls } from "./LayerDepthControls";
import { CompositionMotionControls } from "./CompositionMotionControls";
import {
  CompositionPresetPanel,
  type AppliedCompositionPreset,
  type CompositionPresetPreviewState,
} from "./CompositionPresetPanel";
import { buildCompositionAutoOrganizePatch } from "@/domains/production/composition-editor/composition-auto-organize.service";
import { buildCompositionDurationRecalculationPatch } from "@/domains/production/composition-editor/composition-duration-recalculation.service";
import { deriveCompositionScenes } from "@/domains/production/composition-editor/composition-scene.service";
import {
  COMPOSITION_VERSION_FALLBACK_HEADER,
  formatCompositionDocumentEtag,
  resolveCompositionDocumentVersion,
} from "@/domains/production/composition-editor/composition-document-version";
import { CompositionPreviewTelemetryBuffer } from "@/domains/production/composition-editor/composition-preview-telemetry.client";
import { detachVideoAudio } from "@/domains/materials/media/detach-video-audio.client";
import { uploadWithSignedUrl } from "@/lib/storage-upload";
import { COMPOSITION_PREVIEW_TELEMETRY_CONFIG } from "@/domains/production/composition-editor/composition-preview-telemetry";
import { clampPreviewPlayhead, classifyPreviewTimeMessage, isPreviewRefreshRequired } from "@/domains/production/composition-editor/composition-preview-playhead.service";
import { CompositionSaveQueue } from "@/domains/production/composition-editor/composition-save-queue";
import { CompositionPreviewRuntimePatchCoordinator } from "@/domains/production/composition-editor/composition-preview-runtime-sync.client";
import {
  INITIAL_COMPOSITION_PREVIEW_SYNC_STATE,
  transitionCompositionPreviewSyncState,
} from "@/domains/production/composition-editor/composition-preview-sync-state";
import { COMPOSITION_PREVIEW_SYNC_V2_ENABLED } from "@/domains/production/composition-editor/composition-preview-sync.config";
import {
  createCompositionPreviewParentCommand,
  parseCompositionPreviewIframeMessage,
  type CompositionPreviewParentCommandInput,
} from "@/domains/production/composition-editor/composition-preview-protocol";
import { classifyCompositionPreviewOperations } from "@/domains/production/composition-editor/composition-preview-operation-policy";
import { buildCompositionPreviewVisualPatch } from "@/domains/production/composition-editor/composition-preview-visual-patch";
import { EngineSelect } from "@/components/ui/EngineSelect";
import { hasCompositionCrop, normalizeCompositionCropInsets, resolveCompositionCropInsets, type CompositionCropInsets } from "@/domains/production/composition-editor/composition-visual-crop.service";
import { createClient as createBrowserSupabaseClient } from "@/utils/supabase/client";
import {
  DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID,
  findHyperframesRenderProfile,
  getHyperframesRenderProfile,
  HYPERFRAMES_RENDER_PROFILES,
  sameHyperframesRenderSettings,
  toHyperframesRenderSettings,
  type HyperframesRenderProfileId,
  type HyperframesRenderSettings,
} from "@/domains/production/hyperframes/hyperframes-render-profiles";
import {
  estimateHyperframesRenderBudget,
  formatRenderBudgetBytes,
} from "@/domains/production/hyperframes/hyperframes-render-budget.service";
import styles from "./CompositionStudio.module.css";

type DocumentPayload = { document: CompositionEditorDocument; documentHash: string; version: number };
type AssemblyBrandingAvailability = { hasIntro: boolean; hasOutro: boolean };
type SavePatchOptions = { preservePreviewRuntime?: boolean };
type PreviewReloadReason = "DIRTY_PLAYBACK" | "MANUAL" | "MEDIA_RECOVERY" | "SAVE_RECOVERY";
type PendingEditTelemetry = {
  operationCount: number;
  operationNames: string[];
  source: "AGENT" | "USER";
  startedAt: number;
};
type DocumentHistoryEntry = DocumentPayload & { createdAt: string };
type CompositionSnapshotEntry = {
  createdAt: string;
  documentHash: string;
  documentVersion: number;
  id: string;
  isActive: boolean;
  isCurrentDocument: boolean;
  projectArchiveSizeBytes: number;
  renderProfile: HyperframesRenderSettings | null;
  renderProfileId: HyperframesRenderProfileId | null;
  revisionNumber: number;
};
type ActiveAssembly = {
  projectArchiveSizeBytes: number;
  renderProfile: HyperframesRenderSettings | null;
  revisionId: string;
  status: "READY_FOR_PREVIEW" | "READY_FOR_RENDER";
};
type RenderAttemptSummary = {
  compositionRevisionId: string;
  id: string;
  importStatus: string;
  providerStatus: string;
};
type DurableCompletedVideo = {
  assetId: string;
  compositionRevisionId: string | null;
  createdAt: string;
};
type CompositionRenderRecoveryState = {
  activeRender: RenderAttemptSummary | null;
  completedVideo: DurableCompletedVideo | null;
  latestRender: RenderAttemptSummary | null;
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
  detachedFromAssetId?: string;
  detachedFromClipId?: string;
  durationSeconds?: number;
  hasAudio?: boolean;
  id: string;
  isEditable: boolean;
  label: string;
  mimeType: string;
  previewUrl: string | null;
  sourceHeight?: number;
  sourceWidth?: number;
  sizeLabel: string;
  sourceLabel: string;
  timelineRole?: "AUDIO" | "AVATAR" | "BROLL" | "VISUAL" | "VOICE";
  timelineVariant?: "CLIP" | "FULL";
  valid: boolean;
}

interface NativeCompositionPreviewProps {
  assets: CompositionStudioAsset[];
  componentId: string;
  compositionId: string;
  draftId: string;
  lessons: CompositionStudioLesson[];
  onContinueToPublication?: () => void;
  onAssetsChanged?: () => Promise<void> | void;
  onRefreshProductionAssets?: () => Promise<void> | void;
  onVideoCompleted?: () => void;
  onSelectLesson: (lessonId: string) => void;
  selectedLessonId: string | null;
}

type HistoricalRecoveryResponse = {
  data?: {
    editorSyncWarning?: string | null;
    report?: {
      importedHistoricalAvatarCount?: number;
      pendingAvatarCount?: number;
      recoveredAvatarCount?: number;
      recoveredVoiceCount?: number;
      unresolvedSceneCount?: number;
    };
  };
  error?: string;
  hint?: string;
  success?: boolean;
};

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
export function NativeCompositionPreview({ assets, componentId, compositionId, draftId, lessons, onAssetsChanged, onContinueToPublication, onRefreshProductionAssets, onSelectLesson, onVideoCompleted, selectedLessonId }: NativeCompositionPreviewProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const studioGridRef = useRef<HTMLDivElement | null>(null);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const payloadRef = useRef<DocumentPayload | null>(null);
  const saveInFlightRef = useRef(false);
  const saveQueueRef = useRef<CompositionSaveQueue<() => Promise<boolean>> | null>(null);
  const runtimePatchCoordinatorRef = useRef<CompositionPreviewRuntimePatchCoordinator | null>(null);
  const previewSyncStateRef = useRef(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE);
  const renderPollInFlightRef = useRef(false);
  const onVideoCompletedRef = useRef(onVideoCompleted);
  const mediaRecoveryHashRef = useRef<string | null>(null);
  const playheadSecondsRef = useRef(0);
  const pendingSeekSecondsRef = useRef<number | null>(null);
  const pendingPreviewRestoreSecondsRef = useRef<number | null>(null);
  const previewDocumentHashRef = useRef<string | null>(null);
  const previewRuntimeBaseHashRef = useRef<string | null>(null);
  const autoPlayAfterPreviewRefreshRef = useRef(false);
  const previewTelemetryRef = useRef<CompositionPreviewTelemetryBuffer | null>(null);
  const previewReloadTelemetryRef = useRef<{ reason: PreviewReloadReason; startedAt: number } | null>(null);
  const pendingEditTelemetryRef = useRef<PendingEditTelemetry | null>(null);
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
  const [separatingAudio, setSeparatingAudio] = useState(false);
  const [separatingAudioProgress, setSeparatingAudioProgress] = useState(0);
  const [refreshingProductionAssets, setRefreshingProductionAssets] = useState(false);
  const [recoveringHistoricalAssets, setRecoveringHistoricalAssets] = useState(false);
  const [failedSave, setFailedSave] = useState<{ operations: CompositionEditorPatchOperation[]; source: "AGENT" | "USER"; summary: string } | null>(null);
  const [agentProposal, setAgentProposal] = useState<AgentProposal | null>(null);
  const [lastAppliedAgentProposal, setLastAppliedAgentProposal] = useState<AgentProposal | null>(null);
  const [proposing, setProposing] = useState(false);
  const [presetPanelOpen, setPresetPanelOpen] = useState(false);
  const [presetEntries, setPresetEntries] = useState<CompositionPresetCatalogEntry[]>([]);
  const [presetCatalogLoading, setPresetCatalogLoading] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetPreview, setPresetPreview] = useState<CompositionPresetPreviewState | null>(null);
  const [lastAppliedPreset, setLastAppliedPreset] = useState<AppliedCompositionPreset | null>(null);
  const [assembly, setAssembly] = useState<ActiveAssembly | null>(null);
  const [snapshotHistory, setSnapshotHistory] = useState<CompositionSnapshotEntry[] | null>(null);
  const [snapshotHistoryOpen, setSnapshotHistoryOpen] = useState(false);
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [assemblyNotice, setAssemblyNotice] = useState<string | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [renderStatus, setRenderStatus] = useState<"idle" | "validating" | "sending" | "rendering" | "completed" | "failed">("idle");
  const [renderRequestId, setRenderRequestId] = useState<string | null>(null);
  const [renderProviderStatus, setRenderProviderStatus] = useState<string | null>(null);
  const [renderRecovery, setRenderRecovery] = useState<CompositionRenderRecoveryState | null>(null);
  const [selectedRenderProfileId, setSelectedRenderProfileId] = useState<HyperframesRenderProfileId>(
    DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID,
  );
  const [seconds, setSeconds] = useState(0);

  if (!saveQueueRef.current) {
    saveQueueRef.current = new CompositionSaveQueue(
      (saveCommand) => saveCommand(),
      undefined,
      () => setSaveError("Hay demasiados cambios pendientes. Espera a que termine el guardado actual."),
    );
  }
  if (!runtimePatchCoordinatorRef.current) {
    runtimePatchCoordinatorRef.current = new CompositionPreviewRuntimePatchCoordinator();
  }

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
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [brandingAvailability, setBrandingAvailability] = useState<AssemblyBrandingAvailability | null>(null);

  useEffect(() => {
    onVideoCompletedRef.current = onVideoCompleted;
  }, [onVideoCompleted]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const closeOnPointerDown = (event: globalThis.PointerEvent) => {
      if (!toolMenuRef.current?.contains(event.target as Node)) setToolMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [toolMenuOpen]);

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

  const loadRecoverablePresetApplication = useCallback(async () => {
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/preset-applications`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo recuperar el preset aplicado.");
      setLastAppliedPreset((body.data || null) as AppliedCompositionPreset | null);
    } catch {
      // Undo is only exposed when the server can prove that the current document
      // is exactly the version produced by the application.
      setLastAppliedPreset(null);
    }
  }, [draftId]);

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
      if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED) {
        previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, {
          documentHash: nextPayload.documentHash,
          type: "DOCUMENT_LOADED",
        });
      }
      previewDocumentHashRef.current = nextPayload.documentHash;
      previewRuntimeBaseHashRef.current = nextPayload.documentHash;
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
      setLastAppliedPreset(null);
      void loadRecoverablePresetApplication();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar la composición.");
    } finally {
      setLoading(false);
    }
  }, [draftId, loadRecoverablePresetApplication]);

  const loadBrandingAvailability = useCallback(async () => {
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/branding`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo consultar intro y outro.");
      setBrandingAvailability(body.data as AssemblyBrandingAvailability);
    } catch {
      // Fail closed: if availability cannot be verified, do not expose an action
      // that would predictably fail or mutate the current timeline.
      setBrandingAvailability(null);
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
    if (activeSnapshot) {
      setSelectedRenderProfileId(
        activeSnapshot.renderProfileId
        || findHyperframesRenderProfile(activeSnapshot.renderProfile)?.id
        || DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID,
      );
    }
    setAssembly(activeSnapshot ? {
      projectArchiveSizeBytes: activeSnapshot.projectArchiveSizeBytes,
      renderProfile: activeSnapshot.renderProfile,
      revisionId: activeSnapshot.id,
      status: body.data.status === "READY_FOR_RENDER" ? "READY_FOR_RENDER" : "READY_FOR_PREVIEW",
    } : null);
  }, [compositionId]);

  useEffect(() => { void loadDocument(); void loadBrandingAvailability(); }, [loadBrandingAvailability, loadDocument]);
  useEffect(() => {
    const controller = new AbortController();
    setAssembly(null);
    setSnapshotHistory(null);
    setSnapshotHistoryOpen(false);
    setAssemblyError(null);
    setAssemblyNotice(null);
    setRenderStatus("idle");
    setRenderRequestId(null);
    setRenderProviderStatus(null);
    setRenderRecovery(null);
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
  useEffect(() => () => runtimePatchCoordinatorRef.current?.dispose(), []);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = parseCompositionPreviewIframeMessage(event.data);
      if (!message) return;
      if (message.type === "courseforge-composition-visual-patch-result") {
        runtimePatchCoordinatorRef.current?.acknowledge(message);
        return;
      }
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
          postPreviewMessage({ type: "courseforge-composition-play" });
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
        const readyDocumentHash = previewDocumentHashRef.current;
        if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED && readyDocumentHash) {
          previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, {
            documentHash: readyDocumentHash,
            type: "PREVIEW_READY",
          });
        }
        const readyAt = performance.now();
        const reloadTelemetry = previewReloadTelemetryRef.current;
        if (reloadTelemetry) {
          previewReloadTelemetryRef.current = null;
          previewTelemetryRef.current?.record({
            atSeconds: playheadSecondsRef.current,
            context: { reloadReason: reloadTelemetry.reason },
            durationMs: Math.min(600_000, readyAt - reloadTelemetry.startedAt),
            name: "iframe_reload_ms",
          });
        }
        const pendingEditTelemetry = pendingEditTelemetryRef.current;
        if (pendingEditTelemetry) {
          pendingEditTelemetryRef.current = null;
          previewTelemetryRef.current?.record({
            atSeconds: playheadSecondsRef.current,
            context: {
              operationCount: pendingEditTelemetry.operationCount,
              operationNames: pendingEditTelemetry.operationNames,
              source: pendingEditTelemetry.source,
            },
            durationMs: Math.min(600_000, readyAt - pendingEditTelemetry.startedAt),
            name: "edit_to_visual_update_ms",
          });
        }
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
          postPreviewMessage({ type: "courseforge-composition-seek", seconds: clampedSeconds });
        } else if (autoPlayAfterPreviewRefreshRef.current) {
          autoPlayAfterPreviewRefreshRef.current = false;
          postPreviewMessage({ type: "courseforge-composition-play" });
        }
        if (selectedHfId) {
          postPreviewMessage({ type: "courseforge-composition-select", hfId: selectedHfId });
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
          postPreviewMessage({ type: "courseforge-composition-pause" });
          setPlaying(false);
          setPreviewReady(false);
          setPlaybackError("El enlace del medio dejó de responder. Renovando el acceso al preview…");
          previewDocumentHashRef.current = currentHash;
          previewRuntimeBaseHashRef.current = currentHash;
          setPreviewDocumentHash(currentHash);
          setPreviewDirty(false);
          if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED) {
            previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, {
              documentHash: currentHash,
              type: "PREVIEW_RELOAD_STARTED",
            });
          }
          previewReloadTelemetryRef.current = { reason: "MEDIA_RECOVERY", startedAt: performance.now() };
          setPreviewRefreshKey((current) => current + 1);
          return;
        }
        if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED) {
          previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, { type: "RUNTIME_FAILED" });
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
  const previewUrl = presetPreview
    ? `/api/production/hyperframes/drafts/${draftId}/preset-applications/${presetPreview.applicationId}/preview`
    : agentProposal
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

  const postPreviewMessage = (message: CompositionPreviewParentCommandInput) => {
    const command = createCompositionPreviewParentCommand(message);
    if (!command) return false;
    frameRef.current?.contentWindow?.postMessage(command, "*");
    return true;
  };
  useEffect(() => {
    if (!previewReady) return;
    postPreviewMessage({
      editingEnabled: directEditingEnabled && !agentProposal && !presetPreview,
      cropEnabled: visualCropEnabled && !agentProposal && !presetPreview,
      gridVisible,
      snapEnabled,
      type: "courseforge-composition-editor-settings",
    });
  }, [agentProposal, directEditingEnabled, gridVisible, presetPreview, previewReady, snapEnabled, visualCropEnabled]);
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
    refreshPreviewDocument(false, "MEDIA_RECOVERY");
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
  const refreshPreviewDocument = (autoPlay = false, reason: PreviewReloadReason = "MANUAL") => {
    const currentPayload = payloadRef.current;
    if (!currentPayload || agentProposal || presetPreview) return;
    pausePreviewForMutation();
    autoPlayAfterPreviewRefreshRef.current = autoPlay;
    previewDocumentHashRef.current = currentPayload.documentHash;
    previewRuntimeBaseHashRef.current = currentPayload.documentHash;
    setPreviewDocumentHash(currentPayload.documentHash);
    setPreviewDirty(false);
    if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED) {
      previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, {
        documentHash: currentPayload.documentHash,
        type: "PREVIEW_RELOAD_STARTED",
      });
    }
    previewReloadTelemetryRef.current = { reason, startedAt: performance.now() };
    setPreviewRefreshKey((current) => current + 1);
  };
  const togglePreviewPlayback = () => {
    if (transportActive) {
      postPreviewMessage({ type: "courseforge-composition-pause" });
      return;
    }
    const currentHash = payloadRef.current?.documentHash || null;
    if (isPreviewRefreshRequired({ persistedDocumentHash: currentHash, previewDirty, previewDocumentHash: previewDocumentHashRef.current })) {
      refreshPreviewDocument(true, "DIRTY_PLAYBACK");
      return;
    }
    postPreviewMessage({ type: "courseforge-composition-play" });
  };
  function savePatch(
    operations: CompositionEditorPatchOperation[],
    summary: string,
    source: "AGENT" | "USER" = "USER",
    options: SavePatchOptions = {},
  ): Promise<boolean> {
    if (!COMPOSITION_PREVIEW_SYNC_V2_ENABLED) {
      return executeSavePatch(operations, summary, source, options, false);
    }
    return saveQueueRef.current!.enqueue(() => executeSavePatch(operations, summary, source, options, true));
  }

  async function executeSavePatch(
    operations: CompositionEditorPatchOperation[],
    summary: string,
    source: "AGENT" | "USER",
    options: SavePatchOptions,
    queuedSave: boolean,
  ): Promise<boolean> {
    const currentPayload = payloadRef.current;
    if (!currentPayload || (!queuedSave && saveInFlightRef.current)) return false;
    if (presetPreview) {
      setSaveError("Confirma o descarta el preset antes de realizar otra edición.");
      return false;
    }
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
    const updateStrategy = classifyCompositionPreviewOperations(effectiveOperations);
    if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED) {
      previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, { type: "EDIT_ACCEPTED" });
      previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, { type: "SAVE_STARTED" });
    }
    const visualPatch = updateStrategy === "LIVE_DOM"
      ? buildCompositionPreviewVisualPatch({ document: optimisticDocument, operations: effectiveOperations })
      : null;
    const runtimeBaseHash = previewRuntimeBaseHashRef.current;
    const canApplyIncrementally = COMPOSITION_PREVIEW_SYNC_V2_ENABLED
      && agentProposal === null
      && presetPreview === null
      && previewReady
      && visualPatch !== null
      && runtimeBaseHash !== null
      && previewDocumentHashRef.current === currentPayload.documentHash;
    const runtimePatchPromise = canApplyIncrementally
      ? runtimePatchCoordinatorRef.current!.dispatch({
        baseDocumentHash: runtimeBaseHash,
        patch: visualPatch,
        send: postPreviewMessage,
      })
      : null;
    if (!runtimePatchPromise) {
      postPreviewMessage({ type: "courseforge-composition-pause" });
      setPlaying(false);
    }
    saveInFlightRef.current = true;
    setSaving(true);
    setSaveError(null);
    setFailedSave(null);
    setPreviewDirty(true);
    const priorPendingEditTelemetry = pendingEditTelemetryRef.current;
    if (!options.preservePreviewRuntime) {
      const operationNames = [...new Set(effectiveOperations.map((operation) => operation.type))];
      pendingEditTelemetryRef.current = {
        operationCount: Math.min(100, (priorPendingEditTelemetry?.operationCount || 0) + effectiveOperations.length),
        operationNames: [...new Set([...(priorPendingEditTelemetry?.operationNames || []), ...operationNames])].slice(0, 12),
        source,
        startedAt: priorPendingEditTelemetry?.startedAt || performance.now(),
      };
    }
    const optimisticPayload = { ...currentPayload, document: optimisticDocument };
    payloadRef.current = optimisticPayload;
    setPayload(optimisticPayload);
    const requestBody = JSON.stringify({ operations: effectiveOperations, source, summary });
    const requestStartedAt = performance.now();
    let saveOutcome: "CONFLICT" | "ERROR" | "SUCCESS" = "ERROR";
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/document`, {
        body: requestBody,
        headers: {
          "Content-Type": "application/json",
          "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash),
          [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash,
        },
        method: "PUT",
      });
      const body = await response.json();
      if (response.status === 409 && body.data) {
        saveOutcome = "CONFLICT";
        if (!options.preservePreviewRuntime) pendingEditTelemetryRef.current = priorPendingEditTelemetry;
        const nextPayload = body.data as DocumentPayload;
        nextPayload.documentHash = resolveCompositionDocumentVersion(nextPayload.documentHash);
        if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED) {
          previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, {
            documentHash: nextPayload.documentHash,
            type: "CONFLICT",
          });
        }
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        setPreviewDirty(nextPayload.documentHash !== previewDocumentHashRef.current);
        setLastAppliedPreset(null);
        if (runtimePatchPromise) refreshPreviewDocument(false, "SAVE_RECOVERY");
        setFailedSave({ operations: effectiveOperations, source, summary });
        setSaveError(body.error || "La composición cambió en otra sesión. El preview se actualizó con la última versión.");
        return false;
      }
      if (!response.ok) throw new Error(body.error || "No se pudo guardar el cambio.");
      saveOutcome = "SUCCESS";
      const nextPayload = body.data as DocumentPayload;
      nextPayload.documentHash = resolveCompositionDocumentVersion(nextPayload.documentHash);
      if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED) {
        previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, {
          documentHash: nextPayload.documentHash,
          type: "SAVE_SUCCEEDED",
        });
      }
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      setLastAppliedPreset(null);
      if (runtimePatchPromise) {
        const runtimeOutcome = await runtimePatchPromise;
        previewTelemetryRef.current?.record({
          atSeconds: playheadSecondsRef.current,
          context: { runtimeOutcome: runtimeOutcome.code, updateStrategy },
          durationMs: Math.min(600_000, runtimeOutcome.durationMs),
          name: "runtime_visual_patch_ms",
        });
        if (runtimeOutcome.applied) {
          previewDocumentHashRef.current = nextPayload.documentHash;
          setPreviewDocumentHash(nextPayload.documentHash);
          setPreviewDirty(false);
          const pendingEditTelemetry = pendingEditTelemetryRef.current;
          if (pendingEditTelemetry) {
            pendingEditTelemetryRef.current = null;
            previewTelemetryRef.current?.record({
              atSeconds: playheadSecondsRef.current,
              context: {
                operationCount: pendingEditTelemetry.operationCount,
                operationNames: pendingEditTelemetry.operationNames,
                source: pendingEditTelemetry.source,
                updateStrategy,
              },
              durationMs: Math.min(600_000, runtimeOutcome.durationMs),
              name: "edit_to_visual_update_ms",
            });
          }
          if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED) {
            previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, {
              documentHash: nextPayload.documentHash,
              type: "PREVIEW_READY",
            });
          }
        } else {
          setPreviewDirty(true);
          refreshPreviewDocument(false, "SAVE_RECOVERY");
        }
      } else {
        setPreviewDirty(nextPayload.documentHash !== previewDocumentHashRef.current);
      }
      if (source === "USER") setLastAppliedAgentProposal(null);
      return true;
    } catch (caught) {
      if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED) {
        previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, { type: "SAVE_FAILED" });
      }
      if (!options.preservePreviewRuntime) pendingEditTelemetryRef.current = priorPendingEditTelemetry;
      payloadRef.current = currentPayload;
      setPayload(currentPayload);
      setPreviewDirty(currentPayload.documentHash !== previewDocumentHashRef.current);
      if (options.preservePreviewRuntime || runtimePatchPromise) {
        refreshPreviewDocument(false, "SAVE_RECOVERY");
      }
      setFailedSave({ operations: effectiveOperations, source, summary });
      setSaveError(caught instanceof Error ? caught.message : "No se pudo guardar el cambio.");
      return false;
    } finally {
      previewTelemetryRef.current?.record({
        atSeconds: playheadSecondsRef.current,
        context: {
          operationCount: Math.min(100, effectiveOperations.length),
          operationNames: [...new Set(effectiveOperations.map((operation) => operation.type))].slice(0, 12),
          outcome: saveOutcome,
          requestBytes: Math.min(
            COMPOSITION_PREVIEW_TELEMETRY_CONFIG.maxRequestBytes,
            new TextEncoder().encode(requestBody).byteLength,
          ),
          source,
          updateStrategy,
        },
        durationMs: Math.min(600_000, performance.now() - requestStartedAt),
        name: "save_roundtrip_ms",
      });
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
    const sourceDimensions = asset.sourceWidth && asset.sourceHeight
      ? { height: asset.sourceHeight, width: asset.sourceWidth }
      : null;
    const clip: CompositionClip = {
      durationSeconds: clipDuration,
      hfId: clipId,
      hidden: false,
      id: clipId,
      kind: clipKind,
      label: asset.label,
      layout: resolveDefaultCompositionClipLayout({ canvas: currentPayload.document.canvas, clipKind, sourceDimensions, track: trackDefinition }),
      mediaFit: resolveDefaultCompositionMediaFit({ clipKind, track: trackDefinition }),
      source: {
        ...(asset.hasAudio !== undefined ? { hasAudio: asset.hasAudio } : {}),
        productionAssetId: asset.id,
        ...(sourceDimensions ? { sourceHeight: sourceDimensions.height, sourceWidth: sourceDimensions.width } : {}),
        type: "PRODUCTION_ASSET",
      },
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

  async function separateSelectedVideoAudio(clip: CompositionClip) {
    if (clip.kind !== "VIDEO" || clip.source.type !== "PRODUCTION_ASSET") return;
    const sourceAssetId = clip.source.productionAssetId;
    const sourceAsset = assets.find((asset) => asset.id === sourceAssetId);
    const existingDetachedAsset = assets.find((asset) => (
      asset.detachedFromClipId === clip.id && asset.detachedFromAssetId === sourceAssetId
    ));
    const existingDetachedClip = existingDetachedAsset
      ? payloadRef.current?.document.clips.find((candidate) => (
          candidate.source.type === "PRODUCTION_ASSET"
          && candidate.source.productionAssetId === existingDetachedAsset.id
        ))
      : null;
    if (existingDetachedClip) {
      setSelectedHfId(existingDetachedClip.hfId);
      return;
    }
    if (!existingDetachedAsset && !sourceAsset?.previewUrl) {
      setSaveError("No se pudo abrir el video fuente para separar su audio.");
      return;
    }
    setSeparatingAudio(true);
    setSeparatingAudioProgress(0);
    setSaveError(null);
    try {
      const safeClipId = clip.id.replace(/[^a-z0-9-]+/gi, "-").slice(0, 72);
      let audioAssetId = existingDetachedAsset?.id;
      let audioDurationSeconds = existingDetachedAsset?.durationSeconds;
      let registeredNewAsset = false;
      if (!audioAssetId) {
        const detached = await detachVideoAudio({
          durationSeconds: clip.durationSeconds,
          fileName: sourceAsset!.label,
          onProgress: setSeparatingAudioProgress,
          sourceOffsetSeconds: clip.sourceOffsetSeconds || 0,
          sourceUrl: sourceAsset!.previewUrl!,
        });
        const storagePath = `editor-audio/${componentId}/${safeClipId}-${Date.now()}.wav`;
        const uploaded = await uploadWithSignedUrl("production-assets", storagePath, detached.file, {
          componentId,
          contentType: detached.file.type,
          fileSizeBytes: detached.file.size,
          purpose: "production-asset",
          upsert: false,
        });
        const registrationResponse = await fetch(`/api/production/hyperframes/drafts/${draftId}/detach-audio`, {
          body: JSON.stringify({
            componentId,
            durationSeconds: detached.durationSeconds,
            fileName: detached.file.name,
            sourceAssetId,
            sourceClipId: clip.id,
            storagePath: uploaded.path,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const registration = await readCompositionApiResponse<{
          data?: { durationSeconds?: number; productionAssetId?: string };
          error?: string;
          success?: boolean;
        }>(registrationResponse, "No se pudo registrar el audio separado.");
        audioAssetId = registration.data?.productionAssetId;
        audioDurationSeconds = registration.data?.durationSeconds || detached.durationSeconds;
        if (!registrationResponse.ok || !registration.success || !audioAssetId) {
          throw new Error(registration.error || "No se pudo registrar el audio separado.");
        }
        registeredNewAsset = true;
      }
      if (registeredNewAsset) await onAssetsChanged?.();
      const suffix = crypto.randomUUID().slice(0, 8);
      const audioClipId = `audio-${safeClipId.slice(0, 90)}-${suffix}`;
      const voiceTrack = resolveCompositionTrackDefinition({ mimeType: "audio/wav", timelineRole: "VOICE" });
      const durationSeconds = Math.min(clip.durationSeconds, audioDurationSeconds || clip.durationSeconds);
      const audioClip: CompositionClip = {
        durationSeconds,
        hfId: audioClipId,
        hidden: false,
        id: audioClipId,
        kind: "AUDIO",
        label: `Audio de ${clip.label}`,
        layout: resolveDefaultCompositionClipLayout({
          canvas: payloadRef.current!.document.canvas,
          clipKind: "AUDIO",
          sourceDimensions: null,
          track: voiceTrack,
        }),
        mediaFit: resolveDefaultCompositionMediaFit({ clipKind: "AUDIO", track: voiceTrack }),
        source: { hasAudio: true, productionAssetId: audioAssetId, type: "PRODUCTION_ASSET" },
        sourceDurationSeconds: audioDurationSeconds || durationSeconds,
        sourceOffsetSeconds: 0,
        startSeconds: clip.startSeconds,
        timingSource: "USER_EDITED",
        trackId: voiceTrack.id,
        volume: 1,
      };
      const saved = await savePatch([
        { clip: audioClip, clipId: audioClip.id, track: voiceTrack, type: "clip.add" },
        { clipId: clip.id, type: "clip.volume", volume: 0 },
      ], `Separó el audio de ${clip.label} en una pista editable y silenció el audio original.`);
      if (!saved) throw new Error("El audio se guardó, pero no se pudo agregar a la línea de tiempo.");
      setSelectedHfId(audioClip.hfId);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo separar el audio del video.");
    } finally {
      setSeparatingAudio(false);
      setSeparatingAudioProgress(0);
    }
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

  async function recalculateDuration() {
    if (!payload) return;
    let operations: CompositionEditorPatchOperation[];
    try {
      operations = buildCompositionDurationRecalculationPatch({ assets, document: payload.document }).operations;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo recalcular la duración de la composición.");
      return;
    }
    await savePatch(operations, "Recalculó la duración del contenido sin reorganizar el timeline.");
  }

  async function organizeTimeline() {
    if (!payload) return;
    const hasManualTiming = payload.document.clips.some((clip) => clip.timingSource === "USER_EDITED");
    const confirmation = hasManualTiming
      ? "La composición contiene ajustes manuales. Se organizarán únicamente los tiempos estimados, sin modificar posiciones, tamaños ni tiempos editados manualmente. ¿Continuar?"
      : "Esto organizará únicamente los tiempos estimados. Las posiciones, capas y versiones anteriores se conservarán. ¿Continuar?";
    if (!window.confirm(confirmation)) return;
    let operations: CompositionEditorPatchOperation[];
    try {
      operations = buildCompositionAutoOrganizePatch({ assets, document: payload.document, includeCanvasDuration: false }).operations;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo organizar el timeline de la composición.");
      return;
    }
    await savePatch(operations, "Organizó los tiempos estimados sin reemplazar el layout manual.");
  }

  async function refreshProductionAssets() {
    if (!onRefreshProductionAssets) return;
    setRefreshingProductionAssets(true);
    setSaveError(null);
    try {
      await onRefreshProductionAssets();
      toast.success("Assets de Producción actualizados.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudieron actualizar los assets de Producción.";
      setSaveError(message);
      toast.error(message);
    } finally {
      setRefreshingProductionAssets(false);
    }
  }

  async function recoverHistoricalAssets() {
    if (!componentId) return;
    setRecoveringHistoricalAssets(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/production/heygen/scenes", {
        body: JSON.stringify({ componentId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const responsePayload = await readCompositionApiResponse<HistoricalRecoveryResponse>(
        response,
        "No se pudieron recuperar los assets históricos.",
      );
      if (!response.ok || !responsePayload.success) {
        const detail = [responsePayload.error, responsePayload.hint].filter(Boolean).join(" ");
        throw new Error(detail || "No se pudieron recuperar los assets históricos.");
      }

      await onAssetsChanged?.();
      await loadDocument();
      const report = responsePayload.data?.report;
      const recoveredAvatarCount = report?.recoveredAvatarCount || 0;
      const importedHistoricalAvatarCount = report?.importedHistoricalAvatarCount || 0;
      const recoveredVoiceCount = report?.recoveredVoiceCount || 0;
      const pendingAvatarCount = report?.pendingAvatarCount || 0;
      if (recoveredAvatarCount > 0 || importedHistoricalAvatarCount > 0 || recoveredVoiceCount > 0) {
        toast.success(`Recuperados: ${recoveredAvatarCount} avatares vigentes, ${importedHistoricalAvatarCount} históricos y ${recoveredVoiceCount} voces.`);
      } else if (pendingAvatarCount > 0) {
        toast.success(`${pendingAvatarCount} avatares históricos todavía están procesándose.`);
      } else {
        toast.success("La revisión terminó; no se encontraron assets históricos nuevos.");
      }
      if (responsePayload.data?.editorSyncWarning) toast.warning(responsePayload.data.editorSyncWarning);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudieron recuperar los assets históricos.";
      setSaveError(message);
      toast.error(message);
    } finally {
      setRecoveringHistoricalAssets(false);
    }
  }

  async function placeAssemblyBranding() {
    if (saving || saveInFlightRef.current) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/branding`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo colocar el intro y outro.");
      setBrandingAvailability({ hasIntro: Boolean(body.data?.branding?.intro), hasOutro: Boolean(body.data?.branding?.outro) });
      await loadDocument();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "No se pudo colocar el intro y outro.");
    } finally {
      setSaving(false);
    }
  }

  async function requestAgentProposal(instruction: string) {
    if (!payload) return;
    if (presetPreview) {
      setSaveError("Confirma o descarta el preset antes de solicitar otra edición.");
      return;
    }
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

  async function loadCompositionPresets() {
    setPresetCatalogLoading(true);
    try {
      const response = await fetch("/api/production/hyperframes/composition-presets", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo cargar el catálogo de presets.");
      setPresetEntries(body.data as CompositionPresetCatalogEntry[]);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "No se pudo cargar el catálogo de presets.");
    } finally {
      setPresetCatalogLoading(false);
    }
  }

  async function createCompositionPreset(input: { description: string; instruction?: string; mode: "INSTRUCTIONS" | "MANUAL"; name: string }) {
    const currentPayload = payloadRef.current;
    if (!currentPayload || presetBusy || saving) return;
    setPresetBusy(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/composition-presets`, {
        body: JSON.stringify(input),
        headers: {
          "Content-Type": "application/json",
          "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash),
          [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash,
        },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo crear el preset.");
      await loadCompositionPresets();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "No se pudo crear el preset.");
    } finally {
      setPresetBusy(false);
    }
  }

  async function previewCompositionPreset(presetId: string) {
    const currentPayload = payloadRef.current;
    if (!currentPayload || presetBusy || saving) return;
    if (agentProposal) {
      setSaveError("Confirma o descarta la propuesta de SofLIA antes de abrir un preset.");
      return;
    }
    setPresetBusy(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/preset-applications`, {
        body: JSON.stringify({ presetId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo preparar el preview del preset.");
      const preview = body.data as CompositionPresetPreviewState;
      if (preview.baseDocumentHash !== currentPayload.documentHash) {
        throw new Error("La composición cambió antes de abrir el preview. Actualiza el catálogo y vuelve a intentar.");
      }
      setLastAppliedPreset(null);
      setPresetPreview(preview);
      setPresetPanelOpen(true);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "No se pudo preparar el preview del preset.");
    } finally {
      setPresetBusy(false);
    }
  }

  async function applyCompositionPresetPreview() {
    const preview = presetPreview;
    const currentPayload = payloadRef.current;
    if (!preview || !currentPayload || presetBusy || saveInFlightRef.current) return;
    setPresetBusy(true);
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/preset-applications/${preview.applicationId}/apply`, {
        headers: {
          "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash),
          [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash,
        },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo aplicar el preset.");
      const nextPayload = body.data as DocumentPayload;
      nextPayload.documentHash = resolveCompositionDocumentVersion(nextPayload.documentHash);
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      previewDocumentHashRef.current = nextPayload.documentHash;
      previewRuntimeBaseHashRef.current = nextPayload.documentHash;
      setPreviewDocumentHash(nextPayload.documentHash);
      setPreviewDirty(false);
      setPresetPreview(null);
      setLastAppliedPreset({ applicationId: preview.applicationId, name: preview.preset.name });
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "No se pudo aplicar el preset.");
    } finally {
      setPresetBusy(false);
      setSaving(false);
    }
  }

  async function dismissCompositionPresetPreview() {
    const preview = presetPreview;
    setPresetPreview(null);
    if (!preview) return;
    try {
      await fetch(`/api/production/hyperframes/drafts/${draftId}/preset-applications/${preview.applicationId}`, { method: "DELETE" });
    } catch {
      // The durable preview is short lived and cannot mutate the document after
      // it disappears from this session without its unguessable id.
    }
  }

  async function undoLastCompositionPreset() {
    const applied = lastAppliedPreset;
    const currentPayload = payloadRef.current;
    if (!applied || !currentPayload || presetBusy || saveInFlightRef.current) return;
    if (!window.confirm(`¿Restaurar la versión completa anterior a “${applied.name}”?`)) return;
    setPresetBusy(true);
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/preset-applications/${applied.applicationId}/undo`, {
        headers: {
          "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash),
          [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash,
        },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo deshacer el preset.");
      const nextPayload = body.data as DocumentPayload;
      nextPayload.documentHash = resolveCompositionDocumentVersion(nextPayload.documentHash);
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      previewDocumentHashRef.current = nextPayload.documentHash;
      previewRuntimeBaseHashRef.current = nextPayload.documentHash;
      setPreviewDocumentHash(nextPayload.documentHash);
      setPreviewDirty(false);
      setLastAppliedPreset(null);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "No se pudo deshacer el preset.");
    } finally {
      setPresetBusy(false);
      setSaving(false);
    }
  }

  async function prepareAssembly() {
    setAssembling(true); setAssemblyError(null); setAssemblyNotice(null); setRenderStatus("validating");
    try {
      const selectedProfile = getHyperframesRenderProfile(selectedRenderProfileId);
      const response = await fetch(`/api/production/hyperframes/compositions/${compositionId}/snapshot`, { body: JSON.stringify({ draftId, renderProfileId: selectedProfile.id }), headers: { "Content-Type": "application/json" }, method: "POST" });
      const body = await readCompositionApiResponse<{ data?: { id: string; project_archive_size_bytes: number; reused?: boolean; revision_number?: number }; error?: string }>(response, "No se pudo preparar el ensamble.");
      if (!response.ok) throw new Error(body.error || "No se pudo preparar el ensamble.");
      if (!body.data?.id) throw new Error("El servidor no devolvió el snapshot creado.");
      setAssembly({
        projectArchiveSizeBytes: Number(body.data.project_archive_size_bytes),
        renderProfile: toHyperframesRenderSettings(selectedProfile),
        revisionId: body.data.id,
        status: "READY_FOR_PREVIEW",
      });
      setAssemblyNotice(body.data.reused
        ? `El Snapshot ${body.data.revision_number || "activo"} ya coincide con el documento, los assets y el perfil. Se reutilizó sin volver a cargar el ZIP.`
        : `Snapshot ${body.data.revision_number || "nuevo"} creado y ZIP almacenado correctamente.`);
      setRenderStatus("idle");
      await loadSnapshotHistory();
    } catch (caught) { setAssemblyError(caught instanceof Error ? caught.message : "No se pudo preparar el ensamble."); setRenderStatus("failed"); }
    finally { setAssembling(false); }
  }

  async function restoreSnapshot(snapshot: CompositionSnapshotEntry) {
    if ((snapshot.isActive && snapshot.isCurrentDocument) || assembling) return;
    const currentPayload = payloadRef.current;
    if (!currentPayload) return;
    if (saveInFlightRef.current || saving || presetBusy) {
      setAssemblyError("Espera a que termine el cambio actual antes de restaurar un snapshot.");
      return;
    }
    if (agentProposal || presetPreview) {
      setAssemblyError("Confirma o descarta el preview pendiente antes de restaurar un snapshot.");
      return;
    }
    setAssembling(true);
    setAssemblyError(null);
    setAssemblyNotice(null);
    try {
      const response = await fetch(`/api/production/hyperframes/compositions/${compositionId}/revisions`, {
        body: JSON.stringify({ draftId, revisionId: snapshot.id }),
        headers: {
          "Content-Type": "application/json",
          "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash),
          [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash,
        },
        method: "PUT",
      });
      const body = await readCompositionApiResponse<{
        data?: {
          document: CompositionEditorDocument;
          documentHash: string;
          id: string;
          restoredVersion: number;
          status: "READY_FOR_PREVIEW";
        };
        error?: string;
      }>(response, "No se pudo restaurar el snapshot.");
      if (!response.ok || !body.data) {
        if (response.status === 409) await loadDocument();
        throw new Error(body.error || "No se pudo restaurar el snapshot.");
      }

      pausePreviewForMutation();
      const restoredPayload: DocumentPayload = {
        document: body.data.document,
        documentHash: resolveCompositionDocumentVersion(body.data.documentHash),
        version: body.data.restoredVersion,
      };
      payloadRef.current = restoredPayload;
      setPayload(restoredPayload);
      if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED) {
        previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, {
          documentHash: restoredPayload.documentHash,
          type: "DOCUMENT_LOADED",
        });
      }
      previewDocumentHashRef.current = restoredPayload.documentHash;
      previewRuntimeBaseHashRef.current = restoredPayload.documentHash;
      setPreviewDocumentHash(restoredPayload.documentHash);
      setPreviewDirty(false);
      pendingPreviewRestoreSecondsRef.current = null;
      playheadSecondsRef.current = 0;
      setSeconds(0);
      setSelectedHfId(null);
      setSelectedAnimationId(null);
      setManualInspectorOpen(false);
      setRemovalRangeStart(null);
      setHistory(null);
      setLastAppliedAgentProposal(null);
      setLastAppliedPreset(null);
      setAssembly({
        projectArchiveSizeBytes: snapshot.projectArchiveSizeBytes,
        renderProfile: snapshot.renderProfile,
        revisionId: body.data.id,
        status: "READY_FOR_PREVIEW",
      });
      setSelectedRenderProfileId(
        snapshot.renderProfileId
        || findHyperframesRenderProfile(snapshot.renderProfile)?.id
        || DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID,
      );
      setRenderStatus("idle");
      setRenderRequestId(null);
      setRenderProviderStatus(null);
      setAssemblyNotice(`Snapshot ${snapshot.revisionNumber} restaurado en el timeline y en la salida de ensamble.`);
      await loadBrandingAvailability();
      await loadSnapshotHistory();
    } catch (caught) {
      setAssemblyError(caught instanceof Error ? caught.message : "No se pudo restaurar el snapshot.");
    } finally {
      setAssembling(false);
    }
  }
  async function approveAssembly() {
    const selectedProfile = getHyperframesRenderProfile(selectedRenderProfileId);
    if (!assembly) return;
    if (!assembly.renderProfile || !sameHyperframesRenderSettings(assembly.renderProfile, selectedProfile)) {
      setAssemblyError("Regenera el snapshot para aplicar el perfil seleccionado antes de aprobarlo.");
      return;
    }
    setAssembling(true); setAssemblyError(null);
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
        setRenderRequestId(null);
        setAssemblyError("El envío o HeyGen reportaron que el render falló. Puedes volver a intentarlo.");
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

  const recoverActiveRender = useCallback(async () => {
    const response = await fetch(
      `/api/production/hyperframes/renders?compositionId=${encodeURIComponent(compositionId)}`,
      { cache: "no-store" },
    );
    const body = await readCompositionApiResponse<{
      data?: CompositionRenderRecoveryState | null;
      error?: string;
    }>(response, "No se pudo recuperar el render pendiente.");
    if (!response.ok) throw new Error(body.error || "No se pudo recuperar el render pendiente.");
    setRenderRecovery(body.data || null);
    if (!body.data?.activeRender?.id) return false;

    const requestId = body.data.activeRender.id;
    setRenderRequestId(requestId);
    setRenderProviderStatus(
      body.data.activeRender.importStatus && body.data.activeRender.importStatus !== "NONE"
        ? body.data.activeRender.importStatus
        : body.data.activeRender.providerStatus,
    );
    setRenderStatus("rendering");
    setAssemblyError(null);
    void pollAssemblyRender(requestId);
    return true;
  }, [compositionId, pollAssemblyRender]);

  useEffect(() => {
    if (!assembly || !renderRecovery || renderRecovery.activeRender) return;

    const latestRender = renderRecovery.latestRender;
    const completedVideo = renderRecovery.completedVideo;
    const latestMatchesActiveRevision = latestRender?.compositionRevisionId === assembly.revisionId;
    const completedVideoMatchesActiveRevision = completedVideo?.compositionRevisionId === assembly.revisionId;

    if (latestMatchesActiveRevision && latestRender) {
      const providerFailed = latestRender.providerStatus.toUpperCase() === "FAILED";
      const importFailed = latestRender.importStatus.toUpperCase() === "FAILED";
      if (providerFailed || importFailed) {
        setRenderStatus("failed");
        setRenderProviderStatus(importFailed ? latestRender.importStatus : latestRender.providerStatus);
        setAssemblyError(
          completedVideo
            ? "El render de esta revisión falló en HeyGen. El último video completado sigue disponible para publicación; puedes reintentar esta revisión sin perderlo."
            : "El render de esta revisión falló en HeyGen. Puedes volver a intentarlo.",
        );
        return;
      }
      if (latestRender.importStatus.toUpperCase() === "COMPLETED") {
        setRenderStatus("completed");
        setRenderProviderStatus("COMPLETED");
        setAssemblyError(null);
        return;
      }
    }

    if (completedVideoMatchesActiveRevision) {
      setRenderStatus("completed");
      setRenderProviderStatus("COMPLETED");
      setAssemblyError(null);
    } else {
      setRenderStatus("idle");
      setRenderProviderStatus(null);
      setAssemblyError(null);
    }
  }, [assembly, renderRecovery]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!active) return;
        await recoverActiveRender();
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
  }, [recoverActiveRender]);

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
        setRenderRequestId(null);
        setAssemblyError(null);
        if (!completionNotified) {
          completionNotified = true;
          onVideoCompletedRef.current?.();
        }
      } else if (providerStatus === "FAILED" || importStatus === "FAILED") {
        setRenderStatus("failed");
        setRenderRequestId(null);
        setAssemblyError(
          renderRecovery?.completedVideo
            ? "No se pudo completar este render. El último video completado sigue disponible para publicación y no fue eliminado."
            : "No se pudo completar el render o importar el video final. Revisa el estado antes de reintentar.",
        );
      } else {
        setRenderStatus("rendering");
        setAssemblyError(null);
      }
    };
    const refreshDurableRenderState = async () => {
      const response = await fetch(
        `/api/production/hyperframes/renders/${encodeURIComponent(renderRequestId)}/poll`,
        { cache: "no-store" },
      );
      const body = await readCompositionApiResponse<{
        data?: { importStatus: string; providerStatus: string };
        error?: string;
      }>(response, "No se pudo actualizar el estado del render.");
      if (!response.ok || !body.data) {
        throw new Error(body.error || "No se pudo actualizar el estado del render.");
      }
      applyDurableRenderState({
        import_status: body.data.importStatus,
        provider_status: body.data.providerStatus,
      });
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
        void refreshDurableRenderState().catch(() => undefined);
      });
    const refreshTimer = window.setInterval(() => {
      void refreshDurableRenderState().catch(() => undefined);
    }, 15_000);
    void refreshDurableRenderState().catch(() => undefined);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [renderRecovery?.completedVideo, renderRequestId]);

  async function submitAssemblyRender(options: { forceNewAttempt?: boolean } = {}) {
    const selectedProfile = getHyperframesRenderProfile(selectedRenderProfileId);
    if (!assembly || assembly.status !== "READY_FOR_RENDER") return;
    if (!assembly.renderProfile || !sameHyperframesRenderSettings(assembly.renderProfile, selectedProfile)) {
      setAssemblyError("El perfil seleccionado no coincide con el snapshot aprobado. Regenera el snapshot antes de renderizar.");
      return;
    }
    setAssembling(true); setAssemblyError(null); setAssemblyNotice(null); setRenderStatus("sending");
    try {
      const attemptId = options.forceNewAttempt || renderStatus === "failed"
        ? crypto.randomUUID()
        : undefined;
      const response = await fetch("/api/production/hyperframes/renders", {
        body: JSON.stringify({
          aspectRatio: "16:9",
          attemptId,
          ...toHyperframesRenderSettings(assembly.renderProfile),
          revisionId: assembly.revisionId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = await readCompositionApiResponse<{ data: { providerStatus: string; renderRequestId: string }; error?: string }>(response, "No se pudo enviar el render.");
      if (!response.ok) throw new Error(body.error || "No se pudo enviar el render.");
      const requestId = body.data.renderRequestId as string;
      setRenderRequestId(requestId);
      setRenderProviderStatus(body.data.providerStatus as string);
      setRenderStatus("rendering");
      void pollAssemblyRender(requestId);
    }
    catch (caught) {
      try {
        if (await recoverActiveRender()) {
          setAssemblyError("La solicitud tardó más de lo esperado, pero el ensamble quedó registrado y continúa en seguimiento.");
          return;
        }
      } catch {
        // Preserve the original submission error when reconciliation is also unavailable.
      }
      setAssemblyError(caught instanceof Error ? caught.message : "No se pudo enviar el render.");
      setRenderStatus("failed");
    }
    finally { setAssembling(false); }
  }

  async function deletePriorVideoAndRender() {
    const completedVideo = renderRecovery?.completedVideo;
    if (!completedVideo?.assetId || !assembly || assembly.status !== "READY_FOR_RENDER") return;
    const confirmed = window.confirm(
      "Se eliminará permanentemente de Storage el video final actual de esta lección y se archivarán sus referencias anteriores. Los snapshots y videos de otras lecciones no cambiarán. ¿Deseas continuar y lanzar un render nuevo?",
    );
    if (!confirmed) return;

    setAssembling(true);
    setAssemblyError(null);
    try {
      const response = await fetch(
        `/api/production/hyperframes/compositions/${encodeURIComponent(compositionId)}/final-video`,
        {
          body: JSON.stringify({ assetId: completedVideo.assetId }),
          headers: { "Content-Type": "application/json" },
          method: "DELETE",
        },
      );
      const body = await readCompositionApiResponse<{ code?: string; error?: string }>(
        response,
        "No se pudo eliminar el video final anterior.",
      );
      const alreadyDeleted = response.status === 404
        && body.code === "HYPERFRAMES_FINAL_VIDEO_NOT_FOUND";
      if (!response.ok && !alreadyDeleted) {
        throw new Error(body.error || "No se pudo eliminar el video final anterior.");
      }
      setRenderRecovery((current) => current ? { ...current, completedVideo: null } : current);
      setRenderStatus("idle");
      setRenderProviderStatus(null);
    } catch (caught) {
      setAssemblyError(
        caught instanceof Error
          ? caught.message
          : "No se pudo eliminar el video final anterior.",
      );
      setRenderStatus("failed");
      setAssembling(false);
      return;
    }
    setAssembling(false);
    await submitAssemblyRender({ forceNewAttempt: true });
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

  const deliveryMenu = (
    <AssemblyActions
      compact
      assembly={assembly}
      busy={assembling}
      durationSeconds={duration}
      error={assemblyError}
      notice={assemblyNotice}
      history={snapshotHistory}
      historyOpen={snapshotHistoryOpen}
      priorCompletedVideo={Boolean(renderRecovery?.completedVideo && renderRecovery.completedVideo.compositionRevisionId !== assembly?.revisionId)}
      providerStatus={renderProviderStatus}
      renderStatus={renderStatus}
      selectedRenderProfileId={selectedRenderProfileId}
      onApprove={approveAssembly}
      onDeleteAndRender={deletePriorVideoAndRender}
      onHistoryToggle={() => setSnapshotHistoryOpen((current) => !current)}
      onPrepare={prepareAssembly}
      onProfileChange={(profileId) => {
        setSelectedRenderProfileId(profileId);
        setAssemblyNotice(null);
      }}
      onRender={() => submitAssemblyRender()}
      onRestore={restoreSnapshot}
    />
  );
  const compositionScenes = deriveCompositionScenes(payload.document);
  const activeSceneId = compositionScenes.find((scene) =>
    seconds >= scene.startSeconds && seconds < scene.startSeconds + scene.durationSeconds
  )?.id;

  return (
    <section className={`${styles.studio} courseforge-composition-studio`}>
      <CompositionPresetPanel
        activePreview={presetPreview}
        busy={saving || presetBusy}
        entries={presetEntries}
        lastApplied={lastAppliedPreset}
        loading={presetCatalogLoading}
        onApply={applyCompositionPresetPreview}
        onClose={() => setPresetPanelOpen(false)}
        onCreate={createCompositionPreset}
        onDismiss={dismissCompositionPresetPreview}
        onPreview={previewCompositionPreset}
        onReload={loadCompositionPresets}
        onUndo={undoLastCompositionPreset}
        open={presetPanelOpen}
      />
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
      <div
        ref={studioGridRef}
        style={{
          "--studio-preview-row": `${studioTopPanePercent}fr`,
          "--studio-timeline-row": `${100 - studioTopPanePercent}fr`,
        } as CSSProperties}
        className={`${styles.editorGrid} ${inspectorOpen ? styles.editorGridWithInspector : ""}`}
      >
        <StudioLibrary assets={assets} delivery={deliveryMenu} lessons={lessons} onAddAsset={addAssetToTimeline} onSelectLesson={onSelectLesson} selectedLessonId={selectedLessonId} onSelectAsset={selectClip} selectedHfId={selectedHfId} timelineAssetIds={new Set(payload.document.clips.flatMap((clip) => clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []))} />

        <section ref={previewShellRef} className={`${styles.previewPanel} ${previewFullscreen ? styles.previewFullscreen : ""}`}>
          <div className={styles.previewToolbar}>
            <div className={styles.previewIdentity}>
              <span className={styles.previewIdentityIcon}><Clapperboard size={14} aria-hidden="true" /></span>
              <span className={styles.previewTitle}>Ensamble <small>v{payload.version} · {formatSeconds(duration)}</small>{presetPreview ? <span className={styles.pendingBadge}>Preview de preset</span> : agentProposal ? <span className={styles.pendingBadge}>Propuesta sin guardar</span> : previewDirty ? <span className={styles.pendingBadge}>Cambios pendientes</span> : null}</span>
            </div>
            <div className={styles.previewTools}>
              <div className={styles.toolbarGroup} aria-label="Edición principal">
                <PreviewToolButton active={directEditingEnabled} label="Editar" title="Activar selección, arrastre y tiradores" onClick={() => setDirectEditingEnabled((current) => !current)}><MousePointer2 size={13} /></PreviewToolButton>
                <PreviewToolButton active={snapEnabled} label="Snap" title="Alinear clips, recortes y animaciones con el cursor y con otros límites temporales" onClick={() => setSnapEnabled((current) => !current)}><Magnet size={13} /></PreviewToolButton>
                <PreviewToolButton active={false} label="Dividir" title="Dividir el clip seleccionado en el cursor" onClick={() => void splitSelectedClipAtPlayhead()}><Scissors size={13} /></PreviewToolButton>
              </div>
              <div ref={toolMenuRef} className={styles.toolMenuWrap}>
                <button type="button" aria-expanded={toolMenuOpen} aria-haspopup="menu" onClick={() => setToolMenuOpen((current) => !current)} className={`${styles.toolButton} ${gridVisible || visualCropEnabled || trimToolEnabled || removalRangeStart !== null ? styles.toolButtonActive : ""}`} title="Abrir herramientas adicionales"><SlidersHorizontal size={13} /><span>Herramientas</span><ChevronDown className={toolMenuOpen ? styles.toolMenuChevronOpen : ""} size={12} /></button>
                {toolMenuOpen && <div className={styles.toolMenu} role="menu" aria-label="Herramientas adicionales">
                  <button type="button" role="menuitemcheckbox" aria-checked={gridVisible} onClick={() => { setGridVisible((current) => !current); setToolMenuOpen(false); }} className={styles.toolMenuItem}><Grid3X3 size={14} /><span><strong>Rejilla</strong><small>Guías visuales del canvas</small></span><i data-active={gridVisible} /></button>
                  <button type="button" role="menuitemcheckbox" aria-checked={visualCropEnabled} onClick={() => { setDirectEditingEnabled(true); setSaveError(null); setVisualCropEnabled((current) => !current); setToolMenuOpen(false); }} className={styles.toolMenuItem}><Scan size={14} /><span><strong>Recorte visual</strong><small>Ajustar bordes del medio</small></span><i data-active={visualCropEnabled} /></button>
                  <button type="button" role="menuitemcheckbox" aria-checked={trimToolEnabled} onClick={() => { setTrimToolEnabled((current) => !current); setToolMenuOpen(false); }} className={styles.toolMenuItem}><Crop size={14} /><span><strong>Recorte temporal</strong><small>Modificar inicio y duración</small></span><i data-active={trimToolEnabled} /></button>
                  <button type="button" role="menuitem" onClick={() => { if (removalRangeStart === null) markSelectedIntervalStart(); else void removeSelectedInterval(); setToolMenuOpen(false); }} className={styles.toolMenuItem}><Trash2 size={14} /><span><strong>{removalRangeStart === null ? "Marcar intervalo" : "Eliminar intervalo"}</strong><small>{removalRangeStart === null ? "Define el inicio de un corte" : `Desde ${formatCompositionTimecode(removalRangeStart.seconds)} al cursor`}</small></span><i data-active={removalRangeStart !== null} /></button>
                </div>}
              </div>
              <div className={styles.toolbarGroup} aria-label="Vista del monitor">
                <button type="button" disabled={previewZoom <= 0.75} onClick={() => changePreviewZoom(-0.1)} title="Alejar preview" aria-label="Alejar preview" className={styles.toolIconButton}><Minus size={13} /></button>
                <span className={styles.toolValue}>{Math.round(previewZoom * 100)}%</span>
                <button type="button" disabled={previewZoom >= 1.75} onClick={() => changePreviewZoom(0.1)} title="Acercar preview" aria-label="Acercar preview" className={styles.toolIconButton}><Plus size={13} /></button>
                <button type="button" onClick={() => void togglePreviewFullscreen()} title={previewFullscreen ? "Salir de pantalla completa" : "Abrir preview en pantalla completa"} aria-label={previewFullscreen ? "Salir de pantalla completa" : "Abrir preview en pantalla completa"} className={styles.toolIconButton}>{previewFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
              </div>
            </div>
            <div className={styles.previewUtilities}>
              <span role="status" data-state={saving ? "saving" : saveError ? "error" : "saved"} className={styles.saveStatus}>{saving ? "Guardando…" : saveError ? "Error" : "Guardado"}</span>
              <div className={styles.toolbarGroup} aria-label="Documento e inspector">
                <button type="button" onClick={() => setManualInspectorOpen((current) => !current)} className={`${styles.toolIconButton} ${inspectorOpen ? styles.toolIconButtonActive : ""}`} title={inspectorOpen ? "Cerrar inspector" : "Abrir inspector"} aria-label={inspectorOpen ? "Cerrar inspector" : "Abrir inspector"}><PanelRight size={14} /></button>
                <div className={styles.historyWrap}>
                  <button type="button" disabled={saving} onClick={() => void loadHistory()} className={styles.toolIconButton} title="Historial de edición" aria-label="Abrir historial de edición"><History size={14} /></button>
                  {history && <div className={styles.historyMenu} role="dialog" aria-label="Historial de edición"><div className={styles.historyMenuHeader}><span>Historial de edición</span><button type="button" aria-label="Cerrar historial" onClick={() => setHistory(null)}><X size={12} /></button></div>{history.map((entry, entryIndex) => <button key={`${entry.documentHash}-${entry.version}-${entryIndex}`} type="button" disabled={saving || entry.version === payload.version} onClick={() => void restoreHistoryEntry(entry)} className={styles.historyItem}><span><strong>Versión {entry.version}{entry.version === payload.version ? " · actual" : ""}</strong><small>{new Date(entry.createdAt).toLocaleString()}</small></span>{entry.version !== payload.version && <em>Restaurar</em>}</button>)}</div>}
                </div>
                <button type="button" onClick={() => void loadDocument()} className={styles.toolIconButton} title="Recargar composición" aria-label="Recargar composición"><RefreshCw size={14} /></button>
              </div>
              <div className={styles.toolbarActionGroup}>
                <button type="button" disabled={Boolean(agentProposal)} onClick={() => { setPresetPanelOpen(true); void loadCompositionPresets(); }} className={styles.toolButton} title="Aplicar o crear un preset dinámico"><Clapperboard size={13} /><span>Presets</span></button>
                <button type="button" onClick={() => { setManualInspectorOpen(true); setInspectorTab("assistant"); }} className={`${styles.toolButton} ${styles.assistantTool}`} title="Ajustar la composición con SofLIA"><Sparkles size={13} /><span>SofLIA</span></button>
                {onContinueToPublication && <button type="button" onClick={onContinueToPublication} className={`${styles.toolButton} ${styles.publishTool}`} title="Continuar a publicación"><span>Publicar</span><ArrowRight size={13} /></button>}
              </div>
            </div>
          </div>
          {compositionScenes.length > 0 && (
            <nav aria-label="Microeditor por escenas" className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-white/10 bg-black/10 px-3 py-2">
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">Escenas</span>
              {compositionScenes.map((scene) => (
                <button
                  key={scene.id}
                  type="button"
                  aria-current={activeSceneId === scene.id ? "step" : undefined}
                  onClick={() => {
                    seek(scene.startSeconds);
                    selectClip(scene.primaryHfId);
                  }}
                  className={`shrink-0 rounded-md border px-2.5 py-1 text-[10px] font-semibold transition ${activeSceneId === scene.id ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "border-white/10 text-slate-400 hover:border-white/20 hover:text-white"}`}
                  title={`${scene.roles.join(" + ")} · ${formatCompositionTimecode(scene.durationSeconds)}`}
                >
                  {scene.label}
                </button>
              ))}
            </nav>
          )}
          <div className={`${styles.previewViewport} courseforge-composition-preview-viewport`}>
            <div className={styles.previewFrame}>
              <iframe ref={frameRef} title="Preview completo de composición" src={previewUrl} sandbox="allow-scripts" allow="autoplay" className="absolute inset-0 h-full w-full" />
              {previewMediaState === "PREPARING" && <div className={styles.mediaPreparing}><div className={styles.mediaStatus}><Loader2 className="animate-spin" size={15} /> Preparando medios{pendingPreviewMediaIds.length > 0 ? ` (${pendingPreviewMediaIds.length})` : ""}…</div></div>}
              {previewMediaState === "BUFFERING" && <div className={styles.mediaBuffering}><span className={styles.mediaStatus}><Loader2 className="animate-spin" size={13} /> Cargando medio{pendingPreviewMediaIds.length > 1 ? ` (${pendingPreviewMediaIds.length})` : ""}…</span></div>}
            </div>
          </div>
          {playbackError && <div role="alert" className="flex items-center justify-between gap-3 border-t border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100"><span>{playbackError}</span><button type="button" onClick={refreshPreviewMedia} className="shrink-0 rounded border border-amber-400/50 px-2 py-1 font-semibold hover:bg-amber-100 dark:border-amber-200/50 dark:hover:bg-amber-200/10">Recargar medios</button></div>}
          <div className={styles.transport}>
            <button type="button" disabled={saving || !previewReady || previewMediaState === "PREPARING"} onClick={togglePreviewPlayback} title={previewDirty ? "Actualizar el preview y reproducir" : transportActive ? "Pausar" : "Reproducir"} className={styles.transportPrimary}>{transportActive ? <Pause size={14} /> : <Play size={14} />}</button>
            <button type="button" disabled={saving || !previewReady || Boolean(agentProposal) || Boolean(presetPreview)} onClick={() => refreshPreviewDocument(false)} title="Actualizar el preview con los cambios guardados" aria-label="Actualizar preview" className={`${styles.transportSecondary} ${previewDirty ? styles.transportSecondaryDirty : ""}`}><RefreshCw size={13} /></button>
            <input aria-label="Posición del preview" disabled={saving || !previewReady} type="range" min="0" max={duration} step="0.05" value={Math.min(seconds, duration)} onPointerDown={beginScrub} onChange={(event) => seek(Number(event.target.value))} className={styles.transportProgress} style={{ "--transport-progress": `${duration > 0 ? Math.min(100, (seconds / duration) * 100) : 0}%` } as CSSProperties} />
            <span className={styles.transportTime}>{formatSeconds(seconds)} / {formatSeconds(duration)}</span>
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
          className={`${styles.resizer} ${studioResizing ? styles.resizerActive : ""}`}
        >
          <span className={styles.resizerLine} />
          <span className={styles.resizerHandle}><GripHorizontal size={14} /></span>
          <span className={styles.resizerLine} />
        </div>

        <section className={styles.timelinePanel}>
          <div className={styles.timelineScroll}>
            <div className={`${styles.durationStrip} ${durationSourceLabel ? "" : styles.durationStripWarning}`}>
              <span>{durationSourceLabel ? `Duración total: ${formatCompositionTimecode(duration)} · ${durationSourceLabel}` : "Define el asset que controla la duración del contenido."}</span>
              <div className={styles.durationActions}>
                <button type="button" disabled={saving} onClick={() => void recalculateDuration()} className={styles.durationAction}>Recalcular duración</button>
                <button type="button" disabled={saving} onClick={() => void organizeTimeline()} className={styles.durationAction}>Organizar timeline</button>
                <button type="button" disabled={saving || refreshingProductionAssets || recoveringHistoricalAssets} onClick={() => void refreshProductionAssets()} className={styles.durationAction}>{refreshingProductionAssets ? "Actualizando…" : "Actualizar assets"}</button>
                <button type="button" disabled={saving || refreshingProductionAssets || recoveringHistoricalAssets} onClick={() => void recoverHistoricalAssets()} className={styles.durationAction}>{recoveringHistoricalAssets ? "Recuperando…" : "Recuperar históricos"}</button>
                {(brandingAvailability?.hasIntro || brandingAvailability?.hasOutro) && <button type="button" disabled={saving} onClick={() => void placeAssemblyBranding()} className={styles.durationAction}>Colocar intro/outro</button>}
              </div>
            </div>
            <AudioMixControls audioMix={payload.document.audioMix} disabled={saving} onUpdate={(settings, summary) => void savePatch([{ settings, type: "audio-mix.update" }], summary)} />
            <CompositionTimeline assetLabels={Object.fromEntries(assets.map((asset) => [asset.id, asset.label]))} document={payload.document} currentTime={seconds} saving={saving} selectedAnimationId={selectedAnimationId} selectedHfId={selectedHfId} snapEnabled={snapEnabled} trimMode={trimToolEnabled} onAnimationSelect={selectAnimation} onAnimationTimingChange={(animation, timing) => void savePatch([{ animationId: animation.id, timing, type: "animation.update-timing" }], `Ajustó ${animation.preset?.id || animation.propertyGroup} desde la timeline.`)} onClearSelection={clearSelection} onDurationChange={(clip, durationSeconds) => void savePatch([{ clipId: clip.id, durationSeconds, type: "clip.duration" }], `Ajustó la duración de ${clip.label} desde la timeline.`)} onMove={(clip, startSeconds) => void savePatch([{ clipId: clip.id, startSeconds, type: "clip.move" }], `Movió ${clip.label} a ${startSeconds} segundos.`)} onSeek={seek} onSelect={selectClip} onTrackUpdate={(track, settings, summary) => void updateTrack(track, settings, summary)} onTrim={(clip, startSeconds, durationSeconds, sourceOffsetSeconds) => void savePatch([{ clipId: clip.id, durationSeconds, sourceOffsetSeconds, startSeconds, type: "clip.trim" }], `Ajustó el inicio de ${clip.label} desde la timeline.`)} />
            {estimatedClipCount > 0 && <p className={styles.estimatedWarning}><AlertTriangle className="mt-0.5 shrink-0" size={14} /> {estimatedClipCount} segmentos tienen duración estimada. Arrastra su borde derecho para ajustarlos.</p>}
          </div>
        </section>

        {inspectorOpen && <aside className={styles.inspector}>
          <div className={styles.inspectorHeader}><div className={styles.inspectorTabs}><button type="button" onClick={() => setInspectorTab("properties")} className={`${styles.inspectorTab} ${inspectorTab === "properties" ? styles.inspectorTabActive : ""}`}>Propiedades</button><button type="button" onClick={() => setInspectorTab("assistant")} className={`${styles.inspectorTab} ${inspectorTab === "assistant" ? styles.inspectorTabActive : ""}`}>SofLIA</button></div><button type="button" onClick={clearSelection} className={styles.inspectorClose} title="Cerrar inspector" aria-label="Cerrar inspector"><X size={15} /></button></div>
          <div className={styles.inspectorBody}>{inspectorTab === "properties" ? <CompositionInspector animations={selectedClip ? payload.document.motion.animations.filter((animation) => animation.target.clipId === selectedClip.id) : []} clip={selectedClip} track={selectedClip ? payload.document.tracks.find((track) => track.id === selectedClip.trackId) || null : null} cropModeEnabled={visualCropEnabled} saving={saving} separatingAudio={separatingAudio} separatingAudioProgress={separatingAudioProgress} selectedAnimationId={selectedAnimationId} onAnimationSelect={setSelectedAnimationId} onDetachAudio={separateSelectedVideoAudio} onPatch={savePatch} onPreviewCrop={(hfId, crop) => postPreviewMessage({ type: "courseforge-composition-preview-crop", hfId, crop })} onRemove={removeClipFromTimeline} /> : <AgentConversation lastAppliedProposal={lastAppliedAgentProposal} proposal={agentProposal} proposing={proposing} saving={saving} onDismiss={() => void dismissAgentProposal()} onPropose={requestAgentProposal} onApprove={() => void approveAgentProposal()} onUndo={() => void undoLastAgentProposal()} />}</div>
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
      className="fixed right-4 top-20 z-[100] w-[calc(100vw-2rem)] max-w-md overflow-hidden rounded-xl border border-red-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-red-400/30 dark:bg-[var(--engine-surface-hover)]"
    >
      <div className="h-1 bg-red-500" />
      <div className="flex items-start gap-3 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300">
          <AlertTriangle aria-hidden="true" size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[var(--engine-primary)] dark:text-white">No se pudo completar el cambio</p>
          <p className="mt-1 break-words text-xs leading-5 text-slate-600 dark:text-gray-300">{message}</p>
          {onRetry && (
            <button
              type="button"
              disabled={retrying}
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--engine-primary)] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#0d2f4d] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[var(--engine-accent)] dark:text-[var(--engine-primary)] dark:hover:bg-[#18e0c0]"
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
          className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-[var(--engine-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--engine-accent)] dark:hover:bg-white/10 dark:hover:text-white"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
    </div>
  );
}

function PreviewToolButton({ active, children, label, onClick, title }: { active: boolean; children: ReactNode; label: string; onClick: () => void; title: string }) {
  return <button type="button" aria-pressed={active} onClick={onClick} title={title} className={`${styles.toolButton} ${active ? styles.toolButtonActive : ""}`}>{children}<span>{label}</span></button>;
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

  return <section className={styles.agentPanel}>
    <div className="flex items-center gap-2.5 border-b border-[var(--engine-accent)]/25 bg-gradient-to-r from-[var(--engine-accent)]/15 to-white px-3 py-3 dark:to-[var(--engine-surface-hover)]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--engine-accent)] text-xs font-black text-[var(--engine-primary)] shadow-sm shadow-[var(--engine-accent)]/30 dark:shadow-none">S</span>
      <div className="min-w-0"><p className="truncate text-xs font-bold text-slate-900 dark:text-white">SofLIA</p><p className="flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Asistente de edición</p></div>
    </div>

    <div className="min-h-40 flex-1 space-y-3 overflow-y-auto px-3 py-4">
      {messages.map((message) => <div key={message.id} className={`flex items-end gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
        {message.role === "assistant" && <span className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--engine-accent)] text-[10px] font-black text-[var(--engine-primary)]">S</span>}
        <div className={`max-w-[84%] rounded-2xl px-3 py-2.5 text-xs leading-5 shadow-sm ${message.role === "user" ? "rounded-br-md bg-[var(--engine-primary)] text-white" : "rounded-bl-md border border-slate-100 bg-white text-slate-700 dark:border-white/10 dark:bg-[var(--engine-surface-hover)] dark:text-gray-100"}`}>
          {message.text}
        </div>
      </div>)}
      {proposing && <div className="flex items-end gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--engine-accent)] text-[10px] font-black text-[var(--engine-primary)]">S</span><div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-100 bg-white px-3 py-2.5 text-xs text-slate-600 shadow-sm dark:border-white/10 dark:bg-[var(--engine-surface-hover)] dark:text-gray-300"><Loader2 className="animate-spin text-[var(--engine-accent)]" size={13} /> Revisando la composición...</div></div>}
      {proposal && <div className="ml-8 rounded-xl border border-[var(--engine-accent)]/40 bg-[var(--engine-accent)]/10 p-3 text-xs text-[var(--engine-primary)] shadow-sm dark:text-[#E9ECEF]"><div className="flex items-center justify-between gap-2"><p className="font-bold">Esperando tu confirmación</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${proposal.risk.level === "HIGH" ? "bg-red-100 text-red-700" : proposal.risk.level === "MEDIUM" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>Riesgo {proposal.risk.level.toLowerCase()}</span></div><p className="mt-1 text-[11px] leading-4 opacity-80">No se guardará nada hasta que confirmes.</p><ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-[10px] opacity-80">{proposal.diff.slice(0, 8).map((change, index) => <li key={`${change.entityType}-${change.entityId}-${change.path}-${index}`}>• {change.entityType.toLowerCase()} {change.entityId}: {change.path}</li>)}</ul>{proposal.validation.issues.length > 0 && <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">{proposal.validation.issues.map((issue) => issue.message).join(" ")}</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={onApprove} className="rounded-lg bg-[var(--engine-primary)] px-3 py-1.5 font-bold text-white transition hover:bg-[#0d2f4d] disabled:opacity-50">Confirmar y aplicar</button><button type="button" disabled={saving} onClick={reject} className="rounded-lg border border-[var(--engine-accent)] bg-white px-3 py-1.5 font-bold text-[var(--engine-primary)] transition hover:bg-[var(--engine-accent)]/10 disabled:opacity-50 dark:bg-transparent dark:text-[var(--engine-accent)]">Rechazar</button></div></div>}
      {!proposal && lastAppliedProposal && <div className="ml-8 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-sm dark:border-white/10 dark:bg-[var(--engine-surface-hover)] dark:text-gray-200"><p className="font-bold">Edición aplicada</p><p className="mt-1 text-[10px] opacity-75">Puedes deshacerla mientras no se guarden cambios posteriores.</p><button type="button" disabled={saving} onClick={onUndo} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 font-bold hover:bg-slate-50 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5">Deshacer edición</button></div>}
    </div>

    <div className="border-t border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-[#101720]">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-1.5 transition focus-within:border-[var(--engine-accent)] focus-within:ring-2 focus-within:ring-[var(--engine-accent)]/15 dark:border-white/15 dark:bg-slate-950">
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} maxLength={1500} rows={2} placeholder="Pide un cambio para la composición..." className="w-full resize-none bg-transparent px-1 py-0 text-xs leading-4 text-slate-900 outline-none placeholder:text-slate-400 dark:text-white" />
        <div className="mt-0.5 flex items-center justify-between gap-2"><span className="text-[9px] text-slate-400">Enter para enviar · Shift + Enter para salto</span><button type="button" aria-label="Enviar mensaje" disabled={proposing || Boolean(proposal) || instruction.trim().length < 3} onClick={() => void send()} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--engine-primary)] text-white transition hover:bg-[#0d2f4d] disabled:cursor-not-allowed disabled:opacity-40"><Send size={12} /></button></div>
      </div>
    </div>
  </section>;
}

function AssemblyActions({ assembly, busy, compact = false, durationSeconds, error, notice, history, historyOpen, onApprove, onDeleteAndRender, onHistoryToggle, onPrepare, onProfileChange, onRender, onRestore, priorCompletedVideo, providerStatus, renderStatus, selectedRenderProfileId }: {
  assembly: ActiveAssembly | null;
  busy: boolean;
  compact?: boolean;
  durationSeconds: number;
  error: string | null;
  notice: string | null;
  history: CompositionSnapshotEntry[] | null;
  historyOpen: boolean;
  onApprove: () => void;
  onDeleteAndRender: () => void;
  onHistoryToggle: () => void;
  onPrepare: () => void;
  onProfileChange: (profileId: HyperframesRenderProfileId) => void;
  onRender: () => void;
  onRestore: (snapshot: CompositionSnapshotEntry) => void;
  priorCompletedVideo: boolean;
  providerStatus: string | null;
  renderStatus: "idle" | "validating" | "sending" | "rendering" | "completed" | "failed";
  selectedRenderProfileId: HyperframesRenderProfileId;
}) {
  const selectedProfile = getHyperframesRenderProfile(selectedRenderProfileId);
  const renderBudget = estimateHyperframesRenderBudget({ durationSeconds, renderProfile: selectedProfile });
  const profileMatchesAssembly = !assembly
    || sameHyperframesRenderSettings(assembly.renderProfile, selectedProfile);
  const normalizedProviderStatus = providerStatus?.toUpperCase() || null;
  const label = renderStatus === "validating"
    ? "Validando snapshot…"
    : renderStatus === "sending" || normalizedProviderStatus === "UPLOADING"
      ? "Courseforge está subiendo el ZIP validado a HeyGen."
      : normalizedProviderStatus === "SUBMITTING"
        ? "ZIP recibido por HeyGen. Courseforge está creando el render."
        : renderStatus === "rendering"
          ? normalizedProviderStatus === "QUEUED" || normalizedProviderStatus === "RETRY_SCHEDULED"
            ? "Courseforge está preparando la importación del video. Puedes cerrar o recargar esta página."
            : `HeyGen está procesando el video${providerStatus ? ` (${providerStatus.toLowerCase()})` : ""}. Courseforge lo importará al terminar; puedes cerrar o recargar esta página.`
          : renderStatus === "completed"
            ? "Video completado e importado en Courseforge."
            : "";
  const summary = renderStatus === "completed"
    ? "El video final ya está disponible."
    : assembly
      ? assembly.status === "READY_FOR_RENDER"
        ? priorCompletedVideo
          ? "Snapshot aprobado. Puedes renderizar esta revisión; el video anterior continúa disponible para publicación."
          : "Snapshot aprobado. Puedes enviar el render."
        : "Snapshot listo. Revísalo y apruébalo para renderizar."
      : "Congela la versión guardada antes de enviar un render.";
  const activeRender = renderStatus === "sending" || renderStatus === "rendering";
  const deliveryState = renderStatus === "completed"
    ? "complete"
    : activeRender
      ? "working"
      : assembly?.status === "READY_FOR_RENDER"
        ? "ready"
        : "draft";
  const deliveryLabel = deliveryState === "complete"
    ? "Listo para publicar"
    : deliveryState === "working"
      ? "Renderizando"
      : deliveryState === "ready"
        ? "Listo para render"
        : "Preparando salida";
  return <section className={`${styles.deliveryPanel} ${compact ? styles.deliveryPanelCompact : ""}`}>
    <header className={styles.deliveryHeader}>
      <span className={styles.deliveryIcon} data-state={deliveryState}>{deliveryState === "complete" ? <CheckCircle2 size={17} /> : <Clapperboard size={17} />}</span>
      <div className={styles.deliveryTitle}>
        <span>Entrega final</span>
        <strong>{deliveryState === "complete" ? "Video listo para publicar" : "Salida de video"}</strong>
        <p>{summary}</p>
      </div>
      <span className={styles.deliveryStatus} data-state={deliveryState}><span aria-hidden="true" />{deliveryLabel}</span>
    </header>

    <div className={styles.deliveryBody}>
      <div className={styles.outputMetrics} aria-label="Datos de la salida">
        <span><small>Archivo</small><strong>{assembly ? formatAssemblyBytes(assembly.projectArchiveSizeBytes) : "—"}</strong></span>
        <span><small>Resolución</small><strong>1080p</strong></span>
        <span><small>Cuadros</small><strong>{assembly?.renderProfile?.fps || selectedProfile.fps} FPS</strong></span>
        <span><small>Calidad</small><strong>{assembly?.renderProfile ? renderQualityLabel(assembly.renderProfile.quality) : renderQualityLabel(selectedProfile.quality)}</strong></span>
        <span><small>Salida estimada</small><strong>{formatRenderBudgetBytes(renderBudget.estimatedOutputBytes)}</strong></span>
      </div>

      <label className={styles.outputProfile}>
        <span className={styles.renderProfileLabel}>Formato de salida</span>
      <EngineSelect
        aria-label="Perfil de render"
        disabled={busy || activeRender}
        value={selectedRenderProfileId}
        onValueChange={(value) => onProfileChange(value as HyperframesRenderProfileId)}
        options={HYPERFRAMES_RENDER_PROFILES.map((profile) => ({
          value: profile.id,
          label: `${profile.label} · 1080p · 25 FPS`,
          description: profile.description,
        }))}
      />
      </label>

      <div className={styles.deliveryActions}>
        <button type="button" disabled={busy || renderBudget.requiresSegmentation} onClick={() => void onPrepare()} className={styles.deliveryActionSecondary}><Clapperboard size={14} /> {busy && renderStatus === "validating" ? "Preparando…" : assembly ? "Nueva versión" : "Crear snapshot"}</button>
        <button type="button" disabled={busy || history === null} onClick={onHistoryToggle} className={styles.deliveryActionGhost}><History size={14} /> Versiones {history ? history.length : ""}</button>
        {assembly?.status === "READY_FOR_PREVIEW" && <button type="button" disabled={busy || !profileMatchesAssembly} onClick={() => void onApprove()} className={styles.deliveryActionPrimary}><CheckCircle2 size={14} /> Aprobar salida</button>}
        {assembly?.status === "READY_FOR_RENDER" && <button type="button" disabled={busy || activeRender || renderStatus === "completed" || !profileMatchesAssembly || renderBudget.requiresSegmentation} onClick={() => void onRender()} className={`${styles.deliveryActionPrimary} ${renderStatus === "completed" ? styles.deliveryActionComplete : ""}`}>{renderStatus === "completed" ? <CheckCircle2 size={14} /> : <Send size={14} />} {activeRender ? "Render en curso" : renderStatus === "completed" ? "Render completado" : renderStatus === "failed" ? "Reintentar render" : "Renderizar video"}</button>}
        {assembly?.status === "READY_FOR_RENDER" && priorCompletedVideo && <button type="button" disabled={busy || activeRender} onClick={() => void onDeleteAndRender()} className={styles.deliveryActionDanger}><Trash2 size={14} /> Reemplazar</button>}
      </div>
    </div>

    {(notice || !profileMatchesAssembly || label || priorCompletedVideo || error || renderBudget.recommendedSegmentCount > 1) && <div className={styles.deliveryMessages}>
      {notice && <p role="status" data-tone="success"><CheckCircle2 size={12} />{notice}</p>}
      {!profileMatchesAssembly && <p role="status" data-tone="warning"><AlertTriangle size={12} />El formato cambió. Crea una nueva versión antes de aprobar o renderizar.</p>}
      {label && <p role="status">{activeRender && <Loader2 className="animate-spin" size={12} />}{label}</p>}
      {priorCompletedVideo && <p role="status" data-tone="warning"><AlertTriangle size={12} />El video anterior seguirá disponible hasta que termine esta revisión.</p>}
      {renderBudget.recommendedSegmentCount > 1 && <p role={renderBudget.requiresSegmentation ? "alert" : "status"} data-tone={renderBudget.requiresSegmentation ? "danger" : "warning"}><AlertTriangle size={12} />{renderBudget.requiresSegmentation ? `La salida estimada supera 2 GiB. Divide la composición en al menos ${renderBudget.recommendedSegmentCount} segmentos antes de renderizar.` : `Para una recuperación más segura, recomendamos ${renderBudget.recommendedSegmentCount} segmentos de hasta ${Math.floor(renderBudget.recommendedSegmentSeconds / 60)} min.`}</p>}
      {error && <p role="alert" data-tone="danger"><AlertTriangle size={12} />{error}</p>}
    </div>}

    {historyOpen && <>
      <button type="button" className={styles.snapshotBackdrop} aria-label="Cerrar versiones" onClick={onHistoryToggle} />
      <aside className={styles.snapshotHistory} role="dialog" aria-modal="true" aria-labelledby="snapshot-history-title">
        <div className={styles.snapshotHistoryHeader}>
          <div><strong id="snapshot-history-title">Versiones de salida</strong><span>{history?.length || 0} snapshots disponibles</span></div>
          <button type="button" aria-label="Cerrar versiones" onClick={onHistoryToggle}><X size={15} /></button>
        </div>
        <p className={styles.snapshotEmpty}>Restaurar reemplaza el timeline editable y la salida activa con el contenido de esa versión.</p>
        {history && history.length > 0 ? <div className={styles.snapshotList}>{history.map((snapshot) => {
          const fullyRestored = snapshot.isActive && snapshot.isCurrentDocument;
          const actionLabel = fullyRestored
            ? "En uso"
            : snapshot.isActive
              ? "Restaurar timeline"
              : snapshot.isCurrentDocument
                ? "Activar salida"
                : "Restaurar";
          return <div key={snapshot.id} className={styles.snapshotRow}><span><strong>Versión {snapshot.revisionNumber}{snapshot.isActive ? " · salida activa" : ""}{snapshot.isCurrentDocument ? " · en timeline" : ""}</strong><small>Documento v{snapshot.documentVersion} · {findHyperframesRenderProfile(snapshot.renderProfile)?.label || "Perfil anterior"} · {new Date(snapshot.createdAt).toLocaleString()}</small></span><button type="button" disabled={busy || fullyRestored} onClick={() => void onRestore(snapshot)} className={styles.deliveryActionGhost}>{actionLabel}</button></div>;
        })}</div> : <p className={styles.snapshotEmpty}>Todavía no hay versiones guardadas.</p>}
      </aside>
    </>}
  </section>;
}

function formatAssemblyBytes(value: number) {
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function renderQualityLabel(quality: HyperframesRenderSettings["quality"]) {
  return quality === "high" ? "alta" : quality === "draft" ? "borrador" : "estándar";
}

function StudioLibrary({ assets, delivery, lessons, onAddAsset, onSelectAsset, onSelectLesson, selectedHfId, selectedLessonId, timelineAssetIds }: {
  assets: CompositionStudioAsset[];
  delivery: ReactNode;
  lessons: CompositionStudioLesson[];
  onAddAsset: (asset: CompositionStudioAsset) => void;
  onSelectAsset: (hfId: string) => void;
  onSelectLesson: (lessonId: string) => void;
  selectedHfId: string | null;
  selectedLessonId: string | null;
  timelineAssetIds: Set<string>;
}) {
  const [activeView, setActiveView] = useState<"assets" | "delivery" | "lessons">("lessons");

  return <aside className={styles.library}>
    <div className={styles.panelTabs} role="tablist" aria-label="Biblioteca del ensamble">
      <button type="button" role="tab" aria-selected={activeView === "lessons"} onClick={() => setActiveView("lessons")} className={`${styles.panelTab} ${activeView === "lessons" ? styles.panelTabActive : ""}`}>
        <Clapperboard size={14} aria-hidden="true" /> Videos <span className={styles.tabCount}>{lessons.length}</span>
      </button>
      <button type="button" role="tab" aria-selected={activeView === "assets"} onClick={() => setActiveView("assets")} className={`${styles.panelTab} ${activeView === "assets" ? styles.panelTabActive : ""}`}>
        <ImageIcon size={14} aria-hidden="true" /> Medios <span className={styles.tabCount}>{assets.length}</span>
      </button>
      <button type="button" role="tab" aria-selected={activeView === "delivery"} onClick={() => setActiveView("delivery")} className={`${styles.panelTab} ${activeView === "delivery" ? styles.panelTabActive : ""}`}>
        <Send size={14} aria-hidden="true" /> Entrega
      </button>
    </div>

    <div className={`${styles.libraryBody} ${activeView === "delivery" ? styles.libraryBodyDelivery : ""}`}>
      {activeView === "lessons" ? <div className={styles.lessonList} role="tabpanel">
        {lessons.map((lesson, index) => <button key={lesson.id} type="button" onClick={() => onSelectLesson(lesson.id)} className={`${styles.lessonItem} ${selectedLessonId === lesson.id ? styles.lessonItemActive : ""}`}>
          <span className={`${styles.lessonIndex} ${lesson.completed ? styles.lessonIndexComplete : ""}`}>{lesson.completed ? <CheckCircle2 size={12} aria-label="Completado" /> : index + 1}</span>
          <span className="min-w-0"><span className={styles.itemTitle}>{lesson.title}</span><span className={styles.itemMeta}>{lesson.subtitle}</span></span>
          <ChevronRight className={styles.lessonChevron} size={13} aria-hidden="true" />
        </button>)}
      </div> : activeView === "assets" ? <div className={styles.assetList} role="tabpanel">
        {assets.map((asset) => {
          const hfId = `asset-${asset.id}`;
          const inTimeline = timelineAssetIds.has(asset.id);
          return <div key={asset.id} className={`${styles.assetItem} ${selectedHfId === hfId ? styles.assetItemActive : ""} ${asset.valid ? "" : "border-red-400/40 bg-red-500/10"}`}>
            <button type="button" disabled={!asset.isEditable || !inTimeline} onClick={() => onSelectAsset(hfId)} className={styles.assetMain}>
              <AssetThumbnail asset={asset} />
              <span className="min-w-0 flex-1"><span className={styles.itemTitle}>{asset.label}</span><span className={styles.assetMetaRow}><span className={styles.itemMeta}>{asset.sourceLabel}</span><span className={styles.itemMeta}>{asset.sizeLabel}</span></span></span>
            </button>
            <button type="button" disabled={!asset.isEditable || !asset.valid || inTimeline} onClick={() => onAddAsset(asset)} title={inTimeline ? "Este asset ya está en la línea de tiempo" : "Añadir a la línea de tiempo"} className={`${styles.assetAdd} ${inTimeline ? styles.assetAddComplete : ""}`}>{inTimeline ? <><CheckCircle2 size={12} /> En timeline</> : <><Plus size={12} /> Añadir a timeline</>}</button>
          </div>;
        })}
      </div> : <div className={styles.deliveryMenu} role="tabpanel">{delivery}</div>}
    </div>
  </aside>;
}

function AssetThumbnail({ asset }: { asset: CompositionStudioAsset }) {
  const [failed, setFailed] = useState(false);
  const commonClass = "relative flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5";
  if (asset.mimeType.startsWith("audio/")) return <span className={commonClass + " text-violet-600 dark:text-violet-300"}><Music2 size={18} /></span>;
  if (asset.mimeType.startsWith("image/") && asset.previewUrl && !failed) return <span className={commonClass}><img src={asset.previewUrl} alt="" onError={() => setFailed(true)} className="h-full w-full bg-slate-950 object-contain" /></span>;
  if (asset.mimeType.startsWith("video/") && asset.previewUrl && !failed) return <span className={commonClass}><video muted preload="metadata" onError={() => setFailed(true)} className="h-full w-full bg-slate-950 object-contain"><source src={asset.previewUrl} type={asset.mimeType} /></video><Play className="pointer-events-none absolute text-white drop-shadow" size={15} /></span>;
  const Icon = asset.mimeType.startsWith("image/") ? ImageIcon : asset.mimeType.startsWith("video/") ? Video : FileQuestion;
  return <span className={commonClass + " text-slate-400 dark:text-gray-500"}><Icon size={18} /></span>;
}

function CompositionInspector({ animations, clip, cropModeEnabled, onAnimationSelect, onDetachAudio, onPatch, onPreviewCrop, onRemove, saving, selectedAnimationId, separatingAudio, separatingAudioProgress, track }: { animations: CompositionAnimation[]; clip: CompositionClip | null; cropModeEnabled: boolean; onAnimationSelect: (animationId: string | null) => void; onDetachAudio: (clip: CompositionClip) => Promise<void>; onPatch: (operations: CompositionEditorPatchOperation[], summary: string) => Promise<boolean>; onPreviewCrop: (hfId: string, crop: CompositionVisualCrop) => void; onRemove: (clip: CompositionClip) => Promise<void>; saving: boolean; selectedAnimationId: string | null; separatingAudio: boolean; separatingAudioProgress: number; track: CompositionTrack | null }) {
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
    if (!clip) {
      setVolume(1);
      return;
    }
    setVolume(clip.volume ?? resolveCompositionClipDefaultVolume(clip, track ?? undefined));
  }, [clip?.id, clip?.kind, clip?.volume, track?.id, track?.semanticRole, track?.volume]);
  if (!clip) return <p className={styles.emptyInspector}>Selecciona un clip en la timeline o directamente en el monitor para editar su posición, visibilidad o duración.</p>;
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
        { clipId: clip.id, type: "clip.volume", volume },
      ], `Ajustó la duración y el volumen de ${clip.label}.`);
    };
    return <div className="space-y-3"><div className="flex items-start gap-2"><span className="rounded-md bg-violet-100 p-1.5 text-violet-700 dark:bg-violet-400/10 dark:text-violet-200"><Music2 size={16} /></span><div><p className="text-sm font-semibold text-slate-900 dark:text-white">{clip.label}</p><p className="mt-0.5 text-[11px] text-slate-500 dark:text-gray-400">Música · ajustes de audio</p></div></div><TimecodeField label="Duración (mm:ss)" value={durationSeconds} onChange={setDurationSeconds} /><VolumeSlider accentClassName="accent-violet-500" ariaLabel="Volumen de la música" disabled={saving} label="Volumen" onChange={setVolume} value={volume} /><p className="text-[10px] leading-4 text-slate-500 dark:text-gray-400">Estos ajustes modifican la duración real del clip y el volumen base de la música. El ducking se configura por separado.</p>{validationError && <p role="alert" className="rounded-md bg-red-50 px-2 py-1.5 text-[10px] text-red-700 dark:bg-red-500/10 dark:text-red-200">{validationError}</p>}<button type="button" disabled={saving} onClick={() => void saveMusicChanges()} className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Save size={13} /> Guardar audio</button></div>;
  }
  const hasConfigurableClipAudio = compositionClipHasConfigurableAudio(clip, track ?? undefined);
  const canDetachAudio = clip.kind === "VIDEO" && hasConfigurableClipAudio;
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
    if (start === null || duration === null || duration < 0.05 || Object.values(layout).some((value) => value === null) || (hasConfigurableClipAudio && (volume < 0 || volume > 1))) {
      setValidationError("Revisa tiempo, posición y transformación. Todos los valores deben ser válidos y la duración debe ser mayor a cero.");
      return;
    }
    setValidationError(null);
    const operations: CompositionEditorPatchOperation[] = [
      { clipId: clip.id, durationSeconds: duration, type: "clip.duration" },
      { clipId: clip.id, startSeconds: start, type: "clip.move" },
      { clipId: clip.id, layout: layout as { height: number; opacity: number; rotation: number; width: number; x: number; y: number }, type: "clip.layout" },
    ];
    if (hasConfigurableClipAudio) operations.push({ clipId: clip.id, type: "clip.volume", volume });
    await onPatch(operations, `Guardó tiempo, posición, transformación${hasConfigurableClipAudio ? " y volumen" : ""} de ${clip.label}.`);
  };
  const resetAsset = async () => {
    const confirmed = window.confirm(`¿Reiniciar ${clip.label}? Se restaurarán su tamaño, tiempo y encuadre originales; también se quitarán sus animaciones y fragmentos derivados.`);
    if (!confirmed) return;
    await onPatch([{ clipId: clip.id, type: "clip.reset-asset" }], `Reinició ${clip.label} a su estado base.`);
  };
  const supportsVisualCrop = clip.kind === "VIDEO" || clip.kind === "IMAGE" || clip.kind === "DECK_SLIDE";
  return <div className="space-y-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-slate-900 dark:text-white">{clip.label}</p><p className="mt-0.5 text-[11px] text-slate-500 dark:text-gray-400">{clip.kind} · pista {clip.trackId}</p></div><div className="flex flex-wrap gap-1"><button type="button" disabled={saving || separatingAudio} onClick={() => void onPatch([{ clipId: clip.id, hidden: !clip.hidden, type: "clip.visibility" }], `${clip.hidden ? "Mostró" : "Ocultó"} ${clip.label}.`)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50 dark:border-white/15 dark:text-gray-200">{clip.hidden ? <Eye size={13} /> : <EyeOff size={13} />}{clip.hidden ? "Mostrar" : "Ocultar"}</button><button type="button" disabled={saving || separatingAudio} onClick={() => void onRemove(clip)} className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-400/40 dark:text-red-200 dark:hover:bg-red-400/10"><Trash2 size={13} /> Quitar</button></div></div><p className="rounded-md bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500 dark:bg-white/5 dark:text-gray-400">Quitar solo retira este clip de la línea de tiempo; los assets y el deck original permanecen disponibles.</p>{clip.kind !== "AUDIO" && <LayerDepthControls clip={clip} disabled={saving || separatingAudio} onPatch={onPatch} />}<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><TimecodeField label="Inicio (mm:ss)" value={startSeconds} onChange={setStartSeconds} /><TimecodeField label="Duración (mm:ss)" value={durationSeconds} onChange={setDurationSeconds} /><InspectorField label="Posición X" value={x} onChange={setX} /><InspectorField label="Posición Y" value={y} onChange={setY} /></div><p className="text-[10px] text-slate-500 dark:text-gray-400">Formato: 01:05 = 1 minuto y 5 segundos; 00:01.050 incluye milisegundos.</p>{hasConfigurableClipAudio && <section className="border-t border-slate-200 pt-3 dark:border-white/10"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Audio del clip</p><VolumeSlider accentClassName="accent-cyan-500" ariaLabel={`Volumen de ${clip.label}`} disabled={saving || separatingAudio} label="Volumen individual" onChange={setVolume} value={volume} /><p className="mt-2 text-[10px] leading-4 text-slate-500 dark:text-gray-400">Este ajuste pertenece sólo a este segmento. El volumen de la pista continúa funcionando como control maestro.</p>{canDetachAudio && <button type="button" disabled={saving || separatingAudio} onClick={() => void onDetachAudio(clip)} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-cyan-300 bg-cyan-50 px-2.5 py-1.5 text-xs font-bold text-cyan-800 disabled:opacity-50 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200">{separatingAudio ? <Loader2 className="animate-spin" size={13} /> : <Scissors size={13} />}{separatingAudio ? `Analizando y separando… ${Math.round(separatingAudioProgress * 100)}%` : "Separar audio del video"}</button>}<p className="mt-2 text-[10px] leading-4 text-slate-500 dark:text-gray-400">Al separar, el audio pasa a Voz / narración y el video original queda silenciado. Ambos se editan de forma independiente.</p></section>}<div className="border-t border-slate-200 pt-3 dark:border-white/10"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Transformación</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><InspectorField label="Ancho" value={width} onChange={setWidth} min={1} /><InspectorField label="Alto" value={height} onChange={setHeight} min={1} /><InspectorField label="Rotación" value={rotation} onChange={setRotation} min={-360} /><InspectorField label="Opacidad" value={opacity} onChange={setOpacity} min={0} /></div><p className="mt-2 text-[10px] text-slate-500">Arrastra en el preview para mover; usa el tirador para redimensionar. Mantén Alt para liberar proporciones.</p></div>{(clip.kind === "VIDEO" || clip.kind === "IMAGE") && <MediaFitControls clip={clip} disabled={saving || separatingAudio} onPatch={onPatch} track={track} />}{supportsVisualCrop && <VisualCropControls clip={clip} cropModeEnabled={cropModeEnabled} disabled={saving || separatingAudio} onPatch={onPatch} onPreviewCrop={onPreviewCrop} />}{COMPOSITION_MOTION_ENABLED && clip.kind !== "AUDIO" && <CompositionMotionControls animations={animations} clip={clip} disabled={saving || separatingAudio} selectedAnimationId={selectedAnimationId} onSelectAnimation={onAnimationSelect} onPatch={onPatch} />}{validationError && <p role="alert" className="rounded-md bg-red-50 px-2 py-1.5 text-[10px] text-red-700 dark:bg-red-500/10 dark:text-red-200">{validationError}</p>}<div className="flex flex-wrap gap-2"><button type="button" disabled={saving || separatingAudio} onClick={() => void saveAllChanges()} className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50 dark:bg-cyan-400 dark:text-slate-950"><Save size={13} /> Guardar cambios</button><button type="button" disabled={saving || separatingAudio || clip.source.type !== "PRODUCTION_ASSET"} onClick={() => void resetAsset()} className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2.5 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-400/40 dark:text-amber-200 dark:hover:bg-amber-400/10" title="Restaurar tiempo, tamaño, encuadre y animaciones del asset"><RotateCcw size={13} /> Reiniciar asset</button>{saving && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400"><Loader2 className="animate-spin" size={13} /> Actualizando preview…</span>}</div></div>;
}

function MediaFitControls({ clip, disabled, onPatch, track }: { clip: CompositionClip; disabled: boolean; onPatch: (operations: CompositionEditorPatchOperation[], summary: string) => Promise<boolean>; track: CompositionTrack | null }) {
  const currentFit = clip.mediaFit || ((track?.semanticRole === "AVATAR" || track?.id === "avatar") ? "CONTAIN" : "COVER");
  const changeFit = (mediaFit: "CONTAIN" | "COVER") => {
    const operations: CompositionEditorPatchOperation[] = [{ clipId: clip.id, mediaFit, type: "clip.media-fit" }];
    if (mediaFit === "CONTAIN" && clip.crop) operations.push({ clipId: clip.id, crop: null, type: "clip.crop" });
    const summary = mediaFit === "CONTAIN" ? `Mostró completo ${clip.label}.` : `Ajustó ${clip.label} para llenar su caja.`;
    return onPatch(operations, summary);
  };
  return <section className="border-t border-slate-200 pt-3 dark:border-white/10"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Ajuste del medio</p><div className="grid grid-cols-2 gap-2"><button type="button" disabled={disabled || currentFit === "CONTAIN"} onClick={() => void changeFit("CONTAIN")} className="rounded-md border border-slate-300 px-2 py-1.5 text-[10px] font-bold text-slate-700 disabled:bg-cyan-50 disabled:text-cyan-700 dark:border-white/15 dark:text-gray-200 dark:disabled:bg-cyan-400/10 dark:disabled:text-cyan-200">Mostrar completo</button><button type="button" disabled={disabled || currentFit === "COVER"} onClick={() => void changeFit("COVER")} className="rounded-md border border-slate-300 px-2 py-1.5 text-[10px] font-bold text-slate-700 disabled:bg-cyan-50 disabled:text-cyan-700 dark:border-white/15 dark:text-gray-200 dark:disabled:bg-cyan-400/10 dark:disabled:text-cyan-200">Llenar caja</button></div><p className="mt-2 text-[10px] leading-4 text-slate-500 dark:text-gray-400">“Mostrar completo” elimina el recorte explícito y conserva toda la fuente. “Llenar caja” puede ocultar bordes si la proporción es distinta.</p></section>;
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
