"use client";

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { readApiResponse } from "@/lib/client/api-response";
import { waitForSlideGeneration } from "@/lib/client/slide-generation";
import { uploadWithSignedUrl } from "@/lib/storage-upload";
import { validateHyperframesMediaAsset } from "@/domains/production/hyperframes/hyperframes-media-constraints";
import { HYPERFRAMES_ASSET_DELIVERY_MODES } from "@/domains/production/hyperframes/hyperframes.types";
import { HYPERFRAMES_PRIVATE_SOURCE_BUCKET } from "@/domains/production/media-storage.config";
import type { CloudStorageProvider } from "@/domains/production/cloud-storage/types";
import {
  MAX_VIDEO_UPLOAD_SIZE_BYTES,
} from "@/lib/video-platform";
import {
  COPY_FEEDBACK_RESET_DELAY_MS,
} from "@/shared/constants/timing";
import type {
  AvatarClip,
  AvatarGenerationMode,
  MaterialAssets,
  MaterialComponent,
  StoryboardItem,
} from "../types/materials.types";
import type {
  VoiceAudio,
  VoiceClip,
  BackgroundMusic,
  BRollClip,
  AvatarVideo,
  SlidesAsset,
} from "../validators/assets.validators";
import { formatGammaContent } from "../lib/production-formatters";
import { inspectLocalVideoFile } from "../media/video-file-metadata.client";

interface UseProductionAssetStateParams {
  component: MaterialComponent;
  onAssetChange?: (
    componentId: string,
    assets: Partial<MaterialAssets>,
  ) => Promise<void> | void;
  onGeneratePrompts: (
    componentId: string,
    storyboard: StoryboardItem[],
  ) => Promise<string>;
}

function isValidHttpUrl(url: string) {
  if (!url) {
    return true;
  }
  return url.startsWith("https://") || url.startsWith("http://");
}

function isRestPendingHeygenStatus(status: unknown) {
  return (
    status === "PENDING" ||
    status === "QUEUED" ||
    status === "RUNNING" ||
    status === "WAITING_PROVIDER" ||
    status === "RETRY_SCHEDULED"
  );
}

function formatHeygenProviderFailure(result: Record<string, unknown>) {
  if (result.providerErrorCode === "MOVIO_PAYMENT_INSUFFICIENT_CREDIT") {
    return "HeyGen no tiene creditos API suficientes. Recarga creditos API en HeyGen y vuelve a generar.";
  }
  return typeof result.providerErrorMessage === "string" && result.providerErrorMessage
    ? result.providerErrorMessage
    : "HeyGen reporto la generacion como fallida.";
}

function isRenderableSlideImage(file: File) {
  const imageMimeTypes = new Set([
    "image/png",
    "image/jpeg",
  ]);
  const extension = file.name.split(".").pop()?.toLowerCase();

  return (
    imageMimeTypes.has(file.type) ||
    extension === "png" ||
    extension === "jpg" ||
    extension === "jpeg"
  );
}

interface HeygenPreset {
  id: string;
  is_default?: boolean;
  name?: string | null;
}

type HeygenEngine = "avatar_iv" | "avatar_v";
type HeygenResolution = "720p" | "1080p" | "4k";
type HeygenAspectRatio = "16:9" | "9:16";
type VoiceUploadStatus =
  | "idle"
  | "validating"
  | "uploading"
  | "saving"
  | "succeeded"
  | "failed";

function isHtmlSlideFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return (
    file.type === "text/html" ||
    file.type === "application/xhtml+xml" ||
    extension === "html" ||
    extension === "htm"
  );
}

function getMimeTypeFromExtension(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  return "application/octet-stream";
}

function naturalSlideNameCompare(left: string, right: string) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

async function expandSlideInputFiles(files: File[]) {
  const expanded: File[] = [];

  for (const file of files) {
    const isZip =
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed" ||
      file.name.toLowerCase().endsWith(".zip");

    if (!isZip) {
      expanded.push(file);
      continue;
    }

    const zip = await JSZip.loadAsync(file);
    const imageEntries = Object.values(zip.files)
      .filter((entry) => {
        const zipFile = new File([], entry.name);
        return !entry.dir && (isRenderableSlideImage(zipFile) || isHtmlSlideFile(zipFile));
      })
      .sort((left, right) => naturalSlideNameCompare(left.name, right.name));

    for (const entry of imageEntries) {
      const blob = await entry.async("blob");
      const fileName = entry.name.split("/").pop() || entry.name;
      expanded.push(
        new File([blob], fileName, {
          type: getMimeTypeFromExtension(fileName),
        }),
      );
    }
  }

  return expanded;
}

function buildSingleUploadedSlideImage(params: {
  file: File;
  fileName: string;
  originalFileName: string;
  publicUrl: string;
  slideIndex?: number;
  height?: number;
  width?: number;
}) {
  if (!isRenderableSlideImage(params.file)) {
    return null;
  }

  return {
    content_type: params.file.type || undefined,
    file_name: params.originalFileName,
    height: params.height,
    slide_index: params.slideIndex ?? 1,
    storage_path: `production-assets/${params.fileName}`,
    public_url: params.publicUrl,
    width: params.width,
  };
}

type VideoMetadata = { duration: number; height: number; width: number };

