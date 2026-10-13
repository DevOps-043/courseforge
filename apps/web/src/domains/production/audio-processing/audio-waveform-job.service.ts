import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProductionIdempotencyKey,
  createOrReuseProductionJob,
} from "../jobs/production-jobs.service";
import {
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
  type ProductionComponentContext,
} from "../types/production.types";
import { resolveAudioStorageSource } from "./audio-source-contract";

export const WAVEFORM_ANALYSIS_PROFILE_ID = "waveform-analysis-v2";
export class WaveformSourceError extends Error {}

export async function createWaveformAnalysisJob(input: {
  componentContext: ProductionComponentContext;
  createdBy: string;
  assetId: string;
  retryFailed: boolean;
  supabase: SupabaseClient;
}) {
  const context = input.componentContext;
  if (!context.organizationId)
    throw new WaveformSourceError("Organización no disponible.");
  const { data: asset, error } = await input.supabase
    .from("production_assets")
    .select(
      "id, checksum, storage_bucket, storage_path, mime_type, qa_status, file_size_bytes",
    )
    .eq("id", input.assetId)
    .eq("organization_id", context.organizationId)
    .eq("material_component_id", context.componentId)
    .maybeSingle();
  if (error) throw error;
  if (
    !asset ||
    ["ARCHIVED", "REJECTED"].includes(asset.qa_status) ||
    !/^(audio|video)\//.test(asset.mime_type || "") ||
    !/^[a-f0-9]{64}$/.test(asset.checksum || "") ||
    !asset.file_size_bytes ||
    asset.file_size_bytes > 250 * 1024 * 1024
  ) {
    throw new WaveformSourceError(
      "El recurso no admite análisis de ondas (máximo 250 MB y 30 minutos).",
    );
  }
  let storage;
  try {
    storage = resolveAudioStorageSource(
      asset.storage_bucket,
      asset.storage_path,
    );
  } catch {
    throw new WaveformSourceError(
      "El recurso no tiene un archivo interno válido.",
    );
  }
  const inputSnapshot = {
    profile: { id: WAVEFORM_ANALYSIS_PROFILE_ID, version: 2 },
    source: { assetId: asset.id, checksum: asset.checksum, ...storage },
  };
  return createOrReuseProductionJob(input.supabase, {
    context,
    createdBy: input.createdBy,
    jobType: PRODUCTION_JOB_TYPES.AUDIO_PROCESSING,
    provider: PRODUCTION_PROVIDERS.FFMPEG,
    idempotencyKey: buildProductionIdempotencyKey({
      componentId: context.componentId,
      input: inputSnapshot,
      jobType: PRODUCTION_JOB_TYPES.AUDIO_PROCESSING,
      provider: PRODUCTION_PROVIDERS.FFMPEG,
    }),
    inputSnapshot,
    retryFailed: input.retryFailed,
  });
}
