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
import { normalizeAudioSourceMime, resolveAudioStorageSource } from "./audio-source-contract";
import { getAudioSourceCapability, type AudioSourceCandidate, type AudioSourceRejectionCode } from "./audio-source-policy";

export const createAudioProcessingJobRequestSchema = z.object({
  componentId: z.string().uuid(),
  profileId: z.literal(DEFAULT_AUDIO_PROCESSING_PROFILE_ID).default(DEFAULT_AUDIO_PROCESSING_PROFILE_ID),
  sourceAssetId: z.string().uuid(),
  retryFailed: z.boolean().default(false),
}).strict();

interface SourceAssetRecord extends AudioSourceCandidate {
  public_url?: string | null;
  duration_seconds?: number | null;
  duration_milliseconds?: number | null;
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

export async function resolveAudioProcessingSource(params: {
  componentId: string; organizationId: string; sourceAssetId: string; supabase: SupabaseClient;
}): Promise<SourceAssetRecord> {
  const read = async (assetId: string) => {
    const { data, error } = await params.supabase.from("production_assets")
      .select("id, asset_type, checksum, file_size_bytes, material_component_id, mime_type, organization_id, storage_bucket, storage_path, metadata, qa_status, public_url, duration_seconds, duration_milliseconds")
      .eq("id", assetId).eq("organization_id", params.organizationId).eq("material_component_id", params.componentId).maybeSingle();
    if (error) throw error;
    if (!data || data.qa_status === "ARCHIVED") throw new AudioProcessingJobError("AUDIO_SOURCE_NOT_FOUND", "Narración no encontrada para este componente.");
    return data as SourceAssetRecord;
  };
  const selected = await read(params.sourceAssetId);
  if (selected.asset_type !== "PROCESSED_AUDIO") return selected;
  const metadata = selected.metadata as { source_asset_id?: unknown } | null;
  const originalId = z.string().uuid().safeParse(metadata?.source_asset_id);
  if (!originalId.success) throw new AudioProcessingJobError("AUDIO_SOURCE_INVALID", "No se pudo identificar la narración original.");
  const original = await read(originalId.data);
  if (original.asset_type === "PROCESSED_AUDIO") throw new AudioProcessingJobError("AUDIO_SOURCE_INVALID", "El derivado no referencia una narración original.");
  return original;
}

export class AudioProcessingJobError extends Error {
  constructor(
    readonly code: "AUDIO_SOURCE_NOT_FOUND" | "AUDIO_TENANT_UNRESOLVED" | AudioSourceRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = "AudioProcessingJobError";
  }
}

export function buildAudioProcessingJobInput(source: SourceAssetRecord): AudioProcessingJobInput {
  const capability = getAudioSourceCapability(source);
  if (!capability.eligible) throw new AudioProcessingJobError(capability.code, capability.reason);
  const storage = resolveAudioStorageSource(source.storage_bucket, source.storage_path);

  const profile = getAudioProcessingProfile(DEFAULT_AUDIO_PROCESSING_PROFILE_ID);
  return {
    profile,
    source: {
      assetId: source.id,
      checksum: source.checksum!,
      mimeType: normalizeAudioSourceMime(source.mime_type)!,
      ...storage,
    },
  };
}

export async function createAudioProcessingJob(params: {
  componentContext: ProductionComponentContext;
  createdBy: string;
  sourceAssetId: string;
  retryFailed?: boolean;
  supabase: SupabaseClient;
}): Promise<ProductionJobRecord> {
  if (!params.componentContext.organizationId) {
    throw new AudioProcessingJobError("AUDIO_TENANT_UNRESOLVED", "No se pudo resolver la organización del componente.");
  }

  const source = await resolveAudioProcessingSource({ componentId: params.componentContext.componentId,
    organizationId: params.componentContext.organizationId, sourceAssetId: params.sourceAssetId, supabase: params.supabase });
  const inputSnapshot = buildAudioProcessingJobInput(source);
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
    retryFailed: params.retryFailed === true,
  });
}
