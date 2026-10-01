import { AUDIO_TIMING_POLICY } from "./composition-audio-conformance-policy";

/** Explicit native/canonical profiles only; IEEE float stereo, no gain or integer quantization. */
export function stereoFloatWavHeader(pcmBytes: number, sampleRate: 8000 | 48000) {
  if (![8000, 48000].includes(sampleRate) || !Number.isSafeInteger(pcmBytes) || pcmBytes <= 0 || pcmBytes % 8
    || pcmBytes > AUDIO_TIMING_POLICY.maximumDurationSeconds * sampleRate * 8) throw new Error("AUDIO_REFERENCE_WAV_INVALID");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcmBytes, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 8, 28);
  header.writeUInt16LE(8, 32); header.writeUInt16LE(32, 34); header.write("data", 36); header.writeUInt32LE(pcmBytes, 40);
  return header;
}
