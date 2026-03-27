"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/utils/supabase/client";
import {
  fetchVideoMetadata,
  getVideoProviderAndId,
  MAX_VIDEO_UPLOAD_SIZE_BYTES,
  PRODUCTION_VIDEOS_BUCKET,
} from "@/lib/video-platform";
import type {
  MaterialAssets,
  MaterialComponent,
  StoryboardItem,
} from "../types/materials.types";
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
  const [bRollPrompts, setBRollPrompts] = useState(
    component.assets?.b_roll_prompts || "",
  );
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [finalVideoSource, setFinalVideoSource] = useState<
    "upload" | "link" | null
  >(component.assets?.final_video_source || (component.assets?.final_video_url ? "link" : null));
  const [finalVideoUrl, setFinalVideoUrl] = useState(
    component.assets?.final_video_url || "",
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [screencastUrl, setScreencastUrl] = useState(
    component.assets?.screencast_url || "",
  );
  const [showPreview, setShowPreview] = useState(false);
  const [slidesUrl, setSlidesUrl] = useState(component.assets?.slides_url || "");
  const [urlError, setUrlError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoUrl = component.assets?.video_url || "";

  const updateAsset = (
    field: string,
    value: string,
    setter: (nextValue: string) => void,
  ) => {
    setter(value);
    onAssetChange?.(component.id, { [field]: value });
  };

  const copyToClipboard = (text: string, label = "Copiado") => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(label);
    window.setTimeout(() => setCopyFeedback(null), 2000);
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes("429") ||
        errorMessage.includes("RESOURCE_EXHAUSTED") ||
        errorMessage.includes("exhausted")
      ) {
        alert(
          "Limite de API alcanzado. Por favor espera unos minutos e intenta de nuevo.",
        );
      } else {
        alert(`Error al generar prompts: ${errorMessage}`);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleVideoUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (file.size > MAX_VIDEO_UPLOAD_SIZE_BYTES) {
      toast.error(
        "El video no debe superar los 500MB. Para videos mas grandes, usa YouTube/Vimeo.",
      );
      return;
    }

    setIsUploading(true);
    const supabase = createClient();

    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${component.id}-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from(PRODUCTION_VIDEOS_BUCKET)
        .upload(fileName, file);

      if (uploadError) {
        throw uploadError;
      }

      const {
        data: { publicUrl },
      } = supabase.storage
        .from(PRODUCTION_VIDEOS_BUCKET)
        .getPublicUrl(fileName);

      updateAsset("final_video_url", publicUrl, setFinalVideoUrl);
      setFinalVideoSource("upload");
      setUrlError(null);
      toast.success("Video subido correctamente");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(
        `Error al subir video: ${
          error instanceof Error ? error.message : "Error desconocido"
        }`,
      );
    } finally {
      setIsUploading(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  };

  const handleSave = async () => {
    if (finalVideoUrl && !isValidHttpUrl(finalVideoUrl)) {
      setUrlError("La URL debe comenzar con https:// o http://");
      toast.error("URL del video final no es valida");
      return;
    }

    setIsSaving(true);

    try {
      const assets: Partial<MaterialAssets> = {};
      if (slidesUrl) assets.slides_url = slidesUrl;
      if (videoUrl) assets.video_url = videoUrl;
      if (screencastUrl) assets.screencast_url = screencastUrl;
      if (bRollPrompts) assets.b_roll_prompts = bRollPrompts;
      if (finalVideoUrl) assets.final_video_url = finalVideoUrl;
      if (finalVideoSource) assets.final_video_source = finalVideoSource;

      if (finalVideoUrl) {
        try {
          const { provider, id } = getVideoProviderAndId(finalVideoUrl);
          const duration =
            provider === "direct"
              ? await detectDirectVideoDuration(id)
              : (await fetchVideoMetadata(finalVideoUrl)).duration || 0;

          if (duration > 0) {
            assets.video_duration = duration;
          }
        } catch (durationError) {
          console.error("Error auto-detecting duration:", durationError);
        }
      }

      await onSaveAssets(component.id, assets);
    } catch (error) {
      console.error(error);
      alert("Error saving assets");
    } finally {
      setIsSaving(false);
    }
  };

  return {
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
  };
}
