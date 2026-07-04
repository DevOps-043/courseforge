"use client";

import { useRef, useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { uploadWithSignedUrl } from "@/lib/storage-upload";
import type { CloudStorageProvider } from "@/domains/production/cloud-storage/types";
import {
  MAX_VIDEO_UPLOAD_SIZE_BYTES,
} from "@/lib/video-platform";
import {
  COPY_FEEDBACK_RESET_DELAY_MS,
} from "@/shared/constants/timing";
import type {
  MaterialAssets,
  MaterialComponent,
  StoryboardItem,
} from "../types/materials.types";
import type {
  VoiceAudio,
  BackgroundMusic,
  BRollClip,
  AvatarVideo,
  SlidesAsset,
} from "../validators/assets.validators";
import { formatGammaContent } from "../lib/production-formatters";

interface UseProductionAssetStateParams {
  component: MaterialComponent;
  onAssetChange?: (
    componentId: string,
    assets: Partial<MaterialAssets>,
  ) => void;
  onGeneratePrompts: (
    componentId: string,
    storyboard: StoryboardItem[],
  ) => Promise<string>;
  onSaveAssets: (
    componentId: string,
    assets: Partial<MaterialAssets>,
  ) => Promise<void>;
}

function isValidHttpUrl(url: string) {
  if (!url) {
    return true;
  }
  return url.startsWith("https://") || url.startsWith("http://");
}

function isRenderableSlideImage(file: File) {
  const imageMimeTypes = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/svg+xml",
  ]);
  const extension = file.name.split(".").pop()?.toLowerCase();

  return (
    imageMimeTypes.has(file.type) ||
    extension === "png" ||
    extension === "jpg" ||
    extension === "jpeg" ||
    extension === "webp" ||
    extension === "svg"
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
      .filter((entry) => !entry.dir && isRenderableSlideImage(new File([], entry.name)))
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
  publicUrl: string;
  slideIndex?: number;
}) {
  if (!isRenderableSlideImage(params.file)) {
    return null;
  }

  return {
    slide_index: params.slideIndex ?? 1,
    storage_path: `production-assets/${params.fileName}`,
    public_url: params.publicUrl,
  };
}

async function detectDirectVideoDuration(url: string) {
  return new Promise<number>((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    video.onloadedmetadata = () => {
      const durationRaw = video.duration;
      resolve(
        !Number.isNaN(durationRaw) && durationRaw > 0
          ? Math.round(durationRaw)
          : 0,
      );
    };
    video.onerror = () => resolve(0);
    video.src = url;
  });
}

