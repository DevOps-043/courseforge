import { createHash } from "node:crypto";
import { PRODUCTION_MEDIA_CACHE_CONTROL_SECONDS } from "../../media-storage.config";
import {
  PRODUCTION_ASSET_TYPES,
  PRODUCTION_QA_STATUSES,
} from "../../types/production.types";
import {
  HEYGEN_ALLOWED_AUDIO_HOSTS,
  HEYGEN_AUDIO_IMPORT_TIMEOUT_MS,
  HEYGEN_MAX_AUDIO_IMPORT_SIZE_BYTES,
  HEYGEN_VIDEO_STORAGE_BUCKET,
  type HeygenGeneratedSpeech,
  type HeygenProductionJobRow,
  type HeygenSupabaseClient,
} from "./heygen.types";
import {
  HeygenRepository,
  resolveHeygenStorageObjectPath,
} from "./heygen.repository";
import { resolveHeygenJobFileStem } from "./heygen-asset-naming";

export interface HeygenImportedVoiceAsset {
  durationSeconds: number | null;
  id: string;
  publicUrl: string;
  providerRequestId: string | null;
  storagePath: string;
  wordTimestamps: HeygenGeneratedSpeech["wordTimestamps"];
}

export class HeygenAudioImportService {
  private readonly repository: HeygenRepository;

  constructor(
    private readonly supabase: HeygenSupabaseClient,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.repository = new HeygenRepository(supabase);
  }

  async findImportedVoice(jobId: string): Promise<HeygenImportedVoiceAsset | null> {
    const existing = await this.repository.findVoiceAudioAssetByJob(jobId);
    if (!existing?.public_url || !existing.storage_path) return null;

    const metadata = isRecord(existing.metadata) ? existing.metadata : {};
    return {
      durationSeconds: preciseDuration(existing),
      id: existing.id,
      publicUrl: existing.public_url,
      providerRequestId: typeof metadata.provider_request_id === "string"
        ? metadata.provider_request_id
        : null,
      storagePath: existing.storage_path,
      wordTimestamps: parseWordTimestamps(metadata.word_timestamps),
    };
  }

