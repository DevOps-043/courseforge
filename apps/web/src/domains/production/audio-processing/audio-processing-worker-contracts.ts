import { z } from "zod";
import { getAudioProcessingProfile } from "./audio-processing-profiles";
import type { AudioProcessingJobInput, AudioProcessingProfile } from "./audio-processing.types";

const audioSourceSchema = z.object({
  assetId: z.string().uuid(),
  checksum: z.string().trim().min(16).max(256),
  mimeType: z.enum(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"]),
  storageBucket: z.string().trim().min(1).max(100),
  storagePath: z.string().trim().min(1).max(2_000),
}).strict();

const jobSnapshotSchema = z.object({
  profile: z.object({
    id: z.enum(["voice-course-v1", "voice-clean-neural-dfn3-v1"]),
    version: z.literal(1),
  }).passthrough(),
  source: audioSourceSchema,
}).strict();

export interface ClaimedAudioProcessingJob {
  id: string;
  input_snapshot: unknown;
  job_type: string;
  provider: string;
  status: string;
}

export interface ResolvedAudioProcessingWorkerInput {
  jobId: string;
  profile: AudioProcessingProfile;
  source: AudioProcessingJobInput["source"];
}

/**
 * A worker treats its database snapshot as untrusted data. The profile is
 * re-resolved locally by ID and version so request payloads cannot inject
 * arbitrary FFmpeg filter values.
 */
export function resolveAudioProcessingWorkerInput(
  job: ClaimedAudioProcessingJob,
): ResolvedAudioProcessingWorkerInput {
  if (!isUuid(job.id)) throw new Error("AUDIO_PROCESSING_JOB_ID_INVALID");
  if (job.job_type !== "AUDIO_PROCESSING") throw new Error("AUDIO_PROCESSING_JOB_TYPE_INVALID");
  if (job.provider !== "ffmpeg") throw new Error("AUDIO_PROCESSING_PROVIDER_INVALID");
  if (job.status !== "RUNNING") throw new Error("AUDIO_PROCESSING_JOB_NOT_CLAIMED");

  const parsed = jobSnapshotSchema.safeParse(job.input_snapshot);
  if (!parsed.success) throw new Error("AUDIO_PROCESSING_INPUT_INVALID");

  const profile = getAudioProcessingProfile(parsed.data.profile.id);
  if (profile.version !== parsed.data.profile.version) {
    throw new Error("AUDIO_PROCESSING_PROFILE_VERSION_UNAVAILABLE");
  }

  return {
    jobId: job.id,
    profile,
    source: parsed.data.source,
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
