"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AlertTriangle, GripHorizontal, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { CompositionClip, CompositionEditorDocument, CompositionTrack } from "@/domains/production/composition-editor/composition-document.types";
import { formatCompositionTimecode } from "@/domains/production/composition-editor/composition-timecode";
import { resolveCompositionAnimationWindow } from "@/domains/production/composition-editor/composition-motion-scheduling.service";
import { CompositionNarrativePanel } from "./CompositionNarrativePanel";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import { applyCompositionEditorPatches, ensureCanvasDurationForClipPatches } from "@/domains/production/composition-editor/editor-patch.service";
import { getCompositionTrackDefinition, resolveCompositionTrackDefinition } from "@/domains/production/composition-editor/composition-track-registry";
import {
  resolveDefaultCompositionClipLayout,
  resolveDefaultCompositionMediaFit,
} from "@/domains/production/composition-editor/composition-default-layout.service";
import { RenderDiagnosticsPanel } from "./RenderDiagnosticsPanel";
import { CompositionPresetPanel } from "./CompositionPresetPanel";
import { buildCompositionAutoOrganizePatch } from "@/domains/production/composition-editor/composition-auto-organize.service";
import { buildCompositionDurationRecalculationPatch } from "@/domains/production/composition-editor/composition-duration-recalculation.service";
import { resolveCompositionAssetInsertionTiming } from "@/domains/production/composition-editor/composition-asset-placement.service";
import { reconcileProductionIntroDocument } from "@/domains/production/composition-editor/composition-production-intro.service";
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
import { readCompositionApiResponse } from "@/domains/production/composition-editor/composition-editor-api.client";
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
import {
  classifyCompositionPreviewOperations,
  requiresCompositionPreviewReload,
} from "@/domains/production/composition-editor/composition-preview-operation-policy";
import { buildCompositionPreviewVisualPatch } from "@/domains/production/composition-editor/composition-preview-visual-patch";
import { createClient as createBrowserSupabaseClient } from "@/utils/supabase/client";
import {
  DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID,
  findHyperframesRenderProfile,
  getHyperframesRenderProfile,
  sameHyperframesRenderSettings,
  toHyperframesRenderSettings,
  type HyperframesRenderProfileId,
} from "@/domains/production/hyperframes/hyperframes-render-profiles";
import styles from "./CompositionStudio.module.css";
import {
  CompositionStudioLibrary,
  type SoundEffectCatalogItem,
} from "./CompositionStudioLibrary";
import { CompositionInspector } from "./CompositionInspector";
import {
  CompositionDeliveryPanel,
  type ActiveCompositionAssembly,
  type CompositionSnapshotEntry,
} from "./CompositionDeliveryPanel";
import { CompositionAgentConversation } from "./CompositionAgentConversation";
import { CompositionPreviewViewport } from "./CompositionPreviewViewport";
import {
  CompositionPreviewToolbar,
  type CompositionDocumentHistoryEntry,
} from "./CompositionPreviewToolbar";
import {
  CompositionTimelineWorkspace,
  type AssemblyBrandingAvailability,
} from "./CompositionTimelineWorkspace";
import { useCompositionStudioControls } from "./useCompositionStudioControls";
import { useCompositionPresetController } from "./useCompositionPresetController";
import { useCompositionAgentProposalController } from "./useCompositionAgentProposalController";
import type { CompositionDocumentPayload, CompositionStudioAsset, CompositionStudioLesson } from "./composition-studio.types";

export type { CompositionStudioAsset, CompositionStudioLesson } from "./composition-studio.types";

type DocumentPayload = CompositionDocumentPayload;
type SavePatchOptions = { preservePreviewRuntime?: boolean };
type PreviewReloadReason = "EDIT_SAVED" | "DIRTY_PLAYBACK" | "MANUAL" | "MEDIA_RECOVERY" | "SAVE_RECOVERY";
type PendingEditTelemetry = {
  operationCount: number;
  operationNames: string[];
  source: "AGENT" | "USER";
  startedAt: number;
};
type RenderAttemptSummary = {
  cancelledAt?: string | null;
  providerError?: string | null;
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
const DURATION_SOURCE_LABELS: Record<NonNullable<CompositionEditorDocument["canvas"]["durationSource"]>, string> = {
  avatar_clips: "clips de avatar",
  avatar_full: "avatar completo",
  b_roll: "B-roll",
  slides: "diapositivas",
  voice: "voz",
};

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
      expectedAvatarSceneCount?: number;
      expectedVoiceOnlySceneCount?: number;
      incompleteExpectedMediaCount?: number;
      pendingAvatarCount?: number;
      pendingExpectedMediaCount?: number;
      recoveredAvatarCount?: number;
      recoveredVoiceCount?: number;
      readySceneCount?: number;
      unconfiguredSceneCount?: number;
      unresolvedSceneCount?: number;
    };
  };
  error?: string;
  hint?: string;
  success?: boolean;
};

