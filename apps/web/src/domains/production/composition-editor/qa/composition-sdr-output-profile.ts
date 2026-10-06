import {z} from "zod";
const numberText = z.string().max(32).regex(/^\d+(?:\.\d+)?$/);
const probeSchema = z.object({streams: z.array(z.object({codec_type: z.literal("video"), codec_name: z.literal("h264"),
  width: z.number().int().positive(), height: z.number().int().positive(), pix_fmt: z.literal("yuv420p"),
  avg_frame_rate: z.string().max(32).regex(/^\d+\/\d+$/), nb_read_frames: z.string().max(10).regex(/^[1-9]\d*$/),
  color_space: z.literal("bt709"), color_transfer: z.literal("bt709"), color_primaries: z.literal("bt709"),
  color_range: z.literal("tv"), chroma_location: z.literal("left"), start_time: numberText,
}).strict()).length(1), format: z.object({duration: numberText, size: z.string().max(12).regex(/^[1-9]\d*$/),
  format_name: z.string().max(128), start_time: numberText}).strict()}).strict();

/** Probe metadata/counts only: never certifies transfer conversion or source provenance. */
export function validateSdrEncodedOutput(encoded: unknown, expected: {width: number; height: number; fps: number; frameCount: number; sizeBytes: number}) {
  try {
    if (typeof encoded !== "string" || Buffer.byteLength(encoded) > 65536) throw new Error();
    const parsed = probeSchema.parse(JSON.parse(encoded)), stream = parsed.streams[0]!;
    const [numerator, denominator] = stream.avg_frame_rate.split("/").map(Number);
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || !denominator
      || numerator! / denominator !== expected.fps || stream.width !== expected.width
      || stream.height !== expected.height || Number(stream.nb_read_frames) !== expected.frameCount
      || Number(parsed.format.size) !== expected.sizeBytes || !parsed.format.format_name.split(",").includes("mp4")
      || Number(parsed.format.start_time) !== 0 || Number(stream.start_time) !== 0 || Number(parsed.format.duration) <= 0
      || Math.abs(Number(parsed.format.duration) - expected.frameCount / expected.fps) > 1 / expected.fps)
      throw new Error();
    return {policy: "COUNTED_H264_REC709_OUTPUT_PROFILE_V1" as const,
      scope: "PROBED_METADATA_NOT_SDR_PIXEL_CONVERSION_ATTESTATION" as const,
      frameCount: expected.frameCount, durationSeconds: Number(parsed.format.duration), fps: expected.fps};
  } catch {throw new Error("SDR_FRAME_OUTPUT_PROFILE_INVALID");}
}
