"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampCompositionReferenceZoom,
  validateCompositionReferenceImage,
} from "@/domains/production/composition-editor/composition-reference-comparison";
import type { CompositionStudioAsset } from "./composition-studio.types";

export interface CompositionReferenceSource {
  assetId?: string;
  height: number | null;
  key: string;
  kind: "ASSET" | "LOCAL_FILE";
  label: string;
  url: string;
  width: number | null;
}

export function useCompositionReferenceComparison() {
  const localObjectUrlRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reference, setReference] = useState<CompositionReferenceSource | null>(null);
  const [zoom, setZoom] = useState(1);

  const releaseLocalObjectUrl = useCallback(() => {
    if (!localObjectUrlRef.current) return;
    URL.revokeObjectURL(localObjectUrlRef.current);
    localObjectUrlRef.current = null;
  }, []);

  const clear = useCallback(() => {
    requestIdRef.current += 1;
    releaseLocalObjectUrl();
    setError(null);
    setLoading(false);
    setReference(null);
    setZoom(1);
  }, [releaseLocalObjectUrl]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      releaseLocalObjectUrl();
    };
  }, [releaseLocalObjectUrl]);

  const selectAsset = useCallback((asset: CompositionStudioAsset) => {
    const validationError = validateCompositionReferenceImage({
      height: asset.sourceHeight,
      mimeType: asset.mimeType,
      width: asset.sourceWidth,
    });
    if (!asset.valid || !asset.previewUrl || validationError) {
      setError(validationError || "El asset seleccionado no tiene una vista previa válida.");
      return;
    }

    requestIdRef.current += 1;
    releaseLocalObjectUrl();
    setError(null);
    setLoading(false);
    setReference({
      assetId: asset.id,
      height: asset.sourceHeight ?? null,
      key: `asset:${asset.id}`,
      kind: "ASSET",
      label: asset.label,
      url: asset.previewUrl,
      width: asset.sourceWidth ?? null,
    });
    setZoom(1);
  }, [releaseLocalObjectUrl]);

  const selectLocalFile = useCallback(async (file: File) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const metadataError = validateCompositionReferenceImage({
      byteLength: file.size,
      mimeType: file.type,
    });
    if (metadataError) {
      setLoading(false);
      setError(metadataError);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setError(null);
    setLoading(true);

    try {
      const dimensions = await decodeImageDimensions(objectUrl);
      const dimensionsError = validateCompositionReferenceImage({
        byteLength: file.size,
        height: dimensions.height,
        mimeType: file.type,
        width: dimensions.width,
      });
      if (dimensionsError) throw new Error(dimensionsError);
      if (requestIdRef.current !== requestId) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      releaseLocalObjectUrl();
      localObjectUrlRef.current = objectUrl;
      setReference({
        height: dimensions.height,
        key: `local:${requestId}:${file.name}`,
        kind: "LOCAL_FILE",
        label: file.name,
        url: objectUrl,
        width: dimensions.width,
      });
      setZoom(1);
    } catch (cause) {
      URL.revokeObjectURL(objectUrl);
      if (requestIdRef.current === requestId) {
        setError(cause instanceof Error ? cause.message : "No se pudo leer la imagen de referencia.");
      }
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [releaseLocalObjectUrl]);

  const changeZoom = useCallback((delta: number) => {
    setZoom((current) => clampCompositionReferenceZoom(current + delta));
  }, []);

  return {
    active,
    changeZoom,
    clear,
    error,
    loading,
    reference,
    resetZoom: () => setZoom(1),
    selectAsset,
    selectLocalFile,
    setActive,
    setError,
    zoom,
  };
}

function decodeImageDimensions(url: string) {
  return new Promise<{ height: number; width: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ height: image.naturalHeight, width: image.naturalWidth });
    image.onerror = () => reject(new Error("El archivo no contiene una imagen válida o está dañado."));
    image.src = url;
  });
}
