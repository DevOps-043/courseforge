import { createHash } from "node:crypto";
import { PRODUCTION_MEDIA_CACHE_CONTROL_SECONDS } from "../../media-storage.config";
import {
  HEYGEN_ALLOWED_VIDEO_HOSTS,
  HEYGEN_MAX_IMPORT_SIZE_BYTES,
  HEYGEN_VIDEO_IMPORT_TIMEOUT_MS,
  HEYGEN_VIDEO_STORAGE_BUCKET,
  type HeygenProductionJobRow,
  type HeygenSupabaseClient,
  type HeygenVideoDetails,
} from "./heygen.types";
import { HeygenRepository } from "./heygen.repository";
import {
  PRODUCTION_ASSET_TYPES,
  PRODUCTION_PROVIDERS,
} from "../../types/production.types";
import { resolveHeygenJobFileStem } from "./heygen-asset-naming";

interface DownloadedVideo {
  buffer: Buffer;
  checksum: string;
  contentLength: number;
  contentType: string;
  extension: "mp4" | "webm";
}

export interface HeygenImportedVideoAsset {
  asset: {
    id: string;
    publicUrl: string;
    storagePath: string;
  };
  materialAssets?: Record<string, unknown>;
}

export class HeygenVideoImportService {
  private readonly repository: HeygenRepository;

  constructor(
    private readonly supabase: HeygenSupabaseClient,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.repository = new HeygenRepository(supabase);
  }

  async importCompletedVideo(params: {
    autoPromote: boolean;
    createdBy?: string | null;
    job: HeygenProductionJobRow;
    video: HeygenVideoDetails;
  }): Promise<HeygenImportedVideoAsset> {
    return this.importCompletedVideoAsset({
      ...params,
      assetType: PRODUCTION_ASSET_TYPES.AVATAR_VIDEO,
    });
  }

  async importCompletedClipVideo(params: {
    createdBy?: string | null;
    job: HeygenProductionJobRow;
    video: HeygenVideoDetails;
  }): Promise<HeygenImportedVideoAsset> {
    return this.importCompletedVideoAsset({
      autoPromote: false,
      createdBy: params.createdBy || null,
      job: params.job,
      video: params.video,
      assetType: PRODUCTION_ASSET_TYPES.AVATAR_VIDEO_CLIP,
    });
  }

