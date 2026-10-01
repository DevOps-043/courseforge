import { z } from "zod";
import { createHash } from "node:crypto";
import { PLAYBACK_CAPTURE_POLICY } from "./composition-playback-capture-runtime";
import { mediaBoundaryWitnessSchema } from "./composition-playback-boundaries";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const playbackVisualFramesSchema = z.array(z.object({frameIndex: z.number().int().nonnegative(),
  timeSeconds: z.number().finite().nonnegative(), sha256: hash, sizeBytes: z.number().int().positive()}).strict()).min(1).max(48)
  .refine((frames) => new Set(frames.map((frame) => frame.frameIndex)).size === frames.length);
export function playbackVisualFramesHash(input: unknown) {
  const frames = playbackVisualFramesSchema.parse(input).sort((left, right) => left.frameIndex - right.frameIndex)
    .map(({frameIndex, timeSeconds, sha256, sizeBytes}) => ({frameIndex, timeSeconds, sha256, sizeBytes}));
  return createHash("sha256").update(JSON.stringify(frames)).digest("hex");
}
export const playbackWitnessSchema = z.object({
  policy: z.literal(PLAYBACK_CAPTURE_POLICY.id), workletSha256: hash,
  originFrame: z.number().int().nonnegative(), sampleCount: z.number().int().positive(),
  packetCount: z.number().int().positive(), eventCount: z.number().int().nonnegative(),
  maxClockDriftMilliseconds: z.number().finite().nonnegative(), maxMediaDriftMilliseconds: z.number().finite().nonnegative(),
  quantumMilliseconds: z.number().finite().positive().max(PLAYBACK_CAPTURE_POLICY.maximumBlockFrames * 1000 / PLAYBACK_CAPTURE_POLICY.sampleRate),
  observation: z.literal("BROWSER_MEDIA_GRAPH_NOT_PHYSICAL_DEVICE_OR_SEMANTIC_LIP_SYNC"),
  boundaries: mediaBoundaryWitnessSchema.optional(),
}).strict();
export const nativePlaybackReceiptSchema = z.object({
  schemaVersion: z.literal(3), method: z.literal("BROWSER_MEDIA_OUTPUT_PCM_V3"), status: z.literal("BROWSER_PLAYBACK_CAPTURED"),
  organizationId: z.string().uuid(), revisionId: z.string().uuid(), projectHash: hash, documentHash: hash,
  assetCount: z.number().int().nonnegative().max(250), mediaBytes: z.number().int().nonnegative().max(2 * 1024 ** 3),
  audioEnvelopeVersion: z.literal(2), durationSeconds: z.number().finite().positive().max(PLAYBACK_CAPTURE_POLICY.maximumDurationSeconds),
  sampleRate: z.literal(PLAYBACK_CAPTURE_POLICY.sampleRate), channels: z.literal(2), audioSha256: hash,
  peak: z.number().finite().min(0).max(1), clipCount: z.number().int().nonnegative().max(PLAYBACK_CAPTURE_POLICY.maximumMediaElements),
  decodedAssetCount: z.literal(0), playback: playbackWitnessSchema,
}).strict().refine((receipt) => receipt.playback.sampleCount === Math.ceil(receipt.durationSeconds * receipt.sampleRate),
  {message: "AUDIO_PLAYBACK_SAMPLE_COUNT_INVALID"});
