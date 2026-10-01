import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AudioLoudnessQualityError, buildLoudnessAnalysisArgs, parseLoudnessAnalysis, requirePassingAudioLoudness, type AudioLoudnessAnalysis } from "./audio-analysis";
import {
  AUDIO_WAVEFORM_SAMPLE_RATE_HZ,
  buildWaveformDerivative,
  buildWaveformExtractionArgs,
  type AudioWaveformManifest,
} from "./audio-waveform";
import {
  assertSupportedAudioProfile,
  resolveWorkerAudioProfilePolicy,
  type WorkerAudioProfilePolicy,
} from "./worker-capabilities";

const execFileAsync = promisify(execFile);
const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 7 * 60 * 1000;
const AUDIO_PROCESSING_LEASE_SECONDS = 3600;
const MAX_WAVEFORM_PCM_BYTES = 64 * 1024 * 1024;
const MAX_WAVEFORM_JSON_BYTES = 8 * 1024 * 1024;
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
    const profilePolicy = resolveWorkerAudioProfilePolicy(job.input_snapshot.profile.id);
    if (!ALLOWED_SOURCE_BUCKETS.has(job.input_snapshot.source.storageBucket)) {
      throw new AudioProcessingTerminalError("AUDIO_SOURCE_BUCKET_NOT_ALLOWED");
    }

    workDirectory = await mkdtemp(join(tmpdir(), "courseforge-audio-"));
    const inputPath = join(workDirectory, "source.input");
    const normalizedWavPath = join(workDirectory, "source.wav");
    const outputPath = join(workDirectory, "processed.m4a");
    const waveformPcmPath = join(workDirectory, "waveform.pcm");
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

    await execFileAsync("ffmpeg", buildFfmpegArgs(enhancementInputPath, outputPath, profilePolicy), {
      maxBuffer: 64 * 1024,
      timeout: FFMPEG_TIMEOUT_MS,
      windowsHide: true,
    });

    const outputFile = await stat(outputPath);
    if (outputFile.size <= 0 || outputFile.size > MAX_INPUT_BYTES) {
      throw new AudioProcessingTerminalError("AUDIO_OUTPUT_SIZE_INVALID");
    }
    const outputBytes = await readFile(outputPath);
    const durationSeconds = await probeDuration(outputPath);
    const checksum = sha256(outputBytes);
    const loudnessAnalysis = await analyzeLoudness(outputPath, profilePolicy);
    requirePassingAudioLoudness(loudnessAnalysis);
    const waveformManifest = await createAndUploadWaveform({
      durationSeconds,
      inputPath: outputPath,
      organizationId: job.organization_id,
      outputPath: waveformPcmPath,
      supabase: params.supabase,
    });
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
      p_metadata: buildOutputMetadata(job, loudnessAnalysis, waveformManifest),
      p_mime_type: "audio/mp4",
      p_output_snapshot: {
        audio_analysis: loudnessAnalysis,
        duration_seconds: durationSeconds,
        profile_id: job.input_snapshot.profile.id,
        source_asset_id: job.input_snapshot.source.assetId,
        waveform: waveformManifest,
      },
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
    p_lease_seconds: AUDIO_PROCESSING_LEASE_SECONDS,
    p_limit: Math.min(Math.max(limit, 1), 4),
    p_profile_ids: supportedProfiles,
  });
  if (error) throw new Error("AUDIO_CLAIM_FAILED");
  const results = await Promise.allSettled((data || []).map((job: unknown) => processClaimedAudioJob({ job, supabase, supportedProfiles })));
  return { claimed: results.length, failed: results.filter((result) => result.status === "rejected").length };
}

export function buildFfmpegArgs(inputPath: string, outputPath: string, policy: WorkerAudioProfilePolicy) {
  const { compressor, highPassFrequencyHz, limiterPeak, loudness } = policy;
  return [
    "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-i", inputPath,
    "-map", "0:a:0", "-vn",
    "-af", [
      `highpass=f=${highPassFrequencyHz}`,
      `acompressor=threshold=${compressor.thresholdDecibels}dB:ratio=${compressor.ratio}:attack=${compressor.attackMilliseconds}:release=${compressor.releaseMilliseconds}:makeup=${compressor.makeupDecibels}dB`,
      `alimiter=limit=${limiterPeak}`,
      `loudnorm=I=${loudness.integratedLufs}:LRA=${loudness.loudnessRangeLu}:TP=${loudness.truePeakDbtp}`,
    ].join(","),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "1", "-movflags", "+faststart", "-y", outputPath,
  ];
}

