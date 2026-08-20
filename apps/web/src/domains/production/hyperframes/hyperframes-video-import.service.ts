import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HEYGEN_ALLOWED_VIDEO_HOSTS } from "../providers/heygen/heygen.types";
import { PRODUCTION_MEDIA_CACHE_CONTROL_SECONDS } from "../media-storage.config";
import {
  PRODUCTION_ASSET_TYPES,
  PRODUCTION_PROVIDERS,
  PRODUCTION_QA_STATUSES,
} from "../types/production.types";

const FINAL_VIDEO_BUCKET = "production-videos";
const MAX_FINAL_VIDEO_BYTES = 500 * 1024 * 1024;
const VIDEO_DOWNLOAD_TIMEOUT_MS = 90_000;

export interface HyperframesImportedVideo {
  checksum: string;
  fileSizeBytes: number;
  publicUrl: string;
  storagePath: string;
}

export class HyperframesVideoImportService {
  constructor(
    private readonly supabase: SupabaseClient<any, "public", any>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async importCompletedRender(params: {
    artifactId: string;
    componentId: string;
    createdBy?: string | null;
    durationSeconds?: number | null;
    jobId: string;
    organizationId: string;
    renderId: string;
    requestId: string;
    thumbnailUrl?: string | null;
    videoUrl: string;
  }): Promise<HyperframesImportedVideo> {
    assertSafeHyperframesVideoUrl(params.videoUrl);
    const existing = await this.findExistingAsset(params.jobId);
    if (existing?.public_url && existing.storage_path && existing.checksum && existing.file_size_bytes) {
      return {
        checksum: existing.checksum,
        fileSizeBytes: existing.file_size_bytes,
        publicUrl: existing.public_url,
        storagePath: existing.storage_path,
      };
    }

    const downloaded = await downloadVideoWithLimits(this.fetchImpl, params.videoUrl);
    const objectPath = [
      "organizations",
      params.organizationId,
      "artifacts",
      params.artifactId,
      "components",
      params.componentId,
      "renders",
      params.requestId,
      `final.${downloaded.extension}`,
    ].join("/");
    const { error: uploadError } = await this.supabase.storage
      .from(FINAL_VIDEO_BUCKET)
      .upload(objectPath, downloaded.buffer, {
        cacheControl: String(PRODUCTION_MEDIA_CACHE_CONTROL_SECONDS),
        contentType: downloaded.contentType,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const publicUrl = this.supabase.storage.from(FINAL_VIDEO_BUCKET).getPublicUrl(objectPath).data.publicUrl;
    const storagePath = `${FINAL_VIDEO_BUCKET}/${objectPath}`;
    const { error: assetError } = await this.supabase.from("production_assets").insert({
      artifact_id: params.artifactId,
      asset_type: PRODUCTION_ASSET_TYPES.FINAL_VIDEO,
      checksum: downloaded.checksum,
      created_by: params.createdBy || null,
      duration_seconds: params.durationSeconds ? Math.round(params.durationSeconds) : null,
      external_url: params.videoUrl,
      file_size_bytes: downloaded.buffer.byteLength,
      material_component_id: params.componentId,
      metadata: {
        provider_render_id: params.renderId,
        render_request_id: params.requestId,
        thumbnail_url: params.thumbnailUrl || null,
      },
      mime_type: downloaded.contentType,
      organization_id: params.organizationId,
      production_job_id: params.jobId,
      provider: PRODUCTION_PROVIDERS.HYPERFRAMES,
      public_url: publicUrl,
      qa_status: PRODUCTION_QA_STATUSES.READY_FOR_QA,
      storage_bucket: FINAL_VIDEO_BUCKET,
      storage_path: storagePath,
    });
    if (assetError) throw assetError;

    const { data: component, error: componentReadError } = await this.supabase
      .from("material_components")
      .select("assets")
      .eq("id", params.componentId)
      .single();
    if (componentReadError) throw componentReadError;

    const nextAssets = {
      ...((component?.assets || {}) as Record<string, unknown>),
      final_video_asset_provider: PRODUCTION_PROVIDERS.HYPERFRAMES,
      final_video_source: "hyperframes_cloud",
      final_video_storage_path: storagePath,
      final_video_url: publicUrl,
      production_status: "COMPLETED",
      updated_at: new Date().toISOString(),
      video_duration: params.durationSeconds ? Math.round(params.durationSeconds) : undefined,
    };
    const { error: componentUpdateError } = await this.supabase
      .from("material_components")
      .update({ assets: nextAssets })
      .eq("id", params.componentId);
    if (componentUpdateError) throw componentUpdateError;

    return {
      checksum: downloaded.checksum,
      fileSizeBytes: downloaded.buffer.byteLength,
      publicUrl,
      storagePath,
    };
  }

  private async findExistingAsset(jobId: string) {
    const { data, error } = await this.supabase
      .from("production_assets")
      .select("checksum, file_size_bytes, public_url, storage_path")
      .eq("production_job_id", jobId)
      .eq("asset_type", PRODUCTION_ASSET_TYPES.FINAL_VIDEO)
      .maybeSingle();
    if (error) throw error;
    return data as {
      checksum?: string | null;
      file_size_bytes?: number | null;
      public_url?: string | null;
      storage_path?: string | null;
    } | null;
  }
}

export function assertSafeHyperframesVideoUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("HeyGen devolvió una URL de video HyperFrames inválida.");
  }
  if (url.protocol !== "https:") {
    throw new Error("La URL de video HyperFrames debe usar HTTPS.");
  }
  const hostname = url.hostname.toLowerCase();
  if (!HEYGEN_ALLOWED_VIDEO_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    throw new Error("La URL de video HyperFrames no pertenece a un host permitido de HeyGen.");
  }
}

async function downloadVideoWithLimits(fetchImpl: typeof fetch, url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VIDEO_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "video/mp4,video/webm,application/octet-stream" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("No se pudo descargar el video final de HyperFrames.");
    const contentType = normalizeVideoContentType(response.headers.get("content-type"), url);
    const declaredLength = parseContentLength(response.headers.get("content-length"));
    if (declaredLength !== null && declaredLength > MAX_FINAL_VIDEO_BYTES) {
      throw new Error("El video final de HyperFrames excede el límite de almacenamiento.");
    }
    const buffer = await readBodyWithLimit(response);
    return {
      buffer,
      checksum: createHash("sha256").update(buffer).digest("hex"),
      contentType,
      extension: contentType === "video/webm" ? "webm" : "mp4",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readBodyWithLimit(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_FINAL_VIDEO_BYTES) throw new Error("El video final de HyperFrames excede el límite de almacenamiento.");
    return buffer;
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_FINAL_VIDEO_BYTES) throw new Error("El video final de HyperFrames excede el límite de almacenamiento.");
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

function normalizeVideoContentType(header: string | null, url: string) {
  const contentType = (header || "").split(";", 1)[0]?.trim().toLowerCase();
  if (contentType === "video/mp4" || contentType === "video/webm") return contentType;
  if (contentType === "application/octet-stream") return url.toLowerCase().includes(".webm") ? "video/webm" : "video/mp4";
  throw new Error("HeyGen devolvió un MIME type no permitido para el video final.");
}

function parseContentLength(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