/** The native assembly studio: library, full preview, timeline and contextual inspector. */
export function NativeCompositionPreview({ assets, componentId, compositionId, draftId, lessons, onAssetsChanged, onContinueToPublication, onRefreshProductionAssets, onSelectLesson, onVideoCompleted, selectedLessonId }: NativeCompositionPreviewProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const {
    changePreviewZoom,
    directEditingEnabled,
    finishStudioResize,
    gridVisible,
    previewFullscreen,
    previewShellRef,
    previewZoom,
    resizeStudioPanes,
    setDirectEditingEnabled,
    setGridVisible,
    setPreviewFullscreen,
    setSnapEnabled,
    setStudioResizing,
    setStudioTopPanePercent,
    setToolMenuOpen,
    setTrimToolEnabled,
    setVisualCropEnabled,
    snapEnabled,
    studioGridRef,
    studioResizing,
    studioTopPanePercent,
    togglePreviewFullscreen,
    toolMenuOpen,
    toolMenuRef,
    trimToolEnabled,
    visualCropEnabled,
  } = useCompositionStudioControls();
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
  const previewReloadRequestRef = useRef(0);
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
  const [selectedHfId, setSelectedHfId] = useState<string | null>(null);
  const getCurrentPayload = useCallback(() => payloadRef.current, []);
  const isSaveInFlight = useCallback(() => saveInFlightRef.current, []);
  const applyPresetDocument = useCallback((nextPayload: CompositionDocumentPayload) => {
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
    previewDocumentHashRef.current = nextPayload.documentHash;
    previewRuntimeBaseHashRef.current = nextPayload.documentHash;
    setPreviewDocumentHash(nextPayload.documentHash);
    setPreviewDirty(false);
  }, []);
  const beginAgentProposalMutation = useCallback((optimisticPayload: CompositionDocumentPayload) => {
    previewReadyRef.current = false;
    pendingPreviewRestoreSecondsRef.current = playheadSecondsRef.current;
    pendingSeekSecondsRef.current = null;
    frameRef.current?.contentWindow?.postMessage(
      createCompositionPreviewParentCommand({ type: "courseforge-composition-pause" }),
      window.location.origin,
    );
    setPlaying(false);
    setPreviewReady(false);
    setPreviewMediaState("PREPARING");
    setPendingPreviewMediaIds([]);
    setPlaybackError(null);
    saveInFlightRef.current = true;
    setSaving(true);
    payloadRef.current = optimisticPayload;
    setPayload(optimisticPayload);
  }, []);
  const failAgentProposalMutation = useCallback((previousPayload: CompositionDocumentPayload) => {
    pendingPreviewRestoreSecondsRef.current = null;
    payloadRef.current = previousPayload;
    setPayload(previousPayload);
    setPreviewReady(true);
    setPreviewMediaState("READY");
    setPendingPreviewMediaIds([]);
  }, []);
  const finishAgentProposalMutation = useCallback(() => {
    saveInFlightRef.current = false;
    setSaving(false);
  }, []);
  const {
    agentProposal,
    approveAgentProposal,
    clearLastAppliedAgentProposal,
    dismissAgentProposal,
    lastAppliedAgentProposal,
    proposing,
    requestAgentProposal,
    resetAgentProposalState,
    undoLastAgentProposal,
  } = useCompositionAgentProposalController({
    draftId,
    getCurrentPayload,
    isSaveInFlight,
    onError: setSaveError,
    onMutationFailed: failAgentProposalMutation,
    onMutationFinished: finishAgentProposalMutation,
    onMutationStarted: beginAgentProposalMutation,
    onMutationSucceeded: applyPresetDocument,
    selectedClipId: payload?.document.clips.find((clip) => clip.hfId === selectedHfId)?.id || null,
  });
  const {
    applyCompositionPresetPreview,
    createCompositionPreset,
    dismissCompositionPresetPreview,
    lastAppliedPreset,
    loadCompositionPresets,
    loadRecoverablePresetApplication,
    presetBusy,
    presetCatalogLoading,
    presetEntries,
    presetPanelOpen,
    presetPreview,
    previewCompositionPreset,
    setLastAppliedPreset,
    setPresetPanelOpen,
    undoLastCompositionPreset,
  } = useCompositionPresetController({
    agentProposalActive: Boolean(agentProposal),
    draftId,
    getCurrentPayload,
    isSaveInFlight,
    onDocumentApplied: applyPresetDocument,
    onError: setSaveError,
    onSavingChange: setSaving,
    saving,
  });
  const [assembly, setAssembly] = useState<ActiveCompositionAssembly | null>(null);
  const [snapshotHistory, setSnapshotHistory] = useState<CompositionSnapshotEntry[] | null>(null);
  const [snapshotHistoryOpen, setSnapshotHistoryOpen] = useState(false);
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [assemblyNotice, setAssemblyNotice] = useState<string | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [renderStatus, setRenderStatus] = useState<"idle" | "validating" | "sending" | "rendering" | "completed" | "failed" | "cancelled">("idle");
  const [renderRequestId, setRenderRequestId] = useState<string | null>(null);
  const [diagnosticRequestId, setDiagnosticRequestId] = useState<string | null>(null);
  const [renderStartedAt, setRenderStartedAt] = useState<string | null>(null);
  const [renderImportStatus, setRenderImportStatus] = useState("NONE");
  const cancelledRenderRef = useRef<string | null>(null);
  const [renderProviderStatus, setRenderProviderStatus] = useState<string | null>(null);
  const [renderRecovery, setRenderRecovery] = useState<CompositionRenderRecoveryState | null>(null);
  const [selectedRenderProfileId, setSelectedRenderProfileId] = useState<HyperframesRenderProfileId>(
    DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID,
  );
  const [seconds, setSeconds] = useState(0);

  if (!saveQueueRef.current) {
    saveQueueRef.current = new CompositionSaveQueue(
      (saveCommand) => saveCommand(),
      (snapshot) => setSaving(snapshot.status === "RUNNING" || snapshot.pendingCount > 0),
      () => setSaveError("Hay demasiados cambios pendientes. Espera a que termine el guardado actual."),
    );
  }
  if (!runtimePatchCoordinatorRef.current) {
    runtimePatchCoordinatorRef.current = new CompositionPreviewRuntimePatchCoordinator();
  }

  const [selectedAnimationId, setSelectedAnimationId] = useState<string | null>(null);
  const [applyingPreassembly, setApplyingPreassembly] = useState(false);
  const animationPlaybackEndRef = useRef<number | null>(null);
  const previewReadyRef = useRef(false);
  const [manualInspectorOpen, setManualInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"assistant" | "properties">("properties");
  const [removalRangeStart, setRemovalRangeStart] = useState<{ clipId: string; seconds: number } | null>(null);
  const [history, setHistory] = useState<CompositionDocumentHistoryEntry[] | null>(null);
  const [brandingAvailability, setBrandingAvailability] = useState<AssemblyBrandingAvailability | null>(null);

  useEffect(() => {
    onVideoCompletedRef.current = onVideoCompleted;
  }, [onVideoCompleted]);

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
      resetAgentProposalState();
      setLastAppliedPreset(null);
      void loadRecoverablePresetApplication();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar la composición.");
    } finally {
      setLoading(false);
    }
  }, [draftId, loadRecoverablePresetApplication, resetAgentProposalState]);

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
    setDiagnosticRequestId(null);
    setRenderStartedAt(null);
    setRenderImportStatus("NONE");
    cancelledRenderRef.current = null;
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
        if (animationPlaybackEndRef.current !== null && message.seconds >= animationPlaybackEndRef.current) {
          animationPlaybackEndRef.current = null;
          postPreviewMessage({ type: "courseforge-composition-pause" });
        }
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
        previewReadyRef.current = true;
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
    previewReadyRef.current = false;
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
  const previewStatusLabel = presetPreview
    ? "Preview de preset"
    : agentProposal
      ? "Propuesta sin guardar"
      : saving || (!previewReady && previewMediaState === "PREPARING")
        ? "Actualizando preview…"
        : previewDirty
          ? "Cambios pendientes"
          : null;

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
    const document = payloadRef.current?.document;
    const animation = document?.motion.animations.find((item) => item.id === animationId);
    const clip = document?.clips.find((item) => item.hfId === clipHfId);
    if (animation && clip) seek(clip.startSeconds + resolveCompositionAnimationWindow(animation, clip.durationSeconds).start);
  };
  const playSelectedAnimation = () => {
    const document = payloadRef.current?.document;
    const animation = document?.motion.animations.find((item) => item.id === selectedAnimationId);
    const clip = document?.clips.find((item) => item.id === animation?.target.clipId);
    if (!animation || !clip) return;
    const window = resolveCompositionAnimationWindow(animation, clip.durationSeconds);
    seek(clip.startSeconds + window.start);
    animationPlaybackEndRef.current = clip.startSeconds + window.end;
    if (previewDirty) refreshPreviewDocument(true, "DIRTY_PLAYBACK");
    else postPreviewMessage({ type: "courseforge-composition-play" });
  };
  const clearSelection = () => {
    setSelectedHfId(null);
    setSelectedAnimationId(null);
    setManualInspectorOpen(false);
    postPreviewMessage({ type: "courseforge-composition-select", hfId: null });
  };
  const pausePreviewForMutation = () => {
    previewReadyRef.current = false;
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
    previewReloadRequestRef.current += 1;
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
  const scheduleSavedPreviewReload = (autoPlay: boolean) => {
    const requestId = previewReloadRequestRef.current + 1;
    previewReloadRequestRef.current = requestId;
    void saveQueueRef.current!.whenIdle().then(() => {
      // Several edits can be committed before the queue settles. Only the
      // newest request is allowed to rebuild the iframe, avoiding stale or
      // duplicate previews between consecutive asset edits.
      if (previewReloadRequestRef.current !== requestId) return;
      refreshPreviewDocument(autoPlay, "SAVE_RECOVERY");
    });
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
    const requiresCompiledPreviewReload = requiresCompositionPreviewReload(updateStrategy);
    if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED) {
      previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, { type: "EDIT_ACCEPTED" });
      previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, { type: "SAVE_STARTED" });
    }
    const isMotionEdit = effectiveOperations.length > 0 && effectiveOperations.every((operation) => operation.type.startsWith("animation."));
    const visualPatch = updateStrategy === "LIVE_DOM" || isMotionEdit
      ? buildCompositionPreviewVisualPatch({ document: optimisticDocument, operations: effectiveOperations })
      : null;
    const runtimeBaseHash = previewRuntimeBaseHashRef.current;
    const canApplyIncrementally = (COMPOSITION_PREVIEW_SYNC_V2_ENABLED || isMotionEdit)
      && agentProposal === null
      && presetPreview === null
      && previewReadyRef.current
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
        refreshPreviewDocument(false, "SAVE_RECOVERY");
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
          // The iframe URL describes its compiled base. Updating it here would
          // reload the iframe after every successfully acknowledged live edit.
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
        // Timeline and structural operations cannot be applied to the iframe
        // with a visual DOM patch. Also recover any visual edit made while the
        // iframe was unavailable. In both cases the saved document must become
        // the source of a fresh preview without requiring user interaction.
        if (requiresCompiledPreviewReload || !canApplyIncrementally) {
          scheduleSavedPreviewReload(playing || previewMediaState === "BUFFERING");
        }
      }
      if (source === "USER") clearLastAppliedAgentProposal();
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
      setSaving(saveQueueRef.current!.snapshot().pendingCount > 0);
    }
  }

  async function applyNarrativePreassembly() {
    return saveQueueRef.current!.enqueue(async () => {
      const currentPayload = payloadRef.current;
      if (!currentPayload) return false;
      setApplyingPreassembly(true);
      setSaveError(null);
      try {
        const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/document`, {
          body: JSON.stringify({ action: "preassemble" }),
          headers: {
            "Content-Type": "application/json",
            "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash),
            [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash,
          },
          method: "POST",
        });
        const body = await readCompositionApiResponse<{ data?: DocumentPayload; error?: string }>(response, "No se pudo aplicar el preensamble.");
        if (!response.ok || !body.data) throw new Error(body.error || "No se pudo aplicar el preensamble.");
        const nextPayload = body.data;
        nextPayload.documentHash = resolveCompositionDocumentVersion(nextPayload.documentHash);
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        refreshPreviewDocument(false, "EDIT_SAVED");
        toast.success("Preensamble aplicado con las duraciones reales de las escenas.");
        return true;
      } catch (caught) {
        setSaveError(caught instanceof Error ? caught.message : "No se pudo aplicar el preensamble.");
        return false;
      } finally {
        setApplyingPreassembly(false);
      }
    });
  }

  function openSceneBuilder() {
    const current = new URL(window.location.href);
    const adminIndex = current.pathname.indexOf("/admin");
    const tenantPrefix = adminIndex > 0 ? current.pathname.slice(0, adminIndex) : "";
    const query = new URLSearchParams({
      componentId,
      returnTo: `${current.pathname}${current.search}${current.hash}`,
      source: "course",
    });
    window.location.assign(`${tenantPrefix}/admin/heygen?${query.toString()}`);
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
    const insertionTiming = resolveCompositionAssetInsertionTiming({
      canvasDurationSeconds: currentPayload.document.canvas.durationSeconds,
      extendCanvasForSequentialAsset: trackDefinition.semanticRole === "VOICE",
      isSequential,
      occupiedUntilSeconds: occupiedUntil,
      playheadSeconds: playheadSecondsRef.current,
      preferredDurationSeconds: preferredDuration,
    });
    const clipKind: CompositionClip["kind"] = isAudio ? "AUDIO" : asset.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE";
    const sourceDimensions = asset.sourceWidth && asset.sourceHeight
      ? { height: asset.sourceHeight, width: asset.sourceWidth }
      : null;
    const clip: CompositionClip = {
      durationSeconds: insertionTiming.durationSeconds,
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
      startSeconds: insertionTiming.startSeconds,
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
    }], trackDefinition.semanticRole === "VOICE"
      ? `Agregó ${asset.label} al final y extendió la duración del video.`
      : insertionTiming.overlapsExistingClips
        ? `Agregó ${asset.label} a la línea de tiempo en una subfila superpuesta.`
        : `Agregó ${asset.label} a la línea de tiempo.`);
    if (added) selectClip(clip.hfId);
  }

  async function addSoundEffectToTimeline(soundEffect: SoundEffectCatalogItem) {
    const currentPayload = payloadRef.current;
    if (!currentPayload || soundEffect.durationMilliseconds <= 0) return;
    const linked = await fetch("/api/production/sound-effects", {
      body: JSON.stringify({ draftId, soundEffectAssetId: soundEffect.id }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const response = await readCompositionApiResponse<{ data?: { durationMilliseconds?: number }; error?: string }>(
      linked,
      "No se pudo preparar el efecto de sonido.",
    );
    if (!linked.ok) {
      setSaveError(response.error || "No se pudo vincular el efecto de sonido al borrador.");
      return;
    }
    const sourceDurationSeconds = (response.data?.durationMilliseconds || soundEffect.durationMilliseconds) / 1000;
    const track = getCompositionTrackDefinition("SFX");
    const occupiedIds = new Set(currentPayload.document.clips.map((clip) => clip.id));
    let suffix = 1;
    let clipId = `sfx-${soundEffect.id}`;
    while (occupiedIds.has(clipId)) clipId = `sfx-${soundEffect.id}-${suffix++}`;
    const startSeconds = Math.min(
      Math.max(0, playheadSecondsRef.current),
      Math.max(0, currentPayload.document.canvas.durationSeconds - 1 / currentPayload.document.canvas.fps),
    );
    const durationSeconds = Math.min(sourceDurationSeconds, currentPayload.document.canvas.durationSeconds - startSeconds);
    if (durationSeconds <= 0) {
      setSaveError("Mueve el cursor dentro de la duración del video antes de añadir un efecto.");
      return;
    }
    const clip: CompositionClip = {
      durationSeconds,
      hfId: clipId,
      hidden: false,
      id: clipId,
      kind: "AUDIO",
      label: soundEffect.name,
      layout: resolveDefaultCompositionClipLayout({ canvas: currentPayload.document.canvas, clipKind: "AUDIO", sourceDimensions: null, track }),
      mediaFit: resolveDefaultCompositionMediaFit({ clipKind: "AUDIO", track }),
      source: { soundEffectAssetId: soundEffect.id, type: "SOUND_EFFECT_ASSET" },
      sourceDurationSeconds,
      sourceOffsetSeconds: 0,
      startSeconds,
      timingSource: "USER_EDITED",
      trackId: track.id,
      volume: 0.7,
    };
    const saved = await savePatch([{ clip, clipId, track, type: "clip.add" }], `Añadió el efecto ${soundEffect.name} al cursor.`);
    if (saved) selectClip(clip.hfId);
  }

  async function setProductionIntro(asset: CompositionStudioAsset) {
    const currentPayload = payloadRef.current;
    if (!currentPayload || !asset.isEditable || !asset.valid || !asset.mimeType.startsWith("video/")) return;
    const durationSeconds = asset.durationSeconds || 0;
    if (durationSeconds <= 0) {
      setSaveError("La intro necesita una duración medida antes de usarla.");
      return;
    }
    const document = reconcileProductionIntroDocument(currentPayload.document, {
      durationSeconds,
      hasAudio: asset.hasAudio,
      id: asset.id,
      label: asset.label,
      mimeType: asset.mimeType,
      sourceHeight: asset.sourceHeight,
      sourceWidth: asset.sourceWidth,
    });
    const saved = await savePatch(
      [{ document, type: "document.restore" }],
      `Configuró ${asset.label} como intro y desplazó el contenido del video.`,
    );
    if (saved) selectClip("production-intro-media");
  }

  async function clearProductionIntro() {
    const currentPayload = payloadRef.current;
    if (!currentPayload) return;
    const hasIntro = currentPayload.document.clips.some((clip) => (
      clip.source.type === "PRODUCTION_ASSET" && clip.source.placement === "INTRO"
    ));
    if (!hasIntro) return;
    const document = reconcileProductionIntroDocument(currentPayload.document, null);
    await savePatch([{ document, type: "document.restore" }], "Quitó la intro y reacomodó el contenido del video.");
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
      setHistory(body.data as CompositionDocumentHistoryEntry[]);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "No se pudo cargar el historial.");
    }
  }

  async function restoreHistoryEntry(entry: CompositionDocumentHistoryEntry) {
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
      const unconfiguredSceneCount = report?.unconfiguredSceneCount || 0;
      const incompleteExpectedMediaCount = report?.incompleteExpectedMediaCount || 0;
      if (unconfiguredSceneCount > 0) {
        toast.warning(`${unconfiguredSceneCount} escenas aún requieren definir su modalidad en el módulo de avatares.`);
      } else if (incompleteExpectedMediaCount > 0) {
        toast.warning(`${incompleteExpectedMediaCount} escenas todavía no cumplen el medio configurado.`);
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

  async function placeAssemblyBranding(outroAssetId?: string | null) {
    if (saving || saveInFlightRef.current) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/branding`, {
        ...(outroAssetId === undefined ? {} : {
          body: JSON.stringify({ outroAssetId }),
          headers: { "Content-Type": "application/json" },
        }),
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo colocar el intro y outro.");
      await loadBrandingAvailability();
      await loadDocument();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "No se pudo colocar el intro y outro.");
    } finally {
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
      clearLastAppliedAgentProposal();
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
      if (cancelledRenderRef.current === requestId) return;

      setRenderProviderStatus(body.data.providerStatus as string);
      if (body.data.action === "CANCELLED") {
        setRenderStatus("cancelled"); setRenderRequestId(null); setAssemblyError(null);
      } else if (body.data.action === "COMPLETED") {
        setRenderStatus("completed"); setRenderRequestId(null); setAssemblyError(null);
      } else if (body.data.action === "FAIL") {
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
    setDiagnosticRequestId(body.data?.activeRender?.id || body.data?.latestRender?.id || null);
    if (!body.data?.activeRender?.id) return false;

    const requestId = body.data.activeRender.id;
    setRenderImportStatus(body.data.activeRender.importStatus || "NONE");
    setRenderRequestId(requestId);
    setRenderProviderStatus(body.data.activeRender.providerStatus);
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
      if (latestRender.cancelledAt) {
        setRenderStatus("cancelled"); setAssemblyError(null); return;
      }
      const providerFailed = latestRender.providerStatus.toUpperCase() === "FAILED";
      const importFailed = latestRender.importStatus.toUpperCase() === "FAILED";
      if (providerFailed || importFailed) {
        setRenderStatus("failed");
        setRenderProviderStatus(importFailed ? latestRender.importStatus : latestRender.providerStatus);
        setAssemblyError(
          importFailed && !providerFailed
            ? completedVideo
              ? "HeyGen terminó este render, pero Courseforge no pudo importar el video final. El último video completado sigue disponible; revisa el diagnóstico antes de reintentar."
              : "HeyGen terminó este render, pero Courseforge no pudo importar el video final. Revisa el diagnóstico antes de reintentar."
            : completedVideo
              ? "HeyGen reportó que este render falló. El último video completado sigue disponible para publicación; puedes reintentar esta revisión sin perderlo."
              : "HeyGen reportó que este render falló. Puedes volver a intentarlo.",
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
      cancelled_at?: string | null;
      provider_error?: { message?: string } | null;
    }) => {
      if (!active || cancelledRenderRef.current === renderRequestId) return;
      const providerStatus = row.provider_status || "PENDING";
      const importStatus = row.import_status || "NONE";
      setRenderProviderStatus(providerStatus);
      setRenderImportStatus(importStatus);

      if (row.cancelled_at) {
        setRenderStatus("cancelled"); setRenderRequestId(null); setAssemblyError(null);
      } else if (importStatus === "COMPLETED") {
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
    let refreshInFlight = false;
    const refreshDurableRenderState = async () => {
      if (refreshInFlight || !active) return;
      refreshInFlight = true;
      try {
        const response = await fetch(
          `/api/production/hyperframes/renders/${encodeURIComponent(renderRequestId)}/poll`,
          { cache: "no-store", signal: AbortSignal.timeout(12_000) },
        );
        const body = await readCompositionApiResponse<{
          data?: RenderAttemptSummary;
          error?: string;
        }>(response, "No se pudo actualizar el estado del render.");
        if (!response.ok || !body.data) {
          throw new Error(body.error || "No se pudo actualizar el estado del render.");
        }
        applyDurableRenderState({
          import_status: body.data.importStatus,
          provider_status: body.data.providerStatus,
          cancelled_at: body.data.cancelledAt,
          provider_error: body.data.providerError ? { message: body.data.providerError } : null,
        });
      } finally { refreshInFlight = false; }
    };
    const reportRefreshError = (error: unknown) => {
      if (active) setAssemblyError(`No se pudo actualizar el estado: ${error instanceof Error ? error.message : "error de conexión"}. Se volverá a intentar.`);
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
        void refreshDurableRenderState().catch(reportRefreshError);
      });
    const refreshTimer = window.setInterval(() => {
      void refreshDurableRenderState().catch(reportRefreshError);
    }, 15_000);
    void refreshDurableRenderState().catch(reportRefreshError);
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
    setRenderStartedAt(new Date().toISOString()); setDiagnosticRequestId(null); setRenderImportStatus("NONE");
    try {
      const attemptId = options.forceNewAttempt || renderStatus === "failed" || renderStatus === "cancelled"
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
      setDiagnosticRequestId(requestId);
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
        && (body.code === "HYPERFRAMES_FINAL_VIDEO_NOT_FOUND"
          || (body as { details?: { reason?: string } }).details?.reason === "HYPERFRAMES_FINAL_VIDEO_NOT_FOUND");
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

  if (loading) return <LoadingPreview />;
  if (error || !payload || !previewUrl) return <PreviewError error={error || "No hay composición disponible."} onRetry={() => void loadDocument()} />;

  const deliveryMenu = (
    <CompositionDeliveryPanel
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
      importStatus={renderImportStatus}
      diagnostics={<RenderDiagnosticsPanel requestId={diagnosticRequestId} pendingStartedAt={renderStatus === "sending" ? renderStartedAt : null} knownStatus={renderStatus} onCancelled={() => { cancelledRenderRef.current = diagnosticRequestId; setRenderStatus("cancelled"); setRenderRequestId(null); setAssemblyError(null); }} />}
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
  const narrativeLibrary = compositionScenes.length > 0 ? (
    <CompositionNarrativePanel
      document={payload.document}
      scenes={compositionScenes}
      currentTime={seconds}
      onSeek={(time) => { beginScrub(); seek(time); }}
      onSelect={selectClip}
      applying={applyingPreassembly}
      onApply={() => void applyNarrativePreassembly()}
      onOpenSceneBuilder={openSceneBuilder}
    />
  ) : null;

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
        <CompositionStudioLibrary assets={assets} delivery={deliveryMenu} introAssetId={payload.document.clips.flatMap((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.source.placement === "INTRO" ? [clip.source.productionAssetId] : [])[0] || null} lessons={lessons} narrative={narrativeLibrary} narrativeCount={compositionScenes.length} onAddAsset={addAssetToTimeline} onAddSoundEffect={addSoundEffectToTimeline} onClearIntro={clearProductionIntro} onSelectLesson={onSelectLesson} onSelectAsset={selectClip} onSetIntro={setProductionIntro} selectedLessonId={selectedLessonId} selectedHfId={selectedHfId} timelineAssetIds={new Set(payload.document.clips.flatMap((clip) => clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []))} />

        <section ref={previewShellRef} className={`${styles.previewPanel} ${previewFullscreen ? styles.previewFullscreen : ""}`}>
          <CompositionPreviewToolbar
            agentProposalActive={Boolean(agentProposal)}
            currentVersion={payload.version}
            directEditingEnabled={directEditingEnabled}
            duration={duration}
            gridVisible={gridVisible}
            history={history}
            inspectorOpen={inspectorOpen}
            onCloseHistory={() => setHistory(null)}
            onContinueToPublication={onContinueToPublication}
            onHistoryOpen={() => void loadHistory()}
            onInspectorToggle={() => setManualInspectorOpen((current) => !current)}
            onIntervalAction={() => {
              if (removalRangeStart === null) markSelectedIntervalStart();
              else void removeSelectedInterval();
              setToolMenuOpen(false);
            }}
            onOpenAssistant={() => {
              setManualInspectorOpen(true);
              setInspectorTab("assistant");
            }}
            onOpenPresets={() => {
              setPresetPanelOpen(true);
              void loadCompositionPresets();
            }}
            onReload={() => void loadDocument()}
            onRestoreHistory={(entry) => void restoreHistoryEntry(entry)}
            onSplit={() => void splitSelectedClipAtPlayhead()}
            onToggleDirectEditing={() => setDirectEditingEnabled((current) => !current)}
            onToggleFullscreen={() => void togglePreviewFullscreen()}
            onToggleGrid={() => {
              setGridVisible((current) => !current);
              setToolMenuOpen(false);
            }}
            onToggleSnap={() => setSnapEnabled((current) => !current)}
            onToggleToolMenu={() => setToolMenuOpen((current) => !current)}
            onToggleTrim={() => {
              setTrimToolEnabled((current) => !current);
              setToolMenuOpen(false);
            }}
            onToggleVisualCrop={() => {
              setDirectEditingEnabled(true);
              setSaveError(null);
              setVisualCropEnabled((current) => !current);
              setToolMenuOpen(false);
            }}
            onZoom={changePreviewZoom}
            previewFullscreen={previewFullscreen}
            previewStatusLabel={previewStatusLabel}
            previewZoom={previewZoom}
            removalRangeStartSeconds={removalRangeStart?.seconds ?? null}
            saveError={saveError}
            saving={saving}
            snapEnabled={snapEnabled}
            toolMenuOpen={toolMenuOpen}
            toolMenuRef={toolMenuRef}
            trimToolEnabled={trimToolEnabled}
            visualCropEnabled={visualCropEnabled}
          />
          <CompositionPreviewViewport
            activeSceneId={activeSceneId}
            agentProposalActive={Boolean(agentProposal)}
            duration={duration}
            fps={payload.document.canvas.fps}
            frameRef={frameRef}
            onBeginScrub={beginScrub}
            onPlaySelectedAnimation={playSelectedAnimation}
            onRefreshDocument={() => refreshPreviewDocument(false)}
            onRefreshMedia={refreshPreviewMedia}
            onSceneSelect={(scene) => {
              seek(scene.startSeconds);
              selectClip(scene.primaryHfId);
            }}
            onSeek={seek}
            onTogglePlayback={togglePreviewPlayback}
            pendingMediaCount={pendingPreviewMediaIds.length}
            playbackError={playbackError}
            presetPreviewActive={Boolean(presetPreview)}
            previewDirty={previewDirty}
            previewMediaState={previewMediaState}
            previewReady={previewReady}
            previewUrl={previewUrl}
            saving={saving}
            scenes={compositionScenes}
            seconds={seconds}
            selectedAnimationId={selectedAnimationId}
            transportActive={transportActive}
          />
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

        <CompositionTimelineWorkspace
          assetLabels={Object.fromEntries(assets.map((asset) => [asset.id, asset.label]))}
          brandingAvailability={brandingAvailability}
          currentTime={seconds}
          document={payload.document}
          durationSourceLabel={durationSourceLabel}
          estimatedClipCount={estimatedClipCount}
          onAnimationSelect={selectAnimation}
          onAnimationTimingChange={(animation, timing) => void savePatch([{ animationId: animation.id, timing, type: "animation.update-timing" }], `Ajustó ${animation.preset?.id || animation.propertyGroup} desde la timeline.`)}
          onAudioMixUpdate={(settings, summary) => void savePatch([{ settings, type: "audio-mix.update" }], summary)}
          onClearSelection={clearSelection}
          onCreateGroup={(clipIds, groupId) => void savePatch([{ clipIds, groupId, type: "group.create" }], `Agrupó ${clipIds.length} clips del timeline.`)}
          onDurationChange={(clip, durationSeconds) => void savePatch([{ clipId: clip.id, durationSeconds, type: "clip.duration" }], `Ajustó la duración de ${clip.label} desde la timeline.`)}
          onMove={(clip, startSeconds) => void savePatch([{ clipId: clip.id, startSeconds, type: "clip.move" }], `Movió ${clip.label} a ${startSeconds} segundos.`)}
          onMoveGroup={(groupId, startSeconds) => void savePatch([{ groupId, startSeconds, type: "group.move" }], `Movió el grupo a ${formatSeconds(startSeconds)}.`)}
          onOrganize={() => void organizeTimeline()}
          onOutroChange={(outroId) => void placeAssemblyBranding(outroId)}
          onRecalculateDuration={() => void recalculateDuration()}
          onRecoverHistoricalAssets={() => void recoverHistoricalAssets()}
          onRefreshProductionAssets={() => void refreshProductionAssets()}
          onSeek={seek}
          onSelect={selectClip}
          onTrackUpdate={(track, settings, summary) => void updateTrack(track, settings, summary)}
          onTransitionAdd={(transition) => void savePatch([{ transition, type: "transition.add" }], `Añadió ${transition.type} entre dos clips.`)}
          onTransitionRemove={(transitionId) => void savePatch([{ transitionId, type: "transition.remove" }], "Quitó una transición entre clips.")}
          onTransitionUpdate={(transitionId, settings) => void savePatch([{ settings, transitionId, type: "transition.update" }], "Ajustó una transición entre clips.")}
          onTrim={(clip, startSeconds, durationSeconds, sourceOffsetSeconds) => void savePatch([{ clipId: clip.id, durationSeconds, sourceOffsetSeconds, startSeconds, type: "clip.trim" }], `Ajustó el inicio de ${clip.label} desde la timeline.`)}
          onUngroup={(groupId) => void savePatch([{ groupId, type: "group.ungroup" }], "Desagrupó los clips seleccionados.")}
          recoveringHistoricalAssets={recoveringHistoricalAssets}
          refreshingProductionAssets={refreshingProductionAssets}
          saving={saving}
          selectedAnimationId={selectedAnimationId}
          selectedHfId={selectedHfId}
          snapEnabled={snapEnabled}
          trimToolEnabled={trimToolEnabled}
        />

        {inspectorOpen && <aside className={styles.inspector}>
          <div className={styles.inspectorHeader}><div className={styles.inspectorTabs}><button type="button" onClick={() => setInspectorTab("properties")} className={`${styles.inspectorTab} ${inspectorTab === "properties" ? styles.inspectorTabActive : ""}`}>Propiedades</button><button type="button" onClick={() => setInspectorTab("assistant")} className={`${styles.inspectorTab} ${inspectorTab === "assistant" ? styles.inspectorTabActive : ""}`}>SofLIA</button></div><button type="button" onClick={clearSelection} className={styles.inspectorClose} title="Cerrar inspector" aria-label="Cerrar inspector"><X size={15} /></button></div>
          <div className={styles.inspectorBody}>{inspectorTab === "properties" ? <CompositionInspector animations={selectedClip ? payload.document.motion.animations.filter((animation) => animation.target.clipId === selectedClip.id) : []} clip={selectedClip} track={selectedClip ? payload.document.tracks.find((track) => track.id === selectedClip.trackId) || null : null} cropModeEnabled={visualCropEnabled} saving={saving} separatingAudio={separatingAudio} separatingAudioProgress={separatingAudioProgress} selectedAnimationId={selectedAnimationId} onAnimationSelect={(id) => { if (id && selectedClip) selectAnimation(id, selectedClip.hfId); else setSelectedAnimationId(null); }} onDetachAudio={separateSelectedVideoAudio} onPatch={savePatch} onPreviewCrop={(hfId, crop) => postPreviewMessage({ type: "courseforge-composition-preview-crop", hfId, crop })} onRemove={removeClipFromTimeline} /> : <CompositionAgentConversation lastAppliedProposal={lastAppliedAgentProposal} proposal={agentProposal} proposing={proposing} saving={saving} onDismiss={() => void dismissAgentProposal()} onPropose={(instruction) => requestAgentProposal(instruction, Boolean(presetPreview))} onApprove={() => void approveAgentProposal()} onUndo={() => void undoLastAgentProposal()} />}</div>
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
