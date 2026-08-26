"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
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

type AspectRatio = "16:9" | "9:16";
type Engine = "avatar_iv" | "avatar_v";
type Resolution = "720p" | "1080p" | "4k";
type AvatarGenerationMode = "scene_clips" | "single_video";

interface AvatarSceneClip {
  avatar_preset_id?: string;
  background?: {
    asset_id?: string;
    url?: string;
    value?: string;
  };
  deleted?: boolean;
  duration?: number;
  error_message?: string;
  external_id?: string;
  file_name?: string;
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
}

interface VoiceSceneClip {
  clip_id: string;
  duration?: number;
  id: string;
  order: number;
  public_url: string;
  status: "COMPLETED" | "FAILED" | "STALE";
}

interface AvatarPreset {
  heygen_avatar_look_id?: string | null;
  id: string;
  is_default?: boolean;
  name?: string | null;
  preview_image_url?: string | null;
  preview_video_url?: string | null;
  status?: string | null;
}

interface VoicePreset {
  gender?: string | null;
  heygen_voice_id?: string | null;
  id: string;
  is_default?: boolean;
  language?: string | null;
  name?: string | null;
  preview_audio_url?: string | null;
  voice_type?: string | null;
}

interface LatestJob {
  createdAt?: string | null;
  jobId: string;
  providerJobId?: string | null;
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
  providerStatus?: string | null;
  script?: {
    durationEstimateSeconds?: number;
    sectionCount?: number;
    title?: string;
  };
  standalone?: boolean;
  status: string;
}

