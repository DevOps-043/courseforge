import { z } from "zod";
import { PLAYBACK_CAPTURE_POLICY } from "./composition-playback-capture-runtime";
import { mediaBoundaryWitnessSchema } from "./composition-playback-boundaries";

const safeFrame = z.number().int().nonnegative().max((PLAYBACK_CAPTURE_POLICY.maximumDurationSeconds + 60) * PLAYBACK_CAPTURE_POLICY.sampleRate);
export const playbackCaptureBatchSchema = z.object({
  originFrame: safeFrame.nullable(), chunks: z.array(z.object({startFrame: safeFrame,
    frames: z.number().int().positive().max(PLAYBACK_CAPTURE_POLICY.maximumBlockFrames),
    pcm: z.string().max(Math.ceil(PLAYBACK_CAPTURE_POLICY.maximumBlockFrames * 8 / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  }).strict()).max(PLAYBACK_CAPTURE_POLICY.maximumQueuedFrames),
  error: z.enum(["AUDIO_PLAYBACK_BACKPRESSURE", "AUDIO_PLAYBACK_PCM_INVALID", "AUDIO_PLAYBACK_PROCESSOR_FAILED",
    "AUDIO_PLAYBACK_PACKET_INVALID", "AUDIO_PLAYBACK_MEDIA_FAILED", "AUDIO_PLAYBACK_BUFFERING", "AUDIO_PLAYBACK_STOPPED_EARLY",
    "AUDIO_PLAYBACK_CLOCK_INVALID", "AUDIO_PLAYBACK_UNEXPECTED_MEDIA"]).nullable(),
  boundaries: mediaBoundaryWitnessSchema.optional(),
  done: z.boolean(), packetCount: z.number().int().nonnegative(), eventCount: z.number().int().nonnegative(),
  maxClockDriftMilliseconds: z.number().finite().nonnegative(), maxMediaDriftMilliseconds: z.number().finite().nonnegative(),
  largestBlockFrames: z.number().int().nonnegative().max(PLAYBACK_CAPTURE_POLICY.maximumBlockFrames),
}).strict();

/** Exact sample continuity, no zero padding, gain correction, lag compensation or dropped chunks. */
export class PlaybackPcmConsumer {
  private nextFrame: number | null = null;
  private originFrame: number | null = null;
  private discardedUntil = 0;
  private writtenFrames = 0;
  private measuredPeak = 0;
  readonly expectedFrames: number;
  constructor(durationSeconds: number) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > PLAYBACK_CAPTURE_POLICY.maximumDurationSeconds) {
      throw new Error("AUDIO_PLAYBACK_DURATION_INVALID");
    }
    this.expectedFrames = Math.ceil(durationSeconds * PLAYBACK_CAPTURE_POLICY.sampleRate);
  }
  async consume(input: unknown, write: (bytes: Buffer) => Promise<void>) {
    const batch = playbackCaptureBatchSchema.parse(input);
    if (batch.error) throw new Error(batch.error);
    const batchFrames = batch.chunks.reduce((sum, chunk) => sum + chunk.frames, 0);
    if (batchFrames > PLAYBACK_CAPTURE_POLICY.maximumQueuedFrames) throw new Error("AUDIO_PLAYBACK_BATCH_LIMIT");
    if (batch.originFrame !== null) {
      if (this.originFrame !== null && this.originFrame !== batch.originFrame) throw new Error("AUDIO_PLAYBACK_ORIGIN_CHANGED");
      if (batch.originFrame < this.discardedUntil) throw new Error("AUDIO_PLAYBACK_START_MISSING");
      this.originFrame = batch.originFrame;
    }
    for (const chunk of batch.chunks) {
      if (this.nextFrame !== null && chunk.startFrame !== this.nextFrame) throw new Error("AUDIO_PLAYBACK_SAMPLE_GAP");
      this.nextFrame = chunk.startFrame + chunk.frames;
      const bytes = Buffer.from(chunk.pcm, "base64");
      if (bytes.length !== chunk.frames * 8 || bytes.toString("base64") !== chunk.pcm) throw new Error("AUDIO_PLAYBACK_PACKET_INVALID");
      for (let offset = 0; offset < bytes.length; offset += 4) {
        const sample = bytes.readFloatLE(offset);
        if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error("AUDIO_PLAYBACK_PCM_INVALID");
      }
      if (this.originFrame === null) { this.discardedUntil = this.nextFrame; continue; }
      const first = Math.max(this.originFrame, chunk.startFrame);
      const end = Math.min(this.originFrame + this.expectedFrames, this.nextFrame);
      if (first >= end) continue;
      if (first !== this.originFrame + this.writtenFrames) throw new Error("AUDIO_PLAYBACK_SAMPLE_GAP");
      const pcm = bytes.subarray((first - chunk.startFrame) * 8, (end - chunk.startFrame) * 8);
      for (let offset = 0; offset < pcm.length; offset += 4) this.measuredPeak = Math.max(this.measuredPeak, Math.abs(pcm.readFloatLE(offset)));
      await write(pcm); this.writtenFrames += end - first;
    }
    return batch;
  }
  get complete() { return this.writtenFrames === this.expectedFrames; }
  finish() {
    if (!this.complete || this.originFrame === null) throw new Error("AUDIO_PLAYBACK_INCOMPLETE");
    return { originFrame: this.originFrame, sampleCount: this.writtenFrames, peak: this.measuredPeak };
  }
}
