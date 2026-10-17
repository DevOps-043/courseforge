import { createHash } from "node:crypto";
import { z } from "zod";
import { compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { COMPOSITION_PLAYBACK_AUDIO_ENVELOPE_VERSION } from "../composition-playback-audio-envelope";
import { AUDIO_REFERENCE_LIMITS, encodeAudioReferenceWavHeader } from "./composition-audio-reference-mix";
import { AUDIO_STREAM_LIMITS } from "./composition-audio-conformance-policy";
import { playbackWitnessSchema, playbackVisualFramesSchema, playbackVisualFramesHash } from "./composition-playback-audio-contract";
import { PLAYBACK_CAPTURE_POLICY } from "./composition-playback-capture-runtime";
import { mediaBoundaryPlanHash } from "./composition-playback-boundaries";

export const AUDIO_EVIDENCE_LIMITS = { packageBytes: 48 * 1024 * 1024, legacyPackageBytes: 8 * 1024 * 1024, jsonBytes: 64 * 1024,
  legacyWavBytes: 44 + AUDIO_STREAM_LIMITS.legacyDurationSeconds * AUDIO_REFERENCE_LIMITS.sampleRate * 8,
  wavBytes: 44 + AUDIO_REFERENCE_LIMITS.durationSeconds * AUDIO_REFERENCE_LIMITS.sampleRate * 8 } as const;
export const audioEvidenceHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const audioEvidenceReceiptBase = z.object({
  organizationId: z.string().uuid(), revisionId: z.string().uuid(),
  projectHash: audioEvidenceHashSchema, documentHash: audioEvidenceHashSchema,
  status: z.literal("SOURCE_MIX_REFERENCE_NOT_PLAYBACK_CAPTURE"),
  audioEnvelopeVersion: z.literal(COMPOSITION_PLAYBACK_AUDIO_ENVELOPE_VERSION), audioSha256: audioEvidenceHashSchema,
  visualChecksum: audioEvidenceHashSchema, assetCount: z.number().int().min(0).max(250),
  mediaBytes: z.number().int().min(0).max(2 * 1024 * 1024 * 1024),
  durationSeconds: z.number().finite().positive().max(AUDIO_REFERENCE_LIMITS.durationSeconds),
  sampleRate: z.literal(AUDIO_REFERENCE_LIMITS.sampleRate), channels: z.literal(2),
  clipCount: z.number().int().min(0).max(AUDIO_REFERENCE_LIMITS.clips),
  decodedAssetCount: z.number().int().min(0).max(AUDIO_REFERENCE_LIMITS.clips), peak: z.number().finite().min(0).max(1),
}).strict();
export const audioEvidenceReceiptSchema = z.discriminatedUnion("schemaVersion", [
  audioEvidenceReceiptBase.extend({ schemaVersion: z.literal(1), method: z.literal("PREVIEW_RULES_STEREO_PCM_V1"),
    durationSeconds: z.number().finite().positive().max(AUDIO_STREAM_LIMITS.legacyDurationSeconds) }).strict(),
  audioEvidenceReceiptBase.extend({ schemaVersion: z.literal(2), method: z.literal("PREVIEW_RULES_STEREO_PCM_CHUNKED_V2"),
    mixChunkFrames: z.literal(AUDIO_STREAM_LIMITS.mixChunkFrames) }).strict(),
  audioEvidenceReceiptBase.extend({schemaVersion: z.literal(3), method: z.literal("BROWSER_MEDIA_OUTPUT_PCM_CANONICAL_V3"),
    status: z.literal("BROWSER_PLAYBACK_CAPTURED"), decodedAssetCount: z.literal(0), playback: playbackWitnessSchema,
    native: z.object({sampleRate: z.literal(PLAYBACK_CAPTURE_POLICY.sampleRate), audioSha256: audioEvidenceHashSchema,
      peak: z.number().finite().min(0).max(1)}).strict(),
    conversion: z.literal("FFMPEG_ARESAMPLE_8K_STEREO_NO_GAIN_OR_LAG_CORRECTION"), visualFramesSha256: audioEvidenceHashSchema,
    visualFrames: playbackVisualFramesSchema,
  }).strict(),
]);
export const audioEvidenceMetadataSchema = z.object({ documentHash: audioEvidenceHashSchema, audioSha256: audioEvidenceHashSchema }).strict();
export const audioEvidenceRecordSchema = z.object({
  organizationId: z.string().uuid(), revisionId: z.string().uuid(), projectHash: audioEvidenceHashSchema,
  documentHash: audioEvidenceHashSchema, visualChecksum: audioEvidenceHashSchema, checksum: audioEvidenceHashSchema,
  storagePath: z.string(), sizeBytes: z.number().int().positive().max(AUDIO_EVIDENCE_LIMITS.packageBytes),
  receipt: audioEvidenceReceiptSchema, contract: compositionConformanceContractSchema,
}).strict().refine((record) => record.receipt.schemaVersion !== 1 || record.sizeBytes <= AUDIO_EVIDENCE_LIMITS.legacyPackageBytes,
  { message: "AUDIO_EVIDENCE_LEGACY_PACKAGE_LIMIT" });
export const audioEvidenceSha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function audioEvidenceStoragePath(organizationId: string, revisionId: string, visualChecksum: string, checksum: string) {
  return `${organizationId}/${revisionId}/audio/${visualChecksum}/${checksum}.zip`;
}
export function validateAudioEvidenceBytes(params: {
  wav: Buffer; receipt: z.infer<typeof audioEvidenceReceiptSchema>; metadata: unknown;
  contract: z.infer<typeof compositionConformanceContractSchema>;
}) {
  const { wav, contract } = params;
  const receipt = audioEvidenceReceiptSchema.parse(params.receipt);
  if (receipt.schemaVersion === 3) {
    if (receipt.playback.sampleCount !== Math.ceil(receipt.durationSeconds * receipt.native.sampleRate)) throw new Error("AUDIO_EVIDENCE_PLAYBACK_SAMPLE_COUNT_INVALID");
    if (playbackVisualFramesHash(receipt.visualFrames) !== receipt.visualFramesSha256
      || receipt.visualFrames.length !== contract.checkpoints.length
      || contract.checkpoints.some((checkpoint) => !receipt.visualFrames.some((frame) => frame.frameIndex === checkpoint.frameIndex
        && Math.abs(frame.timeSeconds - checkpoint.timeSeconds) <= 0.01))) throw new Error("AUDIO_EVIDENCE_PLAYBACK_VISUAL_INVALID");
    const boundaries = receipt.playback.boundaries;
    if (boundaries && (boundaries.media.length !== receipt.clipCount
      || boundaries.media.some((row) => row.window.endSeconds > receipt.durationSeconds)
      || boundaries.planHash !== mediaBoundaryPlanHash(boundaries.media.map((row) => row.window)))) {
      throw new Error("AUDIO_EVIDENCE_PLAYBACK_BOUNDARY_PLAN_INVALID");
    }
  }
  const metadata = audioEvidenceMetadataSchema.parse(params.metadata);
  const expectedBytes = 44 + Math.ceil(receipt.durationSeconds * receipt.sampleRate) * 8;
  if (receipt.documentHash !== contract.documentHash || receipt.durationSeconds !== contract.canvas.durationSeconds
    || metadata.documentHash !== receipt.documentHash || metadata.audioSha256 !== receipt.audioSha256
    || wav.length !== expectedBytes || wav.length > AUDIO_EVIDENCE_LIMITS.wavBytes
    || audioEvidenceSha256(wav) !== receipt.audioSha256) throw new Error("AUDIO_EVIDENCE_CONTENT_MISMATCH");
  const pcm = wav.subarray(44);
  if (!encodeAudioReferenceWavHeader(pcm.length).equals(wav.subarray(0, 44))) throw new Error("AUDIO_EVIDENCE_WAV_INVALID");
  let peak = 0;
  for (let offset = 0; offset < pcm.length; offset += 4) {
    const sample = pcm.readFloatLE(offset);
    if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error("AUDIO_EVIDENCE_PCM_INVALID");
    peak = Math.max(peak, Math.abs(sample));
  }
  // Receipt peak precedes conversion from the mix's float64 accumulator to float32 samples.
  if (Math.abs(peak - receipt.peak) > 1e-7 || receipt.decodedAssetCount > receipt.clipCount
    || receipt.decodedAssetCount > receipt.assetCount) throw new Error("AUDIO_EVIDENCE_RECEIPT_INVALID");
  return metadata;
}