export function buildNormalizeToWavArgs(inputPath: string, outputPath: string) {
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

function buildOutputMetadata(
  job: ClaimedJob,
  loudnessAnalysis: AudioLoudnessAnalysis,
  waveformManifest: AudioWaveformManifest,
) {
  return {
    ...(job.input_snapshot.profile.id === "voice-clean-neural-dfn3-v1" ? {
      deepfilter_model_sha256: process.env.DEEPFILTER_MODEL_SHA256 || null,
      deepfilter_version: "externally-pinned",
      delay_compensated: true,
    } : {}),
    audio_analysis: loudnessAnalysis,
    profile_id: job.input_snapshot.profile.id,
    profile_version: 1,
    source_asset_id: job.input_snapshot.source.assetId,
    waveform: waveformManifest,
  };
}

async function analyzeLoudness(outputPath: string, policy: WorkerAudioProfilePolicy) {
  const { stderr } = await execFileAsync(
    "ffmpeg",
    buildLoudnessAnalysisArgs(outputPath, policy.loudness),
    { encoding: "utf8", maxBuffer: 512 * 1024, timeout: FFMPEG_TIMEOUT_MS, windowsHide: true },
  );
  return parseLoudnessAnalysis(stderr, policy.loudness);
}

async function createAndUploadWaveform(params: {
  durationSeconds: number;
  inputPath: string;
  organizationId: string;
  outputPath: string;
  supabase: SupabaseClient<any, any, any>;
}): Promise<AudioWaveformManifest> {
  const expectedPcmBytes = params.durationSeconds * AUDIO_WAVEFORM_SAMPLE_RATE_HZ * 2;
  if (expectedPcmBytes > MAX_WAVEFORM_PCM_BYTES) {
    throw new AudioProcessingTerminalError("AUDIO_WAVEFORM_DURATION_TOO_LARGE");
  }
  await execFileAsync("ffmpeg", buildWaveformExtractionArgs(params.inputPath, params.outputPath), {
    maxBuffer: 64 * 1024,
    timeout: FFMPEG_TIMEOUT_MS,
    windowsHide: true,
  });
  const waveformFile = await stat(params.outputPath);
  if (waveformFile.size <= 0 || waveformFile.size > MAX_WAVEFORM_PCM_BYTES) {
    throw new AudioProcessingTerminalError("AUDIO_WAVEFORM_PCM_SIZE_INVALID");
  }
  const pcm = await readFile(params.outputPath);
  const derivative = buildWaveformDerivative(
    pcm,
    pcm.byteLength / (2 * AUDIO_WAVEFORM_SAMPLE_RATE_HZ),
  );
  const derivativeBytes = Buffer.from(JSON.stringify(derivative));
  if (derivativeBytes.byteLength > MAX_WAVEFORM_JSON_BYTES) {
    throw new AudioProcessingTerminalError("AUDIO_WAVEFORM_DERIVATIVE_TOO_LARGE");
  }
  const checksum = sha256(derivativeBytes);
  const storagePath = `organizations/${params.organizationId}/audio-analysis/${checksum}/waveform-v1.json`;
  const { error } = await params.supabase.storage.from("production-assets").upload(storagePath, derivativeBytes, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) throw new AudioProcessingRetryableError("AUDIO_WAVEFORM_UPLOAD_FAILED");
  return {
    checksum,
    contract_version: derivative.contract_version,
    duration_seconds: derivative.duration_seconds,
    level_count: derivative.levels.length,
    sample_rate_hz: derivative.sample_rate_hz,
    storage_bucket: "production-assets",
    storage_path: storagePath,
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
  return error instanceof AudioProcessingTerminalError || error instanceof AudioProcessingRetryableError || error instanceof AudioLoudnessQualityError
    ? error.message
    : "AUDIO_PROCESSING_EXECUTION_FAILED";
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

class AudioProcessingTerminalError extends Error {}
class AudioProcessingRetryableError extends Error {}
