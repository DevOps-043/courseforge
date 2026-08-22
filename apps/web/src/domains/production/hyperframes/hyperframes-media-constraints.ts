import { DEFAULT_COMPOSITION_RENDER_FPS } from "../composition-editor/composition-document.types.constants";
import {
  DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID,
  getHyperframesRenderProfile,
  toHyperframesRenderSettings,
} from "./hyperframes-render-profiles";

export const HYPERFRAMES_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const HYPERFRAMES_AUDIO_MAX_BYTES = 50 * 1024 * 1024;
export const HYPERFRAMES_IMAGE_MAX_BYTES = 50 * 1024 * 1024;
export const HYPERFRAMES_FONT_MAX_BYTES = 50 * 1024 * 1024;
export const HYPERFRAMES_MEDIA_MAX_DIMENSION_PX = 1_920;
export const HYPERFRAMES_DURABLE_RENDER_PROFILE = toHyperframesRenderSettings(
  getHyperframesRenderProfile(DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID),
);

if (HYPERFRAMES_DURABLE_RENDER_PROFILE.fps !== DEFAULT_COMPOSITION_RENDER_FPS) {
  throw new Error("El FPS predeterminado del documento y del render deben coincidir.");
}

const ALLOWED_MEDIA = {
  audio: {
    extensions: new Set(["mp3", "wav"]),
    mimeTypes: new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"]),
    maxBytes: HYPERFRAMES_AUDIO_MAX_BYTES,
    summary: "MP3 o WAV",
  },
  font: {
    extensions: new Set(["otf", "ttf", "woff", "woff2"]),
    mimeTypes: new Set([
      "font/otf",
      "font/sfnt",
      "font/ttf",
      "font/woff",
      "font/woff2",
    ]),
    maxBytes: HYPERFRAMES_FONT_MAX_BYTES,
    summary: "OTF, TTF, WOFF o WOFF2",
  },
  image: {
    extensions: new Set(["jpeg", "jpg", "png"]),
    mimeTypes: new Set(["image/jpeg", "image/png"]),
    maxBytes: HYPERFRAMES_IMAGE_MAX_BYTES,
    summary: "JPG o PNG",
  },
  video: {
    extensions: new Set(["mp4", "webm"]),
    mimeTypes: new Set(["video/mp4", "video/webm"]),
    maxBytes: HYPERFRAMES_VIDEO_MAX_BYTES,
    summary: "MP4 o WebM",
  },
} as const;

type HyperframesMediaKind = keyof typeof ALLOWED_MEDIA;

export interface HyperframesMediaValidationInput {
  fileName?: string | null;
  fileSizeBytes?: number | null;
  height?: number | null;
  mimeType?: string | null;
  width?: number | null;
}

export interface HyperframesMediaValidationResult {
  errors: string[];
  kind: HyperframesMediaKind | null;
  valid: boolean;
}

/**
 * Provider-facing constraints for every media file packaged in a HyperFrames
 * project. Unknown dimensions remain allowed for historical assets, while all
 * new browser uploads measure them before reaching Storage.
 */
export function validateHyperframesMediaAsset(
  input: HyperframesMediaValidationInput,
): HyperframesMediaValidationResult {
  const mimeType = input.mimeType?.trim().toLowerCase() || "";
  const extension = fileExtension(input.fileName);
  const kind = mediaKind(mimeType, extension);
  const label = input.fileName?.trim() || "El archivo";
  const errors: string[] = [];

  if (!kind) {
    errors.push(`“${label}” no es un medio compatible con HyperFrames.`);
    return { errors, kind: null, valid: false };
  }

  const constraint = ALLOWED_MEDIA[kind];
  const extensionMatches = !extension || constraint.extensions.has(extension as never);
  const mimeMatches = !mimeType || constraint.mimeTypes.has(mimeType as never);
  if (!extensionMatches || !mimeMatches) {
    errors.push(`“${label}” tiene un formato no admitido. Usa ${constraint.summary}.`);
  }

  if (
    typeof input.fileSizeBytes !== "number"
    || !Number.isSafeInteger(input.fileSizeBytes)
    || input.fileSizeBytes <= 0
  ) {
    errors.push(`No se pudo verificar el tamaño de “${label}”.`);
  } else if (input.fileSizeBytes > constraint.maxBytes) {
    errors.push(
      `“${label}” excede el máximo de ${formatMiB(constraint.maxBytes)} (${formatMiB(input.fileSizeBytes)}).`,
    );
  }

  if (kind === "video" || kind === "image") {
    const width = positiveInteger(input.width);
    const height = positiveInteger(input.height);
    if (width && height && Math.max(width, height) > HYPERFRAMES_MEDIA_MAX_DIMENSION_PX) {
      errors.push(
        `“${label}” usa ${width}×${height}. La resolución máxima permitida es 1920 px en el lado mayor (1920×1080 o 1080×1920).`,
      );
    }
  }

  return { errors, kind, valid: errors.length === 0 };
}

export function hyperframesMediaRequirements(kind: "audio" | "image" | "video") {
  const constraint = ALLOWED_MEDIA[kind];
  return {
    formats: constraint.summary,
    maxBytes: constraint.maxBytes,
    maxDimensionPx: kind === "audio" ? null : HYPERFRAMES_MEDIA_MAX_DIMENSION_PX,
  };
}

function mediaKind(mimeType: string, extension: string | null): HyperframesMediaKind | null {
  const mimePrefix = mimeType.split("/", 1)[0];
  if (mimePrefix && mimePrefix in ALLOWED_MEDIA) return mimePrefix as HyperframesMediaKind;
  for (const [kind, constraint] of Object.entries(ALLOWED_MEDIA)) {
    if (extension && constraint.extensions.has(extension as never)) return kind as HyperframesMediaKind;
  }
  return null;
}

function fileExtension(fileName: string | null | undefined) {
  const cleanName = fileName?.split(/[?#]/, 1)[0] || "";
  const extension = cleanName.includes(".") ? cleanName.split(".").pop()?.toLowerCase() : null;
  return extension || null;
}

function positiveInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function formatMiB(value: number) {
  const mib = value / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib.toFixed(0) : mib.toFixed(1)} MiB`;
}