async function detectDirectVideoMetadata(url: string) {
  return new Promise<VideoMetadata>((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    video.onloadedmetadata = () => {
      const durationRaw = video.duration;
      resolve({
        duration: !Number.isNaN(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : 0,
        height: Number.isFinite(video.videoHeight) ? video.videoHeight : 0,
        width: Number.isFinite(video.videoWidth) ? video.videoWidth : 0,
      });
    };
    video.onerror = () => resolve({ duration: 0, height: 0, width: 0 });
    video.src = url;
  });
}

async function detectDirectVideoDuration(url: string) {
  return (await detectDirectVideoMetadata(url)).duration;
}

async function detectLocalMediaDuration(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    return (await detectDirectVideoMetadata(objectUrl)).duration;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function detectLocalImageDimensions(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<{ height: number; width: number }>((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ height: image.naturalHeight, width: image.naturalWidth });
      image.onerror = () => resolve({ height: 0, width: 0 });
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function assertHyperframesMediaFile(file: File, dimensions?: { height: number; width: number }) {
  if (file.size > MAX_VIDEO_UPLOAD_SIZE_BYTES) {
    throw new Error(
      "La carga reanudable admite hasta 2 GiB. Para archivos mayores divide el video en segmentos.",
    );
  }

  const validation = validateHyperframesMediaAsset({
    deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
    fileName: file.name,
    fileSizeBytes: file.size,
    height: dimensions?.height,
    mimeType: file.type,
    width: dimensions?.width,
  });
  if (!validation.valid) throw new Error(validation.errors.join(" "));
}

export function useProductionAssetState({
  component,
  onAssetChange,
  onGeneratePrompts,
}: UseProductionAssetStateParams) {
  // Legacy states (kept for compatibility and fallback)
  const [bRollPrompts, setBRollPrompts] = useState(component.assets?.b_roll_prompts || "");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [finalVideoSource, setFinalVideoSource] = useState<
    "upload" | "link" | "desktop_worker" | "hyperframes_cloud" | null
  >(
    component.assets?.final_video_source || (component.assets?.final_video_url ? "link" : null)
  );
  const [finalVideoUrl, setFinalVideoUrl] = useState(component.assets?.final_video_url || "");
  const [screencastUrl, setScreencastUrl] = useState(component.assets?.screencast_url || "");
  const [slidesUrl, setSlidesUrl] = useState(component.assets?.slides_url || "");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // New structured visual asset states
  const [voiceAudio, setVoiceAudio] = useState<VoiceAudio | null>(
    (component.assets as any)?.voice_audio || null
  );
  const [voiceClips, setVoiceClips] = useState<VoiceClip[]>(
    (component.assets as any)?.voice_clips || [],
  );
  const [backgroundMusic, setBackgroundMusic] = useState<BackgroundMusic | null>(
    (component.assets as any)?.background_music || null
  );
  const [bRollClips, setBRollClips] = useState<BRollClip[]>(
    (component.assets as any)?.b_roll_clips || []
  );
  const [avatarVideo, setAvatarVideo] = useState<AvatarVideo | null>(
    (component.assets as any)?.avatar_video || null
  );
  const [avatarGenerationMode, setAvatarGenerationMode] =
    useState<AvatarGenerationMode>(
      (component.assets as any)?.avatar_generation_mode || "single_video",
    );
  const [avatarClips, setAvatarClips] = useState<AvatarClip[]>(
    (component.assets as any)?.avatar_clips || [],
  );
  const [slidesAsset, setSlidesAsset] = useState<SlidesAsset | null>(
    (component.assets as any)?.slides || null
  );

  // Loader states
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const [voiceUploadStatus, setVoiceUploadStatus] =
    useState<VoiceUploadStatus>("idle");
  const [voiceUploadFileName, setVoiceUploadFileName] = useState<string | null>(null);
  const [voiceUploadError, setVoiceUploadError] = useState<string | null>(null);
  const [isUploadingMusic, setIsUploadingMusic] = useState(false);
  const [isUploadingBroll, setIsUploadingBroll] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingSlides, setIsUploadingSlides] = useState(false);
  const [isExportingOpenDesign, setIsExportingOpenDesign] = useState(false);
  const [isGeneratingSofliaSlides, setIsGeneratingSofliaSlides] = useState(false);
  const [sofliaSlidesGenerationStatus, setSofliaSlidesGenerationStatus] = useState<string | null>(null);
  const [isPreparingAnimatedDeck, setIsPreparingAnimatedDeck] = useState(false);

  // HeyGen generation states
  const [heygenAvatarPresets, setHeygenAvatarPresets] = useState<HeygenPreset[]>([]);
  const [heygenVoicePresets, setHeygenVoicePresets] = useState<HeygenPreset[]>([]);
  const [isLoadingHeygenPresets, setIsLoadingHeygenPresets] = useState(false);
  const [isSyncingHeygen, setIsSyncingHeygen] = useState(false);
  const [heygenAspectRatio, setHeygenAspectRatio] =
    useState<HeygenAspectRatio>("16:9");
  const [heygenCaptionEnabled, setHeygenCaptionEnabled] = useState(false);
  const [heygenEngine, setHeygenEngine] = useState<HeygenEngine>("avatar_iv");
  const [heygenJobId, setHeygenJobId] = useState<string | null>(null);
  const [heygenJobStatus, setHeygenJobStatus] = useState<string | null>(null);
  const [heygenProviderJobId, setHeygenProviderJobId] = useState<string | null>(null);
  const [heygenResolution, setHeygenResolution] =
    useState<HeygenResolution>("1080p");
  const [selectedHeygenAvatarPresetId, setSelectedHeygenAvatarPresetId] =
    useState("");
  const [selectedHeygenVoicePresetId, setSelectedHeygenVoicePresetId] =
    useState("");
  const [heygenSyncProgress, setHeygenSyncProgress] = useState(0);
  const [heygenError, setHeygenError] = useState<string | null>(null);

  // Artlist integration states
  const [isSearchingArtlist, setIsSearchingArtlist] = useState(false);
  const [isImportingArtlist, setIsImportingArtlist] = useState(false);
  const [artlistSearchResults, setArtlistSearchResults] = useState<any[]>([]);

  // Google Drive integration states
  const [isSearchingGoogleDrive, setIsSearchingGoogleDrive] = useState(false);
  const [isImportingGoogleDrive, setIsImportingGoogleDrive] = useState(false);
  const [googleDriveSearchResults, setGoogleDriveSearchResults] = useState<any[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const voiceFileRef = useRef<HTMLInputElement>(null);
  const musicFileRef = useRef<HTMLInputElement>(null);
  const brollFileRef = useRef<HTMLInputElement>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const slidesFileRef = useRef<HTMLInputElement>(null);

  const videoUrl = component.assets?.video_url || "";

  useEffect(() => {
    void loadHeygenPresets();
    void loadLatestHeygenJob();
  }, []);

  useEffect(() => {
    if (isUploadingVoice) return;
    setVoiceAudio((component.assets as any)?.voice_audio || null);
    setVoiceClips((component.assets as any)?.voice_clips || []);
  }, [component.assets, isUploadingVoice]);

  const loadHeygenPresets = async () => {
    setIsLoadingHeygenPresets(true);
    try {
      const response = await fetch("/api/production/heygen/presets");
      const data = await readApiResponse(response);
      if (!response.ok || !data.success) {
        throw new Error(data.error || "No se pudieron cargar presets HeyGen");
      }

      const avatars = Array.isArray(data.data?.avatars) ? data.data.avatars : [];
      const voices = Array.isArray(data.data?.voices) ? data.data.voices : [];
      setHeygenAvatarPresets(avatars);
      setHeygenVoicePresets(voices);

      const defaultAvatar = avatars.find((avatar: HeygenPreset) => avatar.is_default);
      const defaultVoice = voices.find((voice: HeygenPreset) => voice.is_default);
      setSelectedHeygenAvatarPresetId((current) =>
        current || defaultAvatar?.id || avatars[0]?.id || "",
      );
      setSelectedHeygenVoicePresetId((current) =>
        current || defaultVoice?.id || voices[0]?.id || "",
      );
    } catch (error) {
      console.warn("Could not load HeyGen presets:", error);
    } finally {
      setIsLoadingHeygenPresets(false);
    }
  };

  const loadLatestHeygenJob = async () => {
    try {
      const response = await fetch(
        `/api/production/heygen/jobs?componentId=${component.id}`,
      );
      const data = await readApiResponse(response);
      if (!response.ok || !data.success) {
        throw new Error(data.error || "No se pudo recuperar el job HeyGen");
      }

      const latestJob = data.data?.latestJob;
      if (!latestJob) return;

      setHeygenJobId(latestJob.jobId || null);
      setHeygenJobStatus(latestJob.status || null);
      setHeygenProviderJobId(latestJob.providerJobId || null);
      if (latestJob.status === "FAILED") {
        const providerError = latestJob.providerError || {};
        setHeygenError(formatHeygenProviderFailure({
          providerErrorCode: providerError.code,
          providerErrorMessage: providerError.message || providerError.error_message,
        }));
      }

      const recoveredVoiceAsset = data.data?.voiceAsset;
      if (recoveredVoiceAsset?.publicUrl && recoveredVoiceAsset?.storagePath) {
        const metadata = recoveredVoiceAsset.metadata || {};
        const recoveredVoice: VoiceAudio = {
          duration: recoveredVoiceAsset.durationSeconds || undefined,
          external_id: typeof metadata.provider_request_id === "string"
            ? metadata.provider_request_id
            : undefined,
          file_name:
            (typeof metadata.file_name === "string" && metadata.file_name) ||
            recoveredVoiceAsset.storagePath.split("/").pop(),
          last_uploaded_at:
            (typeof metadata.imported_at === "string" && metadata.imported_at) ||
            latestJob.updatedAt ||
            new Date().toISOString(),
          provider: "heygen",
          public_url: recoveredVoiceAsset.publicUrl,
          script_hash:
            (typeof metadata.script_hash === "string" && metadata.script_hash) ||
            undefined,
          storage_path: recoveredVoiceAsset.storagePath,
          word_timestamps: Array.isArray(metadata.word_timestamps)
            ? metadata.word_timestamps
            : [],
        };
        setVoiceAudio((current) => current || recoveredVoice);
        if (!(component.assets as any)?.voice_audio) {
          void Promise.resolve(
            onAssetChange?.(component.id, { voice_audio: recoveredVoice }),
          ).catch((error) => {
            console.warn("Could not relink recovered HeyGen voice:", error);
          });
        }
      }

      if (data.data?.asset?.publicUrl && data.data?.asset?.storagePath) {
        const recoveredAvatar: AvatarVideo = {
          external_id: latestJob.providerJobId || undefined,
          file_name: data.data.asset.storagePath.split("/").pop(),
          has_audio: true,
          provider: "heygen",
          public_url: data.data.asset.publicUrl,
          storage_path: data.data.asset.storagePath,
          sync_status: "COMPLETED",
        };
        setAvatarVideo((current) => current || recoveredAvatar);
      }

      if (isRestPendingHeygenStatus(latestJob.status)) {
        setHeygenSyncProgress(35);
        setIsSyncingHeygen(true);
        pollHeygenStatus(latestJob.jobId);
      }
    } catch (error) {
      console.warn("Could not recover latest HeyGen job:", error);
    }
  };

  const updateAsset = (
    field: string,
    value: any,
    setter: (nextValue: any) => void,
  ) => {
    setter(value);
    onAssetChange?.(component.id, { [field]: value });
  };

  const copyToClipboard = async (text: string, label = "Copiado") => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      setCopyFeedback(label);
      window.setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_RESET_DELAY_MS);
      return true;
    } catch (error) {
      console.warn("Could not copy to clipboard:", error);
      toast.warning("No se pudo copiar al portapapeles. La exportacion continuo.");
      return false;
    }
  };

  const openInGamma = async () => {
    const formattedContent = formatGammaContent(
      component.content as Record<string, unknown>,
    );

    if (!formattedContent) {
      alert("No hay contenido de guion o storyboard para exportar.");
      return;
    }

    await copyToClipboard(formattedContent, "Estructura copiada");
    window.open("https://gamma.app/create", "_blank");
  };

  // 1. Voice Audio Upload
  const handleVoiceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingVoice(true);
    setVoiceUploadFileName(file.name);
    setVoiceUploadError(null);
    setVoiceUploadStatus("validating");
    try {
      assertHyperframesMediaFile(file);
      setVoiceUploadStatus("uploading");
      const fileName = `voices/${component.id}-voice-${Date.now()}.${file.name.split('.').pop()}`;
      const { publicUrl, path } = await uploadWithSignedUrl(HYPERFRAMES_PRIVATE_SOURCE_BUCKET, fileName, file, {
        componentId: component.id,
      });

      let duration = 0;
      try {
        duration = await detectLocalMediaDuration(file);
      } catch (e) {
        console.warn('Could not auto-detect local voice duration:', e);
      }
      if (!duration) {
        try {
          duration = await detectDirectVideoDuration(publicUrl);
        } catch (e) {
          console.warn('Could not auto-detect uploaded voice duration:', e);
        }
      }

      const newVoice: VoiceAudio = {
        storage_path: `${HYPERFRAMES_PRIVATE_SOURCE_BUCKET}/${path}`,
        public_url: publicUrl,
        file_name: file.name,
        duration: duration || undefined,
        provider: 'upload',
        last_uploaded_at: new Date().toISOString(),
      };
      setVoiceUploadStatus("saving");
      await onAssetChange?.(component.id, { voice_audio: newVoice });
      setVoiceAudio(newVoice);
      setVoiceUploadStatus("succeeded");
      toast.success('Audio de voz subido correctamente');
    } catch (err: any) {
      const message = getErrorMessage(err, "No se pudo completar la carga de voz.");
      setVoiceUploadError(message);
      setVoiceUploadStatus("failed");
      toast.error(`Error al subir voz: ${message}`);
    } finally {
      setIsUploadingVoice(false);
      if (voiceFileRef.current) voiceFileRef.current.value = '';
    }
  };

  // 2. Background Music Upload
  const handleMusicUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingMusic(true);
    try {
      assertHyperframesMediaFile(file);
      const fileName = `music/${component.id}-bg-${Date.now()}.${file.name.split('.').pop()}`;
      const { publicUrl, path } = await uploadWithSignedUrl(HYPERFRAMES_PRIVATE_SOURCE_BUCKET, fileName, file, {
        componentId: component.id,
      });

      const newMusic: BackgroundMusic = {
        storage_path: `${HYPERFRAMES_PRIVATE_SOURCE_BUCKET}/${path}`,
        public_url: publicUrl,
        file_name: file.name,
        volume_multiplier: backgroundMusic?.volume_multiplier ?? 0.15,
      };
      setBackgroundMusic(newMusic);
      onAssetChange?.(component.id, { background_music: newMusic });
      toast.success('Música de fondo subida correctamente');
    } catch (err: any) {
      toast.error(`Error al subir música: ${err.message}`);
    } finally {
      setIsUploadingMusic(false);
      if (musicFileRef.current) musicFileRef.current.value = '';
    }
  };

  // Helper: generates renderable slide images from the component storyboard.
  // Used automatically when uploaded/imported slides contain no renderable images.
  const autoGenerateSlidesFromStoryboard = async (): Promise<boolean> => {
    try {
      const exportResponse = await fetch('/api/production/open-design/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentId: component.id }),
      });

      if (!exportResponse.ok) return false;

      const exportData = await exportResponse.json();
      if (!exportData.success || !Array.isArray(exportData.slideImages) || exportData.slideImages.length === 0) {
        return false;
      }

      const newSlides: SlidesAsset = {
        open_design_project_id: exportData.generatedSlidesId || exportData.openDesignProjectId,
        images: exportData.slideImages,
      };
      const firstSlideUrl = exportData.slideImages[0]?.public_url || "";
      setSlidesAsset(newSlides);
      setSlidesUrl(firstSlideUrl);
      onAssetChange?.(component.id, {
        slides: newSlides,
        slides_url: firstSlideUrl,
      });
      return true;
    } catch {
      return false;
    }
  };

  const prepareUploadedHtmlSlidesAsAnimatedDeck = async (
    preferredHtmlPath: string,
  ): Promise<boolean> => {
    setIsPreparingAnimatedDeck(true);
    try {
      const response = await fetch("/api/production/slides/animated-deck/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        componentId: component.id,
        htmlContentPath: preferredHtmlPath,
      }),
    });
      const data = await readApiResponse(response);

      if (!response.ok || !data.success || !data.assets?.slides?.animated_deck) {
        throw new Error(data.error || "No se pudo preparar el deck animado");
      }

      const newSlides: SlidesAsset = data.assets.slides;

      setSlidesAsset(newSlides);
      setSlidesUrl(newSlides.html_public_url || slidesUrl);
      onAssetChange?.(component.id, {
        final_video_assembly_stale: true,
        slides: newSlides,
        slides_url: newSlides.html_public_url || slidesUrl,
      });
      return true;
    } finally {
      setIsPreparingAnimatedDeck(false);
    }
  };

  // 3. Generated HTML export & Upload ZIP/HTML
  const handleSofliaEngineSlideGeneration = async (
    slideTemplateRunId?: string | null,
    appearance: "light" | "dark" = slidesAsset?.appearance || "light",
    appearanceOnly = false,
  ) => {
    setIsGeneratingSofliaSlides(true);
    setSofliaSlidesGenerationStatus("QUEUED");
    try {
      const regenerationRequestId = crypto.randomUUID();
      const response = await fetch("/api/production/slides/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appearance,
          appearanceOnly,
          componentId: component.id,
          forceRegenerate: true,
          locale: "es",
          metadata: {
            brandLabel: "SofLIA - Engine",
          },
          regenerationRequestId,
          ...(slideTemplateRunId ? { slideTemplateRunId } : {}),
          template: "course-module",
        }),
      });

      let data = await readApiResponse(response);
      if (!response.ok || !data.success) {
        throw new Error(data.error || "No se pudo generar el deck SofLIA - Engine");
      }
      if (response.status === 202 && data.submissionStatus === "QUEUED") {
        toast.info("Deck en cola. La generacion continuara en segundo plano.");
        const completed = await waitForSlideGeneration({
          componentId: component.id,
          jobId: data.jobId,
          onStatus: setSofliaSlidesGenerationStatus,
        });
        data = { success: true, assets: completed.assets };
      }

      let generatedSlides = data.assets?.slides as SlidesAsset | undefined;
      if (appearanceOnly && generatedSlides?.html_content_path) {
        const prepareResponse = await fetch("/api/production/slides/animated-deck/prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            componentId: component.id,
            htmlContentPath: generatedSlides.html_content_path,
          }),
        });
        const preparedData = await readApiResponse(prepareResponse);
        if (!prepareResponse.ok || !preparedData.success || !preparedData.assets?.slides?.animated_deck) {
          throw new Error(preparedData.error || "La apariencia cambió, pero no se pudo actualizar su vista previa.");
        }
        generatedSlides = preparedData.assets.slides as SlidesAsset;
      }
      const generatedSlidesUrl =
        data.assets?.slides_url || generatedSlides?.html_public_url || slidesUrl;

      if (generatedSlides) {
        setSlidesAsset(generatedSlides);
      }
      setSlidesUrl(generatedSlidesUrl);
      const updatedAssets: Partial<MaterialAssets> = {
        final_video_assembly_stale: true,
        production_status: "DECK_READY" as any,
        slides_url: generatedSlidesUrl,
      };
      const nextSlides = generatedSlides || slidesAsset;
      if (nextSlides) {
        updatedAssets.slides = nextSlides;
      }
      onAssetChange?.(component.id, updatedAssets);
      toast.success(
        appearanceOnly
          ? `Apariencia ${appearance === "dark" ? "oscura" : "clara"} aplicada al deck`
          : data.reused
          ? "Deck SofLIA - Engine recuperado"
          : "Deck SofLIA - Engine regenerado",
      );
    } catch (err: any) {
      toast.error(`Error al generar deck SofLIA - Engine: ${err.message}`);
    } finally {
      setIsGeneratingSofliaSlides(false);
      setSofliaSlidesGenerationStatus(null);
    }
  };

  const handleOpenDesignExport = async () => {
    setIsExportingOpenDesign(true);
    try {
      const response = await fetch('/api/production/open-design/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentId: component.id }),
      });

      const data = await readApiResponse(response);
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error al exportar slides');
      }

      const copied = await copyToClipboard(data.html, 'HTML Copiado');

      const newSlides: SlidesAsset = {
        open_design_project_id: data.generatedSlidesId || data.openDesignProjectId,
        images: Array.isArray(data.slideImages)
          ? data.slideImages
          : slidesAsset?.images || [],
      };
      const firstSlideUrl = newSlides.images?.[0]?.public_url || "";
      setSlidesAsset(newSlides);
      setSlidesUrl(firstSlideUrl);
      onAssetChange?.(component.id, {
        slides: newSlides,
        slides_url: firstSlideUrl,
      });
      toast.success(copied
        ? 'Slides exportadas y copiadas al portapapeles'
        : 'Slides exportadas; copia manual requerida');

    } catch (err: any) {
      toast.error(`Error al exportar slides: ${err.message}`);
    } finally {
      setIsExportingOpenDesign(false);
    }
  };

  const handleSlidesZipUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (selectedFiles.length === 0) return;

    setIsUploadingSlides(true);
    try {
      const files = await expandSlideInputFiles(selectedFiles);
      if (files.length === 0) {
        // ZIP contained no renderable images — auto-generate SVGs from the component storyboard
        toast.info("El ZIP no contiene imágenes. Generando slides desde el storyboard...");
        const generated = await autoGenerateSlidesFromStoryboard();
        toast.success(
          generated
            ? "Slides generadas automaticamente para ensamblado"
            : 'No se pudieron generar slides. Usa el botón "Exportar" manualmente.',
        );
        return;
      }

      const uploadedImages: NonNullable<SlidesAsset["images"]> = [];
      let referenceUrl = "";
      let referencePath = "";
      const uploadVersion = Date.now();

      for (const [index, file] of files.entries()) {
        const imageDimensions = isRenderableSlideImage(file)
          ? await detectLocalImageDimensions(file)
          : null;
        if (imageDimensions) {
          if (!imageDimensions.width || !imageDimensions.height) {
            throw new Error(`No se pudo verificar la resolución de “${file.name}”.`);
          }
          assertHyperframesMediaFile(file, imageDimensions);
        }
        const extension = file.name.split(".").pop()?.toLowerCase() || "bin";
        const safeName = file.name
          .replace(/\.[^.]+$/, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40) || `slide-${index + 1}`;
        const fileName = isRenderableSlideImage(file)
          ? `slides/${component.id}-${uploadVersion}-slide-${String(index + 1).padStart(2, "0")}-${safeName}.${extension}`
          : `slides/${component.id}-${uploadVersion}-slides-source.${extension}`;
        const { publicUrl, path } = await uploadWithSignedUrl('production-assets', fileName, file, {
          componentId: component.id,
        });

        if (!referenceUrl) {
          referenceUrl = publicUrl;
          referencePath = `production-assets/${path}`;
        }

        const uploadedImage = buildSingleUploadedSlideImage({
          file,
          fileName: path,
          originalFileName: file.name,
          publicUrl,
          slideIndex: uploadedImages.length + 1,
          height: imageDimensions?.height,
          width: imageDimensions?.width,
        });

        if (uploadedImage) {
          uploadedImages.push(uploadedImage);
        }
      }

      if (uploadedImages.length === 0) {
        const hasHtmlSource = files.some(isHtmlSlideFile);
        const refSlides: SlidesAsset = {
          html_public_url: referenceUrl,
          html_content_path: referencePath,
          images: [],
        };
        setSlidesAsset(refSlides);
        setSlidesUrl(referenceUrl);
        onAssetChange?.(component.id, { slides: refSlides, slides_url: referenceUrl });

        if (hasHtmlSource) {
          toast.info("Preparando deck HTML animado para Remotion...");
          await prepareUploadedHtmlSlidesAsAnimatedDeck(referencePath);
          toast.success("Deck HTML preparado para preview y ensamblado");
          return;
        }

        toast.info("Generando slides para ensamblado desde el storyboard...");
        const generated = await autoGenerateSlidesFromStoryboard();
        toast.success(
          generated
            ? "Slides guardadas y generadas para ensamblado"
            : 'Archivo guardado como referencia. Usa "Exportar" para generar slides renderizables.',
        );
        return;
      }

      const newSlides: SlidesAsset = {
        images: uploadedImages,
      };
      setSlidesAsset(newSlides);
      setSlidesUrl(referenceUrl);
      onAssetChange?.(component.id, {
        slides: newSlides,
        slides_url: referenceUrl,
      });
      toast.success(`${uploadedImages.length} slide(s) renderizable(s) subidas correctamente`);
    } catch (err: any) {
      toast.error(`Error al subir slides: ${err.message}`);
    } finally {
      setIsUploadingSlides(false);
      if (slidesFileRef.current) slidesFileRef.current.value = '';
    }
  };

  // 4. B-Roll Clips Upload
  const handleBrollClipUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingBroll(true);
    try {
      let videoMetadata = await inspectLocalVideoFile(file);
      if (!videoMetadata.width || !videoMetadata.height) {
        throw new Error(`No se pudo verificar la resolución de “${file.name}”. Usa un MP4 o WebM válido.`);
      }
      assertHyperframesMediaFile(file, videoMetadata);
      const clipId = `clip-${Date.now()}`;
      const fileName = `broll/${component.id}-${clipId}.${file.name.split('.').pop()}`;
      const { publicUrl, path } = await uploadWithSignedUrl(HYPERFRAMES_PRIVATE_SOURCE_BUCKET, fileName, file, {
        componentId: component.id,
      });

      if (!videoMetadata.duration || !videoMetadata.width || !videoMetadata.height) {
        try {
          const uploadedMetadata = await detectDirectVideoMetadata(publicUrl);
          videoMetadata = {
            duration: videoMetadata.duration || uploadedMetadata.duration,
            hasAudio: videoMetadata.hasAudio,
            height: videoMetadata.height || uploadedMetadata.height,
            width: videoMetadata.width || uploadedMetadata.width,
          };
        } catch (e) {
          console.warn('Could not detect uploaded clip metadata:', e);
        }
      }

      const newClip: BRollClip = {
        id: clipId,
        storage_path: `${HYPERFRAMES_PRIVATE_SOURCE_BUCKET}/${path}`,
        public_url: publicUrl,
        file_name: file.name,
        duration: videoMetadata.duration || undefined,
        height: videoMetadata.height || undefined,
        has_audio: videoMetadata.hasAudio,
        order: bRollClips.length + 1,
        width: videoMetadata.width || undefined,
      };

      const updatedClips = [...bRollClips, newClip];
      setBRollClips(updatedClips);
      onAssetChange?.(component.id, { b_roll_clips: updatedClips });
      toast.success('Clip de B-Roll subido');
    } catch (err: any) {
      toast.error(`Error al subir clip B-Roll: ${err.message}`);
    } finally {
      setIsUploadingBroll(false);
      if (brollFileRef.current) brollFileRef.current.value = '';
    }
  };

  const removeBrollClip = (clipId: string) => {
    const updatedClips = bRollClips
      .filter((c) => c.id !== clipId)
      .map((c, idx) => ({ ...c, order: idx + 1 }));
    setBRollClips(updatedClips);
    onAssetChange?.(component.id, { b_roll_clips: updatedClips });
    toast.info('Clip de B-roll eliminado');
  };

  const clearVoiceAudio = () => {
    setVoiceAudio(null);
    onAssetChange?.(component.id, { voice_audio: null as any });
    toast.info("Audio de voz removido");
  };

  const clearBackgroundMusic = () => {
    setBackgroundMusic(null);
    onAssetChange?.(component.id, { background_music: null as any });
    toast.info("Música de fondo removida");
  };

  const clearAvatarVideo = () => {
    setAvatarVideo(null);
    setAvatarClips([]);
    setVoiceClips([]);
    onAssetChange?.(component.id, {
      avatar_clips: [],
      avatar_video: null as any,
      voice_clips: [],
    });
    toast.info("Videos de avatar removidos");
  };

  const removeAvatarClip = (clipId: string) => {
    const updatedClips = avatarClips.map((clip) => clip.id === clipId
      ? {
          ...clip,
          error_message: undefined,
          external_id: undefined,
          file_name: undefined,
          job_id: undefined,
          public_url: undefined,
          duration: undefined,
          provider: undefined,
          source_hash: undefined,
          status: "DRAFT" as const,
          storage_path: undefined,
        }
      : clip);
    setAvatarClips(updatedClips);
    const updatedVoiceClips = voiceClips.filter((clip) => clip.clip_id !== clipId);
    setVoiceClips(updatedVoiceClips);
    onAssetChange?.(component.id, {
      avatar_clips: updatedClips,
      voice_clips: updatedVoiceClips,
    });
    toast.info("Video de avatar retirado; la escena queda disponible para regenerar");
  };

  const clearSlidesAsset = () => {
    setSlidesAsset(null);
    setSlidesUrl("");
    onAssetChange?.(component.id, { slides: null as any, slides_url: "" });
    toast.info("Diapositivas removidas");
  };

  // 5. Avatar Video Upload & Heygen Sync
  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingAvatar(true);
    try {
      const videoMetadata = await inspectLocalVideoFile(file);
      if (!videoMetadata.width || !videoMetadata.height) {
        throw new Error(`No se pudo verificar la resolución de “${file.name}”. Usa un MP4 o WebM válido.`);
      }
      assertHyperframesMediaFile(file, videoMetadata);
      const fileName = `avatars/${component.id}-avatar-${Date.now()}.${file.name.split('.').pop()}`;
      const { publicUrl, path } = await uploadWithSignedUrl(HYPERFRAMES_PRIVATE_SOURCE_BUCKET, fileName, file, {
        componentId: component.id,
      });

      let duration = videoMetadata.duration;
      if (!duration) {
        try {
          duration = await detectDirectVideoDuration(publicUrl);
        } catch (e) {
          console.warn('Could not detect uploaded avatar duration:', e);
        }
      }

      const storagePath = `${HYPERFRAMES_PRIVATE_SOURCE_BUCKET}/${path}`;
      const newAvatar: AvatarVideo = {
        storage_path: storagePath,
        public_url: publicUrl,
        file_name: file.name,
        duration: duration || undefined,
        height: videoMetadata.height,
        has_audio: videoMetadata.hasAudio,
        provider: 'upload',
        width: videoMetadata.width,
      };

      // This picker represents the authoritative full-avatar source. Scene
      // clips are managed in the avatar module; inheriting its previous mode
      // here silently classified complete uploads as fragments.
      setAvatarGenerationMode("single_video");
      setAvatarClips([]);
      setAvatarVideo(newAvatar);
      const avatarUpdate: Partial<MaterialAssets> = {
        avatar_generation_mode: "single_video",
        avatar_clips: [],
        avatar_video: newAvatar,
      };
      await onAssetChange?.(component.id, avatarUpdate);
      toast.success('Video completo de avatar subido');
    } catch (err: any) {
      toast.error(`Error al subir avatar: ${err.message}`);
    } finally {
      setIsUploadingAvatar(false);
      if (avatarFileRef.current) avatarFileRef.current.value = '';
    }
  };

  const handleHeygenSync = async () => {
    setIsSyncingHeygen(true);
    setHeygenSyncProgress(10);
    setHeygenError(null);
    try {
      const response = await fetch("/api/production/heygen/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentId: component.id,
          aspectRatio: heygenAspectRatio,
          autoPromote: true,
          avatarPresetId: selectedHeygenAvatarPresetId || undefined,
          caption: heygenCaptionEnabled,
          engine: heygenEngine,
          outputFormat: "mp4",
          resolution: heygenResolution,
          voicePresetId: selectedHeygenVoicePresetId || undefined,
        }),
      });

      const data = await readApiResponse(response);
      if (response.status === 202 && data.success) {
        setHeygenJobId(null);
        setHeygenProviderJobId(data.data?.providerJobId || null);
        setHeygenJobStatus(data.data?.status || "QUEUED");
        setHeygenSyncProgress(25);
        setHeygenError(null);
        setIsSyncingHeygen(false);
        toast.info("Generacion en cola. El envio a HeyGen continuara en segundo plano.");
        window.setTimeout(() => void loadLatestHeygenJob(), 1_500);
        window.setTimeout(() => void loadLatestHeygenJob(), 4_000);
        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(
          [data.error, data.hint].filter(Boolean).join(" ") ||
            "Error al generar video con HeyGen",
        );
      }

      const jobId = data.data?.jobId;
      setHeygenJobId(jobId || null);
      setHeygenProviderJobId(data.data?.providerJobId || null);
      setHeygenJobStatus(data.data?.status || null);
      setHeygenSyncProgress(35);
      toast.success("Video enviado a HeyGen");

      if (jobId) {
        pollHeygenStatus(jobId);
      } else {
        setIsSyncingHeygen(false);
      }
    } catch (err: any) {
      console.error(err);
      setHeygenSyncProgress(0);
      setIsSyncingHeygen(false);
      setHeygenError(err.message || 'Error de importación');
      toast.error(`Error de importación: ${err.message}`);
    } finally {
      // Polling clears this state when HeyGen finishes or times out.
    }
  };

  const pollHeygenStatus = (jobId: string) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      if (attempts > 30) {
        clearInterval(interval);
        setHeygenError('Tiempo de espera agotado para el render de Heygen');
        setIsSyncingHeygen(false);
        return;
      }

      try {
        const response = await fetch(
          `/api/production/heygen/jobs/${jobId}?autoPromote=true`,
        );

        if (response.ok) {
          const data = await readApiResponse(response);
          const result = data.data;
          setHeygenJobStatus(result.status || null);
          setHeygenProviderJobId(result.providerJobId || null);

          if (result.status === "SUCCEEDED" && result.asset) {
            const newAvatar: AvatarVideo = {
              external_id: result.providerJobId || undefined,
              file_name: result.asset.storagePath.split("/").pop(),
              has_audio: false,
              provider: "heygen",
              public_url: result.asset.publicUrl,
              storage_path: result.asset.storagePath,
              sync_status: "COMPLETED",
              script_hash: result.scriptHash || undefined,
            };
            const generatedVoice: VoiceAudio | null = result.voiceAsset
              ? {
                  duration: result.voiceAsset.durationSeconds || undefined,
                  external_id: result.voiceAsset.providerRequestId || undefined,
                  file_name: result.voiceAsset.storagePath.split("/").pop(),
                  last_uploaded_at: new Date().toISOString(),
                  provider: "heygen",
                  public_url: result.voiceAsset.publicUrl,
                  storage_path: result.voiceAsset.storagePath,
                  script_hash: result.scriptHash || undefined,
                  word_timestamps: result.voiceAsset.wordTimestamps || [],
                }
              : null;
            clearInterval(interval);
            setHeygenSyncProgress(100);
            setAvatarVideo(newAvatar);
            if (generatedVoice) setVoiceAudio(generatedVoice);
            setAvatarGenerationMode("single_video");
            setAvatarClips([]);
            setVoiceClips([]);
            onAssetChange?.(component.id, {
              avatar_generation_mode: "single_video",
              avatar_clips: [],
              voice_clips: [],
              avatar_video: newAvatar,
              ...(generatedVoice ? { voice_audio: generatedVoice } : {}),
            });
            setIsSyncingHeygen(false);
            toast.success(
              generatedVoice
                ? "Voz y avatar de HeyGen importados como pistas separadas"
                : "Video de HeyGen importado correctamente",
            );
          } else if (result.status === "FAILED") {
            clearInterval(interval);
            const failureMessage = formatHeygenProviderFailure(result);
            setHeygenError(failureMessage);
            toast.error(failureMessage);
            setIsSyncingHeygen(false);
          } else {
            setHeygenSyncProgress((prev) => Math.min(prev + 5, 95));
          }
        } else if (response.status !== 202) {
          clearInterval(interval);
          const data = await readApiResponse(response);
          setHeygenError(data.error || 'Error de importación');
          setIsSyncingHeygen(false);
        } else {
          setHeygenSyncProgress((prev) => Math.min(prev + 5, 95));
        }
      } catch (err) {
        console.error('Heygen polling error:', err);
      }
    }, 5000);
  };

  const handleHeygenStatusCheck = () => {
    if (!heygenJobId) {
      toast.error("No hay job activo de HeyGen para consultar.");
      return;
    }

    setIsSyncingHeygen(true);
    setHeygenError(null);
    pollHeygenStatus(heygenJobId);
  };

  // Original generate prompts handler (adapted)
  const handleGeneratePrompts = async () => {
    setIsGenerating(true);

    try {
      const storyboard =
        ((component.content as { storyboard?: StoryboardItem[] }).storyboard || []);

      if (!storyboard.length) {
        alert("No storyboard found for this component");
        return;
      }

      const prompts = await onGeneratePrompts(component.id, storyboard);
      setBRollPrompts(prompts);
      onAssetChange?.(component.id, { b_roll_prompts: prompts });
    } catch (error) {
      console.error(error);
      const errorMessage = getErrorMessage(error, String(error));

      if (
        errorMessage.includes("429") ||
        errorMessage.includes("RESOURCE_EXHAUSTED") ||
        errorMessage.includes("exhausted")
      ) {
        alert("Limite de API alcanzado. Por favor espera unos minutos e intenta de nuevo.");
      } else {
        alert(`Error al generar prompts: ${errorMessage}`);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Original video upload (adapted)
  const handleVideoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (file.size > MAX_VIDEO_UPLOAD_SIZE_BYTES) {
      toast.error("El video no debe superar 2 GiB. Para videos más grandes, divídelo en segmentos.");
      return;
    }

    setIsUploading(true);

    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${component.id}-${Date.now()}.${fileExt}`;

      const { publicUrl, path } = await uploadWithSignedUrl("production-assets", `videos/${fileName}`, file, {
        componentId: component.id,
      });

      setFinalVideoUrl(publicUrl);
      setFinalVideoSource("upload");
      onAssetChange?.(component.id, {
        final_video_file_name: file.name,
        final_video_source: "upload",
        final_video_storage_path: `production-assets/${path}`,
        final_video_url: publicUrl,
      });
      setUrlError(null);
      toast.success("Video subido correctamente");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(`Error al subir video: ${getErrorMessage(error, "Error desconocido")}`);
    } finally {
      setIsUploading(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  };


  // Artlist Catalog search
  const searchArtlist = async (query: string, type: "music" | "video") => {
    setIsSearchingArtlist(true);
    try {
      const response = await fetch(`/api/production/artlist/search?type=${type}&q=${encodeURIComponent(query)}`);
      const data = await readApiResponse(response);
      if (response.ok && data.success) {
        setArtlistSearchResults(data.results || []);
      } else {
        toast.error(data.error || "Error al buscar en Artlist");
      }
    } catch (e) {
      console.error(e);
      toast.error("Error al conectar con el servidor de búsqueda");
    } finally {
      setIsSearchingArtlist(false);
    }
  };

  // Artlist Direct Import
  const importArtlistAsset = async (assetId: string, type: "music" | "video") => {
    setIsImportingArtlist(true);
    try {
      const response = await fetch("/api/production/artlist/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId,
          type,
          componentId: component.id,
        }),
      });
      const data = await readApiResponse(response);
      if (response.ok && data.success) {
        if (type === "music") {
          setBackgroundMusic(data.assets.background_music);
          onAssetChange?.(component.id, { background_music: data.assets.background_music });
          toast.success("Música importada exitosamente de Artlist");
        } else {
          setBRollClips(data.assets.b_roll_clips);
          onAssetChange?.(component.id, { b_roll_clips: data.assets.b_roll_clips });
          toast.success("Clip de B-roll importado exitosamente de Artlist");
        }
        return true;
      } else {
        toast.error(data.error || "Error al importar el asset");
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error("Error de conexión durante la importación");
      return false;
    } finally {
      setIsImportingArtlist(false);
    }
  };

  // Cloud storage search
  const searchGoogleDrive = async (
    query: string,
    provider: CloudStorageProvider = "google_drive",
  ) => {
    setIsSearchingGoogleDrive(true);
    const providerLabel = provider === "google_drive" ? "Google Drive" : "OneDrive";
    try {
      const response = await fetch(
        `/api/production/cloud-storage/list?q=${encodeURIComponent(query)}&provider=${provider}`,
      );
      const data = await readApiResponse(response);
      if (response.ok && data.success) {
        setGoogleDriveSearchResults(data.files || []);
      } else {
        toast.error(data.error || `Error al buscar en ${providerLabel}`);
      }
    } catch (e) {
      console.error(e);
      toast.error(`Error al conectar con ${providerLabel}`);
    } finally {
      setIsSearchingGoogleDrive(false);
    }
  };

  // Cloud storage direct import
  const importGoogleDriveAsset = async (
    urlOrId: string,
    type: "voice" | "music" | "broll" | "avatar" | "slides",
    accessToken?: string,
    provider: CloudStorageProvider = "google_drive"
  ) => {
    setIsImportingGoogleDrive(true);
    const providerLabel = provider === "google_drive" ? "Google Drive" : "OneDrive";
    try {
      const response = await fetch("/api/production/cloud-storage/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileIdOrUrl: urlOrId,
          provider,
          type,
          componentId: component.id,
          accessToken,
          avatarGenerationMode,
        }),
      });
      const data = await readApiResponse(response);
      if (response.ok && data.success) {
        // Update local states
        switch (type) {
          case "voice":
            setVoiceAudio(data.assets.voice_audio);
            onAssetChange?.(component.id, { voice_audio: data.assets.voice_audio });
            toast.success(`Voz importada exitosamente de ${providerLabel}`);
            break;
          case "music":
            setBackgroundMusic(data.assets.background_music);
            onAssetChange?.(component.id, { background_music: data.assets.background_music });
            toast.success(`Musica importada exitosamente de ${providerLabel}`);
            break;
          case "broll":
            setBRollClips(data.assets.b_roll_clips);
            onAssetChange?.(component.id, { b_roll_clips: data.assets.b_roll_clips });
            toast.success(`Clip de B-roll importado exitosamente de ${providerLabel}`);
            break;
          case "avatar":
            if (avatarGenerationMode === "scene_clips") {
              const importedAvatar = data.assets.avatar_video;
              const newClip: AvatarClip = {
                id: `cloud-${Date.now()}`,
                order: avatarClips.length + 1,
                script_text: importedAvatar?.file_name || "Avatar importado",
                storage_path: importedAvatar?.storage_path,
                public_url: importedAvatar?.public_url,
                file_name: importedAvatar?.file_name,
                duration: importedAvatar?.duration,
                provider,
                status: "COMPLETED",
              };
              const updatedClips = [...avatarClips, newClip];
              setAvatarClips(updatedClips);
              onAssetChange?.(component.id, {
                avatar_generation_mode: "scene_clips",
                avatar_clips: updatedClips,
              });
              toast.success(`Clip de avatar importado exitosamente de ${providerLabel}`);
              break;
            }

            setAvatarVideo(data.assets.avatar_video);
            setAvatarGenerationMode("single_video");
            onAssetChange?.(component.id, {
              avatar_generation_mode: "single_video",
              avatar_video: data.assets.avatar_video,
            });
            toast.success(`Avatar importado exitosamente de ${providerLabel}`);
            break;
          case "slides": {
            const importedSlides: SlidesAsset = data.assets.slides;
            setSlidesAsset(importedSlides);
            setSlidesUrl(data.assets.slides_url || "");
            onAssetChange?.(component.id, {
              slides: importedSlides,
              slides_url: data.assets.slides_url || "",
            });
            toast.success(`Diapositivas importadas exitosamente de ${providerLabel}`);

            // If no renderable images were imported (e.g. HTML file), auto-generate SVGs
            if (!importedSlides?.images?.length) {
              toast.info("Generando slides para ensamblado desde el storyboard...");
              const generated = await autoGenerateSlidesFromStoryboard();
              if (generated) {
                toast.success("Slides generadas automaticamente para ensamblado");
              }
            }
            break;
          }
        }
        return true;
      } else {
        toast.error(data.error || `Error al importar el archivo de ${providerLabel}`);
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error(`Error de conexion durante la importacion de ${providerLabel}`);
      return false;
    } finally {
      setIsImportingGoogleDrive(false);
    }
  };

  return {
    // Legacy states
    bRollPrompts,
    copyFeedback,
    copyToClipboard,
    fileRef,
    finalVideoSource,
    finalVideoUrl,
    handleGeneratePrompts,
    handleVideoUpload,
    isGenerating,
    isUploading,
    openInGamma,
    screencastUrl,
    setFinalVideoSource,
    setShowPreview,
    setUrlError,
    showPreview,
    slidesUrl,
    updateAsset,
    urlError,
    videoUrl,
    setBRollPrompts,
    setFinalVideoUrl,
    setScreencastUrl,
    setSlidesUrl,
    isValidHttpUrl,

    // Structured states & loaders
    voiceAudio,
    voiceClips,
    voiceUploadError,
    voiceUploadFileName,
    voiceUploadStatus,
    backgroundMusic,
    bRollClips,
    avatarClips,
    avatarGenerationMode,
    avatarVideo,
    slidesAsset,
    isUploadingVoice,
    isUploadingMusic,
    isUploadingBroll,
    isUploadingAvatar,
    isUploadingSlides,
    isExportingOpenDesign,
    isGeneratingSofliaSlides,
    sofliaSlidesGenerationStatus,
    isPreparingAnimatedDeck,

    // Refs
    voiceFileRef,
    musicFileRef,
    brollFileRef,
    avatarFileRef,
    slidesFileRef,

    // Heygen sync
    heygenAspectRatio,
    heygenAvatarPresets,
    heygenCaptionEnabled,
    heygenEngine,
    heygenJobId,
    heygenJobStatus,
    heygenProviderJobId,
    heygenResolution,
    isSyncingHeygen,
    isLoadingHeygenPresets,
    selectedHeygenAvatarPresetId,
    selectedHeygenVoicePresetId,
    setHeygenAspectRatio,
    setHeygenCaptionEnabled,
    setHeygenEngine,
    setHeygenResolution,
    setAvatarGenerationMode,
    setSelectedHeygenAvatarPresetId,
    setSelectedHeygenVoicePresetId,
    heygenVoicePresets,
    heygenSyncProgress,
    heygenError,
    loadHeygenPresets,
    handleHeygenSync,
    handleHeygenStatusCheck,

    // Sub-handlers
    handleVoiceUpload,
    handleMusicUpload,
    handleSofliaEngineSlideGeneration,
    handleOpenDesignExport,
    prepareUploadedHtmlSlidesAsAnimatedDeck,
    handleSlidesZipUpload,
    handleBrollClipUpload,
    removeBrollClip,
    clearVoiceAudio,
    clearBackgroundMusic,
    clearAvatarVideo,
    removeAvatarClip,
    clearSlidesAsset,
    handleAvatarUpload,
    // Artlist states and handlers
    isSearchingArtlist,
    isImportingArtlist,
    artlistSearchResults,
    searchArtlist,
    importArtlistAsset,
    setArtlistSearchResults,

    // Google Drive states and handlers
    isSearchingGoogleDrive,
    isImportingGoogleDrive,
    googleDriveSearchResults,
    searchGoogleDrive,
    importGoogleDriveAsset,
    setGoogleDriveSearchResults,
  };
}