interface HeygenStudioClientProps {
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

export default function HeygenStudioClient({
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
  const [selectedAvatarPresetId, setSelectedAvatarPresetId] = useState("");
  const [selectedVoicePresetId, setSelectedVoicePresetId] = useState("");
  const [engine, setEngine] = useState<Engine>("avatar_iv");
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [caption, setCaption] = useState(false);
  const [standaloneTitle, setStandaloneTitle] = useState("Video de avatar");
  const [standaloneScript, setStandaloneScript] = useState("");
  const [avatarGenerationMode, setAvatarGenerationMode] =
    useState<AvatarGenerationMode>("scene_clips");
  const [sceneClips, setSceneClips] = useState<AvatarSceneClip[]>([]);
  const [voiceClips, setVoiceClips] = useState<VoiceSceneClip[]>([]);
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingScenes, setIsLoadingScenes] = useState(false);
  const [isGeneratingClips, setIsGeneratingClips] = useState(false);
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
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "No se pudieron cargar los presets.");
      }

      const avatars = (payload.data?.avatars || []) as AvatarPreset[];
      const voices = (payload.data?.voices || []) as VoicePreset[];
      setAvatarPresets(avatars);
      setVoicePresets(voices);

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
      const payload = await response.json();

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
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "No se pudo consultar el ultimo job.");
      }

      const latestJob = payload.data?.latestJob as LatestJob | null;
      const asset = payload.data?.asset as HeygenAsset | null;
      if (latestJob) {
        setCurrentJob({
          asset,
          jobId: latestJob.jobId,
          providerJobId: latestJob.providerJobId || null,
          status: latestJob.status,
        });
      }
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
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(readApiErrorMessage(payload, "No se pudieron cargar las escenas."));
      }

      const clips = (payload.data?.clips || []) as AvatarSceneClip[];
      setVoiceClips((payload.data?.voiceClips || []) as VoiceSceneClip[]);
      setAvatarGenerationMode(
        (payload.data?.avatarGenerationMode as AvatarGenerationMode) || "scene_clips",
      );
      setSceneClips(clips);
      setSelectedSceneClipIds((current) =>
        current.length > 0 ? current : clips.map((clip) => clip.id),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al cargar escenas de avatar.";
      setErrorMessage(message);
    } finally {
      setIsLoadingScenes(false);
    }
  }, [componentId]);

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
    const payload = await response.json();

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
        isStandalone
          ? "/api/production/heygen/standalone/videos"
          : "/api/production/heygen/videos",
        {
        body: JSON.stringify({
          aspectRatio,
          avatarPresetId: selectedAvatarPresetId || undefined,
          ...(isStandalone
            ? {
                script: standaloneScript.trim(),
                title: standaloneTitle.trim(),
              }
            : {
                autoPromote: true,
                componentId,
              }),
          caption,
          engine,
          outputFormat: "mp4",
          resolution,
          voicePresetId: selectedVoicePresetId || undefined,
        }),
        headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(readApiErrorMessage(payload, "No se pudo crear el video con el proveedor de avatares."));
      }

      setCurrentJob(payload.data as CurrentJob);
      toast.success("Job de avatar enviado.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al generar video de avatar.";
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
      const payload = await response.json();

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
        toast.error("El proveedor reporto el job como fallido.");
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
      router.push(safeReturnTo);
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
    const payload = await response.json();

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

  const handleGenerateSelectedClips = async () => {
    if (!connection.connected || !componentId) {
      toast.error("Configura la API key de HeyGen antes de generar clips de avatar.");
      return;
    }

    if (selectedSceneClipIds.length === 0) {
      toast.error("Selecciona al menos una escena.");
      return;
    }

    setIsGeneratingClips(true);
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
          outputFormat: "mp4",
          resolution,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(readApiErrorMessage(payload, "No se pudieron generar los clips."));
      }

      const nextClips = (payload.data?.clips || clips) as AvatarSceneClip[];
      setVoiceClips((payload.data?.voiceClips || []) as VoiceSceneClip[]);
      setSceneClips(nextClips);
      const failedCount = nextClips.filter(
        (clip) => selectedSceneClipIds.includes(clip.id) && clip.status === "FAILED",
      ).length;
      if (failedCount > 0) {
        toast.error(`${failedCount} escenas fueron rechazadas por el proveedor.`);
      } else if (payload.data?.submissionStatus === "QUEUED") {
        toast.success(`Lote en cola: ${selectedSceneClipIds.length} escenas.`);
      } else {
        toast.success(`Lote de avatares enviado: ${selectedSceneClipIds.length} escenas.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al generar clips de avatar.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsGeneratingClips(false);
    }
  };

  const handleCheckClipStatus = async () => {
    if (!componentId) return;

    setIsCheckingClipStatus(true);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/production/heygen/clips/status?componentId=${encodeURIComponent(componentId)}`,
        { cache: "no-store" },
      );
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(readApiErrorMessage(payload, "No se pudo consultar el estado de clips."));
      }

      const clips = (payload.data?.clips || []) as AvatarSceneClip[];
      setVoiceClips((payload.data?.voiceClips || []) as VoiceSceneClip[]);
      setSceneClips(clips);
      const completed = clips.filter((clip) => clip.status === "COMPLETED").length;
      toast.info(`Clips completados: ${completed}/${clips.length}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al consultar clips de avatar.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsCheckingClipStatus(false);
    }
  };

  const isSceneMode = isCourseContext && avatarGenerationMode === "scene_clips";
  const visibleSceneClips = sceneClips.filter((clip) => !clip.deleted);
  const completedSceneClips = visibleSceneClips.filter((clip) => clip.status === "COMPLETED");
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

      {errorMessage ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-300">
          {errorMessage}
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
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Generacion de avatar</h2>
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

          {isCourseContext ? (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 p-2 dark:border-white/5 dark:bg-[var(--engine-canvas)]">
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
                {[
                  { label: "Por escenas", value: "scene_clips" },
                  { label: "Video completo", value: "single_video" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAvatarGenerationMode(option.value as AvatarGenerationMode)}
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
                  : "Un solo avatar y voz para todo el guion"}
              </span>
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
                  placeholder="Escribe el texto que dira el avatar..."
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
                    disabled={isGeneratingClips || isLoadingScenes}
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                  >
                    Guardar cambios
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedSceneClipIds(visibleSceneClips.map((clip) => clip.id))}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                  >
                    Todas
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
                            </label>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getClipStatusClassName(clip.status)}`}>
                              {CLIP_STATUS_LABELS[clip.status] || clip.status}
                            </span>
                            <button
                              type="button"
                              onClick={() => deleteSceneClip(clip.id)}
                              disabled={isGeneratingClips}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
                              title="Eliminar clip"
                            >
                              <Trash2 size={14} />
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
                            {voiceClip ? (
                              <div className="mt-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-2">
                                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-blue-700 dark:text-blue-300">
                                  <span>Voz separada · escena {voiceClip.order}</span>
                                  <span>{voiceClip.status}{voiceClip.duration ? ` · ${voiceClip.duration.toFixed(1)}s` : ""}</span>
                                </div>
                                {voiceClip.status === "COMPLETED" ? (
                                  <audio src={voiceClip.public_url} controls preload="metadata" className="h-8 w-full" />
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
            <SelectField
              disabled={isGenerating || isLoadingPresets}
              label="Avatar"
              value={selectedAvatarPresetId}
              onChange={setSelectedAvatarPresetId}
              options={avatarPresets.map((preset) => ({
                label: `${preset.name || preset.id}${preset.is_default ? " (default)" : ""}`,
                value: preset.id,
              }))}
              placeholder="Avatar default"
            />
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
            </div>
          ) : null}

          <div className="mt-3 grid gap-3 sm:grid-cols-4">
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
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {isSceneMode ? (
              <>
                <button
                  type="button"
                  onClick={handleGenerateSelectedClips}
                  disabled={
                    isGeneratingClips ||
                    isLoadingPresets ||
                    !connection.connected ||
                    selectedSceneClipIds.length === 0
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-500/15 transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGeneratingClips ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  Generar escenas seleccionadas
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
                  Generar avatar
                </button>
                <button
                  type="button"
                  onClick={handleCheckStatus}
                  disabled={!connection.connected || !currentJob?.jobId || isCheckingStatus}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
                >
                  {isCheckingStatus ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  Consultar estado
                </button>
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
              <p className="engine-eyebrow !mb-1 !text-[var(--engine-text-muted)]">Monitor de render</p>
              <h2 className="text-lg text-gray-900 dark:text-white">Vista de producción</h2>
            </div>
            <span className="engine-preview-stage__live"><span /> EN VIVO</span>
          </div>
          {currentJob ? (
            <div className="mt-4 space-y-3">
              <StatusRow label="Job" value={currentJob.jobId} mono />
              <StatusRow label="Proveedor" value={currentJob.providerJobId || "Pendiente"} mono />
              <StatusRow
                label="Estado"
                value={STATUS_LABELS[currentJob.status] || currentJob.status}
              />
              {currentJob.providerStatus ? (
                <StatusRow label="Proveedor" value={currentJob.providerStatus} />
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

      <GeneratedVideoLibrary
        emptyText={
          isCourseContext
            ? "Los clips de esta leccion apareceran aqui cuando terminen."
            : "El video generado aparecera aqui cuando termine el job activo."
        }
        items={generatedVideoItems}
        title={isCourseContext ? "Videos de esta generacion" : "Biblioteca de videos"}
      />

      <section className="engine-catalog-grid">
        <PresetList
          emptyText="Sin avatares sincronizados."
          items={avatarPresets.map((preset) => ({
            id: preset.id,
            imageUrl: preset.preview_image_url || undefined,
            isDefault: Boolean(preset.is_default),
            meta: preset.heygen_avatar_look_id || preset.status || undefined,
            name: preset.name || preset.id,
          }))}
          title="Avatares"
        />
        <PresetList
          emptyText="Sin voces sincronizadas."
          items={voicePresets.map((preset) => ({
            id: preset.id,
            isDefault: Boolean(preset.is_default),
            meta: [preset.language, preset.gender, preset.voice_type].filter(Boolean).join(" · "),
            name: preset.name || preset.id,
          }))}
          title="Voces"
        />
      </section>
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

function readApiErrorMessage(payload: any, fallback: string) {
  const error = typeof payload?.error === "string" ? payload.error : fallback;
  const hint = typeof payload?.hint === "string" ? payload.hint : "";
  return hint ? `${error} ${hint}` : error;
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
  title,
}: {
  emptyText: string;
  items: {
    id: string;
    imageUrl?: string;
    isDefault: boolean;
    meta?: string;
    name: string;
  }[];
  title: string;
}) {
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
        <div className={title === "Avatares" ? "engine-avatar-gallery" : "engine-voice-gallery"}>
          {items.map((item) => (
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
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
