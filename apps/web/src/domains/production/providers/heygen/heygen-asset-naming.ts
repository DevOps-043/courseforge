import type { AvatarClip } from "@/domains/materials/types/materials.types";
import type { ProductionComponentContext } from "../../types/production.types";

const MAX_HEYGEN_TITLE_LENGTH = 120;
const MAX_FILE_STEM_LENGTH = 96;
const HEYGEN_JOB_TOKEN_PREFIX = "CFJOB-";
const HEYGEN_JOB_TOKEN_LENGTH = HEYGEN_JOB_TOKEN_PREFIX.length + 36;

export interface HeygenSceneAssetNames {
  audioFileStem: string;
  displayName: string;
  videoFileStem: string;
  videoTitle: string;
}

/**
 * Keeps the provider dashboard readable while embedding a durable Courseforge
 * job identity. If the worker dies after HeyGen accepts the request but before
 * Postgres stores video_id, the catalog can still repair the correlation.
 */
export function buildCorrelatedHeygenVideoTitle(title: string, jobId: string) {
  const suffix = ` · ${HEYGEN_JOB_TOKEN_PREFIX}${jobId}`;
  return `${title.slice(0, Math.max(0, MAX_HEYGEN_TITLE_LENGTH - suffix.length))}${suffix}`;
}

export function readHeygenJobIdFromVideoTitle(title: unknown) {
  if (typeof title !== "string") return null;
  const match = title.match(new RegExp(`${HEYGEN_JOB_TOKEN_PREFIX}([0-9a-f-]{36})$`, "i"));
  if (!match || match[0].length !== HEYGEN_JOB_TOKEN_LENGTH) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(match[1])
    ? match[1].toLowerCase()
    : null;
}

/**
 * Produces one stable, human-readable identity for every scene asset. HeyGen
 * exposes the video title in its dashboard; the same identity is retained when
 * the generated MP4 and voice MP3 return to Courseforge Storage.
 */
export function buildHeygenSceneAssetNames(params: {
  clip: Pick<AvatarClip, "asset_name" | "id" | "order">;
  context: Pick<ProductionComponentContext, "artifactTitle" | "lessonTitle" | "moduleTitle">;
}): HeygenSceneAssetNames {
  const authoredName = normalizeDisplayName(params.clip.asset_name);
  const lessonName = normalizeDisplayName(params.context.lessonTitle)
    || normalizeDisplayName(params.context.moduleTitle)
    || normalizeDisplayName(params.context.artifactTitle)
    || "Video";
  const sceneLabel = `Escena ${String(params.clip.order).padStart(2, "0")}`;
  const displayName = authoredName || `${lessonName} · ${sceneLabel}`;
  const fileStem = sanitizeFileStem(displayName) || `escena-${params.clip.order}`;

  return {
    audioFileStem: truncateFileStem(`${fileStem}-voz`),
    displayName: displayName.slice(0, MAX_HEYGEN_TITLE_LENGTH),
    videoFileStem: truncateFileStem(`${fileStem}-avatar`),
    videoTitle: `${displayName} · Avatar`.slice(0, MAX_HEYGEN_TITLE_LENGTH),
  };
}

/** Reads naming metadata written into a production job, with safe legacy fallback. */
export function resolveHeygenJobFileStem(
  inputSnapshot: Record<string, unknown> | null | undefined,
  kind: "audio" | "video",
) {
  const key = kind === "audio" ? "audio_file_stem" : "video_file_stem";
  const candidate = typeof inputSnapshot?.[key] === "string"
    ? inputSnapshot[key]
    : null;
  return truncateFileStem(sanitizeFileStem(candidate || "")) || `heygen-${kind}`;
}

function normalizeDisplayName(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeFileStem(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function truncateFileStem(value: string) {
  return value.slice(0, MAX_FILE_STEM_LENGTH).replace(/-+$/g, "");
}
