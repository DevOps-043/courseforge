export const COMPOSITION_REFERENCE_MAX_BYTES = 20 * 1024 * 1024;
export const COMPOSITION_REFERENCE_MAX_EDGE_PIXELS = 16_384;
export const COMPOSITION_REFERENCE_MAX_PIXELS = 40_000_000;
export const COMPOSITION_REFERENCE_MIN_ZOOM = 0.5;
export const COMPOSITION_REFERENCE_MAX_ZOOM = 2;

export const COMPOSITION_REFERENCE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const SUPPORTED_IMAGE_MIME_TYPES = new Set<string>(COMPOSITION_REFERENCE_IMAGE_MIME_TYPES);

export interface CompositionReferenceImageMetadata {
  byteLength?: number;
  height?: number;
  mimeType: string;
  width?: number;
}

export function isSupportedCompositionReferenceMimeType(mimeType: string) {
  return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

export function validateCompositionReferenceImage(
  metadata: CompositionReferenceImageMetadata,
): string | null {
  if (!isSupportedCompositionReferenceMimeType(metadata.mimeType)) {
    return "Usa una imagen PNG, JPEG o WebP. SVG, GIF y otros formatos no están permitidos.";
  }

  if (metadata.byteLength !== undefined) {
    if (!Number.isFinite(metadata.byteLength) || metadata.byteLength <= 0) {
      return "El archivo de referencia está vacío o no es válido.";
    }
    if (metadata.byteLength > COMPOSITION_REFERENCE_MAX_BYTES) {
      return "La imagen de referencia supera el límite de 20 MB.";
    }
  }

  if (metadata.width === undefined && metadata.height === undefined) return null;
  if (metadata.width === undefined || metadata.height === undefined) {
    return "No se pudieron validar las dimensiones de la imagen de referencia.";
  }
  if (!Number.isFinite(metadata.width) || !Number.isFinite(metadata.height)
    || metadata.width <= 0 || metadata.height <= 0) {
    return "Las dimensiones de la imagen de referencia no son válidas.";
  }
  if (metadata.width > COMPOSITION_REFERENCE_MAX_EDGE_PIXELS
    || metadata.height > COMPOSITION_REFERENCE_MAX_EDGE_PIXELS) {
    return "La imagen de referencia supera el límite de 16 384 px por lado.";
  }
  if (metadata.width * metadata.height > COMPOSITION_REFERENCE_MAX_PIXELS) {
    return "La imagen de referencia supera el límite de 40 megapíxeles.";
  }
  return null;
}

export function clampCompositionReferenceZoom(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.min(
    COMPOSITION_REFERENCE_MAX_ZOOM,
    Math.max(COMPOSITION_REFERENCE_MIN_ZOOM, value),
  ) * 100) / 100;
}
