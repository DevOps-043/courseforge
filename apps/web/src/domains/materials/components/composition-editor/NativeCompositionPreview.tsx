"use client";

import { COMPOSITION_CANVAS_FORMATS, resolveCompositionCanvasFormat } from "@/domains/production/composition-editor/composition-canvas-format";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AlertTriangle, GripHorizontal, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { CompositionClip, CompositionEditorDocument, CompositionTrack } from "@/domains/production/composition-editor/composition-document.types";
import { formatCompositionTimecode } from "@/domains/production/composition-editor/composition-timecode";
import { resolveCompositionAnimationWindow } from "@/domains/production/composition-editor/composition-motion-scheduling.service";
import { resolveCompositionPreviewSelectionEvent } from "@/domains/production/composition-editor/composition-timeline-selection.service";
import {
  buildCompositionDeleteSelectionPlan,
  buildCompositionDuplicateSelectionPlan,
} from "@/domains/production/composition-editor/composition-timeline-batch.service";
import {
  createCompositionSelectionClipboardEntry,
  resolveCompositionSelectionClipboardEntry,
  type CompositionSelectionClipboardEntry,
} from "@/domains/production/composition-editor/composition-selection-clipboard";
import {
  buildCompositionSelectionAlignmentPlan,
  buildCompositionSelectionDistributionPlan,
  type CompositionSelectionAlignment,
  type CompositionSelectionAlignmentTarget,
  type CompositionSelectionDistributionAxis,
} from "@/domains/production/composition-editor/composition-selection-layout.service";
import {
  buildCompositionAssetPlacementEditPlan,
  buildCompositionRollEditPlan,
  buildCompositionSlideEditPlan,
  type CompositionAssetInsertionMode,
} from "@/domains/production/composition-editor/composition-timeline-edit.service";
import {
  resolveCompositionTimelineKeyboardCommand,
  type CompositionTimelineKeyboardEditMode,
} from "@/domains/production/composition-editor/composition-timeline-interaction.service";
import {
  readCompositionEditorPreferences,
  resolveBrowserCompositionEditorPreferenceStorage,
  writeCompositionEditorPreferences,
  type CompositionEditorPreferences,
} from "@/domains/production/composition-editor/composition-editor-preferences";
import { CompositionNarrativePanel } from "./CompositionNarrativePanel";
import { CompositionNarrativeExtractionHost, useNarrativeExtractionHost } from "./CompositionNarrativeExtractionHost";
import { acceptsNarrativeExtractionReload } from "@/domains/production/composition-editor/composition-narrative-reload-policy";
import type { NarrativeEditorReload } from "@/domains/production/composition-editor/composition-narrative-editor-controller";
import { CompositionHtmlSnapshotRecoveryPanel } from "./CompositionHtmlSnapshotRecoveryPanel";
import { CompositionHtmlEditorialInspector } from "./CompositionHtmlEditorialInspector";
import { CompositionHtmlRecoveryCenter } from "./CompositionHtmlRecoveryCenter";
import { useAuthStore } from "@/core/stores/authStore";
import { useOrganizationStore } from "@/core/stores/organizationStore";
import { CompositionHtmlEditorialNativeHost } from "@/domains/production/composition-editor/composition-html-editing-native-host.client";
import { projectCurrentHtmlReferencesIntoHistory } from "@/domains/production/composition-editor/composition-html-editing-history-projection.client";
import { htmlSnapshotLocatorScopeSchema, resolveHtmlSnapshotLocatorStorage } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { resolveHtmlSnapshotPublicationLock } from "@/domains/production/composition-editor/composition-html-snapshot-publication-lock.client";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import { applyCompositionEditorPatches, ensureCanvasDurationForClipPatches } from "@/domains/production/composition-editor/editor-patch.service";
import { resolveAvatarAudioLink } from "@/domains/production/composition-editor/composition-avatar-audio-link.service";
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
import {
  createCompositionNativeOverlay,
  type NativeOverlayKind,
} from "@/domains/production/composition-editor/composition-native-overlay.factory";
import { reconcileProductionIntroDocument } from "@/domains/production/composition-editor/composition-production-intro.service";
import { deriveCompositionScenes } from "@/domains/production/composition-editor/composition-scene.service";
import { resolveNarrativeRangePreview, shouldStopNarrativeRangePreview, NARRATIVE_RANGE_PREVIEW_TIMEOUT_MARGIN_MS,
  type NarrativeRangePreview, type NarrativeRangeSelection } from "@/domains/production/composition-editor/composition-narrative-range.service";
import { createCompositionTranscriptCaptionPlan } from "@/domains/production/composition-editor/composition-transcript-caption.service";
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
import { canCommitCompositionPreviewRuntimePatch, CompositionPreviewRuntimePatchCoordinator } from "@/domains/production/composition-editor/composition-preview-runtime-sync.client";
import {
  CompositionCommandHistory,
  type CompositionCommandHistorySnapshot,
} from "@/domains/production/composition-editor/composition-command-history";
import {
  clearCompositionRecoveryEntry,
  createCompositionRecoveryEntry,
  resolveCompositionRecovery,
  writeCompositionRecoveryEntry,
  type CompositionRecoveryEntry,
} from "@/domains/production/composition-editor/composition-recovery-journal";
import { readCompositionApiResponse } from "@/domains/production/composition-editor/composition-editor-api.client";
import {
  INITIAL_COMPOSITION_PREVIEW_SYNC_STATE,
  shouldReportCompositionPreviewReadyTimeout,
  shouldReportCompositionPreviewRuntimeHandshakeFailure,
  transitionCompositionPreviewSyncState,
} from "@/domains/production/composition-editor/composition-preview-sync-state";
import { COMPOSITION_PREVIEW_DOCUMENT_READY_CONFIG, COMPOSITION_PREVIEW_SYNC_V2_ENABLED } from "@/domains/production/composition-editor/composition-preview-sync.config";
import { resolveCompositionPreviewLoadErrorPresentation } from "@/domains/production/composition-editor/composition-preview-load-error";
import { classifyCompositionPreviewMessage } from "@/domains/production/composition-editor/composition-preview-message-policy";
import { acceptsCompositionPreviewShortcut, resolveCompositionEditorShortcut, type CompositionEditorShortcut } from "@/domains/production/composition-editor/composition-editor-shortcut";
import {
  applyCompositionPreviewTerminalFailure,
  type TerminalPreviewFailure,
} from "@/domains/production/composition-editor/composition-preview-terminal-failure";
import {
  createCompositionPreviewParentCommand,
  parseCompositionPreviewIframeMessage,
  type CompositionColorGradingRuntimeStatus,
  type CompositionPreviewLoadErrorCode,
  type CompositionPreviewParentCommandInput,
} from "@/domains/production/composition-editor/composition-preview-protocol";
import {
  classifyCompositionPreviewOperations,
  requiresCompositionPreviewReload,
} from "@/domains/production/composition-editor/composition-preview-operation-policy";
import { buildCompositionPreviewVisualPatch } from "@/domains/production/composition-editor/composition-preview-visual-patch";
import { COMPOSITION_PREVIEW_MAX_GENERATION, buildCompositionComparisonPreviewUrl, buildCompositionSavedPreviewUrl, readCompositionPreviewGeneration } from "@/domains/production/composition-editor/composition-preview-comparison";
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
import { CompositionAudioDiagnostics } from "./CompositionAudioDiagnostics";
import { CompositionAudioMeters } from "./CompositionAudioMeters";
import { areCompositionAudioMetersEnabled } from "@/domains/production/composition-editor/composition-audio-meter-runtime";
import type { CompositionAudioMeterMessage } from "@/domains/production/composition-editor/composition-preview-protocol";
import {
  CompositionInspectorTabs,
  type CompositionInspectorTab,
} from "./CompositionInspectorTabs";
import { CompositionSelectionPanel } from "./CompositionSelectionPanel";
import { CompositionCommandPalette } from "./CompositionCommandPalette";
import {
  buildCompositionCommandPaletteItems,
  executeCompositionEditorCommand,
} from "@/domains/production/composition-editor/composition-editor-command-actions";
import type { CompositionEditorCommandId } from "@/domains/production/composition-editor/composition-editor-command-palette";
import { TransitionControls } from "./TransitionControls";
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
type SavePatchOptions = {
  historyMode?: "RECORD" | "REDO" | "UNDO";
  preservePreviewRuntime?: boolean;
  recoveryEntryId?: string;
  skipRecoveryJournal?: boolean;
};
type SavePatchHandler = (
  operations: CompositionEditorPatchOperation[],
  summary: string,
  source?: "AGENT" | "USER",
  options?: SavePatchOptions,
) => Promise<boolean>;
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
  media: "Medios",
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
export function NativeCompositionPreview(props: NativeCompositionPreviewProps) {
  return <CompositionNarrativeExtractionHost draftId={props.draftId} enabled={process.env.NEXT_PUBLIC_NARRATIVE_EXTRACTION_ENABLED === "true"}
    fragmentEnabled={process.env.NEXT_PUBLIC_NARRATIVE_FRAGMENT_ENABLED === "true"}><NativeCompositionPreviewSession {...props} /></CompositionNarrativeExtractionHost>;
}

