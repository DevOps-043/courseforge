import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AudioWaveformDerivativeCache,
  audioWaveformDerivativeCache,
} from "./audio-waveform-cache.server";
import {
  parseAudioWaveformManifest,
  parseAudioWaveformDerivative,
  selectAudioWaveformLevel,
} from "./audio-analysis.service";

const MAX_DERIVATIVE_BYTES = 32 * 1024 * 1024;
const TARGET_RENDER_WIDTH = 1024;

export class AudioWaveformReadError extends Error {
  constructor(
    readonly status: 404 | 422,
    message: string,
  ) {
    super(message);
  }
}

/** Reads only a derivative referenced by an authorized component asset. */
export async function readAudioWaveformPreview(input: {
  assetId: string;
  componentId: string;
  organizationId: string;
  supabase: SupabaseClient;
  startSeconds?: number;
  endSeconds?: number;
  widthPixels?: number;
  cache?: AudioWaveformDerivativeCache;
}) {
  const { data: asset, error: assetError } = await input.supabase
    .from("production_assets")
    .select("asset_type, metadata, checksum, qa_status")
    .eq("id", input.assetId)
    .eq("organization_id", input.organizationId)
    .eq("material_component_id", input.componentId)
    .maybeSingle();
  if (assetError) throw assetError;
  if (!asset || ["ARCHIVED", "REJECTED"].includes(asset.qa_status))
    throw new AudioWaveformReadError(404, "Audio no encontrado.");

  const manifest = parseAudioWaveformManifest(asset.metadata);
  if (
    !manifest ||
    (manifest.sourceChecksum && manifest.sourceChecksum !== asset.checksum)
  )
    throw new AudioWaveformReadError(
      404,
      "Este audio no tiene waveform disponible.",
    );
  if (
    !manifest.storagePath.startsWith(
      `organizations/${input.organizationId}/audio-analysis/`,
    )
  ) {
    throw new AudioWaveformReadError(
      422,
      "La waveform no pertenece a esta organización.",
    );
  }

  const cache = input.cache ?? audioWaveformDerivativeCache;
  const cacheKey = `${input.organizationId}:${manifest.storagePath}:${manifest.checksum}`;
  let derivative = cache.get(cacheKey);
  let serializedBytes = 0;
  if (!derivative) {
    const { data: stored, error: downloadError } = await input.supabase.storage
      .from(manifest.storageBucket)
      .download(manifest.storagePath);
    if (downloadError || !stored)
      throw new AudioWaveformReadError(404, "La waveform no está disponible.");
    if (stored.size <= 0 || stored.size > MAX_DERIVATIVE_BYTES) {
      throw new AudioWaveformReadError(
        422,
        "El tamaño de la waveform es inválido.",
      );
    }
    const bytes = Buffer.from(await stored.arrayBuffer());
    if (
      createHash("sha256").update(bytes).digest("hex") !== manifest.checksum
    ) {
      throw new AudioWaveformReadError(
        422,
        "El checksum de la waveform no coincide.",
      );
    }

    serializedBytes = bytes.byteLength;
    try {
      derivative = parseAudioWaveformDerivative(
        JSON.parse(bytes.toString("utf8")),
      );
    } catch {
      throw new AudioWaveformReadError(
        422,
        "El formato de la waveform es inválido.",
      );
    }
  }
  if (
    derivative.contractVersion !== manifest.contractVersion ||
    derivative.durationSeconds !== manifest.durationSeconds ||
    derivative.sampleRateHz !== manifest.sampleRateHz ||
    derivative.levels.length !== manifest.levelCount ||
    (manifest.channelCount !== undefined &&
      derivative.channels?.length !== manifest.channelCount)
  )
    throw new AudioWaveformReadError(
      422,
      "El manifiesto de la waveform no coincide.",
    );
  if (serializedBytes) cache.set(cacheKey, derivative, serializedBytes);

  const start = input.startSeconds ?? 0;
  const end = Math.min(
    input.endSeconds ?? derivative.durationSeconds,
    derivative.durationSeconds,
  );
  const width = input.widthPixels ?? TARGET_RENDER_WIDTH;
  if (
    !Number.isFinite(start) ||
    start < 0 ||
    !Number.isFinite(end) ||
    end <= start ||
    !Number.isFinite(width) ||
    width < 1 ||
    width > 4096
  )
    throw new AudioWaveformReadError(422, "Intervalo de onda inválido.");
  const level =
    input.startSeconds === undefined && input.endSeconds === undefined
      ? selectAudioWaveformLevel(derivative, width)
      : derivative.levels.find(
          (entry) =>
            Math.ceil(
              ((end - start) * derivative.sampleRateHz) /
                entry.bucketSizeSamples,
            ) <=
            width * 2,
        ) || derivative.levels.at(-1)!;
  const levelIndex = derivative.levels.indexOf(level);
  const first = Math.floor(
    (start * derivative.sampleRateHz) / level.bucketSizeSamples,
  );
  const last = Math.ceil(
    (end * derivative.sampleRateHz) / level.bucketSizeSamples,
  );
  return {
    contractVersion: derivative.contractVersion,
    checksum: manifest.checksum,
    offsetSeconds: (first * level.bucketSizeSamples) / derivative.sampleRateHz,
    bucketSizeSamples: level.bucketSizeSamples,
    durationSeconds: derivative.durationSeconds,
    max: level.max.slice(first, last),
    min: level.min.slice(first, last),
    ...(derivative.channels
      ? {
          channels: derivative.channels.map((channel) => ({
            min: channel.levels[levelIndex].min.slice(first, last),
            max: channel.levels[levelIndex].max.slice(first, last),
          })),
        }
      : {}),
    sampleRateHz: derivative.sampleRateHz,
  };
}
