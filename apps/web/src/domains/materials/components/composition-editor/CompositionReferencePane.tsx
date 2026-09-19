"use client";

import type { ChangeEvent, CSSProperties } from "react";
import { ImageIcon, Minus, Plus, Trash2, Upload } from "lucide-react";
import {
  COMPOSITION_REFERENCE_IMAGE_MIME_TYPES,
  COMPOSITION_REFERENCE_MAX_ZOOM,
  COMPOSITION_REFERENCE_MIN_ZOOM,
  isSupportedCompositionReferenceMimeType,
} from "@/domains/production/composition-editor/composition-reference-comparison";
import type { CompositionStudioAsset } from "./composition-studio.types";
import type { CompositionReferenceSource } from "./useCompositionReferenceComparison";
import styles from "./CompositionStudio.module.css";

interface CompositionReferencePaneProps {
  assets: CompositionStudioAsset[];
  canvasHeight: number;
  canvasWidth: number;
  error: string | null;
  loading: boolean;
  onChangeZoom: (delta: number) => void;
  onClear: () => void;
  onImageError: (message: string) => void;
  onResetZoom: () => void;
  onSelectAsset: (asset: CompositionStudioAsset) => void;
  onSelectLocalFile: (file: File) => Promise<void>;
  reference: CompositionReferenceSource | null;
  zoom: number;
}

export function CompositionReferencePane({ assets, canvasHeight, canvasWidth, error, loading, onChangeZoom, onClear, onImageError, onResetZoom, onSelectAsset, onSelectLocalFile, reference, zoom }: CompositionReferencePaneProps) {
  const imageAssets = assets.filter((asset) => asset.valid && Boolean(asset.previewUrl) && isSupportedCompositionReferenceMimeType(asset.mimeType));
  const frameStyle = {
    "--composition-aspect-ratio": canvasWidth / canvasHeight,
    aspectRatio: `${canvasWidth} / ${canvasHeight}`,
  } as CSSProperties;

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void onSelectLocalFile(file);
  };

  return <section className={styles.comparisonPane} aria-label="Imagen de referencia">
    <div className={styles.comparisonHeader}>
      <div>
        <strong>Referencia</strong>
        <small>{reference ? reference.label : "Selecciona una imagen"}</small>
      </div>
      <div className={styles.referenceSourceControls}>
        <select
          aria-label="Seleccionar asset como referencia"
          className={styles.referenceSelect}
          value={reference?.assetId || ""}
          onChange={(event) => {
            const asset = imageAssets.find((candidate) => candidate.id === event.target.value);
            if (asset) onSelectAsset(asset);
          }}
        >
          <option value="">Asset del proyecto…</option>
          {imageAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}
        </select>
        <label className={styles.referenceUpload} title="Cargar una imagen local">
          <Upload size={12} aria-hidden="true" />
          <span>Cargar</span>
          <input className="sr-only" type="file" accept={COMPOSITION_REFERENCE_IMAGE_MIME_TYPES.join(",")} onChange={handleFile} />
        </label>
      </div>
    </div>
    <div className={styles.previewStage}>
      <div className={styles.referenceFrame} style={frameStyle}>
        {reference
          ? <>{/* Blob URLs and signed asset previews cannot use Next Image optimization safely. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={reference.key}
              alt={`Referencia: ${reference.label}`}
              className={styles.referenceImage}
              draggable={false}
              onError={() => onImageError("No se pudo mostrar la imagen de referencia seleccionada.")}
              src={reference.url}
              style={{ transform: `scale(${zoom})` }}
            /></>
          : <div className={styles.referencePlaceholder}><ImageIcon size={28} aria-hidden="true" /><span>{loading ? "Validando imagen…" : "Carga una imagen o elige un asset"}</span><small>PNG, JPEG o WebP · máximo 20 MB</small></div>}
      </div>
    </div>
    <div className={styles.referenceFooter}>
      <span title="La referencia es temporal y no forma parte del render">{reference?.width && reference.height ? `${reference.width} × ${reference.height}px · solo vista` : "Solo vista · no se exporta"}</span>
      <div className={styles.referenceZoomControls} aria-label="Zoom de referencia">
        <button type="button" disabled={!reference || zoom <= COMPOSITION_REFERENCE_MIN_ZOOM} onClick={() => onChangeZoom(-0.1)} aria-label="Alejar referencia"><Minus size={12} /></button>
        <button type="button" disabled={!reference} onClick={onResetZoom} title="Restablecer zoom">{Math.round(zoom * 100)}%</button>
        <button type="button" disabled={!reference || zoom >= COMPOSITION_REFERENCE_MAX_ZOOM} onClick={() => onChangeZoom(0.1)} aria-label="Acercar referencia"><Plus size={12} /></button>
        <button type="button" disabled={!reference} onClick={onClear} aria-label="Quitar referencia" title="Quitar referencia"><Trash2 size={12} /></button>
      </div>
    </div>
    {error && <p role="alert" className={styles.referenceError}>{error}</p>}
  </section>;
}
