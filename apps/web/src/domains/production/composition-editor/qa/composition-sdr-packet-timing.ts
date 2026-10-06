import {createHash} from "node:crypto";
import {z} from "zod";

const MAXIMUM_PACKET_JSON_BYTES = 16 * 1024 * 1024;
const timestamp = z.union([z.number().int().safe(), z.string().max(20).regex(/^-?\d+$/)])
  .transform(value => BigInt(value)).refine(value => value >= -(2n ** 63n) && value < 2n ** 63n);
const timingSchema = z.object({
  streams: z.array(z.object({codec_type: z.literal("video"),
    time_base: z.string().max(21).regex(/^[1-9]\d{0,9}\/[1-9]\d{0,9}$/)}).passthrough()).length(1),
  packets: z.array(z.object({pts: timestamp, dts: timestamp, duration: timestamp}).passthrough()).min(1).max(36000),
}).passthrough();

function rational(numerator: bigint, denominator: bigint): string {
  let divisor = numerator < 0n ? -numerator : numerator;
  let remainder = denominator;
  while (remainder !== 0n) [divisor, remainder] = [remainder, divisor % remainder];
  return `${numerator / divisor}/${denominator / divisor}`;
}

/** Exact packet timing in seconds, independent of MP4 timescale; not decoded A/V sync. */
export function hashSdrPacketTiming(encoded: unknown, profile: {fps: number; frameCount: number}): string {
  try {
    if (![24, 25, 30, 60].includes(profile.fps) || !Number.isSafeInteger(profile.frameCount)
      || profile.frameCount < 1 || profile.frameCount > 36000 || typeof encoded !== "string"
      || Buffer.byteLength(encoded) > MAXIMUM_PACKET_JSON_BYTES) throw new Error();
    const parsed = timingSchema.parse(JSON.parse(encoded));
    if (parsed.packets.length !== profile.frameCount) throw new Error();
    const [numerator, denominator] = parsed.streams[0]!.time_base.split("/").map(BigInt);
    const ticksPerSecond = numerator! * BigInt(profile.fps);
    const displayFrames = new Set<bigint>();
    const digest = createHash("sha256").update("courseforge-sdr-packet-timing-v1\n");
    let previousDecodeTimestamp: bigint | undefined;
    for (const packet of parsed.packets) {
      // B-frames can reorder PTS in packet order. DTS must nevertheless increase.
      const frameNumerator = packet.pts * ticksPerSecond;
      if (packet.pts < 0n || frameNumerator % denominator! !== 0n
        || packet.duration * ticksPerSecond !== denominator!
        || previousDecodeTimestamp !== undefined && packet.dts <= previousDecodeTimestamp) throw new Error();
      const displayFrame = frameNumerator / denominator!;
      if (displayFrame >= BigInt(profile.frameCount) || displayFrames.has(displayFrame)) throw new Error();
      displayFrames.add(displayFrame);
      previousDecodeTimestamp = packet.dts;
      digest.update(JSON.stringify([packet.pts, packet.dts, packet.duration]
        .map(value => rational(value * numerator!, denominator!))));
    }
    return digest.digest("hex");
  } catch {throw new Error("SDR_MUX_VIDEO_TIMING_INVALID");}
}
