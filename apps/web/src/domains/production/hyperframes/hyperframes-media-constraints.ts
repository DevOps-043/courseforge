import { DEFAULT_COMPOSITION_RENDER_FPS } from "../composition-editor/composition-document.types.constants";
import {
  HYPERFRAMES_ASSET_DELIVERY_MODES,
  HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES,
  type HyperframesAssetDeliveryMode,
} from "./hyperframes.types";
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
export const HYPERFRAMES_REMOTE_AUDIO_MAX_BYTES = 500 * 1024 * 1024;
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
  deliveryMode?: HyperframesAssetDeliveryMode;
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
 * Provider-facing constraints for embedded and remotely delivered media.
 * Remote video is not part of the project upload, so it uses the Storage cap
 * rather than the embedded-project resource cap.
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
  const maxBytes = input.deliveryMode === HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES
    ? remoteMediaMaxBytes(kind, constraint.maxBytes)
    : constraint.maxBytes;
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
  } else if (input.fileSizeBytes > maxBytes) {
    errors.push(
      `“${label}” excede el máximo de ${formatMiB(maxBytes)} (${formatMiB(input.fileSizeBytes)}).`,
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

function remoteMediaMaxBytes(kind: HyperframesMediaKind, embeddedMaxBytes: number) {
  if (kind === "video") return HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES;
  if (kind === "audio") return HYPERFRAMES_REMOTE_AUDIO_MAX_BYTES;
  return embeddedMaxBytes;
}

export function hyperframesMediaRequirements(
  kind: "audio" | "image" | "video",
  deliveryMode: HyperframesAssetDeliveryMode = HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
) {
  const constraint = ALLOWED_MEDIA[kind];
  return {
    formats: constraint.summary,
    maxBytes: deliveryMode === HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES
      ? remoteMediaMaxBytes(kind, constraint.maxBytes)
      : constraint.maxBytes,
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
