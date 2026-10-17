import { AUDIO_RMS_WINDOW_POLICY, AUDIO_STREAM_LIMITS, AUDIO_TIMING_POLICY } from "./composition-audio-conformance-policy";
export type StereoEnergyWindows = { channels: [number[], number[]]; sampleCounts: number[] };

/** Preserves sample and window boundaries across arbitrary transport chunks; retains no full PCM. */
export class StereoPcmEnergyAccumulator {
  private readonly windows: StereoEnergyWindows = { channels: [[], []], sampleCounts: [] };
  private carry = Buffer.alloc(0);
  private bytes = 0;
  private frames = 0;
  private sums = [0, 0];
  private finished = false;
  private readonly framesPerWindow: number;
  constructor(windowMilliseconds: number) {
    this.framesPerWindow = AUDIO_TIMING_POLICY.sampleRate * windowMilliseconds / 1_000;
    if (!Number.isSafeInteger(this.framesPerWindow) || this.framesPerWindow <= 0
      || windowMilliseconds > AUDIO_RMS_WINDOW_POLICY.windowMilliseconds) throw new Error("AUDIO_TIMING_PCM_INVALID");
  }
  push(bytes: Uint8Array) {
    if (this.finished) throw new Error("AUDIO_TIMING_STREAM_FINISHED");
    this.bytes += bytes.byteLength;
    if (this.bytes > AUDIO_TIMING_POLICY.sampleRate * (AUDIO_TIMING_POLICY.maximumDurationSeconds + 1) * 8) {
      throw new Error("AUDIO_TIMING_PCM_INVALID");
    }
    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset < input.length; offset += AUDIO_STREAM_LIMITS.processingChunkBytes) {
      const chunk = input.subarray(offset, offset + AUDIO_STREAM_LIMITS.processingChunkBytes);
      const aligned = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk;
      const end = aligned.length - aligned.length % 8;
      for (let position = 0; position < end; position += 8) {
        for (let channel = 0; channel < 2; channel++) {
          const value = aligned.readFloatLE(position + channel * 4);
          if (!Number.isFinite(value) || Math.abs(value) > 32) throw new Error("AUDIO_TIMING_PCM_INVALID");
          this.sums[channel]! += value * value;
        }
        this.frames++;
        if (this.frames === this.framesPerWindow) this.flushWindow();
      }
      this.carry = Buffer.from(aligned.subarray(end));
    }
  }
  finish(): StereoEnergyWindows {
    if (!this.finished) {
      if (!this.bytes || this.carry.length) throw new Error("AUDIO_TIMING_PCM_INVALID");
      if (this.frames) this.flushWindow();
      this.finished = true;
    }
    return this.windows;
  }
  private flushWindow() {
    for (let channel = 0; channel < 2; channel++) this.windows.channels[channel]!.push(Math.sqrt(this.sums[channel]! / this.frames));
    this.windows.sampleCounts.push(this.frames); this.frames = 0; this.sums = [0, 0];
  }
}