  async importGeneratedSpeech(params: {
    createdBy?: string | null;
    job: HeygenProductionJobRow;
    scriptHash: string;
    speech: HeygenGeneratedSpeech;
    voiceProviderId: string;
  }): Promise<HeygenImportedVoiceAsset> {
    const existing = await this.findImportedVoice(params.job.id);
    if (existing) return existing;

    assertSafeHeygenAudioUrl(params.speech.audioUrl);
    const downloaded = await downloadHeygenAudioWithLimits({
      fetchImpl: this.fetchImpl,
      url: params.speech.audioUrl,
    });
    const context = buildContextFromJob(params.job);
    const fileStem = resolveHeygenJobFileStem(params.job.input_snapshot, "audio");
    const objectPath = [
      "heygen",
      context.artifactId,
      context.componentId,
      `${fileStem}-${params.job.id.slice(0, 8)}.${downloaded.extension}`,
    ].join("/");

    const { error: uploadError } = await this.supabase.storage
      .from(HEYGEN_VIDEO_STORAGE_BUCKET)
      .upload(objectPath, downloaded.buffer, {
        cacheControl: String(PRODUCTION_MEDIA_CACHE_CONTROL_SECONDS),
        contentType: downloaded.contentType,
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = this.supabase.storage
      .from(HEYGEN_VIDEO_STORAGE_BUCKET)
      .getPublicUrl(objectPath);
    const storagePath = `${HEYGEN_VIDEO_STORAGE_BUCKET}/${objectPath}`;
    const asset = await this.repository.insertGeneratedMediaAsset({
      assetType: PRODUCTION_ASSET_TYPES.VOICE_AUDIO,
      checksum: downloaded.checksum,
      context,
      createdBy: params.createdBy || null,
      durationSeconds: params.speech.durationSeconds,
      externalUrl: params.speech.audioUrl,
      fileSizeBytes: downloaded.buffer.byteLength,
      jobId: params.job.id,
      metadata: {
        asset_display_name: typeof params.job.input_snapshot?.asset_display_name === "string"
          ? params.job.input_snapshot.asset_display_name
          : null,
        file_name: objectPath.split("/").at(-1),
        imported_at: new Date().toISOString(),
        provider_request_id: params.speech.requestId || null,
        script_hash: params.scriptHash,
        voice_provider_id: params.voiceProviderId,
        word_timestamps: params.speech.wordTimestamps,
      },
      mimeType: downloaded.contentType,
      providerJobId: params.speech.requestId || params.job.id,
      publicUrl,
      storageBucket: HEYGEN_VIDEO_STORAGE_BUCKET,
      storagePath,
    });

    return {
      durationSeconds: params.speech.durationSeconds,
      id: asset.id,
      publicUrl,
      providerRequestId: params.speech.requestId || null,
      storagePath,
      wordTimestamps: params.speech.wordTimestamps,
    };
  }

  async discardImportedVoice(asset: HeygenImportedVoiceAsset) {
    const objectPath = resolveHeygenStorageObjectPath({
      storage_bucket: HEYGEN_VIDEO_STORAGE_BUCKET,
      storage_path: asset.storagePath,
    });
    let cleanupError: unknown = null;
    if (objectPath) {
      const { error } = await this.supabase.storage
        .from(HEYGEN_VIDEO_STORAGE_BUCKET)
        .remove([objectPath]);
      cleanupError = error;
    }

    const { error: archiveError } = await this.supabase
      .from("production_assets")
      .update({
        public_url: null,
        qa_status: PRODUCTION_QA_STATUSES.ARCHIVED,
        updated_at: new Date().toISOString(),
      })
      .eq("id", asset.id)
      .eq("asset_type", PRODUCTION_ASSET_TYPES.VOICE_AUDIO);
    if (archiveError) throw archiveError;
    if (cleanupError) throw cleanupError;
  }
}

export function assertSafeHeygenAudioUrl(rawUrl: string) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("HeyGen devolvio una URL de audio invalida.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("La URL de audio de HeyGen debe usar HTTPS.");
  }
  const hostname = parsedUrl.hostname.toLowerCase();
  if (!HEYGEN_ALLOWED_AUDIO_HOSTS.some(
    (allowedHost) => hostname === allowedHost || hostname.endsWith(`.${allowedHost}`),
  )) {
    throw new Error("La URL de audio de HeyGen no pertenece a un host permitido.");
  }
}

export async function downloadHeygenAudioWithLimits(params: { fetchImpl?: typeof fetch; url: string }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEYGEN_AUDIO_IMPORT_TIMEOUT_MS);
  try {
    const response = await (params.fetchImpl || fetch)(params.url, {
      headers: { Accept: "audio/mpeg,audio/wav,audio/x-wav,application/octet-stream" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("No se pudo descargar la voz generada por HeyGen.");
    const contentType = normalizeAudioContentType(response.headers.get("content-type"), params.url);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > HEYGEN_MAX_AUDIO_IMPORT_SIZE_BYTES) {
      throw new Error("La voz de HeyGen excede el limite de importacion.");
    }
    const buffer = await readBodyWithLimit(response);
    return {
      buffer,
      checksum: createHash("sha256").update(buffer).digest("hex"),
      contentType,
      extension: contentType === "audio/mpeg" ? "mp3" as const : "wav" as const,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readBodyWithLimit(response: Response) {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > HEYGEN_MAX_AUDIO_IMPORT_SIZE_BYTES) {
      throw new Error("La voz de HeyGen excede el limite de importacion.");
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
    if (totalBytes > HEYGEN_MAX_AUDIO_IMPORT_SIZE_BYTES) {
      await reader.cancel();
      throw new Error("La voz de HeyGen excede el limite de importacion.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

function normalizeAudioContentType(header: string | null, url: string) {
  const contentType = (header || "").split(";", 1)[0]!.trim().toLowerCase();
  if (contentType === "audio/mpeg" || contentType === "audio/mp3") return "audio/mpeg";
  if (["audio/wav", "audio/x-wav", "audio/wave"].includes(contentType)) return "audio/wav";
  if (contentType === "application/octet-stream") {
    return url.toLowerCase().includes(".wav") ? "audio/wav" : "audio/mpeg";
  }
  throw new Error("HeyGen devolvio un archivo de voz con MIME type no permitido.");
}

function buildContextFromJob(job: HeygenProductionJobRow) {
  if (!job.material_component_id) throw new Error("El job de HeyGen no tiene componente asociado.");
  return {
    artifactId: job.artifact_id,
    componentId: job.material_component_id,
    componentType: typeof job.input_snapshot?.component_type === "string"
      ? job.input_snapshot.component_type
      : "UNKNOWN",
    lessonId: job.lesson_id || null,
    materialLessonId: job.material_lesson_id || null,
    moduleId: job.module_id || null,
    organizationId: job.organization_id || null,
  };
}

function preciseDuration(asset: { duration_milliseconds?: number | null; duration_seconds?: number | null }) {
  if (asset.duration_milliseconds && asset.duration_milliseconds > 0) {
    return asset.duration_milliseconds / 1000;
  }
  return asset.duration_seconds && asset.duration_seconds > 0 ? asset.duration_seconds : null;
}

function parseWordTimestamps(value: unknown): HeygenGeneratedSpeech["wordTimestamps"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.word !== "string"
      || typeof entry.start !== "number" || typeof entry.end !== "number") return [];
    return [{ word: entry.word, start: entry.start, end: entry.end }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
