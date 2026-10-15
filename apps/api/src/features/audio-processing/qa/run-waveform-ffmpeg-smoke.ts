import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createWaveformAccumulator } from "../audio-waveform-stream";
import { buildNativeWaveformDecodeArgs } from "../audio-waveform-worker";

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "waveform-build-smoke-"));
  try {
    const frames = 48000;
    const wav = Buffer.alloc(44 + frames * 4);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(48000, 24);
    wav.writeUInt32LE(192000, 28);
    wav.writeUInt16LE(4, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(frames * 4, 40);
    for (let frame = 0; frame < frames; frame += 1) {
      const sample = Math.round(
        32767 * Math.sin((2 * Math.PI * 1000 * frame) / 48000),
      );
      wav.writeInt16LE(sample, 44 + frame * 4);
      wav.writeInt16LE(-sample, 46 + frame * 4);
    }
    const path = join(directory, "stereo.wav");
    await writeFile(path, wav);
    const { stdout } = await promisify(execFile)(
      "ffmpeg",
      buildNativeWaveformDecodeArgs(path),
      {
        encoding: "buffer",
        maxBuffer: 1024 * 1024,
        timeout: 30000,
        windowsHide: true,
      },
    );
    const accumulator = createWaveformAccumulator(48000, 2, 1);
    accumulator.push(stdout);
    const derivative = accumulator.finish();
    if (
      derivative.duration_seconds !== 1 ||
      derivative.channels.some(
        (channel) => Math.max(...channel.levels[0].max) < 0.99,
      )
    ) {
      throw new Error("WAVEFORM_NATIVE_FFMPEG_CONFORMANCE_FAILED");
    }
    process.stdout.write("Native-rate stereo waveform FFmpeg smoke passed.\n");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "WAVEFORM_SMOKE_FAILED"}\n`,
  );
  process.exitCode = 1;
});
