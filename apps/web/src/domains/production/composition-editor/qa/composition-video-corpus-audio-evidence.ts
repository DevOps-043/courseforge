import { createHash } from "node:crypto";
import { CORPUS_AUDIO_DURATION_SECONDS } from "./composition-conformance-corpus-assets";

const SOURCE_SAMPLE_RATE = 8000;
const DECODED_SAMPLE_RATE = 48000;
const CHANNEL_COUNT = 2;
const WINDOW_SECONDS = 0.5;
const MAX_RMS_DELTA_DB = 1.5;
const MAX_AAC_PADDING_FRAMES = 1024;

/** FFmpeg's pipe WAV uses an unknown RIFF/data length sentinel; parse bounded chunks, not a fixed header offset. */
export function extractDecodedCorpusPcm(wav: Buffer) {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE")
    throw new Error("CONFORMANCE_CORPUS_AUDIO_FORMAT_INVALID");
  let offset = 12, hasFormat = false;
  for (let chunkCount = 0; chunkCount < 32 && offset + 8 <= wav.length; chunkCount++) {
    const id = wav.toString("ascii", offset, offset + 4), length = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      if (hasFormat || length < 16 || start + length > wav.length || wav.readUInt16LE(start) !== 1
        || wav.readUInt16LE(start + 2) !== CHANNEL_COUNT || wav.readUInt32LE(start + 4) !== DECODED_SAMPLE_RATE
        || wav.readUInt16LE(start + 12) !== CHANNEL_COUNT * 2 || wav.readUInt16LE(start + 14) !== 16)
        throw new Error("CONFORMANCE_CORPUS_AUDIO_FORMAT_INVALID");
      hasFormat = true;
    }
    if (id === "data") {
      const end = length === 0xffffffff ? wav.length : start + length;
      if (!hasFormat || end !== wav.length || end <= start || (end - start) % (CHANNEL_COUNT * 2))
        throw new Error("CONFORMANCE_CORPUS_AUDIO_FORMAT_INVALID");
      return wav.subarray(start, end);
    }
    if (length === 0xffffffff || start + length > wav.length) throw new Error("CONFORMANCE_CORPUS_AUDIO_FORMAT_INVALID");
    offset = start + length + (length % 2);
  }
  throw new Error("CONFORMANCE_CORPUS_AUDIO_FORMAT_INVALID");
}

/** Checks signal and coarse envelope only; this is not audio identity or preview/render parity. */
export function measureVideoCorpusDecodedAudio(sourceWav: Buffer, decodedPcm: Buffer) {
  const sourceFrames = SOURCE_SAMPLE_RATE * CORPUS_AUDIO_DURATION_SECONDS;
  const expectedDecodedFrames = DECODED_SAMPLE_RATE * CORPUS_AUDIO_DURATION_SECONDS;
  if (sourceWav.length !== 44 + sourceFrames * CHANNEL_COUNT * 4
    || sourceWav.toString("ascii", 0, 4) !== "RIFF"
    || sourceWav.toString("ascii", 8, 12) !== "WAVE"
    || sourceWav.toString("ascii", 36, 40) !== "data"
    || decodedPcm.length % (CHANNEL_COUNT * 2) !== 0) throw new Error("CONFORMANCE_CORPUS_AUDIO_FORMAT_INVALID");
  const decodedFrames = decodedPcm.length / (CHANNEL_COUNT * 2);
  if (decodedFrames < expectedDecodedFrames || decodedFrames > expectedDecodedFrames + MAX_AAC_PADDING_FRAMES)
    throw new Error("CONFORMANCE_CORPUS_AUDIO_DURATION_INVALID");

  let maximumRmsDeltaDb = 0;
  const windowCount = CORPUS_AUDIO_DURATION_SECONDS / WINDOW_SECONDS;
  for (let windowIndex = 0; windowIndex < windowCount; windowIndex++) {
    for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
      const sourceRms = windowRms(sourceFrames, SOURCE_SAMPLE_RATE, windowIndex, (frame) =>
        sourceWav.readFloatLE(44 + (frame * CHANNEL_COUNT + channel) * 4));
      const decodedRms = windowRms(expectedDecodedFrames, DECODED_SAMPLE_RATE, windowIndex, (frame) =>
        decodedPcm.readInt16LE((frame * CHANNEL_COUNT + channel) * 2) / 32768);
      if (!Number.isFinite(sourceRms) || sourceRms <= 0.001 || !Number.isFinite(decodedRms) || decodedRms <= 0.001)
        throw new Error("CONFORMANCE_CORPUS_AUDIO_SIGNAL_INVALID");
      const deltaDb = Math.abs(20 * Math.log10(decodedRms / sourceRms));
      if (deltaDb > MAX_RMS_DELTA_DB) throw new Error("CONFORMANCE_CORPUS_AUDIO_ENVELOPE_INVALID");
      maximumRmsDeltaDb = Math.max(maximumRmsDeltaDb, deltaDb);
    }
  }
  return {decodedPcmSha256: createHash("sha256").update(decodedPcm).digest("hex"), decodedFrames,
    measuredWindowCount: windowCount, maximumRmsDeltaDb, policy: "CORPUS_STEREO_RMS_HALF_SECOND_V1" as const};
}

function windowRms(totalFrames: number, sampleRate: number, windowIndex: number, sample: (frame: number) => number) {
  const first = Math.round(windowIndex * WINDOW_SECONDS * sampleRate);
  const last = Math.min(totalFrames, Math.round((windowIndex + 1) * WINDOW_SECONDS * sampleRate));
  let sumSquares = 0;
  for (let frame = first; frame < last; frame++) {
    const value = sample(frame);
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / (last - first));
}
