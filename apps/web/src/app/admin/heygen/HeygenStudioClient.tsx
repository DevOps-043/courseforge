"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  AudioLines,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  ScanFace,
  Sparkles,
  Trash2,
  UserRoundCog,
} from "lucide-react";
import { toast } from "sonner";
import { EngineSelect } from "@/components/ui/EngineSelect";
import { readApiResponse } from "@/lib/client/api-response";
import type { ProductionCourseContext } from "@/domains/production/course-context/production-course-context";
import {
  sceneSupportsGenerationTarget,
  selectSceneIdsForGeneration,
} from "@/domains/production/providers/heygen/heygen-scene-generation-policy";
import {
  estimateHeygenGenerationQuote,
  type HeygenGenerationQuote,
} from "@/domains/production/providers/heygen/heygen-cost.service";

type AspectRatio = "16:9" | "9:16";
type Engine = "avatar_iv" | "avatar_v";
type Resolution = "720p" | "1080p" | "4k";
type OutputFormat = "mp4" | "webm";
type AvatarGenerationMode = "scene_clips" | "single_video" | "voiceover";

interface AvatarSceneClip {
  asset_name?: string;
  avatar_preset_id?: string;
  background?: {
    asset_id?: string;
    url?: string;
    value?: string;
  };
  deleted?: boolean;
  duration?: number;
  error_message?: string;
  expected_media_mode?: "avatar" | "voice_only" | "none";
  external_id?: string;
  file_name?: string;
  generation_revision?: number;
  has_audio?: boolean;
  id: string;
  job_id?: string;
  order: number;
  origin?: "storyboard" | "manual";
  provider?: string;
  public_url?: string;
  script_text: string;
  script_hash?: string;
  source_hash?: string;
  status: "DRAFT" | "WAITING_PROVIDER" | "COMPLETED" | "FAILED" | "STALE";
  storage_path?: string;
  storyboard_take_number?: number;
  visual_type?: string;
  voice_preset_id?: string;
  voice_error_message?: string;
  voice_status?: "DRAFT" | "WAITING_PROVIDER" | "COMPLETED" | "FAILED" | "STALE";
  voice_speed?: number;
}

interface VoiceSceneClip {
  clip_id: string;
  duration?: number;
  id: string;
  order: number;
  error_message?: string;
  public_url?: string;
  status: "DRAFT" | "COMPLETED" | "FAILED" | "STALE";
}

interface HistoricalSceneRecoveryReport {
  alreadyAvailableAvatarCount: number;
  expectedAvatarSceneCount: number;
  expectedVoiceOnlySceneCount: number;
  incompleteExpectedMediaCount: number;
  importedHistoricalAvatarCount: number;
  matchedJobCount: number;
  pendingAvatarCount: number;
  pendingExpectedMediaCount: number;
  recoveredAvatarCount: number;
  recoveredVoiceCount: number;
  renamedAssetCount: number;
  skipped: string[];
  readySceneCount: number;
  unconfiguredSceneCount: number;
  unresolvedSceneCount: number;
}

interface AvatarPreset {
  archived_at?: string | null;
  avatar_type?: string | null;
  heygen_avatar_look_id?: string | null;
  id: string;
  is_default?: boolean;
  metadata?: Record<string, unknown> | null;
  name?: string | null;
  preview_image_url?: string | null;
  preview_video_url?: string | null;
  status?: string | null;
}

interface VoicePreset {
  archived_at?: string | null;
  gender?: string | null;
  heygen_voice_id?: string | null;
  id: string;
  is_default?: boolean;
  language?: string | null;
  metadata?: Record<string, unknown> | null;
  name?: string | null;
  preview_audio_url?: string | null;
  voice_type?: string | null;
}

interface LatestJob {
  createdAt?: string | null;
  jobId: string;
  jobType?: string | null;
  providerJobId?: string | null;
  providerError?: Record<string, unknown> | null;
  status: string;
  updatedAt?: string | null;
}

interface HeygenAsset {
  id: string;
  publicUrl: string;
  storagePath: string;
}

interface CurrentJob {
  asset?: HeygenAsset | null;
  jobId: string;
  providerJobId?: string | null;
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
  providerStatus?: string | null;
  script?: {
    durationEstimateSeconds?: number;
    sectionCount?: number;
    title?: string;
  };
  standalone?: boolean;
  status: string;
  voiceAsset?: {
    durationSeconds?: number | null;
    publicUrl: string;
    storagePath?: string | null;
  } | null;
}

interface HeygenStudioClientProps {
  courseContext?: ProductionCourseContext | null;
  organizationLabel: string;
}

interface HeygenConnection {
  connected: boolean;
  last4: string | null;
  lastValidatedAt?: string | null;
  lastValidationError?: string | null;
  validationStatus?: "NEVER_VALIDATED" | "VALID" | "INVALID" | null;
}

const STATUS_LABELS: Record<string, string> = {
  FAILED: "Fallido",
  PENDING: "Pendiente",
  QUEUED: "En cola",
  RETRY_SCHEDULED: "Reintento programado",
  SUCCEEDED: "Completado",
  WAITING_PROVIDER: "Esperando proveedor",
};

const CLIP_STATUS_LABELS: Record<AvatarSceneClip["status"], string> = {
  COMPLETED: "Completado",
  DRAFT: "Borrador",
  FAILED: "Fallido",
  STALE: "Desactualizado",
  WAITING_PROVIDER: "Esperando proveedor",
};

const EXPECTED_MEDIA_MODE_LABELS = {
  avatar: "Espera avatar",
  none: "Sin medio hablado",
  unconfigured: "Modalidad pendiente",
  voice_only: "Espera sólo voz",
} as const;

