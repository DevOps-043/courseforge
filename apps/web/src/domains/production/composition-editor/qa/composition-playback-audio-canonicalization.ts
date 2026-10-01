import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, open, rm, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { nativePlaybackReceiptSchema } from "./composition-playback-audio-contract";
import { consumeDecodedPcm } from "./composition-pcm-decoder-stream";
import { audioTimingDecodeArguments } from "./composition-exported-audio-timing";
import { stereoFloatWavHeader } from "./composition-pcm-wav";
import { AUDIO_TIMING_POLICY, AUDIO_STREAM_LIMITS } from "./composition-audio-conformance-policy";

/** Converts actual native capture, not sources. No padding, normalization or temporal alignment correction. */
export async function canonicalizeBrowserPlaybackAudio(params: {
  nativePath: string; receipt: unknown; outputParentDirectory: string; ffmpegPath: string;
}, decode = consumeDecodedPcm) {
  const receipt = nativePlaybackReceiptSchema.parse(params.receipt);
  const nativeSize = 44 + receipt.playback.sampleCount * 8;
  const verifyNative = async () => {
    const file = await lstat(params.nativePath);
    if (!file.isFile() || file.size !== nativeSize) throw new Error("AUDIO_PLAYBACK_NATIVE_CHANGED");
    const digest = createHash("sha256"); let size = 0; let header = Buffer.alloc(0);
    for await (const chunk of createReadStream(params.nativePath)) {
      const bytes = chunk as Buffer; size += bytes.length;
      if (size > nativeSize) throw new Error("AUDIO_PLAYBACK_NATIVE_CHANGED");
      if (header.length < 44) header = Buffer.concat([header, bytes.subarray(0, 44 - header.length)]);
      digest.update(bytes);
    }
    if (size !== nativeSize || digest.digest("hex") !== receipt.audioSha256
      || !stereoFloatWavHeader(nativeSize - 44, receipt.sampleRate).equals(header)) throw new Error("AUDIO_PLAYBACK_NATIVE_CHANGED");
  };
  await verifyNative();
  const directory = await mkdtemp(join(resolve(params.outputParentDirectory), "conformance-playback-canonical-"));
  const names = ["audio-reference.wav", "audio-reference-metadata.json", "audio-reference-receipt.json"];
  const cleanup = async () => {
    for (const name of names) await rm(join(directory, name), {force: true});
    await rmdir(directory).catch((error: NodeJS.ErrnoException) => {if (error.code !== "ENOENT") throw error;});
  };
  try {
    const destination = await open(join(directory, names[0]!), "wx", 0o600);
    const expectedBytes = Math.ceil(receipt.durationSeconds * AUDIO_TIMING_POLICY.sampleRate) * 8;
    const digest = createHash("sha256"); let writtenBytes = 0; let peak = 0; let carry = Buffer.alloc(0);
    try {
      const header = stereoFloatWavHeader(expectedBytes, AUDIO_TIMING_POLICY.sampleRate);
      await destination.writeFile(header); digest.update(header);
      await decode({binary: params.ffmpegPath, arguments: audioTimingDecodeArguments(params.nativePath, receipt.durationSeconds),
        maximumBytes: expectedBytes, timeoutMilliseconds: AUDIO_STREAM_LIMITS.decodeTimeoutMilliseconds,
        consume: async (input) => {
          // Bound processing even if an injected adapter supplies a large stdout chunk.
          for (let start = 0; start < input.length; start += AUDIO_STREAM_LIMITS.processingChunkBytes) {
            const slice = Buffer.from(input.subarray(start, start + AUDIO_STREAM_LIMITS.processingChunkBytes));
            const bytes = carry.length ? Buffer.concat([carry, slice]) : slice;
            const completeBytes = bytes.length - bytes.length % 8; const pcm = bytes.subarray(0, completeBytes);
            carry = Buffer.from(bytes.subarray(completeBytes));
            if (writtenBytes + completeBytes > expectedBytes) throw new Error("AUDIO_PLAYBACK_CANONICAL_SAMPLE_COUNT_INVALID");
            for (let offset = 0; offset < pcm.length; offset += 4) {
              const sample = pcm.readFloatLE(offset);
              if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error("AUDIO_PLAYBACK_CANONICAL_PCM_INVALID");
              peak = Math.max(peak, Math.abs(sample));
            }
            await destination.writeFile(pcm); digest.update(pcm); writtenBytes += completeBytes;
          }
        }});
      if (carry.length || writtenBytes !== expectedBytes) throw new Error("AUDIO_PLAYBACK_CANONICAL_SAMPLE_COUNT_INVALID");
    } finally {await destination.close();}
    await verifyNative();
    const audioSha256 = digest.digest("hex");
    const canonicalReceipt = {...receipt, method: "BROWSER_MEDIA_OUTPUT_PCM_CANONICAL_V3" as const,
      sampleRate: AUDIO_TIMING_POLICY.sampleRate, audioSha256, peak,
      native: {sampleRate: receipt.sampleRate, audioSha256: receipt.audioSha256, peak: receipt.peak},
      conversion: "FFMPEG_ARESAMPLE_8K_STEREO_NO_GAIN_OR_LAG_CORRECTION" as const};
    await writeFile(join(directory, names[1]!), JSON.stringify({documentHash: receipt.documentHash, audioSha256}), {flag: "wx", mode: 0o600});
    await writeFile(join(directory, names[2]!), JSON.stringify(canonicalReceipt), {flag: "wx", mode: 0o600});
    return {directory, audioReferencePath: join(directory, names[0]!), receipt: canonicalReceipt, cleanup};
  } catch (error) {await cleanup(); throw error;}
}
