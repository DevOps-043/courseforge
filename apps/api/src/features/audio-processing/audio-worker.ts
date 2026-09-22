import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSupportedAudioProfile } from "./worker-capabilities";

const execFileAsync = promisify(execFile);
const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 15 * 60 * 1000;
const ALLOWED_SOURCE_BUCKETS = new Set(["production-assets", "production-render-sources", "sound-effect-assets"]);

const claimedJobSchema = z.object({
  artifact_id: z.string().uuid(),
  audio_processing_lease_token: z.string().uuid(),
  id: z.string().uuid(),
  input_snapshot: z.object({
    profile: z.object({ id: z.enum(["voice-course-v1", "voice-clean-neural-dfn3-v1"]), version: z.literal(1) }).passthrough(),
    source: z.object({
      assetId: z.string().uuid(),
      checksum: z.string().regex(/^[a-f0-9]{64}$/),
      mimeType: z.enum(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"]),
      storageBucket: z.string().min(1).max(100),
      storagePath: z.string().min(1).max(2_000),
    }).strict(),
  }).strict(),
  organization_id: z.string().uuid(),
}).passthrough();

type ClaimedJob = z.infer<typeof claimedJobSchema>;

export async function processClaimedAudioJob(params: {
  job: unknown;
  supabase: SupabaseClient<any, any, any>;
  supportedProfiles: readonly string[];
}) {
  const job = claimedJobSchema.parse(params.job);
  let workDirectory: string | null = null;
  try {
    assertSupportedAudioProfile(job.input_snapshot.profile.id, params.supportedProfiles);
    if (!ALLOWED_SOURCE_BUCKETS.has(job.input_snapshot.source.storageBucket)) {
      throw new AudioProcessingTerminalError("AUDIO_SOURCE_BUCKET_NOT_ALLOWED");
    }

    workDirectory = await mkdtemp(join(tmpdir(), "courseforge-audio-"));
    const inputPath = join(workDirectory, "source.input");
    const normalizedWavPath = join(workDirectory, "source.wav");
    const outputPath = join(workDirectory, "processed.m4a");
    const sourceBytes = await downloadVerifiedSource(params.supabase, job);
    await writeFile(inputPath, sourceBytes, { mode: 0o600 });

    await execFileAsync("ffmpeg", buildNormalizeToWavArgs(inputPath, normalizedWavPath), {
      maxBuffer: 64 * 1024,
      timeout: FFMPEG_TIMEOUT_MS,
      windowsHide: true,
    });

    const enhancementInputPath = job.input_snapshot.profile.id === "voice-clean-neural-dfn3-v1"
      ? await enhanceWithDeepFilterNet(normalizedWavPath, workDirectory)
      : normalizedWavPath;

    await execFileAsync("ffmpeg", buildFfmpegArgs(enhancementInputPath, outputPath), {
      maxBuffer: 64 * 1024,
      timeout: FFMPEG_TIMEOUT_MS,
      windowsHide: true,
    });

    const outputBytes = await readFile(outputPath);
    if (outputBytes.byteLength === 0 || outputBytes.byteLength > MAX_INPUT_BYTES) {
      throw new AudioProcessingTerminalError("AUDIO_OUTPUT_SIZE_INVALID");
    }
    const durationSeconds = await probeDuration(outputPath);
    const checksum = sha256(outputBytes);
    const storagePath = `organizations/${job.organization_id}/audio-processing/${job.id}/processed.m4a`;
    const { error: uploadError } = await params.supabase.storage
      .from("production-assets")
      .upload(storagePath, outputBytes, { contentType: "audio/mp4", upsert: true });
    if (uploadError) throw new AudioProcessingRetryableError("AUDIO_OUTPUT_UPLOAD_FAILED");

    const publicUrl = params.supabase.storage.from("production-assets").getPublicUrl(storagePath).data.publicUrl;
    const { error: completeError } = await params.supabase.rpc("complete_audio_processing_job", {
      p_checksum: checksum,
      p_duration_seconds: durationSeconds,
      p_file_size_bytes: outputBytes.byteLength,
      p_job_id: job.id,
      p_lease_token: job.audio_processing_lease_token,
      p_metadata: buildOutputMetadata(job),
      p_mime_type: "audio/mp4",
      p_output_snapshot: { duration_seconds: durationSeconds, profile_id: job.input_snapshot.profile.id, source_asset_id: job.input_snapshot.source.assetId },
      p_public_url: publicUrl,
      p_storage_bucket: "production-assets",
      p_storage_path: storagePath,
    });
    if (completeError) throw new AudioProcessingRetryableError("AUDIO_JOB_COMPLETION_FAILED");
  } catch (error) {
    await failJob(params.supabase, job, error);
    throw error;
  } finally {
    if (workDirectory) await rm(workDirectory, { force: true, recursive: true });
  }
}

export async function processAudioProcessingBatch(
  supabase: SupabaseClient<any, any, any>,
  supportedProfiles: readonly string[],
  limit = 1,
) {
  if (supportedProfiles.length === 0) throw new Error("AUDIO_PROCESSING_PROFILES_REQUIRED");
  const { data, error } = await supabase.rpc("claim_audio_processing_jobs_by_profile", {
    p_lease_seconds: 900,
    p_limit: Math.min(Math.max(limit, 1), 4),
    p_profile_ids: supportedProfiles,
  });
  if (error) throw new Error("AUDIO_CLAIM_FAILED");
  const results = await Promise.allSettled((data || []).map((job: unknown) => processClaimedAudioJob({ job, supabase, supportedProfiles })));
  return { claimed: results.length, failed: results.filter((result) => result.status === "rejected").length };
}

function buildFfmpegArgs(inputPath: string, outputPath: string) {
  return [
    "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-i", inputPath,
    "-map", "0:a:0", "-vn",
    "-af", "highpass=f=70,acompressor=threshold=-18dB:ratio=3:attack=20:release=200:makeup=4dB,alimiter=limit=0.95,loudnorm=I=-16:LRA=11:TP=-1.5",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "1", "-movflags", "+faststart", "-y", outputPath,
  ];
}

function buildNormalizeToWavArgs(inputPath: string, outputPath: string) {
  return [
    "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-i", inputPath,
    "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", "-y", outputPath,
  ];
}

async function enhanceWithDeepFilterNet(inputPath: string, workDirectory: string) {
  const config = await resolveDeepFilterNetConfiguration();
  const outputDirectory = join(workDirectory, "deepfilter-output");
  await execFileAsync(config.binaryPath, [
    "--compensate-delay", "--atten-lim", "12", "--model", config.modelPath, "--out-dir", outputDirectory, inputPath,
  ], { maxBuffer: 64 * 1024, timeout: FFMPEG_TIMEOUT_MS, windowsHide: true });
  const outputPath = join(outputDirectory, "source.wav");
  const output = await readFile(outputPath);
  if (output.byteLength === 0) throw new AudioProcessingTerminalError("DEEPFILTER_OUTPUT_EMPTY");
  return outputPath;
}

async function resolveDeepFilterNetConfiguration() {
  if (process.env.DEEPFILTERNET_ENABLED !== "true") {
    throw new AudioProcessingTerminalError("DEEPFILTER_NOT_ENABLED");
  }
  const binaryPath = requiredEnvironment("DEEPFILTER_BINARY_PATH");
  const modelPath = requiredEnvironment("DEEPFILTER_MODEL_PATH");
  await assertFileChecksum(binaryPath, requiredEnvironment("DEEPFILTER_BINARY_SHA256"));
  await assertFileChecksum(modelPath, requiredEnvironment("DEEPFILTER_MODEL_SHA256"));
  return { binaryPath, modelPath };
}

async function assertFileChecksum(filePath: string, expectedChecksum: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedChecksum)) throw new AudioProcessingTerminalError("DEEPFILTER_CHECKSUM_CONFIGURATION_INVALID");
  const content = await readFile(filePath);
  if (sha256(content) !== expectedChecksum) throw new AudioProcessingTerminalError("DEEPFILTER_ARTIFACT_CHECKSUM_MISMATCH");
}