export default function HeygenStudioClient({
  courseContext,
  organizationLabel,
}: HeygenStudioClientProps) {
  const router = useRouter();
  const params = useParams<{ empresaSlug?: string }>();
  const searchParams = useSearchParams();
  const componentId = searchParams.get("componentId");
  const source = searchParams.get("source");
  const returnTo = searchParams.get("returnTo");
  const isCourseContext = Boolean(componentId);
  const safeReturnTo =
    returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
      ? returnTo
      : null;
  const shouldShowCourseBackButton = isCourseContext || source === "course";

  const [avatarPresets, setAvatarPresets] = useState<AvatarPreset[]>([]);
  const [voicePresets, setVoicePresets] = useState<VoicePreset[]>([]);
  const [archivedAvatarPresets, setArchivedAvatarPresets] = useState<AvatarPreset[]>([]);
  const [archivedVoicePresets, setArchivedVoicePresets] = useState<VoicePreset[]>([]);
  const [selectedAvatarPresetId, setSelectedAvatarPresetId] = useState("");
  const [selectedVoicePresetId, setSelectedVoicePresetId] = useState("");
  const [engine, setEngine] = useState<Engine>("avatar_iv");
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [caption, setCaption] = useState(false);
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [voicePitch, setVoicePitch] = useState(0);
  const [voiceVolume, setVoiceVolume] = useState(1);
  const [voiceLocale, setVoiceLocale] = useState("es-MX");
  const [speechInputType, setSpeechInputType] = useState<"text" | "ssml">("text");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("mp4");
  const [removeBackground, setRemoveBackground] = useState(false);
  const [motionPrompt, setMotionPrompt] = useState("");
  const [brandGlossaryId, setBrandGlossaryId] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogOwnership, setCatalogOwnership] = useState("all");
  const [standaloneTitle, setStandaloneTitle] = useState("Video de avatar");
  const [standaloneScript, setStandaloneScript] = useState("");
  const [avatarGenerationMode, setAvatarGenerationMode] =
    useState<AvatarGenerationMode>(isCourseContext ? "scene_clips" : "single_video");
  const [sceneClips, setSceneClips] = useState<AvatarSceneClip[]>([]);
  const [voiceClips, setVoiceClips] = useState<VoiceSceneClip[]>([]);
  const [generatingVoiceClipIds, setGeneratingVoiceClipIds] = useState<string[]>([]);
  const [resettingSceneClipIds, setResettingSceneClipIds] = useState<string[]>([]);
  const [selectedSceneClipIds, setSelectedSceneClipIds] = useState<string[]>([]);
  const [sceneClipPanelOverrides, setSceneClipPanelOverrides] = useState<
    Record<string, boolean>
  >({});
  const [currentJob, setCurrentJob] = useState<CurrentJob | null>(null);
  const [connection, setConnection] = useState<HeygenConnection>({
    connected: false,
    last4: null,
  });
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [isSyncingCatalog, setIsSyncingCatalog] = useState(false);
  const [updatingPresetId, setUpdatingPresetId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingScenes, setIsLoadingScenes] = useState(false);
  const [isGeneratingClips, setIsGeneratingClips] = useState(false);
  const [isRecoveringHistoricalAssets, setIsRecoveringHistoricalAssets] = useState(false);
  const [historicalRecoveryReport, setHistoricalRecoveryReport] = useState<HistoricalSceneRecoveryReport | null>(null);
  const [sceneGenerationTarget, setSceneGenerationTarget] = useState<"avatar" | "voice_only" | null>(null);
  const [isCheckingClipStatus, setIsCheckingClipStatus] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadPresets = useCallback(async () => {
    setIsLoadingPresets(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/production/heygen/presets", {
        cache: "no-store",
      });
      const payload = await readApiResponse(response);

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "No se pudieron cargar los presets.");
      }

      const avatars = (payload.data?.avatars || []) as AvatarPreset[];
      const voices = (payload.data?.voices || []) as VoicePreset[];
      setAvatarPresets(avatars);
      setVoicePresets(voices);
      setArchivedAvatarPresets((payload.data?.archivedAvatars || []) as AvatarPreset[]);
      setArchivedVoicePresets((payload.data?.archivedVoices || []) as VoicePreset[]);

      setSelectedAvatarPresetId((current) =>
        current || avatars.find((preset) => preset.is_default)?.id || avatars[0]?.id || "",
      );
      setSelectedVoicePresetId((current) =>
        current || voices.find((preset) => preset.is_default)?.id || voices[0]?.id || "",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al cargar presets.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsLoadingPresets(false);
    }
  }, []);

  const loadConnection = useCallback(async () => {
    try {
      const response = await fetch("/api/production/heygen/connection", {
        cache: "no-store",
      });
      const payload = await readApiResponse(response);

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "No se pudo consultar la conexion.");
      }

      setConnection(payload.data as HeygenConnection);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al consultar la conexion de avatares.";
      setErrorMessage(message);
    }
  }, []);

  const loadLatestJob = useCallback(async () => {
    if (!componentId) return;

    try {
      const response = await fetch(
        `/api/production/heygen/jobs?componentId=${encodeURIComponent(componentId)}`,
        { cache: "no-store" },
      );
      const payload = await readApiResponse(response);

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "No se pudo consultar el ultimo job.");
      }

      const latestJob = payload.data?.latestJob as LatestJob | null;
      const asset = payload.data?.asset as HeygenAsset | null;
      const voiceAsset = payload.data?.voiceAsset as CurrentJob["voiceAsset"] | null;
      if (latestJob) {
        const providerFailure = readProviderFailure(latestJob.providerError);
        setCurrentJob({
          asset,
          jobId: latestJob.jobId,
          providerJobId: latestJob.providerJobId || null,
          providerErrorCode: providerFailure.code,
          providerErrorMessage: providerFailure.message,
          status: latestJob.status,
          voiceAsset,
        });
        if (latestJob.status === "FAILED" && providerFailure.message) {
          setErrorMessage(formatProviderFailure({
            providerErrorCode: providerFailure.code,
            providerErrorMessage: providerFailure.message,
          }));
        }
      }
      return latestJob;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al consultar el ultimo job.";
      setErrorMessage(message);
    }
  }, [componentId]);

  const loadScenes = useCallback(async () => {
    if (!componentId) return;

    setIsLoadingScenes(true);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/production/heygen/scenes?componentId=${encodeURIComponent(componentId)}`,
        { cache: "no-store" },
      );
      const payload = await readApiResponse(response);

      if (!response.ok || !payload.success) {
        throw new Error(readApiErrorMessage(payload, "No se pudieron cargar las escenas."));
      }

      const clips = (payload.data?.clips || []) as AvatarSceneClip[];
      setVoiceClips((payload.data?.voiceClips || []) as VoiceSceneClip[]);
      const loadedMode = (payload.data?.avatarGenerationMode as AvatarGenerationMode) || "scene_clips";
      setAvatarGenerationMode(loadedMode);
      const voiceAudio = payload.data?.voiceAudio as {
        duration?: number;
        external_id?: string;
        public_url?: string;
        storage_path?: string;
      } | null;
      if (loadedMode === "voiceover" && voiceAudio?.public_url) {
        setCurrentJob({
          jobId: voiceAudio.external_id || "voiceover",
          providerJobId: voiceAudio.external_id || null,
          status: "SUCCEEDED",
          voiceAsset: {
            durationSeconds: voiceAudio.duration || null,
            publicUrl: voiceAudio.public_url,
            storagePath: voiceAudio.storage_path || null,
          },
        });
      }
      setSceneClips(clips);
      setSelectedSceneClipIds((current) =>
        current.filter((clipId) => clips.some((clip) => clip.id === clipId && !clip.deleted)),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al cargar escenas de avatar.";
      setErrorMessage(message);
    } finally {
      setIsLoadingScenes(false);
    }
  }, [componentId]);

  const refreshSceneClipStatuses = useCallback(async (notify: boolean) => {
    if (!componentId) return;
    if (notify) setIsCheckingClipStatus(true);

    try {
      const response = await fetch(
        `/api/production/heygen/clips/status?componentId=${encodeURIComponent(componentId)}`,
        { cache: "no-store" },
      );
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.success) {
        throw new Error(readApiErrorMessage(payload, "No se pudo consultar el estado de clips."));
      }

      const clips = (payload.data?.clips || []) as AvatarSceneClip[];
      setVoiceClips((payload.data?.voiceClips || []) as VoiceSceneClip[]);
      setSceneClips(clips);
      await loadLatestJob();
      if (notify) {
        const completed = clips.filter((clip) => clip.status === "COMPLETED").length;
        toast.info(`Clips completados: ${completed}/${clips.length}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al consultar clips de avatar.";
      if (notify) {
        setErrorMessage(message);
        toast.error(message);
      } else {
        console.warn("[HeyGen Studio] Automatic clip refresh failed:", message);
      }
    } finally {
      if (notify) setIsCheckingClipStatus(false);
    }
  }, [componentId, loadLatestJob]);

  useEffect(() => {
    loadConnection();
  }, [loadConnection]);

  useEffect(() => {
    if (!connection.connected) return;
    loadPresets();
  }, [connection.connected, loadPresets]);

  useEffect(() => {
    loadLatestJob();
  }, [loadLatestJob]);

  useEffect(() => {
    if (!connection.connected) return;
    loadScenes();
  }, [connection.connected, loadScenes]);

  useEffect(() => {
    if (!connection.connected || !componentId) return;
    const hasPendingAvatar = sceneClips.some((clip) => clip.status === "WAITING_PROVIDER");
    const hasFailedAvatarVoice = sceneClips.some((clip) => (
      clip.status === "FAILED"
      && Boolean(clip.job_id)
      && voiceClips.some((voiceClip) => voiceClip.clip_id === clip.id)
    ));
    if (!hasPendingAvatar && !hasFailedAvatarVoice) return;

    const timeoutId = window.setTimeout(() => {
      void refreshSceneClipStatuses(false);
    }, hasPendingAvatar ? 8_000 : 250);
    return () => window.clearTimeout(timeoutId);
  }, [componentId, connection.connected, refreshSceneClipStatuses, sceneClips, voiceClips]);

  useEffect(() => {
    const activeClipIds = new Set(
      sceneClips.filter((clip) => !clip.deleted).map((clip) => clip.id),
    );

    setSceneClipPanelOverrides((current) => {
      let changed = false;
      const next: Record<string, boolean> = {};

      for (const [clipId, expanded] of Object.entries(current)) {
        if (activeClipIds.has(clipId)) {
          next[clipId] = expanded;
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [sceneClips]);

  const syncCatalog = useCallback(async () => {
    const response = await fetch("/api/production/heygen/sync", {
      method: "POST",
    });
      const payload = await readApiResponse(response);

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "No se pudo sincronizar el catalogo de avatares.");
    }

    return payload.data as { avatarCount?: number; voiceCount?: number };
  }, []);

  const handleSyncCatalog = async () => {
    if (!connection.connected) {
      toast.error("Configura la API key de HeyGen antes de sincronizar avatares.");
      return;
    }

    setIsSyncingCatalog(true);
    setErrorMessage(null);

    try {
      const result = await syncCatalog();
      toast.success(
        `Catalogo de avatares sincronizado: ${result.avatarCount ?? 0} avatares y ${result.voiceCount ?? 0} voces.`,
      );
      await loadPresets();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al sincronizar el catalogo de avatares.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSyncingCatalog(false);
    }
  };

  const handleCreateVideo = async () => {
    if (!connection.connected) {
      toast.error("Configura la API key de HeyGen antes de generar avatares.");
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);

    try {
      const isStandalone = !componentId;
      const response = await fetch(
        avatarGenerationMode === "voiceover"
          ? "/api/production/heygen/speech"
          : isStandalone
          ? "/api/production/heygen/standalone/videos"
          : "/api/production/heygen/videos",
        {
        body: JSON.stringify({
          ...(avatarGenerationMode === "voiceover"
            ? {
                componentId: componentId || undefined,
                inputType: speechInputType,
                locale: voiceLocale || undefined,
                script: isStandalone ? standaloneScript.trim() : undefined,
                speed: voiceSpeed,
                title: isStandalone ? standaloneTitle.trim() : undefined,
              }
            : {
                aspectRatio,
                avatarPresetId: selectedAvatarPresetId || undefined,
                ...(isStandalone
                  ? { script: standaloneScript.trim(), title: standaloneTitle.trim() }
                  : { autoPromote: true, componentId }),
                caption,
                engine,
                brandGlossaryId: brandGlossaryId || undefined,
                locale: voiceLocale || undefined,
                motionPrompt: motionPrompt || undefined,
                outputFormat,
                pitch: voicePitch,
                removeBackground: outputFormat === "webm" || removeBackground,
                resolution,
                speed: Math.min(1.5, voiceSpeed),
                volume: voiceVolume,
              }),
          voicePresetId: selectedVoicePresetId || undefined,
        }),
        headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const payload = await readApiResponse(response);

      if (!response.ok || !payload.success) {
        throw new Error(readApiErrorMessage(payload, "No se pudo crear el video con el proveedor de avatares."));
      }

      if (response.status === 202 && payload.data?.submissionStatus === "QUEUED") {
        setCurrentJob({ jobId: "", providerJobId: null, status: "QUEUED" });
        toast.info("Generacion en cola. El envio a HeyGen continuara en segundo plano.");
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await wait(1_000);
          const latestJob = await loadLatestJob();
          if (latestJob) break;
        }
        return;
      }

      setCurrentJob(payload.data as CurrentJob);
      toast.success(
        avatarGenerationMode === "voiceover"
          ? "Voz en off generada sin crear un video."
          : "Job de avatar enviado.",
      );
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : avatarGenerationMode === "voiceover"
          ? "Error al generar la voz en off."
          : "Error al generar video de avatar.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!currentJob?.jobId) return;

    setIsCheckingStatus(true);
    setErrorMessage(null);

    try {
      const statusUrl = currentJob.standalone
        ? `/api/production/heygen/standalone/videos/${encodeURIComponent(currentJob.providerJobId || currentJob.jobId)}`
        : `/api/production/heygen/jobs/${currentJob.jobId}?autoPromote=true`;
      const response = await fetch(statusUrl, { cache: "no-store" });
      const payload = await readApiResponse(response);

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "No se pudo consultar el job.");
      }

      setCurrentJob(payload.data as CurrentJob);
      const nextStatus = payload.data?.status;
      if (nextStatus === "SUCCEEDED") {
        toast.success(
          currentJob.standalone
            ? "Video independiente listo."
            : "Video importado al asset del componente.",
        );
      } else if (nextStatus === "FAILED") {
        const failureMessage = formatProviderFailure(payload.data);
        setErrorMessage(failureMessage);
        toast.error(failureMessage);
      } else {
        toast.info("El proveedor sigue procesando el video.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al consultar el proveedor de avatares.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const updateSceneClip = (clipId: string, patch: Partial<AvatarSceneClip>) => {
    setSceneClips((current) =>
      current.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)),
    );
  };

  const reindexVisibleSceneClips = (clips: AvatarSceneClip[]) => {
    let order = 1;
    return clips.map((clip) => {
      if (clip.deleted) return clip;
      const nextClip = { ...clip, order };
      order += 1;
      return nextClip;
    });
  };

  const createManualSceneClip = (): AvatarSceneClip => ({
    avatar_preset_id: selectedAvatarPresetId || undefined,
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `manual-${crypto.randomUUID()}`
        : `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    order: 1,
    origin: "manual",
    script_text: "",
    status: "DRAFT",
    voice_preset_id: selectedVoicePresetId || undefined,
  });

  const insertSceneClipAt = (visibleIndex: number) => {
    setSceneClips((current) => {
      const next: AvatarSceneClip[] = [];
      let visibleCursor = 0;
      let inserted = false;

      for (const clip of current) {
        if (!clip.deleted && visibleCursor === visibleIndex && !inserted) {
          next.push(createManualSceneClip());
          inserted = true;
        }
        next.push(clip);
        if (!clip.deleted) visibleCursor += 1;
      }

      if (!inserted) {
        next.push(createManualSceneClip());
      }

      return reindexVisibleSceneClips(next);
    });
  };

  const deleteSceneClip = (clipId: string) => {
    setSceneClips((current) =>
      reindexVisibleSceneClips(
        current.flatMap((clip) => {
          if (clip.id !== clipId) return [clip];
          if (clip.origin === "manual") return [];
          return [{ ...clip, deleted: true, status: "DRAFT" as const }];
        }),
      ),
    );
    setSelectedSceneClipIds((current) => current.filter((id) => id !== clipId));
  };

  const handleResetSceneAssets = async (clipIds: string[]) => {
    if (!componentId || clipIds.length === 0) return;
    const confirmed = window.confirm(
      clipIds.length === 1
        ? "Se borrarán el avatar y la voz generados de esta escena. La escena, su guion y su configuración se conservarán para volver a generarla."
        : `Se borrarán los assets generados de ${clipIds.length} escenas. Los guiones y configuraciones se conservarán para repetir la prueba.`,
    );
    if (!confirmed) return;

    setErrorMessage(null);
    setResettingSceneClipIds((current) => [...new Set([...current, ...clipIds])]);
    try {
      const response = await fetch("/api/production/heygen/scenes", {
        body: JSON.stringify({ clipIds, componentId }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.success) {
        throw new Error(readApiErrorMessage(payload, "No se pudieron limpiar los assets generados."));
      }

      setSceneClips((payload.data?.clips || []) as AvatarSceneClip[]);
      setVoiceClips((payload.data?.voiceClips || []) as VoiceSceneClip[]);
      toast.success(
        clipIds.length === 1
          ? "Assets borrados. La escena está lista para volver a generarse."
          : "Assets generados borrados. Las escenas están listas para repetir la prueba.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudieron limpiar los assets generados.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setResettingSceneClipIds((current) => current.filter((id) => !clipIds.includes(id)));
    }
  };

  const toggleSceneClip = (clipId: string) => {
    setSelectedSceneClipIds((current) =>
      current.includes(clipId)
        ? current.filter((id) => id !== clipId)
        : [...current, clipId],
    );
  };

  const isSceneClipPanelExpanded = (clip: AvatarSceneClip) =>
    sceneClipPanelOverrides[clip.id] ?? clip.status !== "COMPLETED";

  const toggleSceneClipPanel = (clip: AvatarSceneClip) => {
    const nextExpanded = !isSceneClipPanelExpanded(clip);
    setSceneClipPanelOverrides((current) => ({
      ...current,
      [clip.id]: nextExpanded,
    }));
  };

  const handleReturnToCourseFlow = () => {
    if (safeReturnTo) {
      // Production assets are updated by background workers while this module
      // is open. A client-router return can reuse the previous RSC payload and
      // display only the clips that existed before entering HeyGen.
      window.location.assign(safeReturnTo);
      return;
    }

    router.back();
  };

  const saveSceneClips = async (clips: AvatarSceneClip[] = sceneClips) => {
    if (!componentId) return clips;

    const response = await fetch("/api/production/heygen/scenes", {
      body: JSON.stringify({
        avatarGenerationMode,
        clips,
        componentId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const payload = await readApiResponse(response);

    if (!response.ok || !payload.success) {
      throw new Error(readApiErrorMessage(payload, "No se pudieron guardar las escenas."));
    }

    const nextClips = (payload.data?.clips || clips) as AvatarSceneClip[];
    setVoiceClips((payload.data?.voiceClips || []) as VoiceSceneClip[]);
    setSceneClips(nextClips);
    return nextClips;
  };

  const handleSaveSceneEdits = async () => {
    setErrorMessage(null);
    try {
      await saveSceneClips(sceneClips);
      toast.success("Cambios de clips guardados.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudieron guardar los clips.";
      setErrorMessage(message);
      toast.error(message);
    }
  };

  const handleRecoverHistoricalAssets = async () => {
    if (!componentId || !connection.connected) {
      toast.error("Conecta HeyGen para consultar los videos históricos de esta lección.");
      return;
    }

    setIsRecoveringHistoricalAssets(true);
    setHistoricalRecoveryReport(null);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/production/heygen/scenes", {
        body: JSON.stringify({ componentId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.success) {
        throw new Error(readApiErrorMessage(payload, "No se pudieron recuperar los assets históricos."));
      }

      const report = payload.data?.report as HistoricalSceneRecoveryReport;
      setSceneClips((payload.data?.clips || []) as AvatarSceneClip[]);
      setVoiceClips((payload.data?.voiceClips || []) as VoiceSceneClip[]);
      setHistoricalRecoveryReport(report);
      if (payload.data?.editorSyncWarning) toast.warning(payload.data.editorSyncWarning);
      if (report.pendingAvatarCount > 0) {
        toast.success(`Recuperación iniciada: ${report.pendingAvatarCount} videos históricos siguen procesándose.`);
      } else if (report.recoveredAvatarCount > 0 || report.recoveredVoiceCount > 0) {
        toast.success("Assets históricos recuperados y sincronizados con el editor.");
      } else {
        toast.success("La revisión terminó; los assets disponibles ya estaban sincronizados.");
      }
      if (report.unconfiguredSceneCount > 0) {
        toast.warning(`${report.unconfiguredSceneCount} escenas todavía requieren definir si esperan avatar, sólo voz o ningún medio hablado.`);
      } else if (report.incompleteExpectedMediaCount > 0) {
        toast.warning(`${report.incompleteExpectedMediaCount} escenas aún no cumplen el medio configurado.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudieron recuperar los assets históricos.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsRecoveringHistoricalAssets(false);
    }
  };

  const handleGenerateSelectedClips = async (generationTarget: "avatar" | "voice_only") => {
    if (!connection.connected || !componentId) {
      toast.error("Configura la API key de HeyGen antes de generar contenido.");
      return;
    }

    if (selectedSceneClipIds.length === 0) {
      toast.error("Selecciona al menos una escena.");
      return;
    }

    const incompatibleClips = sceneClips.filter(
      (clip) => selectedSceneClipIds.includes(clip.id)
        && !sceneSupportsGenerationTarget(clip, generationTarget),
    );
    if (incompatibleClips.length > 0) {
      const sceneLabels = incompatibleClips.map((clip) => clip.order).join(", ");
      toast.error(
        generationTarget === "avatar"
          ? `Las escenas ${sceneLabels} no están configuradas para avatar. Selecciona “Avatares” para evitar cargos incorrectos.`
          : `Las escenas ${sceneLabels} no están configuradas para voz. Define primero el medio esperado.`,
      );
      return;
    }

    setIsGeneratingClips(true);
    setSceneGenerationTarget(generationTarget);
    setErrorMessage(null);

    try {
      const clips = await saveSceneClips(sceneClips);
      const response = await fetch("/api/production/heygen/clips/generate", {
        body: JSON.stringify({
          aspectRatio,
          caption,
          clipIds: selectedSceneClipIds,
          clips,
          componentId,
          engine,
          generationTarget,
          brandGlossaryId: brandGlossaryId || undefined,
          locale: voiceLocale || undefined,
          motionPrompt: motionPrompt || undefined,
          outputFormat,
          pitch: voicePitch,
          removeBackground: outputFormat === "webm" || removeBackground,
          resolution,
          speed: Math.min(1.5, voiceSpeed),
          volume: voiceVolume,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await readApiResponse(response);

      if (!response.ok || !payload.success) {
        throw new Error(readApiErrorMessage(payload, "No se pudieron generar los clips."));
      }

      const nextClips = (payload.data?.clips || clips) as AvatarSceneClip[];
      setVoiceClips((payload.data?.voiceClips || []) as VoiceSceneClip[]);
      setSceneClips(nextClips);
      const failedCount = nextClips.filter(
        (clip) => selectedSceneClipIds.includes(clip.id) && (
          generationTarget === "voice_only" ? clip.voice_status === "FAILED" : clip.status === "FAILED"
        ),
      ).length;
      if (failedCount > 0) {
        toast.error(`${failedCount} escenas no pudieron generar ${generationTarget === "voice_only" ? "voz" : "avatar"}.`);
      } else if (payload.data?.submissionStatus === "QUEUED") {
        toast.success(`Lote de ${generationTarget === "voice_only" ? "voces" : "avatares"} en cola: ${selectedSceneClipIds.length} escenas.`);
      } else {
        toast.success(`${generationTarget === "voice_only" ? "Voces generadas" : "Avatares enviados"}: ${selectedSceneClipIds.length} escenas.`);
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : `Error al generar ${generationTarget === "voice_only" ? "voces" : "clips de avatar"}.`;
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsGeneratingClips(false);
      setSceneGenerationTarget(null);
    }
  };

  const handlePresetArchived = async (
    kind: "avatar" | "voice",
    presetId: string,
    archived: boolean,
  ) => {
    setUpdatingPresetId(presetId);
    try {
      const response = await fetch("/api/production/heygen/presets", {
        body: JSON.stringify({ archived, kind, presetId }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "No se pudo actualizar el preset.");
      }
      await loadPresets();
      toast.success(archived ? "Preset ocultado del catalogo activo." : "Preset restaurado al catalogo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el preset.");
    } finally {
      setUpdatingPresetId(null);
    }
  };

  const handleGenerateSceneVoice = async (clipId: string) => {
    if (!connection.connected || !componentId) {
      toast.error("Configura la API key de HeyGen antes de generar voces por escena.");
      return;
    }

    setGeneratingVoiceClipIds((current) => [...current, clipId]);
    setErrorMessage(null);
    try {
      await saveSceneClips(sceneClips);
      const response = await fetch("/api/production/heygen/clips/voice", {
        body: JSON.stringify({ clipIds: [clipId], componentId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.success) {
        throw new Error(readApiErrorMessage(payload, "No se pudo generar la voz de esta escena."));
      }

      setSceneClips((payload.data?.clips || sceneClips) as AvatarSceneClip[]);
      setVoiceClips((payload.data?.voiceClips || []) as VoiceSceneClip[]);
      const job = (payload.data?.jobs || [])[0];
      if (job?.errorMessage) throw new Error(job.errorMessage);
      toast.success("Voz de escena generada.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo generar la voz de esta escena.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setGeneratingVoiceClipIds((current) => current.filter((id) => id !== clipId));
    }
  };

  const handleCheckClipStatus = async () => {
    setErrorMessage(null);
    await refreshSceneClipStatuses(true);
  };

  const isSceneMode = isCourseContext && avatarGenerationMode === "scene_clips";
  const isVoiceoverMode = avatarGenerationMode === "voiceover";
  const visibleSceneClips = sceneClips.filter((clip) => !clip.deleted);
  const resettableSceneClipIds = visibleSceneClips.flatMap((clip) => (
    hasGeneratedSceneAssets(clip, voiceClips.find((voice) => voice.clip_id === clip.id))
      ? [clip.id]
      : []
  ));
  const completedSceneClips = visibleSceneClips.filter((clip) => clip.status === "COMPLETED");
  const completedVoiceClips = voiceClips.filter((clip) => clip.status === "COMPLETED");
  const selectedAvatar = avatarPresets.find((preset) => preset.id === selectedAvatarPresetId);
  const selectedSceneClips = visibleSceneClips.filter((clip) => selectedSceneClipIds.includes(clip.id));
  const sceneQuote = estimateHeygenGenerationQuote({
    avatarType: selectedAvatar?.avatar_type,
    engine,
    includeSpeech: true,
    resolution,
    scripts: selectedSceneClips.map((clip) => clip.script_text),
    speed: voiceSpeed,
  });
  const sceneVoiceQuote = estimateHeygenGenerationQuote({
    includeSpeech: true,
    scripts: selectedSceneClips.map((clip) => clip.script_text),
    speed: voiceSpeed,
  });
  const standaloneQuote = estimateHeygenGenerationQuote({
    avatarType: selectedAvatar?.avatar_type,
    engine: isVoiceoverMode ? undefined : engine,
    includeSpeech: true,
    resolution,
    scripts: [standaloneScript],
    speed: voiceSpeed,
  });
  const sceneDurationSeconds = completedSceneClips.reduce(
    (total, clip) => total + (typeof clip.duration === "number" ? clip.duration : 0),
    0,
  );
  const generatedVideoItems = [
    ...completedSceneClips
      .filter((clip) => clip.public_url)
      .map((clip) => ({
        duration: clip.duration,
        id: clip.id,
        label: `Escena ${clip.order}`,
        meta: clip.visual_type || clip.provider || "Clip de avatar",
        url: clip.public_url!,
      })),
    ...(currentJob?.asset?.publicUrl
      ? [
          {
            duration: currentJob.script?.durationEstimateSeconds,
            id: currentJob.jobId,
            label: currentJob.script?.title || standaloneTitle || "Video completo",
            meta: currentJob.providerJobId || "Video de avatar",
            url: currentJob.asset.publicUrl,
          },
        ]
      : []),
  ];
  const normalizedCatalogQuery = catalogQuery.trim().toLowerCase();
  const filteredAvatars = avatarPresets.filter((preset) => {
    const ownership = typeof preset.metadata?.ownership === "string" ? preset.metadata.ownership : "unknown";
    return (catalogOwnership === "all" || ownership === catalogOwnership)
      && (!normalizedCatalogQuery || `${preset.name || ""} ${preset.heygen_avatar_look_id || ""}`.toLowerCase().includes(normalizedCatalogQuery));
  });
  const filteredVoices = voicePresets.filter((preset) => !normalizedCatalogQuery
    || `${preset.name || ""} ${preset.language || ""} ${preset.gender || ""}`.toLowerCase().includes(normalizedCatalogQuery));
  const duplicateAvatarNames = findDuplicatePresetNames(avatarPresets);
  const duplicateVoiceNames = findDuplicatePresetNames(voicePresets);
  const integrationsPath = params?.empresaSlug
    ? `/${params.empresaSlug}/admin/integrations`
    : "/admin/integrations";

  return (
    <div className="heygen-studio space-y-6">
      <header className="engine-page-hero">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-[var(--engine-accent)]">
              <UserRoundCog size={24} />
            </div>
            <div>
              <p className="engine-eyebrow">Producción audiovisual</p>
              <h1 className="text-3xl">Avatares</h1>
              <p className="mt-2 max-w-2xl text-sm">
                Modulo para administrar presets y generar videos de avatar de {organizationLabel}.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {shouldShowCourseBackButton ? (
              <button
                type="button"
                onClick={handleReturnToCourseFlow}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
              >
                <ArrowLeft size={16} />
                Regresar al flujo
              </button>
            ) : null}
            <button
              type="button"
              onClick={loadPresets}
              disabled={!connection.connected || isLoadingPresets || isSyncingCatalog}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
            >
              {isLoadingPresets ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Actualizar
            </button>
            <button
              type="button"
              onClick={handleSyncCatalog}
              disabled={!connection.connected || isLoadingPresets || isSyncingCatalog}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--engine-action)] px-4 py-2.5 text-sm font-semibold text-[var(--engine-on-action)] shadow-lg transition hover:-translate-y-px disabled:opacity-60"
            >
              {isSyncingCatalog ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Sincronizar
            </button>
          </div>
        </div>
      </header>

      {isCourseContext ? (
        courseContext ? (
          <section
            aria-label="Contexto del taller"
            className="grid gap-3 rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 to-orange-50 p-4 dark:border-rose-500/20 dark:from-rose-500/10 dark:to-orange-500/5 sm:grid-cols-2"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-rose-600 shadow-sm dark:bg-white/10 dark:text-rose-300">
                <Layers3 size={17} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-700/70 dark:text-rose-300/70">Taller</p>
                <p className="mt-1 truncate text-sm font-bold text-gray-950 dark:text-white" title={courseContext.workshopTitle}>
                  {courseContext.workshopTitle}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 items-start gap-3 sm:border-l sm:border-rose-200 sm:pl-4 dark:sm:border-rose-500/20">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-rose-600 shadow-sm dark:bg-white/10 dark:text-rose-300">
                <BookOpen size={17} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-700/70 dark:text-rose-300/70">Lección</p>
                <p className="mt-1 truncate text-sm font-bold text-gray-950 dark:text-white" title={courseContext.lessonTitle}>
                  {courseContext.lessonTitle}
                </p>
              </div>
            </div>
          </section>
        ) : (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-300">
            No se pudo verificar el taller y la lección asociados a este componente.
          </div>
        )
      ) : null}

      {errorMessage ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-300">
          {errorMessage}
        </div>
      ) : null}

      {historicalRecoveryReport ? (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm text-blue-800 dark:text-blue-200">
          <p className="font-bold">Reporte de recuperación histórica</p>
          <p className="mt-1">
            {historicalRecoveryReport.recoveredAvatarCount} avatares vinculados a escenas vigentes, {historicalRecoveryReport.importedHistoricalAvatarCount} videos históricos importados y {historicalRecoveryReport.recoveredVoiceCount} voces recuperadas; {historicalRecoveryReport.alreadyAvailableAvatarCount} avatares ya estaban disponibles; {historicalRecoveryReport.pendingAvatarCount} siguen procesándose.
          </p>
          <p className="mt-1 text-xs text-blue-700/80 dark:text-blue-300/80">
            Completas según modalidad: {historicalRecoveryReport.readySceneCount}. Avatar esperado: {historicalRecoveryReport.expectedAvatarSceneCount}. Sólo voz: {historicalRecoveryReport.expectedVoiceOnlySceneCount}. Modalidad pendiente: {historicalRecoveryReport.unconfiguredSceneCount}. Medios faltantes: {historicalRecoveryReport.incompleteExpectedMediaCount}. En proceso: {historicalRecoveryReport.pendingExpectedMediaCount}.
          </p>
          <p className="mt-1 text-xs text-blue-700/80 dark:text-blue-300/80">
            Jobs relacionados: {historicalRecoveryReport.matchedJobCount}. Nombres/metadatos actualizados: {historicalRecoveryReport.renamedAssetCount}. Escenas que requieren decisión o acción: {historicalRecoveryReport.unresolvedSceneCount}.
          </p>
          {historicalRecoveryReport.skipped.length > 0 ? (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-semibold">Ver escenas no recuperables</summary>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {historicalRecoveryReport.skipped.map((message) => <li key={message}>{message}</li>)}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {connection.connected ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          HeyGen está conectado. La configuración de la integración se administra desde {" "}
          <Link href={integrationsPath} className="underline underline-offset-2 hover:opacity-80">
            Integraciones
          </Link>
          .
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-300">
          <span>Conecta HeyGen desde Integraciones para sincronizar avatares y voces.</span>
          <Link href={integrationsPath} className="engine-button engine-button--secondary">
            Ir a Integraciones
          </Link>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <section className="engine-surface engine-studio-panel p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Generación de avatar y voz</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                {isCourseContext
                  ? "Generacion asociada al componente del curso."
                  : "Generacion libre con la cuenta de avatares configurada."}
              </p>
            </div>
            {isCourseContext ? (
              <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                Curso activo
              </span>
            ) : (
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500 dark:bg-white/5 dark:text-slate-400">
                Independiente
              </span>
            )}
          </div>

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 p-2 dark:border-white/5 dark:bg-[var(--engine-canvas)]">
            <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-1 dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
              {[
                ...(isCourseContext ? [{ label: "Por escenas", value: "scene_clips" as const }] : []),
                { label: "Video completo", value: "single_video" as const },
                { label: "Voz en off", value: "voiceover" as const },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAvatarGenerationMode(option.value)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                    avatarGenerationMode === option.value
                      ? "bg-rose-600 text-white shadow-sm"
                      : "text-gray-600 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-white/5"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">
              {isSceneMode
                ? `${completedSceneClips.length}/${visibleSceneClips.length} clips listos · ${formatDuration(sceneDurationSeconds)}`
                : isVoiceoverMode
                  ? "Solo genera y guarda audio; no consume un render de avatar"
                  : "Un solo avatar y voz para todo el guion"}
            </span>
          </div>

          {isCourseContext ? (
            <div className="mb-5 grid gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3 sm:grid-cols-4 dark:border-white/5 dark:bg-[var(--engine-canvas)]">
              {[
                { complete: visibleSceneClips.length > 0, label: "1. Guion", value: `${visibleSceneClips.length} escenas` },
                { complete: completedVoiceClips.length === visibleSceneClips.length && visibleSceneClips.length > 0, label: "2. Voz", value: `${completedVoiceClips.length}/${visibleSceneClips.length}` },
                { complete: completedSceneClips.length === visibleSceneClips.length && visibleSceneClips.length > 0, label: "3. Avatar", value: `${completedSceneClips.length}/${visibleSceneClips.length}` },
                { complete: false, label: "4. Editor", value: "ensamble final" },
              ].map((step) => (
                <div key={step.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
                  <div className="flex items-center gap-2 text-xs font-bold text-gray-700 dark:text-slate-200">
                    <span className={`h-2 w-2 rounded-full ${step.complete ? "bg-emerald-500" : "bg-amber-400"}`} />
                    {step.label}
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{step.value}</p>
                </div>
              ))}
            </div>
          ) : null}

          {!isCourseContext ? (
            <div className="mb-4 grid gap-3">
              <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                Titulo
                <input
                  type="text"
                  value={standaloneTitle}
                  disabled={isGenerating}
                  onChange={(event) => setStandaloneTitle(event.target.value)}
                  className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                Script
                <textarea
                  value={standaloneScript}
                  disabled={isGenerating}
                  onChange={(event) => setStandaloneScript(event.target.value)}
                  placeholder={isVoiceoverMode ? "Escribe el texto de la voz en off..." : "Escribe el texto que dirá el avatar..."}
                  className="min-h-36 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium normal-case leading-relaxed tracking-normal text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white"
                />
              </label>
            </div>
          ) : null}

          {isSceneMode ? (
            <div className="mb-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-700 dark:text-slate-300">
                  {isLoadingScenes ? "Cargando escenas..." : `${visibleSceneClips.length} clips del video`}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleSaveSceneEdits}
                    disabled={isGeneratingClips || isLoadingScenes || isRecoveringHistoricalAssets}
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                  >
                    Guardar cambios
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRecoverHistoricalAssets()}
                    disabled={
                      !connection.connected
                      || isGeneratingClips
                      || isLoadingScenes
                      || isRecoveringHistoricalAssets
                    }
                    className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300"
                    title="Recupera archivos desde jobs y video IDs existentes; no genera videos nuevos ni consume créditos"
                  >
                    {isRecoveringHistoricalAssets ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Recuperar históricos
                  </button>
                  {resettableSceneClipIds.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => void handleResetSceneAssets(resettableSceneClipIds)}
                      disabled={
                        isGeneratingClips
                        || isLoadingScenes
                        || resettingSceneClipIds.length > 0
                        || visibleSceneClips.some((clip) => (
                          clip.status === "WAITING_PROVIDER"
                          || clip.voice_status === "WAITING_PROVIDER"
                        ))
                      }
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
                      title="Borrar avatar y voz generados, conservando las escenas"
                    >
                      {resettingSceneClipIds.length > 0 ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      Limpiar generados
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setSelectedSceneClipIds(selectSceneIdsForGeneration(visibleSceneClips, "voice_only"))}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                  >
                    Voces
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedSceneClipIds(selectSceneIdsForGeneration(visibleSceneClips, "avatar"))}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                  >
                    Avatares
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedSceneClipIds([])}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                  >
                    Ninguna
                  </button>
                </div>
              </div>

              <InsertSceneClipButton
                disabled={isGeneratingClips}
                label="Agregar clip al inicio"
                onClick={() => insertSceneClipAt(0)}
              />

              {visibleSceneClips.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-white/10 dark:text-slate-400">
                  No hay clips activos para este componente.
                </div>
              ) : (
                visibleSceneClips.map((clip, clipIndex) => {
                  const voiceClip = voiceClips.find((voice) => voice.clip_id === clip.id);
                  const isGeneratingVoice = generatingVoiceClipIds.includes(clip.id);
                  const isResettingScene = resettingSceneClipIds.includes(clip.id);
                  const hasGeneratedAssets = hasGeneratedSceneAssets(clip, voiceClip);
                  const isPanelExpanded = isSceneClipPanelExpanded(clip);
                  const scriptPreview =
                    clip.script_text.length > 140
                      ? `${clip.script_text.slice(0, 140).trim()}...`
                      : clip.script_text;

                  return (
                    <div key={clip.id} className="space-y-3">
                      <div className="rounded-xl border border-gray-200 p-4 dark:border-white/10">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => toggleSceneClipPanel(clip)}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                              aria-expanded={isPanelExpanded}
                              title={isPanelExpanded ? "Cerrar panel" : "Abrir panel"}
                            >
                              {isPanelExpanded ? (
                                <ChevronDown size={16} />
                              ) : (
                                <ChevronRight size={16} />
                              )}
                            </button>
                            <label className="inline-flex min-w-0 items-center gap-2 text-sm font-bold text-gray-800 dark:text-white">
                              <input
                                type="checkbox"
                                checked={selectedSceneClipIds.includes(clip.id)}
                                onChange={() => toggleSceneClip(clip.id)}
                                className="accent-rose-500"
                              />
                              <span>Escena {clip.order}</span>
                              {clip.origin === "manual" ? (
                                <span className="rounded-full bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-600 dark:text-rose-300">
                                  Manual
                                </span>
                              ) : null}
                              {clip.visual_type ? (
                                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-500 dark:bg-white/5 dark:text-slate-400">
                                  {clip.visual_type}
                                </span>
                              ) : null}
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${getExpectedMediaModeClassName(clip.expected_media_mode)}`}>
                                {EXPECTED_MEDIA_MODE_LABELS[clip.expected_media_mode || "unconfigured"]}
                              </span>
                            </label>
                          </div>
                          <div className="flex items-center gap-2">
                            {(clip.expected_media_mode === "voice_only" || clip.voice_status) ? (
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getClipStatusClassName(clip.voice_status || "DRAFT")}`}>
                                Voz: {CLIP_STATUS_LABELS[clip.voice_status || "DRAFT"]}
                              </span>
                            ) : null}
                            {(clip.expected_media_mode === "avatar" || hasGeneratedAssets && clip.status !== "DRAFT") ? (
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getClipStatusClassName(clip.status)}`}>
                                Avatar: {CLIP_STATUS_LABELS[clip.status] || clip.status}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => (
                                hasGeneratedAssets
                                  ? void handleResetSceneAssets([clip.id])
                                  : deleteSceneClip(clip.id)
                              )}
                              disabled={
                                isGeneratingClips
                                || isResettingScene
                                || clip.status === "WAITING_PROVIDER"
                                || clip.voice_status === "WAITING_PROVIDER"
                              }
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
                              title={
                                hasGeneratedAssets
                                  ? "Borrar avatar y voz generados; conservar la escena"
                                  : "Eliminar escena"
                              }
                            >
                              {isResettingScene ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </button>
                          </div>
                        </div>

                        {!isPanelExpanded ? (
                          <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-slate-400">
                            {scriptPreview || "Sin guion capturado."}
                            {typeof clip.duration === "number" ? (
                              <span className="ml-2 font-semibold text-gray-400 dark:text-slate-500">
                                {formatDuration(clip.duration)}
                              </span>
                            ) : null}
                          </p>
                        ) : (
                          <>
                            <label className="mt-3 flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                              Medio esperado
                              <select
                                value={clip.expected_media_mode || ""}
                                disabled={isGeneratingClips || clip.status === "WAITING_PROVIDER" || clip.voice_status === "WAITING_PROVIDER"}
                                onChange={(event) => updateSceneClip(clip.id, {
                                  expected_media_mode: (event.target.value || undefined) as AvatarSceneClip["expected_media_mode"],
                                })}
                                className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white"
                              >
                                <option value="" disabled={Boolean(clip.expected_media_mode)}>Pendiente de definir</option>
                                <option value="avatar">Avatar y voz separada</option>
                                <option value="voice_only">Sólo voz en off</option>
                                <option value="none">No requiere medio hablado</option>
                              </select>
                              <span className="font-normal normal-case tracking-normal text-gray-400 dark:text-slate-500">
                                Define qué debe existir para considerar completa esta escena.
                              </span>
                            </label>
                            <label className="mt-3 flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                              Nombre del asset
                              <input
                                type="text"
                                maxLength={120}
                                value={clip.asset_name || ""}
                                disabled={isGeneratingClips}
                                onChange={(event) => updateSceneClip(clip.id, {
                                  asset_name: event.target.value || undefined,
                                })}
                                placeholder={`Se usará el nombre de la lección · Escena ${String(clip.order).padStart(2, "0")}`}
                                className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white"
                              />
                              <span className="font-normal normal-case tracking-normal text-gray-400 dark:text-slate-500">
                                Se mostrará como título en HeyGen y nombrará el MP4/MP3 al regresar.
                              </span>
                            </label>
                            <textarea
                              value={clip.script_text}
                              disabled={isGeneratingClips}
                              onChange={(event) => updateSceneClip(clip.id, { script_text: event.target.value })}
                              className="mt-3 min-h-28 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm leading-relaxed text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white"
                            />
                            {clip.error_message ? (
                              <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-300">
                                {clip.error_message}
                              </p>
                            ) : null}
                            {clip.voice_error_message ? (
                              <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-300">
                                Voz: {clip.voice_error_message}
                              </p>
                            ) : null}
                            {voiceClip ? (
                              <div className="mt-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-2">
                                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-blue-700 dark:text-blue-300">
                                  <span>Voz separada · escena {voiceClip.order}</span>
                                  <span>{voiceClip.status}{voiceClip.duration ? ` · ${voiceClip.duration.toFixed(1)}s` : ""}</span>
                                </div>
                                {voiceClip.status === "COMPLETED" && voiceClip.public_url ? (
                                  <audio src={voiceClip.public_url} controls preload="metadata" className="h-8 w-full" />
                                ) : voiceClip.error_message ? (
                                  <p className="mt-1 text-[11px] text-red-600 dark:text-red-300">{voiceClip.error_message}</p>
                                ) : null}
                              </div>
                            ) : null}
                            <div className="mt-3 grid gap-3 md:grid-cols-3">
                              <SelectField
                                disabled={isGeneratingClips || isLoadingPresets}
                                label="Avatar"
                                value={clip.avatar_preset_id || selectedAvatarPresetId}
                                onChange={(value) => updateSceneClip(clip.id, { avatar_preset_id: value || undefined })}
                                options={avatarPresets.map((preset) => ({
                                  label: `${preset.name || preset.id}${preset.is_default ? " (default)" : ""}`,
                                  value: preset.id,
                                }))}
                                placeholder="Avatar default"
                              />
                              <SelectField
                                disabled={isGeneratingClips || isLoadingPresets}
                                label="Voz"
                                value={clip.voice_preset_id || selectedVoicePresetId}
                                onChange={(value) => updateSceneClip(clip.id, { voice_preset_id: value || undefined })}
                                options={voicePresets.map((preset) => ({
                                  label: `${preset.name || preset.id}${preset.is_default ? " (default)" : ""}`,
                                  value: preset.id,
                                }))}
                                placeholder="Voz default"
                              />
                              <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                                Velocidad de voz
                                <input
                                  type="number"
                                  min={0.5}
                                  max={2}
                                  step={0.05}
                                  value={clip.voice_speed ?? 1}
                                  disabled={isGeneratingClips || isGeneratingVoice}
                                  onChange={(event) => updateSceneClip(clip.id, {
                                    voice_speed: Math.min(2, Math.max(0.5, Number(event.target.value) || 1)),
                                  })}
                                  className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white"
                                />
                              </label>
                              <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                                Fondo
                                <input
                                  value={clip.background?.value || clip.background?.url || ""}
                                  disabled={isGeneratingClips}
                                  onChange={(event) =>
                                    updateSceneClip(clip.id, {
                                      background: event.target.value.trim()
                                        ? { value: event.target.value.trim() }
                                        : undefined,
                                    })
                                  }
                                  placeholder="Opcional"
                                  className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white"
                                />
                              </label>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleGenerateSceneVoice(clip.id)}
                              disabled={isGeneratingClips || isGeneratingVoice || !connection.connected || !clip.script_text.trim()}
                              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300"
                            >
                              {isGeneratingVoice ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                              {voiceClip ? "Regenerar voz" : "Generar voz"}
                            </button>
                          </>
                        )}
                      </div>
                      <InsertSceneClipButton
                        disabled={isGeneratingClips}
                        label="Agregar clip aqui"
                        onClick={() => insertSceneClipAt(clipIndex + 1)}
                      />
                    </div>
                  );
                })
              )}
            </div>
          ) : null}

          {!isSceneMode ? (
            <div className="grid gap-3 md:grid-cols-2">
            {!isVoiceoverMode ? <SelectField
                disabled={isGenerating || isLoadingPresets}
                label="Avatar"
                value={selectedAvatarPresetId}
                onChange={setSelectedAvatarPresetId}
                options={avatarPresets.map((preset) => ({
                  label: `${preset.name || preset.id}${preset.is_default ? " (default)" : ""}`,
                  value: preset.id,
                }))}
                placeholder="Avatar default"
              /> : null}
            <SelectField
              disabled={isGenerating || isLoadingPresets}
              label="Voz"
              value={selectedVoicePresetId}
              onChange={setSelectedVoicePresetId}
              options={voicePresets.map((preset) => ({
                label: `${preset.name || preset.id}${preset.is_default ? " (default)" : ""}`,
                value: preset.id,
              }))}
              placeholder="Voz default"
            />
            {isVoiceoverMode ? (
              <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                Velocidad
                <input
                  type="number"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={voiceSpeed}
                  disabled={isGenerating}
                  onChange={(event) => setVoiceSpeed(Math.min(2, Math.max(0.5, Number(event.target.value) || 1)))}
                  className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white"
                />
              </label>
            ) : null}
            </div>
          ) : null}

          {!isVoiceoverMode ? <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <SelectField
              disabled={isGenerating}
              label="Engine"
              value={engine}
              onChange={(value) => setEngine(value as Engine)}
              options={[
                { label: "Avatar IV", value: "avatar_iv" },
                { label: "Avatar V", value: "avatar_v" },
              ]}
            />
            <SelectField
              disabled={isGenerating}
              label="Resolucion"
              value={resolution}
              onChange={(value) => setResolution(value as Resolution)}
              options={[
                { label: "720p", value: "720p" },
                { label: "1080p", value: "1080p" },
                { label: "4K", value: "4k" },
              ]}
            />
            <SelectField
              disabled={isGenerating}
              label="Formato"
              value={aspectRatio}
              onChange={(value) => setAspectRatio(value as AspectRatio)}
              options={[
                { label: "16:9", value: "16:9" },
                { label: "9:16", value: "9:16" },
              ]}
            />
            <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
              Subtitulos
              <span className="flex h-[38px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm normal-case tracking-normal text-gray-700 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={caption}
                  disabled={isGenerating}
                  onChange={(event) => setCaption(event.target.checked)}
                  className="accent-rose-500"
                />
                SRT
              </span>
            </label>
          </div> : null}

          {!isSceneMode ? (
            <details className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-white/10">
              <summary className="cursor-pointer text-sm font-bold text-gray-700 dark:text-slate-200">
                Controles avanzados de voz y render
              </summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SelectField
                  disabled={isGenerating}
                  label="Entrada de voz"
                  value={speechInputType}
                  onChange={(value) => setSpeechInputType(value as "text" | "ssml")}
                  options={[{ label: "Texto", value: "text" }, { label: "SSML", value: "ssml" }]}
                />
                <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                  Locale
                  <input value={voiceLocale} disabled={isGenerating} onChange={(event) => setVoiceLocale(event.target.value)} placeholder="es-MX" className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none focus:border-rose-500 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white" />
                </label>
                {!isVoiceoverMode ? <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                  Velocidad
                  <input type="number" min={0.5} max={1.5} step={0.05} value={Math.min(1.5, voiceSpeed)} disabled={isGenerating} onChange={(event) => setVoiceSpeed(Math.min(1.5, Math.max(0.5, Number(event.target.value) || 1)))} className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none focus:border-rose-500 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white" />
                </label> : null}
                {!isVoiceoverMode ? <><label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                  Pitch (-50 a 50)
                  <input type="number" min={-50} max={50} step={1} value={voicePitch} disabled={isGenerating} onChange={(event) => setVoicePitch(Math.min(50, Math.max(-50, Number(event.target.value) || 0)))} className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none focus:border-rose-500 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white" />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                  Volumen (0 a 1)
                  <input type="number" min={0} max={1} step={0.05} value={voiceVolume} disabled={isGenerating} onChange={(event) => setVoiceVolume(Math.min(1, Math.max(0, Number(event.target.value))))} className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none focus:border-rose-500 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white" />
                </label></> : null}
                {!isVoiceoverMode ? <>
                  <SelectField disabled={isGenerating} label="Contenedor" value={outputFormat} onChange={(value) => { const next = value as OutputFormat; setOutputFormat(next); if (next === "webm") setRemoveBackground(true); }} options={[{ label: "MP4", value: "mp4" }, { label: "WebM transparente", value: "webm" }]} />
                  <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                    Transparencia
                    <span className="flex h-[38px] items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-700 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-gray-300"><input type="checkbox" checked={removeBackground} disabled={isGenerating || outputFormat === "webm"} onChange={(event) => setRemoveBackground(event.target.checked)} /> Quitar fondo</span>
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400 lg:col-span-2">
                    Motion prompt
                    <input value={motionPrompt} disabled={isGenerating} onChange={(event) => setMotionPrompt(event.target.value)} placeholder="Gestos y movimiento deseados" className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none focus:border-rose-500 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400 lg:col-span-2">
                    Brand glossary ID
                    <input value={brandGlossaryId} disabled={isGenerating} onChange={(event) => setBrandGlossaryId(event.target.value)} placeholder="Opcional" className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none focus:border-rose-500 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white" />
                  </label>
                </> : null}
              </div>
            </details>
          ) : null}

          {(isSceneMode || !isCourseContext) ? (
            <GenerationQuote
              quote={isSceneMode ? sceneQuote : standaloneQuote}
              sceneCount={isSceneMode ? selectedSceneClips.length : undefined}
              title={isSceneMode ? "Cotización de la selección" : "Cotización previa"}
              voiceOnlyQuote={isSceneMode ? sceneVoiceQuote : undefined}
            />
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            {isSceneMode ? (
              <>
                <button
                  type="button"
                  onClick={() => handleGenerateSelectedClips("voice_only")}
                  disabled={
                    isGeneratingClips ||
                    isLoadingPresets ||
                    !connection.connected ||
                    selectedSceneClipIds.length === 0
                  }
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300"
                >
                  {sceneGenerationTarget === "voice_only" ? <Loader2 size={16} className="animate-spin" /> : <AudioLines size={16} />}
                  Generar voz de escenas
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerateSelectedClips("avatar")}
                  disabled={
                    isGeneratingClips ||
                    isLoadingPresets ||
                    !connection.connected ||
                    selectedSceneClipIds.length === 0
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-500/15 transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sceneGenerationTarget === "avatar" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  Generar avatar de escenas
                </button>
                <button
                  type="button"
                  onClick={handleCheckClipStatus}
                  disabled={!connection.connected || isCheckingClipStatus || visibleSceneClips.length === 0}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
                >
                  {isCheckingClipStatus ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  Consultar clips
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleCreateVideo}
                  disabled={
                    isGenerating ||
                    isLoadingPresets ||
                    !connection.connected ||
                    (!isCourseContext && standaloneScript.trim().length < 20)
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-500/15 transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {isVoiceoverMode ? "Generar voz en off" : "Generar avatar"}
                </button>
                {!isVoiceoverMode ? <button
                  type="button"
                  onClick={handleCheckStatus}
                  disabled={!connection.connected || !currentJob?.jobId || isCheckingStatus}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
                >
                  {isCheckingStatus ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  Consultar estado
                </button> : null}
              </>
            )}
          </div>

          {componentId ? (
            <p className="mt-4 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-500 dark:border-white/5 dark:bg-[var(--engine-canvas)] dark:text-slate-400">
              componentId: {componentId}
            </p>
          ) : null}
        </section>

        <section className="engine-preview-stage">
          <div className="engine-preview-stage__header">
            <div>
              <p className="engine-eyebrow !mb-1 !text-[var(--engine-text-muted)]">Monitor de producción</p>
              <h2 className="text-lg text-gray-900 dark:text-white">Vista de producción</h2>
            </div>
            <span className="engine-preview-stage__live"><span /> EN VIVO</span>
          </div>
          {currentJob ? (
            <div className="mt-4 space-y-3">
              <StatusRow label="Job" value={currentJob.jobId || "Asignando job…"} mono />
              <StatusRow label="Proveedor" value={currentJob.providerJobId || "Pendiente"} mono />
              <StatusRow
                label="Estado"
                value={STATUS_LABELS[currentJob.status] || currentJob.status}
              />
              {currentJob.providerStatus ? (
                <StatusRow label="Proveedor" value={currentJob.providerStatus} />
              ) : null}
              {currentJob.providerErrorMessage ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300" role="alert">
                  {formatProviderFailure(currentJob)}
                </div>
              ) : null}
              {currentJob.script?.title ? (
                <StatusRow label="Script" value={currentJob.script.title} />
              ) : null}
              {currentJob.asset?.publicUrl ? (
                <a
                  href={currentJob.asset.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
                >
                  <ExternalLink size={16} />
                  Ver video importado
                </a>
              ) : null}
              {currentJob.voiceAsset?.publicUrl ? (
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-blue-700 dark:text-blue-300">
                    <span>Voz en off</span>
                    <span>{currentJob.voiceAsset.durationSeconds ? formatDuration(currentJob.voiceAsset.durationSeconds) : "Audio listo"}</span>
                  </div>
                  <audio src={currentJob.voiceAsset.publicUrl} controls preload="metadata" className="w-full" />
                  <a
                    href={currentJob.voiceAsset.publicUrl}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-blue-700 underline underline-offset-2 dark:text-blue-300"
                  >
                    <ExternalLink size={13} /> Descargar audio
                  </a>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="engine-preview-empty">
              <div className="engine-preview-orbit">
                <ScanFace size={32} strokeWidth={1.35} />
              </div>
              <h3>El escenario está listo</h3>
              <p>Configura voz, presencia y formato. La vista previa aparecerá aquí al iniciar un render.</p>
            </div>
          )}
        </section>
      </div>

      {!isVoiceoverMode ? <GeneratedVideoLibrary
        emptyText={
          isCourseContext
            ? "Los clips de esta leccion apareceran aqui cuando terminen."
            : "El video generado aparecera aqui cuando termine el job activo."
        }
        items={generatedVideoItems}
        title={isCourseContext ? "Videos de esta generacion" : "Biblioteca de videos"}
      /> : null}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4 dark:border-white/10">
        <label className="min-w-64 flex-1 text-xs font-bold uppercase tracking-wide text-gray-400">
          Buscar en catálogo
          <input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Nombre, idioma o ID" className="mt-1.5 h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none focus:border-rose-500 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white" />
        </label>
        <SelectField label="Propiedad de avatar" value={catalogOwnership} onChange={setCatalogOwnership} options={[{ label: "Todos", value: "all" }, { label: "Propios", value: "private" }, { label: "Públicos", value: "public" }]} />
        <span className="pb-2 text-xs font-semibold text-gray-500">{filteredAvatars.length} avatares · {filteredVoices.length} voces</span>
      </div>

      <section className="engine-catalog-grid">
        <PresetList
          emptyText="Sin avatares sincronizados."
          items={filteredAvatars.map((preset) => ({
            id: preset.id,
            imageUrl: preset.preview_image_url || undefined,
            isDuplicate: duplicateAvatarNames.has(normalizePresetName(preset.name)),
            isDefault: Boolean(preset.is_default),
            meta: preset.heygen_avatar_look_id || preset.status || undefined,
            name: preset.name || preset.id,
          }))}
          kind="avatar"
          onArchive={(presetId) => handlePresetArchived("avatar", presetId, true)}
          paginationKey={`${normalizedCatalogQuery}:${catalogOwnership}`}
          title="Avatares"
          updatingPresetId={updatingPresetId}
        />
        <PresetList
          emptyText="Sin voces sincronizadas."
          items={filteredVoices.map((preset) => ({
            id: preset.id,
            isDuplicate: duplicateVoiceNames.has(normalizePresetName(preset.name)),
            isDefault: Boolean(preset.is_default),
            meta: [preset.language, preset.gender, preset.voice_type].filter(Boolean).join(" · "),
            name: preset.name || preset.id,
          }))}
          kind="voice"
          onArchive={(presetId) => handlePresetArchived("voice", presetId, true)}
          paginationKey={normalizedCatalogQuery}
          title="Voces"
          updatingPresetId={updatingPresetId}
        />
      </section>

      {(archivedAvatarPresets.length > 0 || archivedVoicePresets.length > 0) ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 dark:border-amber-500/20 dark:bg-amber-500/5">
          <div className="mb-3">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Recursos ocultos</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">La limpieza no elimina recursos de HeyGen. Puedes restaurarlos en cualquier momento.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ...archivedAvatarPresets.map((preset) => ({ ...preset, kind: "avatar" as const })),
              ...archivedVoicePresets.map((preset) => ({ ...preset, kind: "voice" as const })),
            ].map((preset) => (
              <button
                key={`${preset.kind}-${preset.id}`}
                type="button"
                disabled={updatingPresetId === preset.id}
                onClick={() => handlePresetArchived(preset.kind, preset.id, false)}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60 dark:border-amber-500/20 dark:bg-black/10 dark:text-amber-200"
              >
                {updatingPresetId === preset.id ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />}
                Restaurar {preset.name || preset.id}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SelectField({
  disabled,
  label,
  onChange,
  options,
  placeholder,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
  value: string;
}) {
  return (
    <div>
      <EngineSelect
        label={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        options={placeholder ? [{ label: placeholder, value: "" }, ...options] : options}
        placeholder={placeholder}
      />
    </div>
  );
}

function InsertSceneClipButton({
  disabled,
  label,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-rose-300 bg-rose-50/60 px-3 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
    >
      <Plus size={14} />
      {label}
    </button>
  );
}

function GenerationQuote({
  quote,
  sceneCount,
  title,
  voiceOnlyQuote,
}: {
  quote: HeygenGenerationQuote;
  sceneCount?: number;
  title: string;
  voiceOnlyQuote?: HeygenGenerationQuote;
}) {
  const hasContent = quote.durationSeconds > 0;
  return (
    <div className="mt-5 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-sm text-violet-950 dark:text-violet-100">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-bold">{title}</p>
        <span className="text-base font-extrabold tabular-nums">
          {hasContent ? `≈ US$${quote.totalUsd.toFixed(2)}` : "Escribe o selecciona un guion"}
        </span>
      </div>
      {hasContent ? (
        <p className="mt-1 text-xs text-violet-800/80 dark:text-violet-200/80">
          {sceneCount !== undefined ? `${sceneCount} escena${sceneCount === 1 ? "" : "s"} · ` : ""}
          {formatDuration(quote.durationSeconds)} estimados · avatar US${quote.avatarUsd.toFixed(2)}
          {quote.includesSpeech ? ` + voz US$${quote.speechUsd.toFixed(2)}` : ""}.
          {voiceOnlyQuote ? ` Sólo voz: ≈ US$${voiceOnlyQuote.totalUsd.toFixed(2)}.` : ""}
        </p>
      ) : null}
      <p className="mt-1 text-[11px] text-violet-800/70 dark:text-violet-200/70">
        Referencia de tarifa API por duración; el saldo y el cobro final los confirma HeyGen. La opción “Sólo voz” no incluye render de avatar.
      </p>
    </div>
  );
}

function StatusRow({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm dark:border-white/5 dark:bg-[var(--engine-canvas)]">
      <span className="shrink-0 font-semibold text-gray-500 dark:text-slate-400">{label}</span>
      <span className={`min-w-0 text-right text-gray-900 dark:text-white ${mono ? "font-mono text-xs" : "font-medium"}`}>
        {value}
      </span>
    </div>
  );
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getClipStatusClassName(status: AvatarSceneClip["status"]) {
  if (status === "COMPLETED") {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "FAILED") {
    return "bg-red-500/10 text-red-700 dark:text-red-300";
  }
  if (status === "STALE") {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  if (status === "WAITING_PROVIDER") {
    return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
  }
  return "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-slate-300";
}

function getExpectedMediaModeClassName(mode: AvatarSceneClip["expected_media_mode"]) {
  if (mode === "avatar") return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (mode === "voice_only") return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
  if (mode === "none") return "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-slate-300";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function readApiErrorMessage(payload: any, fallback: string) {
  const error = typeof payload?.error === "string" ? payload.error : fallback;
  const hint = typeof payload?.hint === "string" ? payload.hint : "";
  return hint ? `${error} ${hint}` : error;
}

function readProviderFailure(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { code: null, message: null };
  }
  const failure = value as Record<string, unknown>;
  return {
    code: typeof failure.code === "string" ? failure.code : null,
    message:
      typeof failure.message === "string"
        ? failure.message
        : typeof failure.error_message === "string"
          ? failure.error_message
          : null,
  };
}

function formatProviderFailure(job: {
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
}) {
  if (job.providerErrorCode === "MOVIO_PAYMENT_INSUFFICIENT_CREDIT") {
    return "HeyGen no tiene creditos API suficientes para completar este avatar. Recarga creditos API en HeyGen y vuelve a generar.";
  }
  return job.providerErrorMessage || "HeyGen reporto la generacion como fallida.";
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function GeneratedVideoLibrary({
  emptyText,
  items,
  title,
}: {
  emptyText: string;
  items: {
    duration?: number;
    id: string;
    label: string;
    meta?: string;
    url: string;
  }[];
  title: string;
}) {
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(items[0]?.id ?? null);
  const selectedVideo = items.find((item) => item.id === selectedVideoId) || items[0] || null;

  useEffect(() => {
    if (items.length === 0) {
      setSelectedVideoId(null);
      return;
    }
    if (!selectedVideoId || !items.some((item) => item.id === selectedVideoId)) {
      setSelectedVideoId(items[0].id);
    }
  }, [items, selectedVideoId]);

  return (
    <section className="engine-surface engine-preset-catalog p-6" data-catalog={title.toLowerCase()}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500 dark:bg-white/5 dark:text-slate-400">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-white/10 dark:text-slate-400">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-4">
          {selectedVideo ? (
            <div className="overflow-hidden rounded-xl border border-gray-100 bg-gray-50 shadow-sm dark:border-white/5 dark:bg-[var(--engine-canvas)]">
              <video
                key={selectedVideo.id}
                src={selectedVideo.url}
                autoPlay
                controls
                playsInline
                preload="metadata"
                className="aspect-video w-full bg-black object-contain"
              />
              <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-900 dark:text-white">
                    {selectedVideo.label}
                  </p>
                  <p className="truncate text-xs text-gray-500 dark:text-slate-400">
                    {[selectedVideo.meta, selectedVideo.duration ? formatDuration(selectedVideo.duration) : null].filter(Boolean).join(" - ")}
                  </p>
                </div>
                <a
                  href={selectedVideo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 transition hover:text-rose-500 dark:text-rose-300"
                >
                  <ExternalLink size={13} />
                  Abrir en pestana
                </a>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedVideoId(item.id)}
              className={`overflow-hidden rounded-xl border bg-gray-50 text-left shadow-sm transition dark:bg-[var(--engine-canvas)] ${
                selectedVideo?.id === item.id
                  ? "border-rose-400 ring-2 ring-rose-500/20 dark:border-rose-400"
                  : "border-gray-100 hover:border-rose-200 dark:border-white/5 dark:hover:border-rose-500/30"
              }`}
            >
              <video
                src={item.url}
                muted
                playsInline
                preload="metadata"
                className="aspect-video w-full bg-black object-cover"
              />
              <div className="p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-900 dark:text-white">
                    {item.label}
                  </p>
                  <p className="truncate text-xs text-gray-500 dark:text-slate-400">
                    {[item.meta, item.duration ? formatDuration(item.duration) : null].filter(Boolean).join(" - ")}
                  </p>
                </div>
              </div>
            </button>
          ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PresetList({
  emptyText,
  items,
  kind,
  onArchive,
  paginationKey,
  title,
  updatingPresetId,
}: {
  emptyText: string;
  items: {
    id: string;
    imageUrl?: string;
    isDuplicate: boolean;
    isDefault: boolean;
    meta?: string;
    name: string;
  }[];
  kind: "avatar" | "voice";
  onArchive: (presetId: string) => void;
  paginationKey: string;
  title: string;
  updatingPresetId: string | null;
}) {
  const pageSize = kind === "avatar" ? 9 : 10;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const [currentPage, setCurrentPage] = useState(1);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const visibleItems = items.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [paginationKey]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-[var(--engine-surface-solid)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500 dark:bg-white/5 dark:text-slate-400">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-white/10 dark:text-slate-400">
          {emptyText}
        </div>
      ) : (
        <>
          <div className={kind === "avatar" ? "engine-avatar-gallery" : "engine-voice-gallery"}>
            {visibleItems.map((item) => (
              <div
                key={item.id}
                className="engine-preset-card"
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="engine-preset-card__image"
                  />
                ) : (
                  <div className="engine-preset-card__fallback">
                    <UserRoundCog size={20} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-gray-900 dark:text-white">{item.name}</p>
                  <p className="truncate font-mono text-[10px] text-gray-500 dark:text-slate-400">
                    {item.meta || item.id}
                  </p>
                </div>
                {item.isDefault ? (
                  <CheckCircle2 className="shrink-0 text-emerald-500" size={18} />
                ) : (
                  <button
                    type="button"
                    disabled={updatingPresetId === item.id}
                    onClick={() => onArchive(item.id)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-400 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-60 dark:border-white/10 dark:hover:border-amber-500/30 dark:hover:bg-amber-500/10 dark:hover:text-amber-300"
                    title={`Ocultar ${kind === "avatar" ? "avatar" : "voz"}${item.isDuplicate ? " duplicado" : ""}`}
                  >
                    {updatingPresetId === item.id ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                  </button>
                )}
                {item.isDuplicate ? <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-bold uppercase text-amber-700 dark:text-amber-300">Duplicado</span> : null}
              </div>
            ))}
          </div>
          {totalPages > 1 ? (
            <nav className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-white/5" aria-label={`Paginación de ${title.toLowerCase()}`}>
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400">
                Mostrando {pageStart + 1}–{Math.min(pageStart + pageSize, items.length)} de {items.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safeCurrentPage === 1}
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                  aria-label={`Página anterior de ${title.toLowerCase()}`}
                >
                  <ChevronLeft size={14} /> Anterior
                </button>
                <span className="min-w-16 text-center text-xs font-semibold text-gray-600 dark:text-slate-300">
                  {safeCurrentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safeCurrentPage === totalPages}
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                  aria-label={`Página siguiente de ${title.toLowerCase()}`}
                >
                  Siguiente <ChevronRight size={14} />
                </button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}

function normalizePresetName(value?: string | null) {
  return (value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function findDuplicatePresetNames(items: Array<{ name?: string | null }>) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = normalizePresetName(item.name);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name));
}

function hasGeneratedSceneAssets(
  clip: AvatarSceneClip,
  voiceClip?: VoiceSceneClip,
) {
  return Boolean(
    voiceClip
    || clip.public_url
    || clip.storage_path
    || clip.job_id
    || clip.external_id
    || clip.status !== "DRAFT"
    || (clip.voice_status && clip.voice_status !== "DRAFT"),
  );
}