export function useProductionAssetState({
  component,
  onAssetChange,
  onGeneratePrompts,
  onSaveAssets,
}: UseProductionAssetStateParams) {
  // Legacy states (kept for compatibility and fallback)
  const [bRollPrompts, setBRollPrompts] = useState(component.assets?.b_roll_prompts || "");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [finalVideoSource, setFinalVideoSource] = useState<"upload" | "link" | null>(
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
  const [backgroundMusic, setBackgroundMusic] = useState<BackgroundMusic | null>(
    (component.assets as any)?.background_music || null
  );
  const [bRollClips, setBRollClips] = useState<BRollClip[]>(
    (component.assets as any)?.b_roll_clips || []
  );
  const [avatarVideo, setAvatarVideo] = useState<AvatarVideo | null>(
    (component.assets as any)?.avatar_video || null
  );
  const [slidesAsset, setSlidesAsset] = useState<SlidesAsset | null>(
    (component.assets as any)?.slides || null
  );

  // Loader states
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const [isUploadingMusic, setIsUploadingMusic] = useState(false);
  const [isUploadingBroll, setIsUploadingBroll] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingSlides, setIsUploadingSlides] = useState(false);
  const [isExportingOpenDesign, setIsExportingOpenDesign] = useState(false);

  // Heygen synchronization states
  const [isSyncingHeygen, setIsSyncingHeygen] = useState(false);
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

  const updateAsset = (
    field: string,
    value: any,
    setter: (nextValue: any) => void,
  ) => {
    setter(value);
    onAssetChange?.(component.id, { [field]: value });
  };

  const copyToClipboard = (text: string, label = "Copiado") => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(label);
    window.setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_RESET_DELAY_MS);
  };

  const openInGamma = () => {
    const formattedContent = formatGammaContent(
      component.content as Record<string, unknown>,
    );

    if (!formattedContent) {
      alert("No hay contenido de guion o storyboard para exportar.");
      return;
    }

    copyToClipboard(formattedContent, "Estructura copiada");
    window.open("https://gamma.app/create", "_blank");
  };

  // 1. Voice Audio Upload
  const handleVoiceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingVoice(true);
    try {
      const fileName = `voices/${component.id}-voice.${file.name.split('.').pop()}`;
      const { publicUrl } = await uploadWithSignedUrl('production-assets', fileName, file, {
        componentId: component.id,
      });

      // Estimate duration roughly (fallback) or detect via direct metadata
      let duration = 0;
      try {
        duration = await detectDirectVideoDuration(publicUrl);
      } catch (e) {
        console.warn('Could not auto-detect voice duration:', e);
      }

      const newVoice: VoiceAudio = {
        storage_path: `production-assets/${fileName}`,
        public_url: publicUrl,
        duration: duration || undefined,
        provider: 'elevenlabs',
        last_uploaded_at: new Date().toISOString(),
      };
      setVoiceAudio(newVoice);
      onAssetChange?.(component.id, { voice_audio: newVoice });
      toast.success('Audio de voz subido correctamente');
    } catch (err: any) {
      toast.error(`Error al subir voz: ${err.message}`);
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
      const fileName = `music/${component.id}-bg.${file.name.split('.').pop()}`;
      const { publicUrl } = await uploadWithSignedUrl('production-assets', fileName, file, {
        componentId: component.id,
      });

      const newMusic: BackgroundMusic = {
        storage_path: `production-assets/${fileName}`,
        public_url: publicUrl,
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

  // Update volume multiplier for background music
  const handleVolumeChange = (volume: number) => {
    if (!backgroundMusic) return;
    const newMusic = { ...backgroundMusic, volume_multiplier: volume };
    setBackgroundMusic(newMusic);
    onAssetChange?.(component.id, { background_music: newMusic });
  };

  // Helper: generates renderable slide images from the component storyboard.
  // Used automatically when uploaded/imported slides contain no renderable images.
  const autoGenerateSlidesFromStoryboard = async (
    preferredHtmlUrl?: string,
    preferredHtmlPath?: string,
  ): Promise<boolean> => {
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
        // Prefer the user's uploaded file as the HTML reference; fall back to generated HTML
        html_content_path: preferredHtmlPath || `production-assets/slides/${component.id}-slides.html`,
        html_public_url: preferredHtmlUrl || exportData.htmlPublicUrl,
        images: exportData.slideImages,
      };
      setSlidesAsset(newSlides);
      setSlidesUrl(newSlides.html_public_url || '');
      onAssetChange?.(component.id, {
        slides: newSlides,
        slides_url: newSlides.html_public_url || '',
      });
      return true;
    } catch {
      return false;
    }
  };

  // 3. Generated HTML export & Upload ZIP/HTML
  const handleOpenDesignExport = async () => {
    setIsExportingOpenDesign(true);
    try {
      const response = await fetch('/api/production/open-design/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentId: component.id }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error al exportar slides');
      }

      copyToClipboard(data.html, 'HTML Copiado');

      const newSlides: SlidesAsset = {
        open_design_project_id: data.generatedSlidesId || data.openDesignProjectId,
        html_content_path: `production-assets/slides/${component.id}-slides.html`,
        html_public_url: data.htmlPublicUrl,
        images: Array.isArray(data.slideImages)
          ? data.slideImages
          : slidesAsset?.images || [],
      };
      setSlidesAsset(newSlides);
      setSlidesUrl(data.htmlPublicUrl || '');
      onAssetChange?.(component.id, {
        slides: newSlides,
        slides_url: data.htmlPublicUrl || '',
      });
      toast.success('Slides exportadas y copiadas al portapapeles');

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
            ? "Slides generadas automáticamente para Remotion"
            : 'No se pudieron generar slides. Usa el botón "Exportar" manualmente.',
        );
        return;
      }

      const uploadedImages: NonNullable<SlidesAsset["images"]> = [];
      let referenceUrl = "";
      let referencePath = "";

      for (const [index, file] of files.entries()) {
        const extension = file.name.split(".").pop()?.toLowerCase() || "bin";
        const safeName = file.name
          .replace(/\.[^.]+$/, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40) || `slide-${index + 1}`;
        const fileName = isRenderableSlideImage(file)
          ? `slides/${component.id}-slide-${String(index + 1).padStart(2, "0")}-${safeName}.${extension}`
          : `slides/${component.id}-slides-source.${extension}`;
        const { publicUrl } = await uploadWithSignedUrl('production-assets', fileName, file, {
          componentId: component.id,
        });

        if (!referenceUrl) {
          referenceUrl = publicUrl;
          referencePath = `production-assets/${fileName}`;
        }

        const uploadedImage = buildSingleUploadedSlideImage({
          file,
          fileName,
          publicUrl,
          slideIndex: uploadedImages.length + 1,
        });

        if (uploadedImage) {
          uploadedImages.push(uploadedImage);
        }
      }

      if (uploadedImages.length === 0) {
        // Non-renderable file (e.g. HTML) uploaded as reference — also generate SVGs for Remotion
        const refSlides: SlidesAsset = {
          ...slidesAsset,
          html_public_url: referenceUrl,
          html_content_path: referencePath,
          images: slidesAsset?.images || [],
        };
        setSlidesAsset(refSlides);
        setSlidesUrl(referenceUrl);
        onAssetChange?.(component.id, { slides: refSlides, slides_url: referenceUrl });

        toast.info("Generando slides para Remotion desde el storyboard...");
        const generated = await autoGenerateSlidesFromStoryboard(referenceUrl, referencePath);
        toast.success(
          generated
            ? "Slides guardadas y generadas para Remotion"
            : 'Archivo guardado como referencia. Usa "Exportar" para generar slides renderizables.',
        );
        return;
      }

      const newSlides: SlidesAsset = {
        ...slidesAsset,
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
      const clipId = `clip-${Date.now()}`;
      const fileName = `broll/${component.id}-${clipId}.${file.name.split('.').pop()}`;
      const { publicUrl } = await uploadWithSignedUrl('production-assets', fileName, file, {
        componentId: component.id,
      });

      let duration = 0;
      try {
        duration = await detectDirectVideoDuration(publicUrl);
      } catch (e) {
        console.warn('Could not detect clip duration:', e);
      }

      const newClip: BRollClip = {
        id: clipId,
        storage_path: `production-assets/${fileName}`,
        public_url: publicUrl,
        duration: duration || undefined,
        order: bRollClips.length + 1,
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
    onAssetChange?.(component.id, { avatar_video: null as any });
    toast.info("Video de avatar removido");
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
      const fileName = `avatars/${component.id}-avatar.${file.name.split('.').pop()}`;
      const { publicUrl } = await uploadWithSignedUrl('production-assets', fileName, file, {
        componentId: component.id,
      });

      let duration = 0;
      try {
        duration = await detectDirectVideoDuration(publicUrl);
      } catch (e) {
        console.warn('Could not detect avatar duration:', e);
      }

      const newAvatar: AvatarVideo = {
        storage_path: `production-assets/${fileName}`,
        public_url: publicUrl,
        duration: duration || undefined,
        provider: 'upload',
      };
      setAvatarVideo(newAvatar);
      onAssetChange?.(component.id, { avatar_video: newAvatar });
      toast.success('Video de avatar subido');
    } catch (err: any) {
      toast.error(`Error al subir avatar: ${err.message}`);
    } finally {
      setIsUploadingAvatar(false);
      if (avatarFileRef.current) avatarFileRef.current.value = '';
    }
  };

  const handleHeygenSync = async (videoId: string) => {
    if (!videoId) {
      toast.error('Por favor introduce un ID de Heygen válido');
      return;
    }

    setIsSyncingHeygen(true);
    setHeygenSyncProgress(10);
    setHeygenError(null);
    try {
      const isUrl = videoId.trim().startsWith('http://') || videoId.trim().startsWith('https://');
      const response = await fetch('/api/production/import-external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'heygen',
          componentId: component.id,
          videoId: isUrl ? undefined : videoId.trim(),
          videoUrl: isUrl ? videoId.trim() : undefined,
        }),
      });

      if (response.status === 202) {
        setHeygenSyncProgress(30);
        // Start polling background status
        pollHeygenStatus(videoId.trim());
        return;
      }

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error al importar de Heygen');
      }

      setHeygenSyncProgress(100);
      setAvatarVideo(data.assets.avatar_video);
      
      onAssetChange?.(component.id, {
        avatar_video: data.assets.avatar_video,
      });
      
      toast.success('Video de Heygen transferido e importado correctamente');
    } catch (err: any) {
      console.error(err);
      setHeygenError(err.message || 'Error de importación');
      toast.error(`Error de importación: ${err.message}`);
    } finally {
      setIsSyncingHeygen(false);
    }
  };

  const pollHeygenStatus = (videoId: string) => {
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
        const response = await fetch('/api/production/import-external', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'heygen',
            componentId: component.id,
            videoId,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          clearInterval(interval);
          setHeygenSyncProgress(100);
          setAvatarVideo(data.assets.avatar_video);
          
          onAssetChange?.(component.id, {
            avatar_video: data.assets.avatar_video,
          });
          
          setIsSyncingHeygen(false);
          toast.success('Video de Heygen transferido e importado correctamente');
        } else if (response.status !== 202) {
          clearInterval(interval);
          const data = await response.json();
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
      toast.error("El video no debe superar los 500MB. Para videos mas grandes, usa YouTube/Vimeo.");
      return;
    }

    setIsUploading(true);

    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${component.id}-${Date.now()}.${fileExt}`;

      const { publicUrl } = await uploadWithSignedUrl("production-assets", `videos/${fileName}`, file, {
        componentId: component.id,
      });

      updateAsset("final_video_url", publicUrl, setFinalVideoUrl);
      setFinalVideoSource("upload");
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

  // General save action that submits all structured data to backend
  const handleSave = async () => {
    setIsSaving(true);

    try {
      const assets: Partial<MaterialAssets> = {
        // Legacy compatibility
        slides_url: slidesUrl || undefined,
        video_url: videoUrl || undefined,
        screencast_url: screencastUrl || undefined,
        b_roll_prompts: bRollPrompts || undefined,

        // Structured assets
        voice_audio: voiceAudio || null as any,
        background_music: backgroundMusic || null as any,
        b_roll_clips: bRollClips.length > 0 ? bRollClips : null as any,
        avatar_video: avatarVideo || null as any,
        slides: slidesAsset || null as any,
      };

      await onSaveAssets(component.id, assets);
      toast.success("Assets guardados correctamente");
    } catch (error) {
      console.error(error);
      toast.error("Error al guardar los assets");
    } finally {
      setIsSaving(false);
    }
  };

  // Artlist Catalog search
  const searchArtlist = async (query: string, type: "music" | "video") => {
    setIsSearchingArtlist(true);
    try {
      const response = await fetch(`/api/production/artlist/search?type=${type}&q=${encodeURIComponent(query)}`);
      const data = await response.json();
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
      const data = await response.json();
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
      const data = await response.json();
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
        }),
      });
      const data = await response.json();
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
            setAvatarVideo(data.assets.avatar_video);
            onAssetChange?.(component.id, { avatar_video: data.assets.avatar_video });
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
              toast.info("Generando slides para Remotion desde el storyboard...");
              const generated = await autoGenerateSlidesFromStoryboard(
                importedSlides?.html_public_url,
                importedSlides?.html_content_path,
              );
              if (generated) {
                toast.success("Slides generadas automáticamente para Remotion");
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
    handleSave,
    handleVideoUpload,
    isGenerating,
    isSaving,
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
    backgroundMusic,
    bRollClips,
    avatarVideo,
    slidesAsset,
    isUploadingVoice,
    isUploadingMusic,
    isUploadingBroll,
    isUploadingAvatar,
    isUploadingSlides,
    isExportingOpenDesign,

    // Refs
    voiceFileRef,
    musicFileRef,
    brollFileRef,
    avatarFileRef,
    slidesFileRef,

    // Heygen sync
    isSyncingHeygen,
    heygenSyncProgress,
    heygenError,
    handleHeygenSync,

    // Sub-handlers
    handleVoiceUpload,
    handleMusicUpload,
    handleVolumeChange,
    handleOpenDesignExport,
    handleSlidesZipUpload,
    handleBrollClipUpload,
    removeBrollClip,
    clearVoiceAudio,
    clearBackgroundMusic,
    clearAvatarVideo,
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
