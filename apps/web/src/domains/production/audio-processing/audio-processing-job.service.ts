import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProductionIdempotencyKey,
  createOrReuseProductionJob,
} from "../jobs/production-jobs.service";
import {
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
  type ProductionComponentContext,
  type ProductionJobRecord,
} from "../types/production.types";
import { DEFAULT_AUDIO_PROCESSING_PROFILE_ID, getAudioProcessingProfile } from "./audio-processing-profiles";
import type { AudioProcessingJobInput } from "./audio-processing.types";

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const supportedSourceMimeTypes = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"] as const;

export const createAudioProcessingJobRequestSchema = z.object({
  componentId: z.string().uuid(),
  profileId: z.literal(DEFAULT_AUDIO_PROCESSING_PROFILE_ID).default(DEFAULT_AUDIO_PROCESSING_PROFILE_ID),
  sourceAssetId: z.string().uuid(),
}).strict();

interface SourceAssetRecord {
  asset_type: string;
  checksum: string | null;
  file_size_bytes: number | null;
  id: string;
  material_component_id: string | null;
  mime_type: string | null;
  organization_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
}

export class AudioProcessingJobError extends Error {
  constructor(
    readonly code: "AUDIO_SOURCE_NOT_FOUND" | "AUDIO_SOURCE_INVALID" | "AUDIO_SOURCE_TOO_LARGE" | "AUDIO_TENANT_UNRESOLVED",
    message: string,
  ) {
    super(message);
    this.name = "AudioProcessingJobError";
  }
}

export function buildAudioProcessingJobInput(source: SourceAssetRecord): AudioProcessingJobInput {
  if (source.asset_type !== "VOICE_AUDIO" || !supportedSourceMimeTypes.includes(source.mime_type as typeof supportedSourceMimeTypes[number])) {
    throw new AudioProcessingJobError("AUDIO_SOURCE_INVALID", "El recurso seleccionado no es un audio de voz compatible.");
  }
  if (!source.storage_bucket || !source.storage_path || !/^[a-f0-9]{64}$/.test(source.checksum || "")) {
    throw new AudioProcessingJobError("AUDIO_SOURCE_INVALID", "El audio fuente no tiene almacenamiento o checksum válido.");
  }
  const fileSizeBytes = source.file_size_bytes;
  if (typeof fileSizeBytes !== "number" || !Number.isSafeInteger(fileSizeBytes) || fileSizeBytes <= 0 || fileSizeBytes > MAX_SOURCE_BYTES) {
    throw new AudioProcessingJobError("AUDIO_SOURCE_TOO_LARGE", "El audio fuente debe pesar entre 1 byte y 50 MB.");
  }

  const profile = getAudioProcessingProfile(DEFAULT_AUDIO_PROCESSING_PROFILE_ID);
  return {
    profile,
    source: {
      assetId: source.id,
      checksum: source.checksum!,
      mimeType: source.mime_type as AudioProcessingJobInput["source"]["mimeType"],
      storageBucket: source.storage_bucket!,
      storagePath: source.storage_path!,
    },
  };
}

export async function createAudioProcessingJob(params: {
  componentContext: ProductionComponentContext;
  createdBy: string;
  sourceAssetId: string;
  supabase: SupabaseClient;
}): Promise<ProductionJobRecord> {
  if (!params.componentContext.organizationId) {
    throw new AudioProcessingJobError("AUDIO_TENANT_UNRESOLVED", "No se pudo resolver la organización del componente.");
  }

  const { data, error } = await params.supabase
    .from("production_assets")
    .select("id, asset_type, checksum, file_size_bytes, material_component_id, mime_type, organization_id, storage_bucket, storage_path")
    .eq("id", params.sourceAssetId)
    .eq("organization_id", params.componentContext.organizationId)
    .eq("material_component_id", params.componentContext.componentId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AudioProcessingJobError("AUDIO_SOURCE_NOT_FOUND", "Audio fuente no encontrado para este componente.");

  const inputSnapshot = buildAudioProcessingJobInput(data as SourceAssetRecord);
  return createOrReuseProductionJob(params.supabase, {
    context: params.componentContext,
    createdBy: params.createdBy,
    idempotencyKey: buildProductionIdempotencyKey({
      componentId: params.componentContext.componentId,
      input: inputSnapshot,
      jobType: PRODUCTION_JOB_TYPES.AUDIO_PROCESSING,
      provider: PRODUCTION_PROVIDERS.FFMPEG,
    }),
    inputSnapshot: { profile: inputSnapshot.profile, source: inputSnapshot.source },
    jobType: PRODUCTION_JOB_TYPES.AUDIO_PROCESSING,
    provider: PRODUCTION_PROVIDERS.FFMPEG,
  });
}