function NativeCompositionPreviewSession({ assets, componentId, compositionId, draftId, lessons, onAssetsChanged, onContinueToPublication, onRefreshProductionAssets, onSelectLesson, onVideoCompleted, selectedLessonId }: NativeCompositionPreviewProps) {
  const narrativeExtractionHost = useNarrativeExtractionHost();
  const narrativeExtractionHostRef = useRef(narrativeExtractionHost);
  useEffect(() => { narrativeExtractionHostRef.current = narrativeExtractionHost; }, [narrativeExtractionHost]);
  const narrativeExtractionBeforeRef = useRef<DocumentPayload | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const previewFocusRestoredRef = useRef(false);
  const executeEditorShortcutRef = useRef<((command: CompositionEditorShortcut) => void) | null>(null);
  const comparisonBaselineFrameRef = useRef<HTMLIFrameElement | null>(null);
  const editorPreferencesRef = useRef<CompositionEditorPreferences | null>(null);
  if (!editorPreferencesRef.current) {
    editorPreferencesRef.current = readCompositionEditorPreferences(
      resolveBrowserCompositionEditorPreferenceStorage(),
    );
  }
  const initialEditorPreferences = editorPreferencesRef.current;
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
  const htmlEditorialHostRef = useRef<CompositionHtmlEditorialNativeHost | null>(null);
  const nativeBypassPendingRef = useRef(0);
  const presetWritePendingRef = useRef(false);
  const nativeMountedRef = useRef(true);
  const [htmlEditorialBusy, setHtmlEditorialBusy] = useState(false);
  const commandHistoryRef = useRef<CompositionCommandHistory | null>(null);
  const externalMutationBasePayloadRef = useRef<CompositionDocumentPayload | null>(null);
  const agentMutationPreviewRef = useRef<{ generation: number; ready: boolean; source: string | null } | null>(null);
  const recoveryAttemptedEntryRef = useRef<string | null>(null);
  const savePatchRef = useRef<SavePatchHandler | null>(null);
  const undoLastEditRef = useRef<(() => Promise<void>) | null>(null);
  const redoLastEditRef = useRef<(() => Promise<void>) | null>(null);
  const copyTimelineSelectionRef = useRef<(() => void) | null>(null);
  const pasteTimelineClipboardRef = useRef<(() => Promise<void>) | null>(null);
  const duplicateTimelineSelectionRef = useRef<(() => Promise<void>) | null>(null);
  const deleteTimelineSelectionRef = useRef<((ripple: boolean) => Promise<void>) | null>(null);
  const rollTimelineSelectionRef = useRef<((edge: "LEFT" | "RIGHT", deltaFrames: number) => Promise<void>) | null>(null);
  const slideTimelineSelectionRef = useRef<((deltaFrames: number) => Promise<void>) | null>(null);
  const timelineFrameStepRef = useRef(1);
  const timelineKeyboardEditModeRef = useRef<CompositionTimelineKeyboardEditMode>("SLIDE");
  const runtimePatchCoordinatorRef = useRef<CompositionPreviewRuntimePatchCoordinator | null>(null);
  const previewSyncStateRef = useRef(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE);
  const renderPollInFlightRef = useRef(false);
  const onVideoCompletedRef = useRef(onVideoCompleted);
  const mediaRecoveryHashRef = useRef<string | null>(null);
  const playheadSecondsRef = useRef(0);
  const timelineClipboardRef = useRef<CompositionSelectionClipboardEntry | null>(null);
  const pendingSeekSecondsRef = useRef<number | null>(null);
  const pendingPreviewRestoreSecondsRef = useRef<number | null>(null);
  const previewDocumentHashRef = useRef<string | null>(null);
  const previewRuntimeBaseHashRef = useRef<string | null>(null);
  const previewReloadRequestRef = useRef(0);
  const previewGenerationRef = useRef(0);
  const failedPreviewGenerationRef = useRef<number | null>(null);
  const previewRuntimeHandshakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRuntimeSignalGenerationRef = useRef<number | null>(null);
  const autoPlayAfterPreviewRefreshRef = useRef(false);
  const previewTelemetryRef = useRef<CompositionPreviewTelemetryBuffer | null>(null);
  const previewReloadTelemetryRef = useRef<{ reason: PreviewReloadReason; startedAt: number } | null>(null);
  const pendingEditTelemetryRef = useRef<PendingEditTelemetry | null>(null);
  const comparisonBaselineReadyRef = useRef(false);
  const [payload, setPayload] = useState<DocumentPayload | null>(null);
  const compositionScenes = useMemo(() => payload ? deriveCompositionScenes(payload.document) : [], [payload]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [safeAreasVisible, setSafeAreasVisible] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [audioMeterMessage, setAudioMeterMessage] = useState<CompositionAudioMeterMessage | null>(null);
  const [previewMediaState, setPreviewMediaState] = useState<"BUFFERING" | "PLAYING" | "PREPARING" | "READY">("PREPARING");
  const [pendingPreviewMediaIds, setPendingPreviewMediaIds] = useState<string[]>([]);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const advancePreviewGeneration = useCallback(() => {
    runtimePatchCoordinatorRef.current?.dispose();
    if (previewRuntimeHandshakeTimerRef.current) clearTimeout(previewRuntimeHandshakeTimerRef.current);
    previewRuntimeHandshakeTimerRef.current = null;
    previewReadyRef.current = false;
    const nextGeneration = previewGenerationRef.current >= COMPOSITION_PREVIEW_MAX_GENERATION
      ? 0
      : previewGenerationRef.current + 1;
    previewGenerationRef.current = nextGeneration;
    failedPreviewGenerationRef.current = null;
    previewRuntimeSignalGenerationRef.current = null;
    setPreviewRefreshKey(nextGeneration);
  }, []);
  const [previewDocumentHash, setPreviewDocumentHash] = useState<string | null>(null);
  const [previewDirty, setPreviewDirty] = useState(false);
  const [comparisonActive, setComparisonActive] = useState(false);
  const [comparisonBaselineHash, setComparisonBaselineHash] = useState<string | null>(null);
  const [comparisonBaselineLoading, setComparisonBaselineLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [previewLoadErrorCode, setPreviewLoadErrorCode] = useState<CompositionPreviewLoadErrorCode | null>(null);
  const [failedPreviewMediaIds, setFailedPreviewMediaIds] = useState<string[]>([]);
  const [colorGradingStatuses, setColorGradingStatuses] = useState<Record<string, CompositionColorGradingRuntimeStatus>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [timelineClipboardCompositionId, setTimelineClipboardCompositionId] = useState<string | null>(null);
  const [separatingAudio, setSeparatingAudio] = useState(false);
  const [separatingAudioProgress, setSeparatingAudioProgress] = useState(0);
  const [refreshingProductionAssets, setRefreshingProductionAssets] = useState(false);
  const [recoveringHistoricalAssets, setRecoveringHistoricalAssets] = useState(false);
  const [failedSave, setFailedSave] = useState<{ operations: CompositionEditorPatchOperation[]; source: "AGENT" | "USER"; summary: string } | null>(null);
  const [commandHistoryState, setCommandHistoryState] = useState<CompositionCommandHistorySnapshot>({
    canRedo: false,
    canUndo: false,
    redoLabel: null,
    retainedEntries: 0,
    retainedSerializedBytes: 0,
    undoLabel: null,
  });
  const [recoveryConflict, setRecoveryConflict] = useState<CompositionRecoveryEntry | null>(null);
  const [selectedHfId, setSelectedHfId] = useState<string | null>(null);
  const commitTerminalPreviewFailure = useCallback((failure: TerminalPreviewFailure) => {
    if (failedPreviewGenerationRef.current === previewGenerationRef.current) return false;
    return applyCompositionPreviewTerminalFailure(failure, playheadSecondsRef.current, {
      state: previewSyncStateRef,
      record: (metric) => { previewTelemetryRef.current?.record(metric); },
      present: (presentation) => {
        failedPreviewGenerationRef.current = previewGenerationRef.current;
        if (previewRuntimeHandshakeTimerRef.current) clearTimeout(previewRuntimeHandshakeTimerRef.current);
        previewRuntimeHandshakeTimerRef.current = null;
        const pauseCommand = createCompositionPreviewParentCommand({ type: "courseforge-composition-pause" });
        frameRef.current?.contentWindow?.postMessage(pauseCommand, "*");
        comparisonBaselineFrameRef.current?.contentWindow?.postMessage(pauseCommand, "*");
        previewReadyRef.current = presentation.ready;
        setAudioMeterMessage(null);
        autoPlayAfterPreviewRefreshRef.current = false;
        setPlaying(presentation.playing);
        setPreviewReady(presentation.ready);
        setPreviewMediaState(presentation.mediaState);
        setPendingPreviewMediaIds(presentation.pendingMediaIds);
        setPreviewLoadErrorCode(presentation.loadErrorCode);
        setPlaybackError(presentation.message);
      },
    });
  }, []);
  const getCurrentPayload = useCallback(() => htmlEditorialHostRef.current?.isBlocked() || narrativeExtractionHostRef.current?.isBlocked() ? null : payloadRef.current, []);
  const isSaveInFlight = useCallback(() => saveInFlightRef.current || Boolean(htmlEditorialHostRef.current?.isBlocked() || narrativeExtractionHostRef.current?.isBlocked()), []);
  const adoptSavedPreviewRevision = useCallback((documentHash: string) => {
    previewDocumentHashRef.current = documentHash;
    previewRuntimeBaseHashRef.current = documentHash;
    setPreviewDocumentHash(documentHash);
    setPreviewDirty(false);
    if (!COMPOSITION_PREVIEW_SYNC_V2_ENABLED) return;
    previewSyncStateRef.current = transitionCompositionPreviewSyncState(previewSyncStateRef.current, {
      documentHash,
      type: "DOCUMENT_LOADED",
    });
    advancePreviewGeneration();
    autoPlayAfterPreviewRefreshRef.current = false;
    setPlaying(false);
    setPreviewReady(false);
    setPreviewMediaState("PREPARING");
    setPendingPreviewMediaIds([]);
    setPreviewLoadErrorCode(null);
    setPlaybackError(null);
  }, [advancePreviewGeneration]);
  const restoreSavedPreviewAfterDismissal = useCallback(() => {
    const currentPayload = payloadRef.current;
    if (!currentPayload) return;
    pendingPreviewRestoreSecondsRef.current = playheadSecondsRef.current;
    pendingSeekSecondsRef.current = null;
    adoptSavedPreviewRevision(currentPayload.documentHash);
  }, [adoptSavedPreviewRevision]);
  const syncCommandHistoryState = useCallback(() => {
    if (commandHistoryRef.current) setCommandHistoryState(commandHistoryRef.current.snapshot());
  }, []);
  const applyPresetDocument = useCallback((nextPayload: CompositionDocumentPayload) => {
    const previousPayload = externalMutationBasePayloadRef.current || payloadRef.current;
    if (previousPayload && previousPayload.documentHash !== nextPayload.documentHash) {
      commandHistoryRef.current?.record({
        afterDocument: nextPayload.document,
        beforeDocument: previousPayload.document,
        source: "SYSTEM",
        summary: "Aplicó un cambio de preset o asistente.",
      });
      syncCommandHistoryState();
    }
    externalMutationBasePayloadRef.current = null;
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
    adoptSavedPreviewRevision(nextPayload.documentHash);
  }, [adoptSavedPreviewRevision, syncCommandHistoryState]);
  const beginAgentProposalMutation = useCallback((optimisticPayload: CompositionDocumentPayload) => {
    externalMutationBasePayloadRef.current = payloadRef.current;
    agentMutationPreviewRef.current = {
      generation: previewGenerationRef.current,
      ready: previewReadyRef.current,
      source: frameRef.current?.getAttribute("src") ?? null,
    };
    previewReadyRef.current = false;
    pendingPreviewRestoreSecondsRef.current = playheadSecondsRef.current;
    pendingSeekSecondsRef.current = null;
    frameRef.current?.contentWindow?.postMessage(
      createCompositionPreviewParentCommand({ type: "courseforge-composition-pause" }),
      "*",
    );
    setPlaying(false);
    setPreviewReady(false);
    setPreviewMediaState("PREPARING");
    setPendingPreviewMediaIds([]);
    if (failedPreviewGenerationRef.current !== previewGenerationRef.current) setPlaybackError(null);
    saveInFlightRef.current = true;
    setSaving(true);
    payloadRef.current = optimisticPayload;
    setPayload(optimisticPayload);
  }, []);
  const failAgentProposalMutation = useCallback((previousPayload: CompositionDocumentPayload) => {
    const previousPreview = agentMutationPreviewRef.current;
    externalMutationBasePayloadRef.current = null;
    pendingPreviewRestoreSecondsRef.current = null;
    payloadRef.current = previousPayload;
    setPayload(previousPayload);
    if (failedPreviewGenerationRef.current === previewGenerationRef.current) return;
    const canRestoreReady = Boolean(previousPreview
      && previousPreview.generation === previewGenerationRef.current
      && previousPreview.source === (frameRef.current?.getAttribute("src") ?? null)
      && (previousPreview.ready || previewReadyRef.current));
    previewReadyRef.current = canRestoreReady;
    setPreviewReady(canRestoreReady);
    if (canRestoreReady) {
      setPreviewMediaState("READY");
      setPendingPreviewMediaIds([]);
    }
  }, []);
  const finishAgentProposalMutation = useCallback(() => {
    agentMutationPreviewRef.current = null;
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
    onPreviewDismissed: restoreSavedPreviewAfterDismissal,
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
    onPreviewDismissed: restoreSavedPreviewAfterDismissal,
    onSavingChange: (pending) => { presetWritePendingRef.current = pending; setSaving(pending); },
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
      (saveCommand) => htmlEditorialHostRef.current?.isBlocked() || narrativeExtractionHostRef.current?.isBlocked() ? Promise.resolve(false) : saveCommand(),
      (snapshot) => setSaving(snapshot.status === "RUNNING" || snapshot.pendingCount > 0),
      () => setSaveError("Hay demasiados cambios pendientes. Espera a que termine el guardado actual."),
    );
  }
  if (!commandHistoryRef.current) commandHistoryRef.current = new CompositionCommandHistory();
  if (!runtimePatchCoordinatorRef.current) {
    runtimePatchCoordinatorRef.current = new CompositionPreviewRuntimePatchCoordinator();
  }

  const [selectedAnimationId, setSelectedAnimationId] = useState<string | null>(null);
  const [selectedTimelineClipIds, setSelectedTimelineClipIds] = useState<Set<string>>(() => new Set());
  const selectedTimelineClipIdsRef = useRef<ReadonlySet<string>>(selectedTimelineClipIds);
  selectedTimelineClipIdsRef.current = selectedTimelineClipIds;
  const [selectedTimelineGroupId, setSelectedTimelineGroupId] = useState<string | null>(null);
  const [editingTimelineGroupId, setEditingTimelineGroupId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);
  const [applyingPreassembly, setApplyingPreassembly] = useState(false);
  const animationPlaybackEndRef = useRef<number | null>(null);
  const narrativeRangePlaybackRef = useRef<NarrativeRangePreview | null>(null);
  const narrativeRangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const narrativeRangeStopRef = useRef<() => void>(() => {});
  const previewReadyRef = useRef(false);
  const [manualInspectorOpen, setManualInspectorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [assetInsertionMode, setAssetInsertionMode] = useState<CompositionAssetInsertionMode>(
    initialEditorPreferences.assetInsertionMode,
  );
  const [timelineFrameStep, setTimelineFrameStep] = useState(initialEditorPreferences.timelineFrameStep);
  const [timelineKeyboardEditMode, setTimelineKeyboardEditMode] = useState<CompositionTimelineKeyboardEditMode>(
    initialEditorPreferences.timelineKeyboardEditMode,
  );
  timelineFrameStepRef.current = timelineFrameStep;
  timelineKeyboardEditModeRef.current = timelineKeyboardEditMode;
  const [inspectorTab, setInspectorTab] = useState<CompositionInspectorTab>("properties");
  const [removalRangeStart, setRemovalRangeStart] = useState<{ clipId: string; seconds: number } | null>(null);
  const [history, setHistory] = useState<CompositionDocumentHistoryEntry[] | null>(null);
  const [brandingAvailability, setBrandingAvailability] = useState<AssemblyBrandingAvailability | null>(null);

  const htmlEditorialContextRef = useRef({ draftId, saving, blockingWork: false });
  htmlEditorialContextRef.current = { draftId, saving, blockingWork: Boolean(loading || previewDirty || saveError || failedSave
    || recoveryConflict || agentProposal || presetPreview || proposing || presetBusy || comparisonActive || assembling
    || applyingPreassembly || separatingAudio || refreshingProductionAssets || recoveringHistoricalAssets
    || renderRequestId || ["validating", "sending", "rendering"].includes(renderStatus)) };
  if (!htmlEditorialHostRef.current) {
    htmlEditorialHostRef.current = new CompositionHtmlEditorialNativeHost({
      enabled: () => process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED === "true",
      durableEnabled: () => process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_OPERATION_RECEIPTS_ENABLED === "true",
      initializationEnabled: () => process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED === "true",
      getScope: () => {
        if (!nativeMountedRef.current) return null;
        const scope = htmlSnapshotLocatorScopeSchema.safeParse({ actorId: useAuthStore.getState().user?.id,
          organizationId: useOrganizationStore.getState().activeOrganizationId, draftId: htmlEditorialContextRef.current.draftId });
        return scope.success ? scope.data : null;
      },
      getPayload: () => payloadRef.current,
      hasConflictingWork: reserved => Boolean(htmlEditorialContextRef.current.blockingWork || nativeBypassPendingRef.current || narrativeExtractionHostRef.current?.isBlocked()
        || presetWritePendingRef.current || saveInFlightRef.current || renderPollInFlightRef.current
        || (!reserved && htmlEditorialContextRef.current.saving)),
      reserve: task => saveQueueRef.current!.runExclusiveWhenIdle(task),
      getStorage: resolveHtmlSnapshotLocatorStorage,
      getLock: resolveHtmlSnapshotPublicationLock,
      onBusyChange: busy => {
        if (!nativeMountedRef.current) return;
        setHtmlEditorialBusy(busy);
        if (busy) { postPreviewMessage({ type: "courseforge-composition-pause" }); setPlaying(false); }
      },
      adopt: nextPayload => {
        payloadRef.current = nextPayload; setPayload(nextPayload);
        commandHistoryRef.current?.rebaseDocuments(document => projectCurrentHtmlReferencesIntoHistory(document, nextPayload.document));
        syncCommandHistoryState();
        setHistory(null); setAssembly(null); setSnapshotHistory(null);
        clearLastAppliedAgentProposal(); setLastAppliedPreset(null);
        pendingPreviewRestoreSecondsRef.current = playheadSecondsRef.current;
        refreshPreviewDocument(false, "EDIT_SAVED");
      },
    });
  }
  useEffect(() => {
    nativeMountedRef.current = true;
    return () => { nativeMountedRef.current = false; htmlEditorialHostRef.current?.abortPending(); };
  }, []);

  async function runNativeBypass(task: () => Promise<void>) {
    if (htmlEditorialHostRef.current?.isBlocked() || narrativeExtractionHostRef.current?.isBlocked()) {
      setSaveError("Hay una escritura editorial pendiente de confirmación o actualización. Revisa su seguimiento antes de editar."); return;
    }
    nativeBypassPendingRef.current += 1;
    try { await task(); } finally { nativeBypassPendingRef.current -= 1; }
  }
  const addSoundEffectToTimeline = (item: SoundEffectCatalogItem) => runNativeBypass(() => linkAndInsertSoundEffect(item));
  const separateSelectedVideoAudio = (clip: CompositionClip) => runNativeBypass(() => detachAndInsertVideoAudio(clip));
  const refreshProductionAssets = () => runNativeBypass(refreshNativeProductionAssets);
  const recoverHistoricalAssets = () => runNativeBypass(recoverNativeHistoricalAssets);
  const placeAssemblyBranding = (assetId?: string | null) => runNativeBypass(() => placeNativeAssemblyBranding(assetId));
  const prepareAssembly = () => runNativeBypass(prepareNativeAssembly);
  const restoreSnapshot = (snapshot: CompositionSnapshotEntry) => runNativeBypass(() => restoreNativeSnapshot(snapshot));
  const approveAssembly = () => runNativeBypass(approveNativeAssembly);
  const submitAssemblyRender = (options: { forceNewAttempt?: boolean } = {}) => runNativeBypass(() => submitNativeAssemblyRender(options));
  const deletePriorVideoAndRender = () => runNativeBypass(deleteNativePriorVideoAndRender);

  function persistEditorPreferences(
    update: Partial<Pick<CompositionEditorPreferences, "assetInsertionMode" | "timelineFrameStep" | "timelineKeyboardEditMode">>,
  ) {
    const nextPreferences: CompositionEditorPreferences = {
      ...(editorPreferencesRef.current || initialEditorPreferences),
      ...update,
    };
    editorPreferencesRef.current = nextPreferences;
    writeCompositionEditorPreferences(
      resolveBrowserCompositionEditorPreferenceStorage(),
      nextPreferences,
    );
  }

  function changeAssetInsertionMode(mode: CompositionAssetInsertionMode) {
    setAssetInsertionMode(mode);
    persistEditorPreferences({ assetInsertionMode: mode });
  }

  function changeTimelineFrameStep(frameStep: number) {
    setTimelineFrameStep(frameStep);
    persistEditorPreferences({ timelineFrameStep: frameStep });
  }

  function changeTimelineKeyboardEditMode(mode: CompositionTimelineKeyboardEditMode) {
    setTimelineKeyboardEditMode(mode);
    persistEditorPreferences({ timelineKeyboardEditMode: mode });
  }

  useEffect(() => {
    onVideoCompletedRef.current = onVideoCompleted;
  }, [onVideoCompleted]);

  const loadDocument = useCallback(async (historyCommand?: {
    beforePayload: CompositionDocumentPayload;
    source: "SYSTEM" | "USER";
    summary: string;
    expectedAfterHash?: string;
    selectedClipId?: string;
  }, extractionReceipt?: NarrativeEditorReload) => {
    if (htmlEditorialHostRef.current?.isBusy()) return false;
    nativeBypassPendingRef.current += 1;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/document`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo cargar la composición.");
      const nextPayload = body.data as DocumentPayload;
      nextPayload.documentHash = resolveCompositionDocumentVersion(nextPayload.documentHash);
      if (extractionReceipt && !acceptsNarrativeExtractionReload(nextPayload.document, nextPayload.documentHash, extractionReceipt)) {
        throw new Error("El documento recargado no acredita el lote completo de extracción. Se conserva el comando pendiente.");
      }
      if (historyCommand && historyCommand.beforePayload.documentHash !== nextPayload.documentHash
        && (!historyCommand.expectedAfterHash || historyCommand.expectedAfterHash === nextPayload.documentHash)) {
        commandHistoryRef.current?.record({
          afterDocument: nextPayload.document,
          beforeDocument: historyCommand.beforePayload.document,
          source: historyCommand.source,
          summary: historyCommand.summary,
        });
      } else if (!historyCommand || (historyCommand.expectedAfterHash && historyCommand.expectedAfterHash !== nextPayload.documentHash)) {
        commandHistoryRef.current?.clear();
      }
      syncCommandHistoryState();
      recoveryAttemptedEntryRef.current = null;
      setRecoveryConflict(null);
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      adoptSavedPreviewRevision(nextPayload.documentHash);
      setSeconds(0);
      playheadSecondsRef.current = 0;
      pendingPreviewRestoreSecondsRef.current = null;
      setPlaying(false);
      setPreviewReady(false);
      setPlaybackError(null);
      comparisonBaselineReadyRef.current = false;
      setComparisonActive(false);
      setComparisonBaselineHash(null);
      setComparisonBaselineLoading(false);
      setSelectedHfId(historyCommand?.selectedClipId ? nextPayload.document.clips.find(clip => clip.id === historyCommand.selectedClipId)?.hfId ?? null : null);
      setSelectedAnimationId(null);
      setSelectedTimelineClipIds(new Set());
      setSelectedTimelineGroupId(null);
      setEditingTimelineGroupId(null);
      setSelectedTransitionId(null);
      setManualInspectorOpen(false);
      setRemovalRangeStart(null);
      setHistory(null);
      resetAgentProposalState();
      setLastAppliedPreset(null);
      void loadRecoverablePresetApplication();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar la composición.");
      return false;
    } finally {
      nativeBypassPendingRef.current -= 1;
      setLoading(false);
    }
  }, [adoptSavedPreviewRevision, draftId, loadRecoverablePresetApplication, resetAgentProposalState, syncCommandHistoryState]);

  useEffect(() => narrativeExtractionHost?.registerOwner({
    canApply: () => Boolean(payloadRef.current && !htmlEditorialContextRef.current.blockingWork
      && !htmlEditorialHostRef.current?.isBusy() && !nativeBypassPendingRef.current
      && !saveInFlightRef.current && !presetWritePendingRef.current
      && saveQueueRef.current?.snapshot().status === "IDLE"),
    beforeApply: () => { narrativeExtractionBeforeRef.current = payloadRef.current ? structuredClone(payloadRef.current) : null; },
    reloadDocument: async receipt => {
      const { anchorClipId: selectedClipId, documentHash: expectedAfterHash } = receipt;
      const beforePayload = narrativeExtractionBeforeRef.current;
      const loaded = await loadDocument(beforePayload ? { beforePayload, expectedAfterHash, selectedClipId,
        source: "USER", summary: receipt.kind === "AUDIOVISUAL" ? "Extrajo un fragmento audiovisual al final de la composición."
          : "Extrajo una copia de voz al final de la composición." } : undefined, receipt);
      if (loaded) {
        narrativeExtractionBeforeRef.current = null;
        const extractedClip = payloadRef.current?.document.clips.find(clip => clip.id === selectedClipId);
        if (extractedClip) setSelectedHfId(extractedClip.hfId);
      }
      return loaded;
    },
  }), [narrativeExtractionHost?.registerOwner, loadDocument]);

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

  const loadSnapshotHistory = useCallback(async (signal?: AbortSignal, options?: {preserveRenderProfile?:boolean}) => {
    if (options?.preserveRenderProfile) setSnapshotHistory(null);
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
    if (activeSnapshot && !options?.preserveRenderProfile) {
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
    const currentPayload = payloadRef.current;
    if (!currentPayload || currentPayload.documentHash !== payload?.documentHash || saving) return;
    let resolution: ReturnType<typeof resolveCompositionRecovery>;
    try {
      resolution = resolveCompositionRecovery(window.localStorage, draftId, currentPayload.documentHash);
    } catch {
      return;
    }
    if (resolution.status === "NONE") return;
    if (resolution.status === "ALREADY_COMMITTED") {
      try {
        clearCompositionRecoveryEntry(window.localStorage, draftId, resolution.entry.entryId);
      } catch {
        return;
      }
      recoveryAttemptedEntryRef.current = resolution.entry.entryId;
      toast.info("El último cambio interrumpido ya estaba guardado.");
      return;
    }
    if (resolution.status === "CONFLICT") {
      recoveryAttemptedEntryRef.current = resolution.entry.entryId;
      setRecoveryConflict(resolution.entry);
      return;
    }
    if (recoveryAttemptedEntryRef.current === resolution.entry.entryId) return;
    recoveryAttemptedEntryRef.current = resolution.entry.entryId;
    void savePatchRef.current?.(
      resolution.entry.operations,
      resolution.entry.summary,
      resolution.entry.source,
      { historyMode: "RECORD", recoveryEntryId: resolution.entry.entryId, skipRecoveryJournal: true },
    ).then((recovered) => {
      if (recovered) toast.success("Se recuperó y guardó el último cambio interrumpido.");
    });
  }, [draftId, payload?.documentHash, saving]);
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
    const executeShortcut = (command: CompositionEditorShortcut) => {
      if (command === "PALETTE") { setCommandPaletteOpen(true); return; }
      if (command === "UNDO") { void undoLastEditRef.current?.(); return; }
      if (command === "REDO") { void redoLastEditRef.current?.(); return; }
      if (command === "PASTE") { if (timelineClipboardRef.current) void pasteTimelineClipboardRef.current?.(); return; }
      if (!selectedTimelineClipIdsRef.current.size) return;
      if (command === "DUPLICATE") { void duplicateTimelineSelectionRef.current?.(); return; }
      if (command === "COPY") { copyTimelineSelectionRef.current?.(); return; }
      if (command === "DELETE" || command === "RIPPLE_DELETE") {
        void deleteTimelineSelectionRef.current?.(command === "RIPPLE_DELETE"); return;
      }
      const timelineCommand = resolveCompositionTimelineKeyboardCommand({ altKey: true, ctrlKey: false, metaKey: false,
        key: command === "TIMELINE_LEFT" ? "ArrowLeft" : "ArrowRight", frameStep: timelineFrameStepRef.current,
        hasSelection: true, mode: timelineKeyboardEditModeRef.current });
      if (timelineCommand?.type === "SLIDE") void slideTimelineSelectionRef.current?.(timelineCommand.deltaFrames);
      else if (timelineCommand) void rollTimelineSelectionRef.current?.(timelineCommand.edge, timelineCommand.deltaFrames);
    };
    executeEditorShortcutRef.current = executeShortcut;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && (target.isContentEditable || target.closest('[role="dialog"], [aria-modal="true"]')))) return;
      const command = resolveCompositionEditorShortcut(event);
      if (!command) return;
      if (["DELETE", "RIPPLE_DELETE", "COPY", "DUPLICATE", "TIMELINE_LEFT", "TIMELINE_RIGHT"].includes(command)
        && !selectedTimelineClipIdsRef.current.size) return;
      if (command === "PASTE" && !timelineClipboardRef.current) return;
      event.preventDefault();
      executeShortcut(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { executeEditorShortcutRef.current = null; window.removeEventListener("keydown", onKeyDown); };
  }, []);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const isCurrentFrame = event.source === frameRef.current?.contentWindow;
      const isComparisonBaselineFrame = event.source === comparisonBaselineFrameRef.current?.contentWindow;
      if (!isCurrentFrame && !isComparisonBaselineFrame) return;
      const message = parseCompositionPreviewIframeMessage(event.data);
      if (!message) return;
      if (message.type === "courseforge-composition-shortcut") {
        if (!acceptsCompositionPreviewShortcut({ currentFrame: isCurrentFrame,
          messageGeneration: message.previewGeneration, currentGeneration: previewGenerationRef.current,
          ready: previewReadyRef.current, focused: document.hasFocus() && document.activeElement === frameRef.current,
          modalOpen: Boolean(document.querySelector('[role="dialog"], [aria-modal="true"]')),
          previewOnly: Boolean(agentProposal || presetPreview), saving: isSaveInFlight() })) return;
        executeEditorShortcutRef.current?.(message.command);
        return;
      }
      const messageDecision = classifyCompositionPreviewMessage({
        documentHash: previewDocumentHashRef.current,
        generation: previewGenerationRef.current,
        failedGeneration: failedPreviewGenerationRef.current,
        message,
        strictSync: isCurrentFrame && COMPOSITION_PREVIEW_SYNC_V2_ENABLED && !presetPreview && !agentProposal,
      });
      if (!messageDecision.accept) {
        if (messageDecision.outcome) previewTelemetryRef.current?.record({
          atSeconds: playheadSecondsRef.current,
          context: { syncOutcome: messageDecision.outcome },
          durationMs: 0,
          name: "preview_sync_event",
        });
        return;
      }
      if (messageDecision.runtimeSignal) {
        previewRuntimeSignalGenerationRef.current = previewGenerationRef.current;
        if (previewRuntimeHandshakeTimerRef.current) clearTimeout(previewRuntimeHandshakeTimerRef.current);
        previewRuntimeHandshakeTimerRef.current = null;
      }
      if (isComparisonBaselineFrame) {
        if (message.type === "courseforge-composition-ready") {
          comparisonBaselineReadyRef.current = true;
          setComparisonBaselineLoading(false);
          postComparisonBaselineMessage({
            editingEnabled: false,
            cropEnabled: false,
            gridVisible,
            snapEnabled: false,
            type: "courseforge-composition-editor-settings",
          });
          postComparisonBaselineMessage({ type: "courseforge-composition-seek", seconds: playheadSecondsRef.current });
          if (playing) postComparisonBaselineMessage({ type: "courseforge-composition-play" });
        }
        return;
      }
      if (message.type === "courseforge-composition-visual-patch-result") {
        runtimePatchCoordinatorRef.current?.acknowledge(message);
        return;
      }
      if (message.type === "courseforge-composition-audio-meter") {
        setAudioMeterMessage(message);
        return;
      }
      if (message.type === "courseforge-composition-load-error") {
        if (!COMPOSITION_PREVIEW_SYNC_V2_ENABLED || presetPreview || agentProposal
          || !shouldReportCompositionPreviewReadyTimeout({
            expectedDocumentHash: message.documentHash,
            previewReady: previewReadyRef.current,
            state: previewSyncStateRef.current,
          })) return;
        if (previewRuntimeHandshakeTimerRef.current) clearTimeout(previewRuntimeHandshakeTimerRef.current);
        previewRuntimeHandshakeTimerRef.current = null;
        commitTerminalPreviewFailure({
          code: message.code,
          message: resolveCompositionPreviewLoadErrorPresentation(message.code)?.message || "No se pudo cargar el preview.",
          outcome: message.code === "AUTH_REQUIRED" || message.code === "ACCESS_DENIED" ? message.code : "PREVIEW_LOAD_FAILED",
        });
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
        const narrativeRange = narrativeRangePlaybackRef.current;
        if (narrativeRange && shouldStopNarrativeRangePreview(narrativeRange, payloadRef.current?.documentHash || null, message.seconds)) {
          narrativeRangeStopRef.current();
        }
        if (comparisonActive && comparisonBaselineReadyRef.current) {
          postComparisonBaselineMessage({ type: "courseforge-composition-seek", seconds: message.seconds });
        }
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
        if (comparisonBaselineReadyRef.current) {
          postComparisonBaselineMessage({ type: message.playing ? "courseforge-composition-play" : "courseforge-composition-pause" });
        }
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
        if (previewRuntimeHandshakeTimerRef.current) clearTimeout(previewRuntimeHandshakeTimerRef.current);
        previewRuntimeHandshakeTimerRef.current = null;
        previewReadyRef.current = true;
        if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED && !presetPreview && !agentProposal && readyDocumentHash) {
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
        setPreviewLoadErrorCode(null);
        setFailedPreviewMediaIds([]);
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
        setFailedPreviewMediaIds((current) => current.includes(message.mediaId) ? current : [...current, message.mediaId]);
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
          advancePreviewGeneration();
          return;
        }
        if (COMPOSITION_PREVIEW_SYNC_V2_ENABLED) {
          commitTerminalPreviewFailure({
            message: `No se pudo reproducir ${message.mediaId}: ${message.message}`,
            outcome: "RUNTIME_FAILED",
          });
          return;
        }
        setPlaybackError(`No se pudo reproducir ${message.mediaId}: ${message.message}`);
      }
      if (message.type === "courseforge-composition-color-grading-status") {
        setColorGradingStatuses((current) => ({
          ...current,
          [message.hfId]: { message: message.message, state: message.state },
        }));
      }
      if (message.type === "courseforge-composition-selection") {
        setSelectedHfId(message.hfId);
        const selectionDecision = resolveCompositionPreviewSelectionEvent({
          clips: payload?.document.clips || [],
          hfId: message.hfId,
          hfIds: message.hfIds,
          origin: message.origin,
        });
        if (selectionDecision.nextClipIds !== null) {
          setSelectedTimelineClipIds(new Set(selectionDecision.nextClipIds));
          setSelectedAnimationId(null);
          setManualInspectorOpen(Boolean(message.hfId));
        }
        if (selectionDecision.shouldClearGroup) setSelectedTimelineGroupId(null);
        if (selectionDecision.shouldOpenProperties) {
          setSelectedAnimationId(null);
          setManualInspectorOpen(true);
          setInspectorTab("properties");
        }
        if (selectionDecision.shouldOpenSelection) {
          setSelectedAnimationId(null);
          setManualInspectorOpen(true);
          setInspectorTab("selection");
        }
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
  }, [agentProposal, commitTerminalPreviewFailure, comparisonActive, gridVisible, payload, playing, presetPreview, snapEnabled]);

  const duration = payload?.document.canvas.durationSeconds || 0;
  const transportActive = playing || previewMediaState === "BUFFERING";
  const durationSourceLabel = payload?.document.canvas.durationSource
    ? DURATION_SOURCE_LABELS[payload.document.canvas.durationSource]
    : null;
  const savedPreviewUrl = useMemo(() => {
    if (!payload || !previewDocumentHash) return null;
    return buildCompositionSavedPreviewUrl({
      draftId,
      documentHash: previewDocumentHash,
      refreshKey: previewRefreshKey,
      strictSyncEnabled: COMPOSITION_PREVIEW_SYNC_V2_ENABLED,
    });
  }, [draftId, payload, previewDocumentHash, previewRefreshKey]);
  const comparisonBaselineUrl = useMemo(() => comparisonBaselineHash
    ? buildCompositionComparisonPreviewUrl({ draftId, documentHash: comparisonBaselineHash })
    : null, [comparisonBaselineHash, draftId]);
  const previewUrl = presetPreview
    ? `/api/production/hyperframes/drafts/${draftId}/preset-applications/${presetPreview.applicationId}/preview`
    : agentProposal
      ? `/api/production/hyperframes/drafts/${draftId}/agent-proposals/${agentProposal.proposalId}/preview`
      : savedPreviewUrl;
  const reportPreviewNavigationFailure = (syncOutcome: "PREVIEW_IFRAME_ERROR" | "PREVIEW_LOADED_NO_RUNTIME", message: string) => {
    if (!COMPOSITION_PREVIEW_SYNC_V2_ENABLED || !savedPreviewUrl || previewUrl !== savedPreviewUrl) return;
    const expectedDocumentHash = previewDocumentHashRef.current;
    const expectedGeneration = readCompositionPreviewGeneration(savedPreviewUrl);
    if (!expectedDocumentHash || expectedGeneration === null
      || previewGenerationRef.current !== expectedGeneration
      || !shouldReportCompositionPreviewRuntimeHandshakeFailure({
        expectedDocumentHash,
        expectedGeneration,
        frameGeneration: readCompositionPreviewGeneration(frameRef.current?.src || ""),
        observedRuntimeGeneration: previewRuntimeSignalGenerationRef.current,
        previewReady: previewReadyRef.current,
        state: previewSyncStateRef.current,
      })) return;
    commitTerminalPreviewFailure({ message, outcome: syncOutcome });
  };
  const onPreviewFrameLoad = () => {
    if (!COMPOSITION_PREVIEW_SYNC_V2_ENABLED || !savedPreviewUrl || previewUrl !== savedPreviewUrl
      || previewRuntimeSignalGenerationRef.current === previewGenerationRef.current) return;
    if (previewRuntimeHandshakeTimerRef.current) clearTimeout(previewRuntimeHandshakeTimerRef.current);
    previewRuntimeHandshakeTimerRef.current = setTimeout(() => {
      previewRuntimeHandshakeTimerRef.current = null;
      reportPreviewNavigationFailure("PREVIEW_LOADED_NO_RUNTIME", "El iframe cargó, pero no inició el preview. Reintenta cargarlo.");
    }, COMPOSITION_PREVIEW_DOCUMENT_READY_CONFIG.runtimeHandshakeAfterLoadMs);
  };
  const onPreviewFrameError = () => {
    if (previewRuntimeHandshakeTimerRef.current) clearTimeout(previewRuntimeHandshakeTimerRef.current);
    previewRuntimeHandshakeTimerRef.current = null;
    reportPreviewNavigationFailure("PREVIEW_IFRAME_ERROR", "No se pudo navegar al preview. Comprueba tu conexión y reintenta.");
  };
  useEffect(() => () => {
    if (previewRuntimeHandshakeTimerRef.current) clearTimeout(previewRuntimeHandshakeTimerRef.current);
    previewRuntimeHandshakeTimerRef.current = null;
  }, [previewUrl]);
  useEffect(() => {
    comparisonBaselineReadyRef.current = false;
    if (comparisonBaselineUrl) setComparisonBaselineLoading(true);
  }, [comparisonBaselineUrl]);
  useEffect(() => {
    pendingSeekSecondsRef.current = null;
    setAudioMeterMessage(null);
    previewReadyRef.current = false;
    setPlaying(false);
    setPreviewReady(false);
    setPreviewMediaState("PREPARING");
    setPendingPreviewMediaIds([]);
    setColorGradingStatuses({});
    setPreviewLoadErrorCode(null);
    previewFocusRestoredRef.current = false;
  }, [previewUrl]);
  useEffect(() => {
    if (!COMPOSITION_PREVIEW_SYNC_V2_ENABLED || !savedPreviewUrl || previewUrl !== savedPreviewUrl) return;
    const expectedDocumentHash = previewDocumentHashRef.current;
    const expectedGeneration = readCompositionPreviewGeneration(savedPreviewUrl);
    if (!expectedDocumentHash || expectedGeneration === null) return;
    const timeout = setTimeout(() => {
      if (previewDocumentHashRef.current !== expectedDocumentHash
        || previewGenerationRef.current !== expectedGeneration
        || readCompositionPreviewGeneration(frameRef.current?.src || "") !== expectedGeneration
        || !shouldReportCompositionPreviewReadyTimeout({
        expectedDocumentHash,
        previewReady: previewReadyRef.current,
        state: previewSyncStateRef.current,
      })) return;
      commitTerminalPreviewFailure({
        message: "El preview no confirmó la versión guardada a tiempo. Reintenta cargarlo.",
        outcome: "PREVIEW_READY_TIMEOUT",
      });
    }, COMPOSITION_PREVIEW_DOCUMENT_READY_CONFIG.acknowledgementTimeoutMs);
    return () => clearTimeout(timeout);
  }, [commitTerminalPreviewFailure, previewUrl, savedPreviewUrl]);
  useEffect(() => {
    mediaRecoveryHashRef.current = null;
  }, [payload?.documentHash]);
  const estimatedClipCount = payload?.document.clips.filter((clip) => clip.timingSource === "ESTIMATED").length || 0;
  const selectedClip = payload?.document.clips.find((clip) => clip.hfId === selectedHfId) ?? null;
  const selectedClipSourceAssetId = selectedClip?.source.type === "PRODUCTION_ASSET" ? selectedClip.source.productionAssetId : null;
  const selectedClipSourceUnavailable = selectedClipSourceAssetId !== null && (
    !assets.some((asset) => asset.id === selectedClipSourceAssetId && asset.valid)
    || (selectedClip !== null && failedPreviewMediaIds.some((mediaId) => mediaId === selectedClip.id || mediaId === `${selectedClip.id}-media` || mediaId === `${selectedClip.id}-audio`))
  );
  const selectedSourceAssetId = selectedClip?.source.type === "PRODUCTION_ASSET"
    ? selectedClip.source.productionAssetId
    : null;
  const selectedSourcePreviewUrl = selectedSourceAssetId
    ? assets.find((asset) => asset.id === selectedSourceAssetId)?.previewUrl ?? null
    : null;
  const activeSelectedTransitionId = payload?.document.transitions?.items.some((transition) => transition.id === selectedTransitionId)
    ? selectedTransitionId
    : null;
  const inspectorOpen = manualInspectorOpen || Boolean(selectedClip) || selectedTimelineClipIds.size > 0 || Boolean(activeSelectedTransitionId);
  const previewStatusLabel = presetPreview
    ? "Preview de preset"
    : agentProposal
      ? "Propuesta sin guardar"
      : saving || (!previewReady && previewMediaState === "PREPARING")
        ? "Actualizando preview…"
        : previewDirty
          ? "Cambios pendientes"
          : null;

  const postPreviewMessage = useCallback((message: CompositionPreviewParentCommandInput) => {
    const command = createCompositionPreviewParentCommand(message);
    if (!command) return false;
    frameRef.current?.contentWindow?.postMessage(command, "*");
    return true;
  }, []);
  const postComparisonBaselineMessage = useCallback((message: CompositionPreviewParentCommandInput) => {
    const command = createCompositionPreviewParentCommand(message);
    if (!command) return false;
    comparisonBaselineFrameRef.current?.contentWindow?.postMessage(command, "*");
    return true;
  }, []);
  const stopNarrativeRangePreview = useCallback(() => {
    if (!narrativeRangePlaybackRef.current) return;
    narrativeRangePlaybackRef.current = null;
    if (narrativeRangeTimeoutRef.current !== null) clearTimeout(narrativeRangeTimeoutRef.current);
    narrativeRangeTimeoutRef.current = null;
    postPreviewMessage({ type: "courseforge-composition-pause" });
    if (comparisonBaselineReadyRef.current) postComparisonBaselineMessage({ type: "courseforge-composition-pause" });
  }, [postPreviewMessage, postComparisonBaselineMessage]);
  useEffect(() => {
    const range = narrativeRangePlaybackRef.current;
    if (range && (range.selection.documentHash !== payload?.documentHash || range.hfId !== selectedHfId
      || !libraryOpen || !previewReady || previewDirty || saving || agentProposal || presetPreview || comparisonActive)) stopNarrativeRangePreview();
  }, [payload?.documentHash, selectedHfId, libraryOpen, previewReady, previewDirty, saving, agentProposal, presetPreview, comparisonActive, stopNarrativeRangePreview]);
  useEffect(() => () => stopNarrativeRangePreview(), [stopNarrativeRangePreview]);
  useEffect(() => {
    if (!previewReady) return;
    postPreviewMessage({
      editingEnabled: directEditingEnabled && !agentProposal && !presetPreview && !saving && !isSaveInFlight(),
      cropEnabled: visualCropEnabled && !agentProposal && !presetPreview && !saving && !isSaveInFlight(),
      gridVisible,
      snapEnabled,
      type: "courseforge-composition-editor-settings",
    });
    if (comparisonBaselineReadyRef.current) {
      postComparisonBaselineMessage({
        editingEnabled: false,
        cropEnabled: false,
        gridVisible,
        snapEnabled: false,
        type: "courseforge-composition-editor-settings",
      });
    }
  }, [agentProposal, comparisonActive, directEditingEnabled, gridVisible, presetPreview, previewReady, saving, snapEnabled, visualCropEnabled, htmlEditorialBusy, isSaveInFlight]);
  useEffect(() => {
    if (previewReady) postPreviewMessage({ scale: previewZoom, type: "courseforge-composition-preview-zoom" });
    if (comparisonBaselineReadyRef.current) postComparisonBaselineMessage({ scale: previewZoom, type: "courseforge-composition-preview-zoom" });
  }, [previewReady, previewZoom]);
  useEffect(() => {
    if (!previewReady || !payload?.document) return;
    const hfIds = payload.document.clips
      .filter((clip) => selectedTimelineClipIds.has(clip.id))
      .map((clip) => clip.hfId)
      .slice(0, 100);
    const primaryHfId = selectedHfId && hfIds.includes(selectedHfId)
      ? selectedHfId
      : hfIds.at(-1) || null;
    postPreviewMessage({ hfId: primaryHfId, hfIds, type: "courseforge-composition-select" });
    if (!previewFocusRestoredRef.current) {
      previewFocusRestoredRef.current = true;
      if (document.hasFocus() && document.activeElement === frameRef.current) {
        postPreviewMessage({ hfId: primaryHfId, type: "courseforge-composition-restore-focus" });
      }
    }
  }, [payload?.document, previewReady, selectedHfId, selectedTimelineClipIds]);
  useEffect(() => {
    const syncFullscreenState = () => setPreviewFullscreen(document.fullscreenElement === previewShellRef.current);
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);
  const refreshPreviewMedia = () => {
    const errorAction = resolveCompositionPreviewLoadErrorPresentation(previewLoadErrorCode)?.action;
    if (errorAction === "LOGIN") {
      window.location.assign("/login?error=session_expired");
      return;
    }
    if (errorAction === "NONE") return;
    if (errorAction === "RELOAD_EDITOR") {
      void loadDocument();
      return;
    }
    mediaRecoveryHashRef.current = null;
    refreshPreviewDocument(false, "MEDIA_RECOVERY");
    setPlaybackError("Renovando el acceso a los medios del preview…");
  };
  const seek = (nextSeconds: number) => {
    stopNarrativeRangePreview();
    pendingSeekSecondsRef.current = nextSeconds;
    playheadSecondsRef.current = nextSeconds;
    setSeconds(nextSeconds);
    postPreviewMessage({ type: "courseforge-composition-seek", seconds: nextSeconds });
    if (comparisonBaselineReadyRef.current) postComparisonBaselineMessage({ type: "courseforge-composition-seek", seconds: nextSeconds });
  };
  const beginScrub = () => {
    stopNarrativeRangePreview();
    postPreviewMessage({ type: "courseforge-composition-pause" });
    if (comparisonBaselineReadyRef.current) postComparisonBaselineMessage({ type: "courseforge-composition-pause" });
    setPlaying(false);
  };
  const selectClip = (hfId: string, preserveTimelineSelection = false) => {
    stopNarrativeRangePreview();
    const nextClip = payloadRef.current?.document.clips.find((clip) => clip.hfId === hfId);
    if (removalRangeStart && nextClip?.id !== removalRangeStart.clipId) setRemovalRangeStart(null);
    if (!preserveTimelineSelection) {
      setSelectedTimelineClipIds(nextClip ? new Set([nextClip.id]) : new Set());
      setSelectedTimelineGroupId(null);
      setEditingTimelineGroupId(null);
    }
    setSelectedHfId(hfId);
    setSelectedAnimationId(null);
    setManualInspectorOpen(true);
    setInspectorTab("properties");
    postPreviewMessage({ type: "courseforge-composition-select", hfId });
  };
  const selectAnimation = (animationId: string, clipHfId: string) => {
    selectClip(clipHfId, true);
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
    else {
      postPreviewMessage({ type: "courseforge-composition-play" });
      if (comparisonBaselineReadyRef.current) postComparisonBaselineMessage({ type: "courseforge-composition-play" });
    }
  };
  const previewNarrativeRange = (selection: NarrativeRangeSelection): boolean => {
    const currentPayload = payloadRef.current;
    if (!currentPayload || !frameRef.current?.contentWindow || !previewReadyRef.current || previewDirty || saving
      || agentProposal || presetPreview || comparisonActive
      || previewDocumentHashRef.current !== currentPayload.documentHash) return false;
    const resolution = resolveNarrativeRangePreview(currentPayload.document, currentPayload.documentHash, selection);
    if (!resolution.ok) return false;
    beginScrub();
    selectClip(resolution.range.hfId);
    seek(resolution.range.startSeconds);
    animationPlaybackEndRef.current = null;
    narrativeRangePlaybackRef.current = resolution.range;
    narrativeRangeTimeoutRef.current = setTimeout(stopNarrativeRangePreview,
      (resolution.range.endSeconds - resolution.range.startSeconds) * 1_000 + NARRATIVE_RANGE_PREVIEW_TIMEOUT_MARGIN_MS);
    postPreviewMessage({ type: "courseforge-composition-play" });
    return true;
  };
  const clearSelection = () => {
    setSelectedHfId(null);
    setSelectedAnimationId(null);
    setSelectedTimelineClipIds(new Set());
    setSelectedTimelineGroupId(null);
    setEditingTimelineGroupId(null);
    setSelectedTransitionId(null);
    setManualInspectorOpen(false);
    postPreviewMessage({ type: "courseforge-composition-select", hfId: null });
  };
  const openCompositionLibrary = () => {
    setLibraryOpen(true);
    comparisonBaselineReadyRef.current = false;
    setComparisonActive(false);
    setComparisonBaselineHash(null);
    setComparisonBaselineLoading(false);
  };
  const inspectTimelineSelection = () => {
    setManualInspectorOpen(true);
    setInspectorTab("selection");
  };
  const selectTransition = (transitionId: string | null) => {
    setSelectedTransitionId(transitionId);
    if (!transitionId) return;
    setManualInspectorOpen(true);
    setInspectorTab("transitions");
  };
  const createTimelineGroup = () => {
    const currentDocument = payloadRef.current?.document;
    if (!currentDocument) return;
    const clipIds = [...selectedTimelineClipIds];
    const groupedClipIds = new Set((currentDocument.groups || []).flatMap((group) => group.clipIds));
    if (clipIds.length < 2 || clipIds.some((clipId) => groupedClipIds.has(clipId))) return;
    void savePatch([{ clipIds, groupId: `group-${crypto.randomUUID()}`, type: "group.create" }], `Agrupó ${clipIds.length} clips del timeline.`);
  };
  const enterTimelineGroup = () => {
    const currentDocument = payloadRef.current?.document;
    const group = currentDocument?.groups?.find((candidate) => candidate.id === selectedTimelineGroupId);
    if (!currentDocument || !group) return;
    const firstClip = currentDocument.clips.find((clip) => group.clipIds.includes(clip.id));
    setEditingTimelineGroupId(group.id);
    setSelectedTimelineGroupId(null);
    if (!firstClip) return;
    setSelectedTimelineClipIds(new Set([firstClip.id]));
    selectClip(firstClip.hfId, true);
  };
  const exitTimelineGroup = () => {
    const currentDocument = payloadRef.current?.document;
    const group = currentDocument?.groups?.find((candidate) => candidate.id === editingTimelineGroupId);
    if (!currentDocument || !group) return;
    const firstClip = currentDocument.clips.find((clip) => group.clipIds.includes(clip.id));
    setEditingTimelineGroupId(null);
    setSelectedTimelineGroupId(group.id);
    setSelectedTimelineClipIds(new Set(group.clipIds));
    if (firstClip) selectClip(firstClip.hfId, true);
    inspectTimelineSelection();
  };
  const ungroupTimelineSelection = () => {
    const currentDocument = payloadRef.current?.document;
    const group = currentDocument?.groups?.find((candidate) => candidate.id === selectedTimelineGroupId);
    if (!currentDocument || !group) return;
    const firstClip = currentDocument.clips.find((clip) => group.clipIds.includes(clip.id));
    void savePatch([{ groupId: group.id, type: "group.ungroup" }], "Desagrupó los clips seleccionados.");
    setSelectedTimelineGroupId(null);
    setEditingTimelineGroupId(null);
    setSelectedTimelineClipIds(firstClip ? new Set([firstClip.id]) : new Set());
    if (firstClip) selectClip(firstClip.hfId, true);
  };
  const pausePreviewForMutation = () => {
    previewReadyRef.current = false;
    pendingPreviewRestoreSecondsRef.current = playheadSecondsRef.current;
    pendingSeekSecondsRef.current = null;
    postPreviewMessage({ type: "courseforge-composition-pause" });
    if (comparisonBaselineReadyRef.current) postComparisonBaselineMessage({ type: "courseforge-composition-pause" });
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
    advancePreviewGeneration();
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
    stopNarrativeRangePreview();
    if (transportActive) {
      postPreviewMessage({ type: "courseforge-composition-pause" });
      if (comparisonBaselineReadyRef.current) postComparisonBaselineMessage({ type: "courseforge-composition-pause" });
      return;
    }
    const currentHash = payloadRef.current?.documentHash || null;
    if (isPreviewRefreshRequired({ persistedDocumentHash: currentHash, previewDirty, previewDocumentHash: previewDocumentHashRef.current })) {
      refreshPreviewDocument(true, "DIRTY_PLAYBACK");
      return;
    }
    postPreviewMessage({ type: "courseforge-composition-play" });
    if (comparisonBaselineReadyRef.current) postComparisonBaselineMessage({ type: "courseforge-composition-play" });
  };
  const toggleComparison = () => {
    if (comparisonActive) {
      comparisonBaselineReadyRef.current = false;
      setComparisonActive(false);
      setComparisonBaselineHash(null);
      setComparisonBaselineLoading(false);
      setToolMenuOpen(false);
      return;
    }
    const currentPayload = payloadRef.current;
    if (!currentPayload || saving) return;
    comparisonBaselineReadyRef.current = false;
    setComparisonBaselineHash(currentPayload.documentHash);
    setComparisonBaselineLoading(true);
    setComparisonActive(true);
    setLibraryOpen(false);
    setToolMenuOpen(false);
  };
  function savePatch(
    operations: CompositionEditorPatchOperation[],
    summary: string,
    source: "AGENT" | "USER" = "USER",
    options: SavePatchOptions = {},
  ): Promise<boolean> {
    if (htmlEditorialHostRef.current?.isBlocked() || narrativeExtractionHost?.isBlocked()) return Promise.resolve(false);
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
    let recoveryEntryId = options.recoveryEntryId;
    if (!options.skipRecoveryJournal) {
      try {
        const recoveryEntry = await createCompositionRecoveryEntry({
          baseDocumentHash: currentPayload.documentHash,
          draftId,
          operations: effectiveOperations,
          source,
          summary,
          targetDocument: optimisticDocument,
        });
        writeCompositionRecoveryEntry(window.localStorage, recoveryEntry);
        recoveryEntryId = recoveryEntry.entryId;
      } catch (recoveryError) {
        console.warn("[CompositionRecovery] No se pudo registrar el cambio pendiente.", recoveryError);
      }
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
    const runtimePatchGeneration = previewGenerationRef.current;
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
        if (canCommitCompositionPreviewRuntimePatch({
          applied: runtimeOutcome.applied,
          dispatchedGeneration: runtimePatchGeneration,
          currentGeneration: previewGenerationRef.current,
          failedGeneration: failedPreviewGenerationRef.current,
        })) {
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
          previewTelemetryRef.current?.record({
            atSeconds: playheadSecondsRef.current,
            context: { syncOutcome: "VISUAL_PATCH_FAILED" },
            durationMs: 0,
            name: "preview_sync_event",
          });
          setPreviewDirty(true);
          if (failedPreviewGenerationRef.current !== previewGenerationRef.current) {
            refreshPreviewDocument(false, "SAVE_RECOVERY");
          }
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
      if ((options.historyMode || "RECORD") === "RECORD") {
        commandHistoryRef.current?.record({
          afterDocument: nextPayload.document,
          beforeDocument: currentPayload.document,
          source,
          summary,
        });
        syncCommandHistoryState();
      }
      if (recoveryEntryId) {
        try {
          clearCompositionRecoveryEntry(window.localStorage, draftId, recoveryEntryId);
        } catch (recoveryError) {
          console.warn("[CompositionRecovery] El cambio se guardó, pero no se pudo limpiar el journal.", recoveryError);
        }
      }
      setRecoveryConflict(null);
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
        commandHistoryRef.current?.record({
          afterDocument: nextPayload.document,
          beforeDocument: currentPayload.document,
          source: "USER",
          summary: "Aplicó el preensamble narrativo.",
        });
        syncCommandHistoryState();
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

  async function addNativeOverlay(kind: NativeOverlayKind) {
    const currentPayload = payloadRef.current;
    if (!currentPayload) return;
    try {
      const prefix = kind === "CAPTION" ? "caption" : "text";
      const { clip, track } = createCompositionNativeOverlay({
        document: currentPayload.document,
        id: `${prefix}-${crypto.randomUUID()}`,
        kind,
        playheadSeconds: playheadSecondsRef.current,
      });
      const saved = await savePatch([{
        clip,
        clipId: clip.id,
        ...(track ? { track } : {}),
        type: "clip.add",
      }], kind === "CAPTION"
        ? "Añadió una capa de captions transparentes."
        : "Añadió una capa de texto nativo.");
      if (saved) selectClip(clip.hfId);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo crear la capa de texto.");
    }
  }

  async function generateTranscriptCaptions() {
    const currentPayload = payloadRef.current;
    if (!currentPayload) return;
    try {
      const scenes = deriveCompositionScenes(currentPayload.document);
      const plan = createCompositionTranscriptCaptionPlan({
        document: currentPayload.document,
        id: `caption-transcript-${crypto.randomUUID()}`,
        scenes,
      });
      const saved = await savePatch(
        plan.operations,
        plan.mode === "CREATE"
          ? `Generó ${plan.cueCount} captions desde la voz.`
          : `Actualizó ${plan.cueCount} captions desde la voz.`,
      );
      if (saved) {
        selectClip(plan.hfId);
        toast.success(`${plan.cueCount} captions sincronizados con la voz.`);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudieron generar captions desde la voz.");
    }
  }

  async function addAssetToTimeline(asset: CompositionStudioAsset) {
    const currentPayload = payloadRef.current;
    if (!currentPayload || !asset.isEditable) return;
    const baseClipId = asset.deckClip?.id || `asset-${asset.id}`;

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

    const trackDefinition = asset.deckClip
      ? { ...getCompositionTrackDefinition("DECK"), id: asset.deckClip.trackId, label: "HTML" }
      : resolveCompositionTrackDefinition(asset);
    const trackId = trackDefinition.id;
    const isAudio = trackDefinition.kind === "AUDIO";
    const isBackgroundAudio = trackDefinition.semanticRole === "MUSIC";
    const isSequential = !isBackgroundAudio;
    const preferredDuration = asset.durationSeconds || (isAudio ? currentPayload.document.canvas.durationSeconds : asset.mimeType.startsWith("image/") ? 5 : 8);
    const occupiedUntil = currentPayload.document.clips
      .filter((candidate) => candidate.trackId === trackId)
      .reduce((latest, candidate) => Math.max(latest, candidate.startSeconds + candidate.durationSeconds), 0);
    const appendTiming = currentPayload.document.sourceInsertionMode === "MANUAL"
      ? { startSeconds: Math.max(occupiedUntil, playheadSecondsRef.current), durationSeconds: preferredDuration, overlapsExistingClips: false }
      : resolveCompositionAssetInsertionTiming({
      canvasDurationSeconds: currentPayload.document.canvas.durationSeconds,
      extendCanvasForSequentialAsset: trackDefinition.semanticRole === "VOICE",
      isSequential,
      occupiedUntilSeconds: occupiedUntil,
      playheadSeconds: playheadSecondsRef.current,
      preferredDurationSeconds: preferredDuration,
    });
    const insertionTiming = assetInsertionMode === "APPEND"
      ? appendTiming
      : {
          durationSeconds: preferredDuration,
          overlapsExistingClips: false,
          startSeconds: Math.max(0, playheadSecondsRef.current),
        };
    const clipKind: CompositionClip["kind"] = asset.deckClip ? "DECK_SLIDE" : isAudio ? "AUDIO" : asset.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE";
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
      source: asset.deckClip?.source || {
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
    let placementOperations: CompositionEditorPatchOperation[];
    let coordinatedRemovedClipCount = 0;
    try {
      const placementPlan = buildCompositionAssetPlacementEditPlan({
        clip,
        document: currentPayload.document,
        mode: assetInsertionMode,
        // The patch service ignores this when the track already exists and uses
        // it when the latest server version no longer contains that track.
        track: trackDefinition,
      });
      placementOperations = placementPlan.operations;
      coordinatedRemovedClipCount = placementPlan.coordinatedRemovedClipIds.length;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo colocar el asset en la línea de tiempo.");
      return;
    }
    if (assetInsertionMode === "OVERWRITE") {
      const coordinatedWarning = coordinatedRemovedClipCount > 0
        ? ` También retirará ${coordinatedRemovedClipCount} clip${coordinatedRemovedClipCount === 1 ? "" : "s"} vinculado${coordinatedRemovedClipCount === 1 ? "" : "s"} o agrupado${coordinatedRemovedClipCount === 1 ? "" : "s"} en otras pistas.`
        : "";
      if (!window.confirm(`Sobrescribir reemplazará el contenido de ${formatCompositionTimecode(clip.startSeconds)} a ${formatCompositionTimecode(clip.startSeconds + clip.durationSeconds)} en la pista ${trackDefinition.label}.${coordinatedWarning} Los assets fuente no se eliminarán. ¿Continuar?`)) return;
    }
    const added = await savePatch(placementOperations, assetInsertionMode === "INSERT"
      ? `Insertó ${asset.label} en el cursor y desplazó el contenido posterior.`
      : assetInsertionMode === "OVERWRITE"
        ? `Sobrescribió el intervalo del cursor con ${asset.label}${coordinatedRemovedClipCount > 0 ? ` y retiró ${coordinatedRemovedClipCount} clips coordinados` : ""}.`
        : trackDefinition.semanticRole === "VOICE"
          ? `Agregó ${asset.label} al final y extendió la duración del video.`
          : insertionTiming.overlapsExistingClips
            ? `Agregó ${asset.label} a la línea de tiempo en una subfila superpuesta.`
            : `Agregó ${asset.label} a la línea de tiempo.`);
    if (added) selectClip(clip.hfId);
  }

  async function replaceSelectedClipSource(asset: CompositionStudioAsset) {
    const document = payloadRef.current?.document;
    const clip = document?.clips.find((candidate) => candidate.hfId === selectedHfId);
    if (!document || !clip || selectedTimelineClipIds.size > 1 || clip.source.type !== "PRODUCTION_ASSET") return;
    const track = document.tracks.find((candidate) => candidate.id === clip.trackId);
    if (!track || track.locked || clip.source.placement || resolveAvatarAudioLink(document, clip.id).status !== "NONE" || asset.deckClip || !asset.isEditable || !asset.valid) {
      setSaveError("El clip o el medio seleccionado no admite reemplazo.");
      return;
    }
    if (!asset.mimeType.startsWith(`${clip.kind.toLowerCase()}/`) || clip.source.productionAssetId === asset.id) {
      setSaveError("Selecciona un medio distinto y del mismo tipo.");
      return;
    }
    if (clip.kind !== "IMAGE" && (!asset.durationSeconds || (clip.sourceOffsetSeconds || 0) + clip.durationSeconds > asset.durationSeconds + 0.001)) {
      setSaveError("El medio nuevo no cubre el recorte y la duración del clip.");
      return;
    }
    await savePatch([{
      clipId: clip.id,
      productionAssetId: asset.id,
      mimeType: asset.mimeType,
      ...(asset.durationSeconds ? { sourceDurationSeconds: asset.durationSeconds } : {}),
      ...(asset.hasAudio !== undefined ? { hasAudio: asset.hasAudio } : {}),
      ...(asset.sourceHeight ? { sourceHeight: asset.sourceHeight } : {}),
      ...(asset.sourceWidth ? { sourceWidth: asset.sourceWidth } : {}),
      type: "clip.replace-source",
    }], `Reemplazó el medio de ${clip.label} por ${asset.label} sin alterar timing ni layout.`);
  }

  async function linkAndInsertSoundEffect(soundEffect: SoundEffectCatalogItem) {
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

  async function detachAndInsertVideoAudio(clip: CompositionClip) {
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

  async function duplicateTimelineSelection() {
    const currentDocument = payloadRef.current?.document;
    if (!currentDocument || selectedTimelineClipIds.size === 0) return;
    try {
      const plan = buildCompositionDuplicateSelectionPlan({
        clipIds: selectedTimelineClipIds,
        document: currentDocument,
      });
      const duplicated = await savePatch(
        plan.operations,
        `Duplicó ${plan.duplicateClipIds.length} clip${plan.duplicateClipIds.length === 1 ? "" : "s"} con sus animaciones.`,
      );
      if (!duplicated) return;
      setSelectedTimelineClipIds(new Set(plan.duplicateClipIds));
      setSelectedTimelineGroupId(null);
      setEditingTimelineGroupId(null);
      const firstHfId = plan.duplicateHfIds[0];
      if (firstHfId) selectClip(firstHfId, true);
      setInspectorTab("selection");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo duplicar la selección.");
    }
  }

  function copyTimelineSelection() {
    if (saveInFlightRef.current || selectedTimelineClipIds.size === 0) return;
    try {
      const entry = createCompositionSelectionClipboardEntry({
        clipIds: selectedTimelineClipIds,
        compositionId,
      });
      timelineClipboardRef.current = entry;
      setTimelineClipboardCompositionId(compositionId);
      toast.success(`${entry.clipIds.length} clip${entry.clipIds.length === 1 ? "" : "s"} copiado${entry.clipIds.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo copiar la selección.");
    }
  }

  async function pasteTimelineClipboard() {
    const currentDocument = payloadRef.current?.document;
    if (!currentDocument || saveInFlightRef.current) return;
    let clipIds: readonly string[];
    try {
      clipIds = resolveCompositionSelectionClipboardEntry(timelineClipboardRef.current, { compositionId });
    } catch (error) {
      timelineClipboardRef.current = null;
      setTimelineClipboardCompositionId(null);
      setSaveError(error instanceof Error ? error.message : "El portapapeles de la composición no está disponible.");
      return;
    }
    try {
      const plan = buildCompositionDuplicateSelectionPlan({
        clipIds,
        destinationStartSeconds: playheadSecondsRef.current,
        document: currentDocument,
      });
      const pasted = await savePatch(
        plan.operations,
        `Pegó ${plan.duplicateClipIds.length} clip${plan.duplicateClipIds.length === 1 ? "" : "s"} en el playhead con sus animaciones.`,
      );
      if (!pasted) return;
      setSelectedTimelineClipIds(new Set(plan.duplicateClipIds));
      setSelectedTimelineGroupId(null);
      setEditingTimelineGroupId(null);
      const firstHfId = plan.duplicateHfIds[0];
      if (firstHfId) selectClip(firstHfId, true);
      setInspectorTab("selection");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo pegar la selección.");
    }
  }

  function runCompositionCommand(commandId: CompositionEditorCommandId) {
    executeCompositionEditorCommand({
      frameStep: timelineFrameStep,
      handlers: {
        align: (alignment) => void alignTimelineSelection(alignment, "CANVAS"),
        copy: copyTimelineSelection,
        delete: (ripple) => void deleteTimelineSelection(ripple),
        distribute: (axis) => void distributeTimelineSelection(axis),
        duplicate: () => void duplicateTimelineSelection(),
        openAssistant: () => { setManualInspectorOpen(true); setInspectorTab("assistant"); },
        openLibrary: openCompositionLibrary,
        openPresets: () => { setPresetPanelOpen(true); void loadCompositionPresets(); },
        paste: () => void pasteTimelineClipboard(),
        redo: () => void redoLastEdit(),
        roll: (edge, deltaFrames) => void rollTimelineSelection(edge, deltaFrames),
        slide: (deltaFrames) => void slideTimelineSelection(deltaFrames),
        toggleDirectEditing: () => setDirectEditingEnabled((current) => !current),
        toggleGrid: () => setGridVisible((current) => !current),
        toggleInspector: () => setManualInspectorOpen((current) => !current),
        toggleSafeAreas: () => setSafeAreasVisible((current) => !current),
        toggleSnap: () => setSnapEnabled((current) => !current),
        undo: () => void undoLastEdit(),
      },
      id: commandId,
    });
  }

  async function deleteTimelineSelection(ripple: boolean) {
    const currentDocument = payloadRef.current?.document;
    if (!currentDocument || selectedTimelineClipIds.size === 0) return;
    const selectedCount = selectedTimelineClipIds.size;
    const confirmation = ripple
      ? `Se eliminarán ${selectedCount} clip${selectedCount === 1 ? "" : "s"} y se cerrarán los huecos seguros en sus pistas. ¿Continuar?`
      : `Se eliminarán ${selectedCount} clip${selectedCount === 1 ? "" : "s"} de la línea de tiempo. ¿Continuar?`;
    if (!window.confirm(confirmation)) return;
    try {
      const plan = buildCompositionDeleteSelectionPlan({
        clipIds: selectedTimelineClipIds,
        document: currentDocument,
        ripple,
      });
      const deleted = await savePatch(
        plan.operations,
        ripple
          ? `Eliminó ${selectedCount} clips y cerró sus huecos en la línea de tiempo.`
          : `Eliminó ${selectedCount} clips de la línea de tiempo.`,
      );
      if (deleted) clearSelection();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo eliminar la selección.");
    }
  }

  async function alignTimelineSelection(
    alignment: CompositionSelectionAlignment,
    target: CompositionSelectionAlignmentTarget,
  ) {
    const currentDocument = payloadRef.current?.document;
    if (!currentDocument || selectedTimelineClipIds.size === 0) return;
    try {
      const plan = buildCompositionSelectionAlignmentPlan({
        alignment,
        clipIds: selectedTimelineClipIds,
        document: currentDocument,
        target,
      });
      await savePatch(
        plan.operations,
        `Alineó ${plan.visualClipCount} elemento${plan.visualClipCount === 1 ? "" : "s"} visual${plan.visualClipCount === 1 ? "" : "es"} ${target === "CANVAS" ? "al canvas" : "a la selección"}.`,
      );
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo alinear la selección.");
    }
  }

  async function distributeTimelineSelection(axis: CompositionSelectionDistributionAxis) {
    const currentDocument = payloadRef.current?.document;
    if (!currentDocument || selectedTimelineClipIds.size === 0) return;
    try {
      const plan = buildCompositionSelectionDistributionPlan({
        axis,
        clipIds: selectedTimelineClipIds,
        document: currentDocument,
      });
      await savePatch(
        plan.operations,
        `Distribuyó ${plan.visualClipCount} elementos visuales en el eje ${axis === "HORIZONTAL" ? "horizontal" : "vertical"}.`,
      );
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo distribuir la selección.");
    }
  }

  async function rollTimelineSelection(edge: "LEFT" | "RIGHT", deltaFrames: number, anchorClipId?: string) {
    const currentDocument = payloadRef.current?.document;
    const selectedClipId = anchorClipId || [...selectedTimelineClipIds][0];
    if (!currentDocument || !selectedClipId) return;
    const selectedClipIds = new Set(selectedTimelineClipIds);
    selectedClipIds.add(selectedClipId);
    try {
      const plan = buildCompositionRollEditPlan({
        deltaFrames,
        document: currentDocument,
        edge,
        selectedClipId,
        selectedClipIds,
      });
      await savePatch(
        plan.operations,
        `Ajustó ${edge === "LEFT" ? "la entrada" : "la salida"} de la selección ${deltaFrames > 0 ? "+" : ""}${deltaFrames} frame${Math.abs(deltaFrames) === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo ajustar el corte con roll.");
    }
  }

  async function slideTimelineSelection(deltaFrames: number, anchorClipId?: string) {
    const currentDocument = payloadRef.current?.document;
    const selectedClipId = anchorClipId || [...selectedTimelineClipIds][0];
    if (!currentDocument || !selectedClipId) return;
    const selectedClipIds = new Set(selectedTimelineClipIds);
    selectedClipIds.add(selectedClipId);
    try {
      const plan = buildCompositionSlideEditPlan({
        deltaFrames,
        document: currentDocument,
        selectedClipId,
        selectedClipIds,
      });
      await savePatch(
        plan.operations,
        `Deslizó la selección ${deltaFrames > 0 ? "+" : ""}${deltaFrames} frame${Math.abs(deltaFrames) === 1 ? "" : "s"} sin cambiar su duración.`,
      );
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo deslizar la selección.");
    }
  }

  async function undoLastEdit() {
    if (saving || saveQueueRef.current?.snapshot().status !== "IDLE" || presetBusy || agentProposal || presetPreview) return;
    const entry = commandHistoryRef.current?.peekUndo();
    if (!entry) return;
    const restored = await savePatch(
      [{ document: entry.beforeDocument, type: "document.restore" }],
      `Deshizo: ${entry.summary}`,
      "USER",
      { historyMode: "UNDO" },
    );
    if (!restored) return;
    commandHistoryRef.current?.commitUndo(entry.id);
    syncCommandHistoryState();
    clearSelection();
  }

  async function redoLastEdit() {
    if (saving || saveQueueRef.current?.snapshot().status !== "IDLE" || presetBusy || agentProposal || presetPreview) return;
    const entry = commandHistoryRef.current?.peekRedo();
    if (!entry) return;
    const restored = await savePatch(
      [{ document: entry.afterDocument, type: "document.restore" }],
      `Rehizo: ${entry.summary}`,
      "USER",
      { historyMode: "REDO" },
    );
    if (!restored) return;
    commandHistoryRef.current?.commitRedo(entry.id);
    syncCommandHistoryState();
    clearSelection();
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

  async function refreshNativeProductionAssets() {
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

  async function recoverNativeHistoricalAssets() {
    if (!componentId) return;
    setRecoveringHistoricalAssets(true);
    setSaveError(null);
    const beforePayload = payloadRef.current;
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
      await loadDocument(beforePayload ? {
        beforePayload,
        source: "SYSTEM",
        summary: "Sincronizó assets históricos con la composición.",
      } : undefined);
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

  async function placeNativeAssemblyBranding(outroAssetId?: string | null) {
    if (saving || saveInFlightRef.current) return;
    setSaving(true);
    setSaveError(null);
    const beforePayload = payloadRef.current;
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
      await loadDocument(beforePayload ? {
        beforePayload,
        source: "USER",
        summary: "Actualizó intro y outro de la composición.",
      } : undefined);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "No se pudo colocar el intro y outro.");
    } finally {
      setSaving(false);
    }
  }

  function getHtmlSnapshotPublicationContext() {
    const current=payloadRef.current;
    const queue=saveQueueRef.current?.snapshot();
    return {documentHash:current?.documentHash ?? null,hasHtmlEditing:Boolean(current?.document.htmlEditing?.items.length),
      snapshotHistoryLoaded:snapshotHistory !== null,expectedActiveRevisionId:assembly?.revisionId ?? null,
      renderProfileId:selectedRenderProfileId,saving:Boolean(saving || saveInFlightRef.current || htmlEditorialHostRef.current?.isBlocked() || queue?.pendingCount || queue?.status !== "IDLE"),
      otherWorkPending:Boolean(assembling || presetBusy || ["validating","sending","rendering"].includes(renderStatus)),
      previewPending:Boolean(previewDirty || saveError || agentProposal || presetPreview || comparisonActive)};
  }

  async function prepareNativeAssembly() {
    setAssembling(true); setAssemblyError(null); setAssemblyNotice(null); setRenderStatus("validating");
    try {
      const selectedProfile = getHyperframesRenderProfile(selectedRenderProfileId);
      const response = await fetch(`/api/production/hyperframes/compositions/${compositionId}/snapshot`, { body: JSON.stringify({ draftId, renderProfileId: selectedProfile.id }), headers: { "Content-Type": "application/json" }, method: "POST" });
      const body = await readCompositionApiResponse<{ data?: {
        conformance?: { checkpointCount: number; maxMismatchedPixelRatio: number; maxTemporalDriftFrames: number; schemaVersion: number };
        id: string;
        project_archive_size_bytes: number;
        reused?: boolean;
        revision_number?: number;
      }; error?: string }>(response, "No se pudo preparar el ensamble.");
      if (!response.ok) throw new Error(body.error || "No se pudo preparar el ensamble.");
      if (!body.data?.id) throw new Error("El servidor no devolvió el snapshot creado.");
      setAssembly({
        projectArchiveSizeBytes: Number(body.data.project_archive_size_bytes),
        renderProfile: toHyperframesRenderSettings(selectedProfile),
        revisionId: body.data.id,
        status: "READY_FOR_PREVIEW",
      });
      const conformanceLabel = body.data.conformance
        ? ` Contrato de conformidad v${body.data.conformance.schemaVersion}: ${body.data.conformance.checkpointCount} cuadros, tolerancia ${(body.data.conformance.maxMismatchedPixelRatio * 100).toFixed(2)}% y deriva máxima ${body.data.conformance.maxTemporalDriftFrames} frame.`
        : "";
      setAssemblyNotice((body.data.reused
        ? `El Snapshot ${body.data.revision_number || "activo"} ya coincide con el documento, los assets y el perfil. Se reutilizó sin volver a cargar el ZIP.`
        : `Snapshot ${body.data.revision_number || "nuevo"} creado y ZIP almacenado correctamente.`) + conformanceLabel);
      setRenderStatus("idle");
      await loadSnapshotHistory();
    } catch (caught) { setAssemblyError(caught instanceof Error ? caught.message : "No se pudo preparar el ensamble."); setRenderStatus("failed"); }
    finally { setAssembling(false); }
  }

  async function restoreNativeSnapshot(snapshot: CompositionSnapshotEntry) {
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
      commandHistoryRef.current?.record({
        afterDocument: restoredPayload.document,
        beforeDocument: currentPayload.document,
        source: "USER",
        summary: `Restauró el snapshot ${snapshot.revisionNumber}.`,
      });
      syncCommandHistoryState();
      payloadRef.current = restoredPayload;
      setPayload(restoredPayload);
      adoptSavedPreviewRevision(restoredPayload.documentHash);
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
  async function approveNativeAssembly() {
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

  async function submitNativeAssemblyRender(options: { forceNewAttempt?: boolean } = {}) {
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
          aspectRatio: resolveCompositionCanvasFormat(payload!.document.canvas),
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

  async function deleteNativePriorVideoAndRender() {
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

  savePatchRef.current = savePatch;
  narrativeRangeStopRef.current = stopNarrativeRangePreview;
  undoLastEditRef.current = undoLastEdit;
  redoLastEditRef.current = redoLastEdit;
  copyTimelineSelectionRef.current = copyTimelineSelection;
  pasteTimelineClipboardRef.current = pasteTimelineClipboard;
  duplicateTimelineSelectionRef.current = duplicateTimelineSelection;
  deleteTimelineSelectionRef.current = deleteTimelineSelection;
  rollTimelineSelectionRef.current = rollTimelineSelection;
  slideTimelineSelectionRef.current = slideTimelineSelection;

  if (loading) return <LoadingPreview />;
  if (error || !payload || !previewUrl) return <PreviewError error={error || "No hay composición disponible."} onRetry={() => void loadDocument()} />;

  const deliveryMenu = (
    <CompositionDeliveryPanel
      recovery={<CompositionHtmlSnapshotRecoveryPanel key={draftId} draftId={draftId}
        publication={{context:getHtmlSnapshotPublicationContext(),getContext:getHtmlSnapshotPublicationContext,
          onRegistered:signal => loadSnapshotHistory(signal,{preserveRenderProfile:true})}} />}
      canvas={payload?.document.canvas}
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
  const captionTranscriptWordCount = compositionScenes.reduce(
    (total, scene) => total + (scene.wordCues?.length || 0),
    0,
  );
  const activeSceneId = compositionScenes.find((scene) =>
    seconds >= scene.startSeconds && seconds < scene.startSeconds + scene.durationSeconds
  )?.id;
  const narrativeLibrary = compositionScenes.length > 0 ? (
    <CompositionNarrativePanel
      document={payload.document}
      documentHash={payload.documentHash}
      draftId={draftId}
      canPreviewRange={previewReady && !previewDirty && !saving && !agentProposal && !presetPreview && !comparisonActive}
      onPreviewRange={previewNarrativeRange}
      onStopRange={stopNarrativeRangePreview}
      scenes={compositionScenes}
      currentTime={seconds}
      onSeek={(time) => { beginScrub(); seek(time); }}
      onSelect={selectClip}
      applying={applyingPreassembly}
      onApply={() => void applyNarrativePreassembly()}
      onOpenSceneBuilder={openSceneBuilder}
    />
  ) : null;
  const canPasteTimelineClipboard = timelineClipboardCompositionId === compositionId;
  const commandPaletteItems = buildCompositionCommandPaletteItems({
    agentProposalActive: Boolean(agentProposal),
    canPaste: canPasteTimelineClipboard,
    canRedo: commandHistoryState.canRedo,
    canUndo: commandHistoryState.canUndo,
    directEditingEnabled,
    document: payload.document,
    frameStep: timelineFrameStep,
    gridVisible,
    inspectorAssistantActive: inspectorOpen && inspectorTab === "assistant",
    inspectorOpen,
    libraryOpen,
    presetsOpen: presetPanelOpen,
    safeAreasVisible,
    saving,
    selectedClipIds: selectedTimelineClipIds,
    snapEnabled,
  });

  return (
    <section className={`${styles.studio} courseforge-composition-studio`} inert={htmlEditorialBusy || narrativeExtractionHost?.busy} aria-busy={htmlEditorialBusy || narrativeExtractionHost?.busy}>
      {htmlEditorialHostRef.current && <CompositionHtmlRecoveryCenter draftId={draftId} host={htmlEditorialHostRef.current} />}
      {commandPaletteOpen && <CompositionCommandPalette items={commandPaletteItems} onClose={() => setCommandPaletteOpen(false)} onRun={runCompositionCommand} />}
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
      {recoveryConflict && (
        <CompositionRecoveryConflictNotice
          summary={recoveryConflict.summary}
          onDiscard={() => {
            try {
              clearCompositionRecoveryEntry(window.localStorage, draftId, recoveryConflict.entryId);
              setRecoveryConflict(null);
            } catch {
              setSaveError("El navegador no permitió descartar la copia local. Revisa el almacenamiento del sitio.");
            }
          }}
        />
      )}
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
        className={`${styles.editorGrid} ${!libraryOpen ? styles.editorGridWithoutLibrary : ""} ${inspectorOpen ? styles.editorGridWithInspector : ""}`}
      >
        <CompositionStudioLibrary
          assets={assets}
          captionTranscriptWordCount={captionTranscriptWordCount}
          delivery={deliveryMenu}
          insertionMode={assetInsertionMode}
          introAssetId={payload.document.clips.flatMap((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.source.placement === "INTRO" ? [clip.source.productionAssetId] : [])[0] || null}
          libraryOpen={libraryOpen}
          lessons={lessons}
          narrative={narrativeLibrary}
          narrativeCount={compositionScenes.length}
          onAddAsset={addAssetToTimeline}
          onReplaceAsset={(asset) => void replaceSelectedClipSource(asset)}
          replacementTarget={selectedTimelineClipIds.size > 1 || payload.document.tracks.find((track) => track.id === selectedClip?.trackId)?.locked || selectedClip && resolveAvatarAudioLink(payload.document, selectedClip.id).status !== "NONE" ? null : selectedClip}
          replacementTargetUnavailable={selectedClipSourceUnavailable}
          onAddCaptionLayer={() => void addNativeOverlay("CAPTION")}
          onGenerateTranscriptCaptions={() => void generateTranscriptCaptions()}
          onAddSoundEffect={addSoundEffectToTimeline}
          onAddTextLayer={() => void addNativeOverlay("TEXT")}
          onClearIntro={clearProductionIntro}
          onInsertionModeChange={changeAssetInsertionMode}
          onSelectLesson={onSelectLesson}
          onSelectAsset={selectClip}
          onSetIntro={setProductionIntro}
          selectedLessonId={selectedLessonId}
          selectedHfId={selectedHfId}
          timelineAssetHfIds={new Map(payload.document.clips.flatMap((clip) => clip.source.type === "PRODUCTION_ASSET"
            ? [[clip.source.productionAssetId, clip.hfId] as const]
            : clip.source.type === "DECK_SLIDE"
              ? [[clip.source.htmlAssetId ? `html-${clip.source.htmlAssetId}-${clip.source.sourceSlideIndex}` : `deck-slide-${clip.source.slideIndex}`, clip.hfId] as const]
              : []))}
        />

        <section ref={previewShellRef} className={`${styles.previewPanel} ${previewFullscreen ? styles.previewFullscreen : ""}`}>
          {payload.document.sourceInsertionMode === "MANUAL" && payload.document.clips.length === 0 &&
            <p role="status" className="px-4 py-2 text-sm text-slate-500">Tu timeline está vacío. Elige un archivo de la biblioteca y pulsa «Añadir a timeline».</p>}
          <CompositionPreviewToolbar
            canvas={payload.document.canvas}
            canRedo={commandHistoryState.canRedo}
            canUndo={commandHistoryState.canUndo}
            onCanvasFormatChange={(format) => void savePatch([{ type: "composition.canvas-size", ...COMPOSITION_CANVAS_FORMATS[format] }], `Cambió el lienzo a ${format}; conserva el encuadre para ajuste manual.`)}
            agentProposalActive={Boolean(agentProposal)}
            comparisonActive={comparisonActive}
            currentVersion={payload.version}
            directEditingEnabled={directEditingEnabled}
            duration={duration}
            gridVisible={gridVisible}
            history={history}
            inspectorOpen={inspectorOpen}
            libraryOpen={libraryOpen}
            onCloseHistory={() => setHistory(null)}
            onContinueToPublication={onContinueToPublication}
            onHistoryOpen={() => void loadHistory()}
            onInspectorToggle={() => setManualInspectorOpen((current) => !current)}
            onOpenLibrary={openCompositionLibrary}
            onIntervalAction={() => {
              if (removalRangeStart === null) markSelectedIntervalStart();
              else void removeSelectedInterval();
              setToolMenuOpen(false);
            }}
            onOpenAssistant={() => {
              setManualInspectorOpen(true);
              setInspectorTab("assistant");
            }}
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            onOpenPresets={() => {
              setPresetPanelOpen(true);
              void loadCompositionPresets();
            }}
            onRedo={() => void redoLastEdit()}
            onReload={() => void loadDocument()}
            onRestoreHistory={(entry) => void restoreHistoryEntry(entry)}
            onSplit={() => void splitSelectedClipAtPlayhead()}
            onToggleComparison={toggleComparison}
            onToggleDirectEditing={() => setDirectEditingEnabled((current) => !current)}
            onToggleFullscreen={() => void togglePreviewFullscreen()}
            onToggleGrid={() => {
              setGridVisible((current) => !current);
              setToolMenuOpen(false);
            }}
            onToggleSafeAreas={() => {
              setSafeAreasVisible((current) => !current);
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
            onUndo={() => void undoLastEdit()}
            onZoom={changePreviewZoom}
            previewFullscreen={previewFullscreen}
            previewStatusLabel={previewStatusLabel}
            previewZoom={previewZoom}
            redoLabel={commandHistoryState.redoLabel}
            removalRangeStartSeconds={removalRangeStart?.seconds ?? null}
            safeAreasVisible={safeAreasVisible}
            saveError={saveError}
            saving={saving}
            snapEnabled={snapEnabled}
            toolMenuOpen={toolMenuOpen}
            toolMenuRef={toolMenuRef}
            trimToolEnabled={trimToolEnabled}
            undoLabel={commandHistoryState.undoLabel}
            visualCropEnabled={visualCropEnabled}
          />
          {areCompositionAudioMetersEnabled() && <CompositionAudioMeters
            message={audioMeterMessage}
            onReset={() => postPreviewMessage({ type: "courseforge-composition-reset-audio-meter" })}
          />}
          <CompositionPreviewViewport
            activeSceneId={activeSceneId}
            agentProposalActive={Boolean(agentProposal)}
            canvasHeight={payload.document.canvas.height}
            canvasWidth={payload.document.canvas.width}
            comparisonActive={comparisonActive}
            comparisonBaselineFrameRef={comparisonBaselineFrameRef}
            comparisonBaselineLoading={comparisonBaselineLoading}
            comparisonBaselineUrl={comparisonBaselineUrl}
            duration={duration}
            fps={payload.document.canvas.fps}
            frameRef={frameRef}
            onBeginScrub={beginScrub}
            onFrameError={onPreviewFrameError}
            onFrameLoad={onPreviewFrameLoad}
            onPlaySelectedAnimation={playSelectedAnimation}
            onRefreshDocument={() => refreshPreviewDocument(false)}
            onRefreshMedia={refreshPreviewMedia}
            previewErrorActionLabel={resolveCompositionPreviewLoadErrorPresentation(previewLoadErrorCode)?.actionLabel ?? (previewLoadErrorCode ? null : "Reintentar preview")}
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
            previewZoom={previewZoom}
            safeAreasVisible={safeAreasVisible}
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
          onDoubleClick={() => setStudioTopPanePercent(68)}
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
          assets={assets}
          brandingAvailability={brandingAvailability}
          componentId={componentId}
          currentTime={seconds}
          document={payload.document}
          durationSourceLabel={durationSourceLabel}
          editingGroupId={editingTimelineGroupId}
          estimatedClipCount={estimatedClipCount}
          onAnimationSelect={selectAnimation}
          onAnimationTimingChange={(animation, timing) => void savePatch([{ animationId: animation.id, timing, type: "animation.update-timing" }], `Ajustó ${animation.preset?.id || animation.propertyGroup} desde la timeline.`)}
          onAudioMixUpdate={(settings, summary) => void savePatch([{ settings, type: "audio-mix.update" }], summary)}
          onClearSelection={clearSelection}
          onDurationChange={(clip, durationSeconds) => void savePatch([{ clipId: clip.id, durationSeconds, type: "clip.duration" }], `Ajustó la duración de ${clip.label} desde la timeline.`)}
          onEditingGroupChange={setEditingTimelineGroupId}
          onInspectSelection={inspectTimelineSelection}
          onMove={(clip, startSeconds) => void savePatch([{ clipId: clip.id, startSeconds, type: "clip.move" }], `Movió ${clip.label} a ${startSeconds} segundos.`)}
          onMoveGroup={(groupId, startSeconds) => void savePatch([{ groupId, startSeconds, type: "group.move" }], `Movió el grupo a ${formatSeconds(startSeconds)}.`)}
          onOrganize={() => void organizeTimeline()}
          onOutroChange={(outroId) => void placeAssemblyBranding(outroId)}
          onRecalculateDuration={() => void recalculateDuration()}
          onRecoverHistoricalAssets={() => void recoverHistoricalAssets()}
          onRefreshProductionAssets={() => void refreshProductionAssets()}
          onRoll={(edge, deltaFrames) => void rollTimelineSelection(edge, deltaFrames)}
          onSeek={seek}
          onSelect={(hfId) => selectClip(hfId, true)}
          onSelectedClipIdsChange={setSelectedTimelineClipIds}
          onSelectedGroupChange={setSelectedTimelineGroupId}
          onSlide={(deltaFrames) => void slideTimelineSelection(deltaFrames)}
          onTrackUpdate={(track, settings, summary) => void updateTrack(track, settings, summary)}
          onTransitionSelect={selectTransition}
          onTrim={(clip, startSeconds, durationSeconds, sourceOffsetSeconds) => void savePatch([{ clipId: clip.id, durationSeconds, sourceOffsetSeconds, startSeconds, type: "clip.trim" }], `Ajustó el inicio de ${clip.label} desde la timeline.`)}
          recoveringHistoricalAssets={recoveringHistoricalAssets}
          refreshingProductionAssets={refreshingProductionAssets}
          saving={saving}
          selectedAnimationId={selectedAnimationId}
          selectedClipIds={selectedTimelineClipIds}
          selectedGroupId={selectedTimelineGroupId}
          selectedHfId={selectedHfId}
          selectedTransitionId={activeSelectedTransitionId}
          snapEnabled={snapEnabled}
          trimToolEnabled={trimToolEnabled}
        />

        {inspectorOpen && <aside className={styles.inspector}>
          <div className={styles.inspectorHeader}>
            <CompositionInspectorTabs
              activeTab={inspectorTab}
              onSelect={setInspectorTab}
              selectedClipCount={selectedTimelineClipIds.size}
              transitionCount={payload.document.transitions?.items.length || 0}
            />
            <button type="button" onClick={clearSelection} className={styles.inspectorClose} title="Cerrar inspector" aria-label="Cerrar inspector"><X size={15} /></button>
          </div>
          <div className={styles.inspectorBody}>
            {inspectorTab === "properties" && selectedClip?.source.type === "DECK_SLIDE" &&
              <CompositionHtmlEditorialInspector draftId={draftId} clipId={selectedClip.id} documentHash={payload.documentHash} host={htmlEditorialHostRef.current} />}
            {inspectorTab === "properties" && <CompositionAudioDiagnostics
              analysis={assets.find((asset) => asset.id === selectedSourceAssetId)?.audioAnalysis}
              clip={selectedClip}
              track={payload.document.tracks.find((track) => track.id === selectedClip?.trackId)}
            />}
            {inspectorTab === "properties" && <CompositionInspector animations={selectedClip ? payload.document.motion.animations.filter((animation) => animation.target.clipId === selectedClip.id) : []} clip={selectedClip} colorGradingStatus={selectedHfId ? colorGradingStatuses[selectedHfId] || null : null} componentId={componentId} track={selectedClip ? payload.document.tracks.find((track) => track.id === selectedClip.trackId) || null : null} cropModeEnabled={visualCropEnabled} saving={saving} separatingAudio={separatingAudio} separatingAudioProgress={separatingAudioProgress} sourcePreviewUrl={selectedSourcePreviewUrl} selectedAnimationId={selectedAnimationId} onAnimationSelect={(id) => { if (id && selectedClip) selectAnimation(id, selectedClip.hfId); else setSelectedAnimationId(null); }} onDetachAudio={separateSelectedVideoAudio} onPatch={savePatch} onPreviewColorGrading={(hfId, colorGrading) => postPreviewMessage({ type: "courseforge-composition-preview-color-grading", hfId, colorGrading })} onPreviewCrop={(hfId, crop) => postPreviewMessage({ type: "courseforge-composition-preview-crop", hfId, crop })} onRemove={removeClipFromTimeline} />}
            {inspectorTab === "selection" && <CompositionSelectionPanel canPaste={canPasteTimelineClipboard} document={payload.document} editingGroupId={editingTimelineGroupId} frameStep={timelineFrameStep} keyboardEditMode={timelineKeyboardEditMode} onAlign={(alignment, target) => void alignTimelineSelection(alignment, target)} onClear={clearSelection} onCopy={copyTimelineSelection} onCreateGroup={createTimelineGroup} onDelete={() => void deleteTimelineSelection(false)} onDistribute={(axis) => void distributeTimelineSelection(axis)} onDuplicate={() => void duplicateTimelineSelection()} onEnterGroup={enterTimelineGroup} onExitGroup={exitTimelineGroup} onFrameStepChange={changeTimelineFrameStep} onInspectClip={(hfId) => selectClip(hfId, true)} onKeyboardEditModeChange={changeTimelineKeyboardEditMode} onPaste={() => void pasteTimelineClipboard()} onRippleDelete={() => void deleteTimelineSelection(true)} onRoll={(edge, deltaFrames) => void rollTimelineSelection(edge, deltaFrames)} onSlide={(deltaFrames) => void slideTimelineSelection(deltaFrames)} onUngroup={ungroupTimelineSelection} saving={saving} selectedClipIds={selectedTimelineClipIds} selectedGroupId={selectedTimelineGroupId} />}
            {inspectorTab === "transitions" && <TransitionControls document={payload.document} onAdd={(transition) => void savePatch([{ transition, type: "transition.add" }], `Añadió ${transition.type} entre dos clips.`)} onRemove={(transitionId) => void savePatch([{ transitionId, type: "transition.remove" }], "Quitó una transición entre clips.")} onSelect={selectTransition} onUpdate={(transitionId, settings) => void savePatch([{ settings, transitionId, type: "transition.update" }], "Ajustó una transición entre clips.")} saving={saving} selectedTransitionId={activeSelectedTransitionId} />}
            {inspectorTab === "assistant" && <CompositionAgentConversation lastAppliedProposal={lastAppliedAgentProposal} proposal={agentProposal} proposing={proposing} saving={saving} onDismiss={() => void dismissAgentProposal()} onPropose={(instruction) => requestAgentProposal(instruction, Boolean(presetPreview))} onApprove={() => void approveAgentProposal()} onUndo={() => void undoLastAgentProposal()} />}
          </div>
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

function CompositionRecoveryConflictNotice({ onDiscard, summary }: { onDiscard: () => void; summary: string }) {
  return (
    <div role="alert" className="fixed right-4 top-20 z-[99] w-[calc(100vw-2rem)] max-w-md rounded-xl border border-amber-300 bg-white p-4 shadow-2xl dark:border-amber-400/40 dark:bg-[var(--engine-surface-hover)]">
      <p className="text-sm font-bold text-amber-900 dark:text-amber-100">Cambio recuperable en conflicto</p>
      <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-gray-300">
        “{summary}” partía de otra versión. No se aplicó automáticamente para evitar sobrescribir cambios más recientes.
      </p>
      <button type="button" onClick={onDiscard} className="mt-3 rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-bold text-amber-900 dark:text-amber-100">
        Descartar copia local
      </button>
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
