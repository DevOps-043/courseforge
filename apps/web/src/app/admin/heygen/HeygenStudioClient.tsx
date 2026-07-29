"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  Unplug,
  UserRoundCog,
} from "lucide-react";
import { toast } from "sonner";

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
  duration?: number;
  error_message?: string;
  external_id?: string;
  file_name?: string;
  id: string;
  job_id?: string;
  order: number;
  provider?: string;
  public_url?: string;
  script_text: string;
  source_hash?: string;
  status: "DRAFT" | "WAITING_PROVIDER" | "COMPLETED" | "FAILED" | "STALE";
  storage_path?: string;
  storyboard_take_number?: number;
  visual_type?: string;
  voice_preset_id?: string;
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
  WAITING_PROVIDER: "Esperando HeyGen",
};

const CLIP_STATUS_LABELS: Record<AvatarSceneClip["status"], string> = {
  COMPLETED: "Completado",
  DRAFT: "Borrador",
  FAILED: "Fallido",
  STALE: "Desactualizado",
  WAITING_PROVIDER: "Esperando HeyGen",
};

export default function HeygenStudioClient({
  organizationLabel,
}: HeygenStudioClientProps) {
  const searchParams = useSearchParams();
  const componentId = searchParams.get("componentId");
  const isCourseContext = Boolean(componentId);

  const [avatarPresets, setAvatarPresets] = useState<AvatarPreset[]>([]);
  const [voicePresets, setVoicePresets] = useState<VoicePreset[]>([]);
  const [selectedAvatarPresetId, setSelectedAvatarPresetId] = useState("");
  const [selectedVoicePresetId, setSelectedVoicePresetId] = useState("");
  const [engine, setEngine] = useState<Engine>("avatar_iv");
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [caption, setCaption] = useState(false);
  const [standaloneTitle, setStandaloneTitle] = useState("Talking head HeyGen");
  const [standaloneScript, setStandaloneScript] = useState("");
  const [avatarGenerationMode, setAvatarGenerationMode] =
    useState<AvatarGenerationMode>("scene_clips");
  const [sceneClips, setSceneClips] = useState<AvatarSceneClip[]>([]);
  const [selectedSceneClipIds, setSelectedSceneClipIds] = useState<string[]>([]);
  const [currentJob, setCurrentJob] = useState<CurrentJob | null>(null);
  const [connection, setConnection] = useState<HeygenConnection>({
    connected: false,
    last4: null,
  });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isLoadingConnection, setIsLoadingConnection] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSavingConnection, setIsSavingConnection] = useState(false);
  const [isValidatingConnection, setIsValidatingConnection] = useState(false);
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
    setIsLoadingConnection(true);

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
      const message = error instanceof Error ? error.message : "Error al consultar HeyGen.";
      setErrorMessage(message);
    } finally {
      setIsLoadingConnection(false);
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
        throw new Error(payload.error || "No se pudieron cargar las escenas.");
      }

      const clips = (payload.data?.clips || []) as AvatarSceneClip[];
      setAvatarGenerationMode(
        (payload.data?.avatarGenerationMode as AvatarGenerationMode) || "scene_clips",
      );
      setSceneClips(clips);
      setSelectedSceneClipIds((current) =>
        current.length > 0 ? current : clips.map((clip) => clip.id),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al cargar escenas HeyGen.";
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

  const syncCatalog = useCallback(async () => {
    const response = await fetch("/api/production/heygen/sync", {
      method: "POST",
    });
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "No se pudo sincronizar HeyGen.");
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
        `Catalogo HeyGen sincronizado: ${result.avatarCount ?? 0} avatars y ${result.voiceCount ?? 0} voces.`,
      );
      await loadPresets();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al sincronizar HeyGen.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSyncingCatalog(false);
    }
  };

  const handleCreateVideo = async () => {
    if (!connection.connected) {
      toast.error("Configura la API key de HeyGen antes de generar talking heads.");
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
        throw new Error(payload.error || "No se pudo crear el video en HeyGen.");
      }

      setCurrentJob(payload.data as CurrentJob);
      toast.success("Job enviado a HeyGen.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al generar video HeyGen.";
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
            ? "Video standalone listo en HeyGen."
            : "Video importado al asset del componente.",
        );
      } else if (nextStatus === "FAILED") {
        toast.error("HeyGen reporto el job como fallido.");
      } else {
        toast.info("HeyGen sigue procesando el video.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al consultar HeyGen.";
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

  const toggleSceneClip = (clipId: string) => {
    setSelectedSceneClipIds((current) =>
      current.includes(clipId)
        ? current.filter((id) => id !== clipId)
        : [...current, clipId],
    );
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
      throw new Error(payload.error || "No se pudieron guardar las escenas.");
    }

    const nextClips = (payload.data?.clips || clips) as AvatarSceneClip[];
    setSceneClips(nextClips);
    return nextClips;
  };

  const handleGenerateSelectedClips = async () => {
    if (!connection.connected || !componentId) {
      toast.error("Configura la API key de HeyGen antes de generar clips.");
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
        throw new Error(payload.error || "No se pudieron generar los clips.");
      }

      setSceneClips((payload.data?.clips || clips) as AvatarSceneClip[]);
      toast.success(`Lote enviado a HeyGen: ${selectedSceneClipIds.length} escenas.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al generar clips HeyGen.";
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
        throw new Error(payload.error || "No se pudo consultar el estado de clips.");
      }

      const clips = (payload.data?.clips || []) as AvatarSceneClip[];
      setSceneClips(clips);
      const completed = clips.filter((clip) => clip.status === "COMPLETED").length;
      toast.info(`Clips completados: ${completed}/${clips.length}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al consultar clips HeyGen.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsCheckingClipStatus(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (apiKeyInput.trim().length < 12) {
      toast.error("Ingresa una API key de HeyGen valida.");
      return;
    }

    setIsSavingConnection(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/production/heygen/connection", {
        body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "No se pudo guardar la API key de HeyGen.");
      }

      setApiKeyInput("");
      setConnection(payload.data as HeygenConnection);
      toast.success("API key de HeyGen validada y guardada.");
      try {
        const syncResult = await syncCatalog();
        toast.success(
          `Catalogo HeyGen sincronizado: ${syncResult.avatarCount ?? 0} avatars y ${syncResult.voiceCount ?? 0} voces.`,
        );
      } catch (syncError) {
        const syncMessage =
          syncError instanceof Error
            ? syncError.message
            : "No se pudo sincronizar HeyGen.";
        setErrorMessage(`API key guardada, pero no se pudo sincronizar el catalogo: ${syncMessage}`);
        toast.error("API key guardada, pero no se pudo sincronizar el catalogo.");
      }
      await loadPresets();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al guardar HeyGen.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSavingConnection(false);
    }
  };

  const handleValidateConnection = async () => {
    setIsValidatingConnection(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/production/heygen/connection/validate", {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "No se pudo validar la API key de HeyGen.");
      }

      setConnection(payload.data as HeygenConnection);
      toast.success("Conexion HeyGen validada.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al validar HeyGen.";
      setErrorMessage(message);
      toast.error(message);
      await loadConnection();
    } finally {
      setIsValidatingConnection(false);
    }
  };

  const handleDisconnectHeygen = async () => {
    setIsDisconnecting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/production/heygen/connection", {
        method: "DELETE",
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "No se pudo desconectar HeyGen.");
      }

      setConnection({ connected: false, last4: null });
      setAvatarPresets([]);
      setVoicePresets([]);
      setSelectedAvatarPresetId("");
      setSelectedVoicePresetId("");
      toast.success("HeyGen desconectado.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al desconectar HeyGen.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isSceneMode = isCourseContext && avatarGenerationMode === "scene_clips";
  const completedSceneClips = sceneClips.filter((clip) => clip.status === "COMPLETED");
  const sceneDurationSeconds = completedSceneClips.reduce(
    (total, clip) => total + (typeof clip.duration === "number" ? clip.duration : 0),
    0,
  );

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-[#151A21]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500">
              <UserRoundCog size={24} />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">HeyGen</h1>
              <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-[#94A3B8]">
                Modulo para administrar presets y generar talking heads de {organizationLabel}.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {connection.connected ? (
              <>
                <button
                  type="button"
                  onClick={handleValidateConnection}
                  disabled={isValidatingConnection}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 px-4 py-2.5 text-sm font-semibold text-emerald-600 transition hover:bg-emerald-500/5 disabled:opacity-60 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                >
                  {isValidatingConnection ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  Revalidar
                </button>
                <button
                  type="button"
                  onClick={handleDisconnectHeygen}
                  disabled={isDisconnecting}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-semibold text-red-500 transition hover:bg-red-500/5 disabled:opacity-60 dark:hover:bg-red-500/10"
                >
                  {isDisconnecting ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />}
                  Desconectar
                </button>
              </>
            ) : (
              null
            )}
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
              className="inline-flex items-center gap-2 rounded-xl bg-[#1F5AF6] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#1F5AF6]/15 transition hover:bg-[#1a4bd6] disabled:opacity-60"
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

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/5 dark:bg-[#151A21]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              Conexion por API key de empresa
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
              La key se valida en servidor, se guarda cifrada y solo se usa para esta organizacion.
            </p>
            <label className="mt-4 flex max-w-xl flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
              API key HeyGen
              <input
                type="password"
                value={apiKeyInput}
                onChange={(event) => setApiKeyInput(event.target.value)}
                placeholder={connection.connected ? "Pega una nueva API key para reemplazarla" : "Pega la API key de HeyGen"}
                disabled={isSavingConnection || isLoadingConnection}
                className="h-[40px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={handleSaveApiKey}
            disabled={isSavingConnection || apiKeyInput.trim().length < 12}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-500/15 transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingConnection ? <Loader2 size={16} className="animate-spin" /> : <UserRoundCog size={16} />}
            Validar y guardar
          </button>
        </div>
      </section>

      {connection.connected ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          HeyGen conectado con API key de empresa
          {connection.last4 ? ` terminada en ${connection.last4}` : ""}.
          {connection.lastValidatedAt ? ` Ultima validacion: ${new Date(connection.lastValidatedAt).toLocaleString()}.` : ""}
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-300">
          Configura una API key de HeyGen para sincronizar los avatars y voces de esta empresa.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-[#151A21]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Talking head</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                {isCourseContext
                  ? "Generacion asociada al componente del curso."
                  : "Generacion libre con la cuenta de HeyGen configurada."}
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
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 p-2 dark:border-white/5 dark:bg-[#0F1419]">
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 dark:border-white/10 dark:bg-[#151A21]">
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
                  ? `${completedSceneClips.length}/${sceneClips.length} clips listos · ${formatDuration(sceneDurationSeconds)}`
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
                  className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                Script
                <textarea
                  value={standaloneScript}
                  disabled={isGenerating}
                  onChange={(event) => setStandaloneScript(event.target.value)}
                  placeholder="Escribe el texto que dira el avatar..."
                  className="min-h-36 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium normal-case leading-relaxed tracking-normal text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"
                />
              </label>
            </div>
          ) : null}

          {isSceneMode ? (
            <div className="mb-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-700 dark:text-slate-300">
                  {isLoadingScenes ? "Cargando escenas..." : `${sceneClips.length} escenas del storyboard`}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedSceneClipIds(sceneClips.map((clip) => clip.id))}
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

              {sceneClips.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-white/10 dark:text-slate-400">
                  No se encontraron bloques de guion para este componente.
                </div>
              ) : (
                sceneClips.map((clip) => (
                  <div
                    key={clip.id}
                    className="rounded-xl border border-gray-200 p-4 dark:border-white/10"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <label className="inline-flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-white">
                        <input
                          type="checkbox"
                          checked={selectedSceneClipIds.includes(clip.id)}
                          onChange={() => toggleSceneClip(clip.id)}
                          className="accent-rose-500"
                        />
                        Escena {clip.order}
                        {clip.visual_type ? (
                          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-500 dark:bg-white/5 dark:text-slate-400">
                            {clip.visual_type}
                          </span>
                        ) : null}
                      </label>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getClipStatusClassName(clip.status)}`}>
                        {CLIP_STATUS_LABELS[clip.status] || clip.status}
                      </span>
                    </div>
                    <textarea
                      value={clip.script_text}
                      disabled={isGeneratingClips}
                      onChange={(event) => updateSceneClip(clip.id, { script_text: event.target.value })}
                      className="min-h-28 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm leading-relaxed text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"
                    />
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
                          className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"
                        />
                      </label>
                    </div>
                  </div>
                ))
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
              <span className="flex h-[38px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm normal-case tracking-normal text-gray-700 dark:border-white/10 dark:bg-[#0F1419] dark:text-gray-300">
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
                  disabled={!connection.connected || isCheckingClipStatus || sceneClips.length === 0}
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
                  Generar talking head
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
            <p className="mt-4 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-500 dark:border-white/5 dark:bg-[#0F1419] dark:text-slate-400">
              componentId: {componentId}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-[#151A21]">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Estado</h2>
          {currentJob ? (
            <div className="mt-4 space-y-3">
              <StatusRow label="Job" value={currentJob.jobId} mono />
              <StatusRow label="HeyGen" value={currentJob.providerJobId || "Pendiente"} mono />
              <StatusRow
                label="Estado"
                value={STATUS_LABELS[currentJob.status] || currentJob.status}
              />
              {currentJob.providerStatus ? (
                <StatusRow label="Provider" value={currentJob.providerStatus} />
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
            <div className="mt-4 rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-white/10 dark:text-slate-400">
              No hay job activo para revisar.
            </div>
          )}
        </section>
      </div>

      <section className="grid gap-6 xl:grid-cols-2">
        <PresetList
          emptyText="Sin avatars sincronizados."
          items={avatarPresets.map((preset) => ({
            id: preset.id,
            imageUrl: preset.preview_image_url || undefined,
            isDefault: Boolean(preset.is_default),
            meta: preset.heygen_avatar_look_id || preset.status || undefined,
            name: preset.name || preset.id,
          }))}
          title="Avatars"
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
    <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-[38px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none transition focus:border-rose-500 disabled:opacity-60 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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
    <div className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm dark:border-white/5 dark:bg-[#0F1419]">
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
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-[#151A21]">
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
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex min-w-0 items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-white/5 dark:bg-[#0F1419]"
            >
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500">
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