function buildOutputMetadata(job: ClaimedJob) {
  return {
    ...(job.input_snapshot.profile.id === "voice-clean-neural-dfn3-v1" ? {
      deepfilter_model_sha256: process.env.DEEPFILTER_MODEL_SHA256 || null,
      deepfilter_version: "externally-pinned",
      delay_compensated: true,
    } : {}),
    profile_id: job.input_snapshot.profile.id,
    profile_version: 1,
    source_asset_id: job.input_snapshot.source.assetId,
  };
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new AudioProcessingTerminalError(`DEEPFILTER_${name}_MISSING`);
  return value;
}

async function downloadVerifiedSource(supabase: SupabaseClient<any, any, any>, job: ClaimedJob) {
  const source = job.input_snapshot.source;
  const { data, error } = await supabase.storage.from(source.storageBucket).download(source.storagePath);
  if (error || !data) throw new AudioProcessingRetryableError("AUDIO_SOURCE_DOWNLOAD_FAILED");
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_INPUT_BYTES) throw new AudioProcessingTerminalError("AUDIO_SOURCE_SIZE_INVALID");
  if (sha256(bytes) !== source.checksum) throw new AudioProcessingTerminalError("AUDIO_SOURCE_CHECKSUM_MISMATCH");
  return bytes;
}

async function probeDuration(outputPath: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", outputPath,
  ], { maxBuffer: 8 * 1024, timeout: 30_000, windowsHide: true });
  const duration = Math.ceil(Number(stdout.trim()));
  if (!Number.isSafeInteger(duration) || duration <= 0) throw new AudioProcessingTerminalError("AUDIO_OUTPUT_DURATION_INVALID");
  return duration;
}

async function failJob(supabase: SupabaseClient<any, any, any>, job: ClaimedJob, error: unknown) {
  const retryable = error instanceof AudioProcessingRetryableError;
  await supabase.rpc("fail_audio_processing_job", {
    p_error_message: safeErrorCode(error),
    p_job_id: job.id,
    p_lease_token: job.audio_processing_lease_token,
    p_retry_after_seconds: retryable ? 60 : 15,
    p_retryable: retryable,
  });
}

function safeErrorCode(error: unknown) {
  return error instanceof AudioProcessingTerminalError || error instanceof AudioProcessingRetryableError
    ? error.message
    : "AUDIO_PROCESSING_EXECUTION_FAILED";
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

class AudioProcessingTerminalError extends Error {}
class AudioProcessingRetryableError extends Error {}
