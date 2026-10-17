import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAudioStorageSource } from "./audio-source-contract";
import {
  createWaveformAccumulator,
  WAVEFORM_ANALYSIS_PROFILE_ID,
  WAVEFORM_MAX_DURATION_SECONDS,
  WAVEFORM_MAX_SOURCE_BYTES,
} from "./audio-waveform-stream";
import { AudioProcessingRetryableError } from "./audio-worker-errors";

const jobSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    material_component_id: z.string().uuid(),
    audio_processing_lease_token: z.string().uuid(),
    audio_processing_attempts: z.number().int().optional(),
    input_snapshot: z
      .object({
        profile: z
          .object({
            id: z.literal(WAVEFORM_ANALYSIS_PROFILE_ID),
            version: z.literal(2),
          })
          .strict(),
        source: z
          .object({
            assetId: z.string().uuid(),
            checksum: z.string().regex(/^[a-f0-9]{64}$/),
            storageBucket: z.string(),
            storagePath: z.string(),
          })
          .strict(),
      })
      .strict(),
  })
  .passthrough();

/** Uses the existing leased queue, but never applies voice filters or replaces media. */
export async function processClaimedWaveformJob(
  jobInput: unknown,
  supabase: SupabaseClient<any, any, any>,
) {
  const parsed = jobSchema.safeParse(jobInput);
  if (!parsed.success) {
    const identity = z
      .object({
        id: z.string().uuid(),
        audio_processing_lease_token: z.string().uuid(),
      })
      .passthrough()
      .safeParse(jobInput);
    if (identity.success)
      await supabase.rpc("fail_audio_processing_job", {
        p_job_id: identity.data.id,
        p_lease_token: identity.data.audio_processing_lease_token,
        p_error_message: "WAVEFORM_INPUT_INVALID",
        p_retryable: false,
        p_retry_after_seconds: 60,
      });
    throw new Error("WAVEFORM_INPUT_INVALID");
  }
  const job = parsed.data;
  let directory: string | undefined;
  try {
    const bytes = await downloadWaveformSource(job, supabase);
    directory = await mkdtemp(join(tmpdir(), "courseforge-waveform-"));
    const inputPath = join(directory, "source.input");
    await writeFile(inputPath, bytes, { mode: 0o600 });
    const manifest = await generateNativeWaveformManifest(
      job,
      inputPath,
      supabase,
    );
    const { error: completeError } = await supabase.rpc(
      "complete_audio_waveform_job",
      {
        p_job_id: job.id,
        p_lease_token: job.audio_processing_lease_token,
        p_manifest: manifest,
      },
    );
    if (completeError)
      throw new AudioProcessingRetryableError("WAVEFORM_COMPLETION_FAILED");
  } catch (error) {
    const retryable =
      error instanceof AudioProcessingRetryableError &&
      (job.audio_processing_attempts ?? 1) < 3;
    const code =
      error instanceof Error && /^WAVEFORM_[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "WAVEFORM_ANALYSIS_FAILED";
    const diagnostic = { jobId: job.id, code, retryable };
    if (retryable) console.warn("waveform_analysis_retry", diagnostic);
    else console.error("waveform_analysis_failed", diagnostic);
    await supabase.rpc("fail_audio_processing_job", {
      p_job_id: job.id,
      p_lease_token: job.audio_processing_lease_token,
      p_error_message: code,
      p_retryable: retryable,
      p_retry_after_seconds: 60,
    });
    throw error;
  } finally {
    if (directory) await rm(directory, { force: true, recursive: true });
  }
}

function hash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

const WAVEFORM_INPUT_OPTIONS = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "wav,mp3,mov,matroska,ogg,aac,flac,aiff,avi",
];

export function buildNativeWaveformDecodeArgs(inputPath: string) {
  if (
    !inputPath.trim() ||
    inputPath.includes("\0") ||
    /^[a-z]+:\/\//i.test(inputPath)
  )
    throw new Error("WAVEFORM_LOCAL_PATH_REQUIRED");
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-xerror",
    ...WAVEFORM_INPUT_OPTIONS,
    "-i",
    inputPath,
    "-map",
    "0:a:0",
    "-vn",
    "-threads",
    "1",
    "-c:a",
    "pcm_f32le",
    "-f",
    "f32le",
    "pipe:1",
  ];
}