  private async importCompletedVideoAsset(params: {
    assetType: (typeof PRODUCTION_ASSET_TYPES)[keyof typeof PRODUCTION_ASSET_TYPES];
    autoPromote: boolean;
    createdBy?: string | null;
    job: HeygenProductionJobRow;
    video: HeygenVideoDetails;
  }): Promise<HeygenImportedVideoAsset> {
    const existingAsset = await this.repository.findAvatarVideoAssetByJob(
      params.job.id,
      params.assetType,
    );
    if (
      existingAsset?.id &&
      existingAsset.public_url &&
      existingAsset.storage_path
    ) {
      return {
        asset: {
          id: existingAsset.id,
          publicUrl: existingAsset.public_url,
          storagePath: existingAsset.storage_path,
        },
      };
    }

    if (!params.video.videoUrl) {
      throw new Error(
        "HeyGen marco el video como completado, pero no entrego video_url.",
      );
    }

    assertSafeHeygenVideoUrl(params.video.videoUrl);
    const downloadedVideo = await downloadVideoWithLimits({
      fetchImpl: this.fetchImpl,
      url: params.video.videoUrl,
    });
    const context = buildContextFromJob(params.job);
    const objectPath = buildHeygenStoragePath({
      artifactId: context.artifactId,
      componentId: context.componentId,
      extension: downloadedVideo.extension,
      fileStem: resolveHeygenJobFileStem(params.job.input_snapshot, "video"),
      jobId: params.job.id,
    });

    const { error: uploadError } = await this.supabase.storage
      .from(HEYGEN_VIDEO_STORAGE_BUCKET)
      .upload(objectPath, downloadedVideo.buffer, {
        cacheControl: String(PRODUCTION_MEDIA_CACHE_CONTROL_SECONDS),
        contentType: downloadedVideo.contentType,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = this.supabase.storage
      .from(HEYGEN_VIDEO_STORAGE_BUCKET)
      .getPublicUrl(objectPath);

    const storagePath = `${HEYGEN_VIDEO_STORAGE_BUCKET}/${objectPath}`;
    const asset = await this.repository.insertGeneratedMediaAsset({
      assetType: params.assetType,
      checksum: downloadedVideo.checksum,
      context,
      createdBy: params.createdBy || null,
      durationSeconds: params.video.durationSeconds || null,
      externalUrl: params.video.videoUrl,
      fileSizeBytes: downloadedVideo.contentLength,
      jobId: params.job.id,
      metadata: {
        asset_display_name: typeof params.job.input_snapshot?.asset_display_name === "string"
          ? params.job.input_snapshot.asset_display_name
          : null,
        file_name: objectPath.split("/").at(-1),
        imported_at: new Date().toISOString(),
        output_format: params.video.outputFormat || downloadedVideo.extension,
        provider: PRODUCTION_PROVIDERS.HEYGEN,
        thumbnail_url: params.video.thumbnailUrl || null,
      },
      mimeType: downloadedVideo.contentType,
      providerJobId: params.video.videoId,
      publicUrl,
      storageBucket: HEYGEN_VIDEO_STORAGE_BUCKET,
      storagePath,
    });

    const materialAssets = params.autoPromote
      ? await this.repository.promoteAvatarVideoToMaterialAssets({
          componentId: context.componentId,
          durationSeconds: params.video.durationSeconds || null,
          providerJobId: params.video.videoId,
          publicUrl,
          storagePath,
        })
      : undefined;

    return {
      asset: {
        id: asset.id,
        publicUrl: publicUrl,
        storagePath,
      },
      materialAssets,
    };
  }
}

export function assertSafeHeygenVideoUrl(rawUrl: string) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("HeyGen devolvio una URL de video invalida.");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("La URL de video de HeyGen debe usar HTTPS.");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isAllowed = HEYGEN_ALLOWED_VIDEO_HOSTS.some(
    (allowedHost) =>
      hostname === allowedHost || hostname.endsWith(`.${allowedHost}`),
  );

  if (!isAllowed) {
    throw new Error("La URL de video de HeyGen no pertenece a un host permitido.");
  }
}

async function downloadVideoWithLimits(params: {
  fetchImpl: typeof fetch;
  url: string;
}): Promise<DownloadedVideo> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    HEYGEN_VIDEO_IMPORT_TIMEOUT_MS,
  );

  try {
    const response = await params.fetchImpl(params.url, {
      headers: {
        Accept: "video/mp4,video/webm,application/octet-stream,binary/octet-stream",
      },
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("No se pudo descargar el video generado por HeyGen.");
    }

    const contentType = normalizeVideoContentType(
      response.headers.get("content-type"),
      params.url,
    );
    const contentLength = parseContentLength(
      response.headers.get("content-length"),
    );
    if (contentLength && contentLength > HEYGEN_MAX_IMPORT_SIZE_BYTES) {
      throw new Error("El video de HeyGen excede el limite de importacion.");
    }

    const buffer = await readResponseBodyWithLimit(response);

    return {
      buffer,
      checksum: createHash("sha256").update(buffer).digest("hex"),
      contentLength: buffer.byteLength,
      contentType,
      extension: contentType.includes("webm") ? "webm" : "mp4",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseBodyWithLimit(response: Response) {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > HEYGEN_MAX_IMPORT_SIZE_BYTES) {
      throw new Error("El video de HeyGen excede el limite de importacion.");
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > HEYGEN_MAX_IMPORT_SIZE_BYTES) {
      throw new Error("El video de HeyGen excede el limite de importacion.");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

export function normalizeVideoContentType(
  contentTypeHeader: string | null,
  url: string,
) {
  const contentType = (contentTypeHeader || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType === "video/mp4" || contentType === "video/webm") {
    return contentType;
  }

  // files2.heygen.ai currently serves some valid MP4 outputs with the
  // non-standard binary/octet-stream value. The caller validates the HTTPS
  // URL against the explicit HeyGen host allow-list before reaching here.
  if (
    contentType === "application/octet-stream"
    || contentType === "binary/octet-stream"
  ) {
    return url.toLowerCase().includes(".webm") ? "video/webm" : "video/mp4";
  }

  throw new Error("HeyGen devolvio un archivo con MIME type no permitido.");
}

function parseContentLength(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildHeygenStoragePath(params: {
  artifactId: string;
  componentId: string;
  extension: string;
  fileStem: string;
  jobId: string;
}) {
  return [
    "heygen",
    params.artifactId,
    params.componentId,
    `${params.fileStem}-${params.jobId.slice(0, 8)}.${params.extension}`,
  ].join("/");
}

function buildContextFromJob(job: HeygenProductionJobRow) {
  if (!job.material_component_id) {
    throw new Error("El job de HeyGen no tiene componente asociado.");
  }

  return {
    artifactId: job.artifact_id,
    componentId: job.material_component_id,
    componentType:
      typeof job.input_snapshot?.component_type === "string"
        ? job.input_snapshot.component_type
        : "UNKNOWN",
    lessonId: job.lesson_id || null,
    materialLessonId: job.material_lesson_id || null,
    moduleId: job.module_id || null,
    organizationId: job.organization_id || null,
  };
}
