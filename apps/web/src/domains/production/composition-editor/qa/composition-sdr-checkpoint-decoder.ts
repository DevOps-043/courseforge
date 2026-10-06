import {z} from "zod";
import {SDR_FRAME_CONVERSION_POLICY, SDR_AUDIO_MUX_POLICY} from "../composition-sdr-conversion-policy";
import {controlledRenderExecutionObservationSchema, evaluateControlledRenderExecution,
  type ControlledRenderExecutionContract} from "../composition-render-execution-contract";

/** Freeze/receipt selects the inverse; a caller flag or stream tags alone never do. */
export function resolveSdrCheckpointFilter(input: {expected?: ControlledRenderExecutionContract;
  observation?: unknown; documentHash: string; videoSha256: string}) {
  const observed = input.observation === undefined ? undefined : controlledRenderExecutionObservationSchema.parse(input.observation);
  if (!input.expected?.sdrConversionPolicy && !observed?.sdrConversionPolicy) return undefined;
  if (!input.expected?.sdrConversionPolicy) throw new Error("CONFORMANCE_SDR_CONVERSION_UNAUTHORIZED");
  if (evaluateControlledRenderExecution({...input, expected: input.expected}).status !== "MATCH")
    throw new Error("CONFORMANCE_SDR_EXECUTION_MISMATCH");
  return SDR_FRAME_CONVERSION_POLICY.compareFilter;
}

const streamProfile = z.object({codec_type: z.literal("video"), codec_name: z.literal("h264"),
  pix_fmt: z.literal("yuv420p"), color_space: z.literal("bt709"), color_primaries: z.literal("bt709"),
  color_transfer: z.literal("bt709"), color_range: z.literal("tv"), chroma_location: z.literal("left")}).passthrough();
/** Metadata is a prerequisite for this inverse, never proof of converted pixels. */
export function assertSdrCheckpointStreamProfile(probe: unknown, audioMuxPolicy?: typeof SDR_AUDIO_MUX_POLICY,
  audioWindow?: {durationSeconds: number; frameDurationSeconds: number}) {
  const parsed = z.object({streams: z.array(z.unknown()).length(audioMuxPolicy ? 2 : 1)}).passthrough().safeParse(probe);
  const video = parsed.success ? parsed.data.streams.filter(stream => streamProfile.safeParse(stream).success) : [];
  const audio = parsed.success ? parsed.data.streams.filter(stream => sdrMuxAudioStreamSchema.safeParse(stream).success) : [];
  if (audioMuxPolicy !== undefined && audioMuxPolicy !== SDR_AUDIO_MUX_POLICY
    || !parsed.success || video.length !== 1 || audio.length !== (audioMuxPolicy ? 1 : 0))
    throw new Error("CONFORMANCE_SDR_DECODE_PROFILE_INVALID");
  if (audioMuxPolicy) {
    const track = sdrMuxAudioStreamSchema.parse(audio[0]);
    if (!audioWindow || !Number.isFinite(audioWindow.durationSeconds) || audioWindow.durationSeconds <= 0
      || !Number.isFinite(audioWindow.frameDurationSeconds) || audioWindow.frameDurationSeconds <= 0
      || Math.abs(Number(track.duration) - audioWindow.durationSeconds) > audioWindow.frameDurationSeconds)
      throw new Error("CONFORMANCE_SDR_DECODE_AUDIO_DURATION_INVALID");
  }
}

export const sdrMuxAudioStreamSchema = z.object({codec_type: z.literal("audio"), codec_name: z.literal("aac"),
  sample_rate: z.literal("48000"), channels: z.literal(2), start_time: z.string().max(32)
    .regex(/^0(?:\.0+)?$/), duration: z.string().max(32).regex(/^\d+(?:\.\d+)?$/)
    .refine(value => Number(value) > 0)}).passthrough();