function decodeWaveform(
  inputPath: string,
  onChunk: (chunk: Buffer) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", buildNativeWaveformDecodeArgs(inputPath), {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let failure: Error | undefined;
    const timeout = setTimeout(
      () => {
        failure = new Error("WAVEFORM_DECODE_TIMEOUT");
        child.kill();
      },
      7 * 60 * 1000,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure) return;
      try {
        onChunk(chunk);
      } catch (error) {
        failure = error as Error;
        child.kill();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (failure || code !== 0)
        reject(failure || new Error("WAVEFORM_DECODE_FAILED"));
      else resolve();
    });
  });
}

async function downloadWaveformSource(
  job: z.infer<typeof jobSchema>,
  supabase: SupabaseClient<any, any, any>,
) {
  const source = job.input_snapshot.source;
  const storage = resolveAudioStorageSource(
    source.storageBucket,
    source.storagePath,
  );
  const { data: asset, error: assetError } = await supabase
    .from("production_assets")
    .select("checksum, storage_bucket, storage_path, mime_type, qa_status")
    .eq("id", source.assetId)
    .eq("organization_id", job.organization_id)
    .eq("material_component_id", job.material_component_id)
    .maybeSingle();
  if (assetError)
    throw new AudioProcessingRetryableError("WAVEFORM_ASSET_READ_FAILED");
  if (
    !asset ||
    ["ARCHIVED", "REJECTED"].includes(asset.qa_status) ||
    asset.checksum !== source.checksum ||
    !/^(audio|video)\//.test(asset.mime_type || "")
  )
    throw new Error("WAVEFORM_SOURCE_CHANGED");
  const currentStorage = resolveAudioStorageSource(
    asset.storage_bucket,
    asset.storage_path,
  );
  if (
    currentStorage.storageBucket !== storage.storageBucket ||
    currentStorage.storagePath !== storage.storagePath
  )
    throw new Error("WAVEFORM_SOURCE_CHANGED");
  const { data: blob, error } = await supabase.storage
    .from(storage.storageBucket)
    .download(storage.storagePath);
  if (error || !blob)
    throw new AudioProcessingRetryableError("WAVEFORM_DOWNLOAD_FAILED");
  if (blob.size <= 0 || blob.size > WAVEFORM_MAX_SOURCE_BYTES)
    throw new Error("WAVEFORM_SOURCE_SIZE_INVALID");
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (hash(bytes) !== source.checksum)
    throw new Error("WAVEFORM_SOURCE_CHECKSUM_INVALID");
  return bytes;
}

async function generateNativeWaveformManifest(
  job: z.infer<typeof jobSchema>,
  inputPath: string,
  supabase: SupabaseClient<any, any, any>,
) {
  const { stdout } = await promisify(execFile)(
    "ffprobe",
    [
      "-v",
      "error",
      ...WAVEFORM_INPUT_OPTIONS,
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=sample_rate,channels:format=duration",
      "-of",
      "json",
      inputPath,
    ],
    { timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true },
  );
  const probe = JSON.parse(stdout) as {
    streams?: { sample_rate?: string; channels?: number }[];
    format?: { duration?: string };
  };
  const stream = probe.streams?.[0];
  let manifest: Record<string, unknown> | null = null;
  if (stream) {
    const duration = Number(probe.format?.duration);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > WAVEFORM_MAX_DURATION_SECONDS
    )
      throw new Error("WAVEFORM_DURATION_INVALID");
    const accumulator = createWaveformAccumulator(
      Number(stream.sample_rate),
      Number(stream.channels),
      duration,
    );
    await decodeWaveform(inputPath, (chunk) => accumulator.push(chunk));
    const derivative = accumulator.finish();
    const derivativeBytes = Buffer.from(JSON.stringify(derivative));
    if (derivativeBytes.length > 32 * 1024 * 1024)
      throw new Error("WAVEFORM_DERIVATIVE_TOO_LARGE");
    const checksum = hash(derivativeBytes);
    const storagePath = `organizations/${job.organization_id}/audio-analysis/${checksum}/waveform-v2.json`;
    const { error: uploadError } = await supabase.storage
      .from("production-assets")
      .upload(storagePath, derivativeBytes, {
        contentType: "application/json",
        upsert: true,
      });
    if (uploadError)
      throw new AudioProcessingRetryableError("WAVEFORM_UPLOAD_FAILED");
    manifest = {
      checksum,
      contract_version: 2,
      duration_seconds: derivative.duration_seconds,
      sample_rate_hz: derivative.sample_rate_hz,
      level_count: derivative.channels[0].levels.length,
      channel_count: derivative.channels.length,
      source_checksum: job.input_snapshot.source.checksum,
      storage_bucket: "production-assets",
      storage_path: storagePath,
    };
  }
  return manifest;
}
