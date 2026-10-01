import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseAudioProcessingDerivatives,
  parseAudioWaveformDerivative,
  selectAudioWaveformLevel,
} from "./audio-analysis.service";

const MAX_DERIVATIVE_BYTES = 8 * 1024 * 1024;
const TARGET_RENDER_WIDTH = 1024;

export class AudioWaveformReadError extends Error {
  constructor(readonly status: 404 | 422, message: string) {
    super(message);
  }
}

/** Reads only a derivative referenced by an authorized component asset. */
export async function readAudioWaveformPreview(input: {
  assetId: string;
  componentId: string;
  organizationId: string;
  supabase: SupabaseClient;
}) {
  const { data: asset, error: assetError } = await input.supabase.from("production_assets")
    .select("asset_type, metadata")
    .eq("id", input.assetId)
    .eq("organization_id", input.organizationId)
    .eq("material_component_id", input.componentId)
    .eq("asset_type", "PROCESSED_AUDIO")
    .maybeSingle();
  if (assetError) throw assetError;
  if (!asset) throw new AudioWaveformReadError(404, "Audio procesado no encontrado.");

  const derivatives = parseAudioProcessingDerivatives(asset.metadata);
  if (!derivatives) throw new AudioWaveformReadError(404, "Este audio no tiene waveform disponible.");
  const manifest = derivatives.waveform;
  if (!manifest.storagePath.startsWith(`organizations/${input.organizationId}/audio-analysis/`)) {
    throw new AudioWaveformReadError(422, "La waveform no pertenece a esta organización.");
  }

  const { data: stored, error: downloadError } = await input.supabase.storage
    .from(manifest.storageBucket).download(manifest.storagePath);
  if (downloadError || !stored) throw new AudioWaveformReadError(404, "La waveform no está disponible.");
  if (stored.size <= 0 || stored.size > MAX_DERIVATIVE_BYTES) {
    throw new AudioWaveformReadError(422, "El tamaño de la waveform es inválido.");
  }
  const bytes = Buffer.from(await stored.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.checksum) {
    throw new AudioWaveformReadError(422, "El checksum de la waveform no coincide.");
  }

  let derivative;
  try {
    derivative = parseAudioWaveformDerivative(JSON.parse(bytes.toString("utf8")));
  } catch {
    throw new AudioWaveformReadError(422, "El formato de la waveform es inválido.");
  }
  if (
    derivative.contractVersion !== manifest.contractVersion
    || derivative.durationSeconds !== manifest.durationSeconds
    || derivative.sampleRateHz !== manifest.sampleRateHz
    || derivative.levels.length !== manifest.levelCount
  ) throw new AudioWaveformReadError(422, "El manifiesto de la waveform no coincide.");

  const level = selectAudioWaveformLevel(derivative, TARGET_RENDER_WIDTH);
  return {
    bucketSizeSamples: level.bucketSizeSamples,
    durationSeconds: derivative.durationSeconds,
    max: level.max,
    min: level.min,
    sampleRateHz: derivative.sampleRateHz,
  };
}
