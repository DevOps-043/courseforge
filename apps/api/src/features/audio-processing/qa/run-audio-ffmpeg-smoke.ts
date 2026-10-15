import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildLoudnessAnalysisArgs, parseLoudnessAnalysis, requirePassingAudioLoudness } from "../audio-analysis";
import { AUDIO_WAVEFORM_SAMPLE_RATE_HZ, buildWaveformDerivative, buildWaveformExtractionArgs } from "../audio-waveform";
import { buildFfmpegArgs, buildNormalizeToWavArgs } from "../audio-worker";
import { resolveWorkerAudioProfilePolicy } from "../worker-capabilities";
import { probeAudioSource } from "../audio-source-probe";

const execFileAsync = promisify(execFile);
const FFMPEG_SMOKE_TIMEOUT_MS = 60_000;

async function runFfmpeg(args: string[], maxBuffer = 64 * 1024) {
  return execFileAsync("ffmpeg", args, {
    encoding: "utf8",
    maxBuffer,
    timeout: FFMPEG_SMOKE_TIMEOUT_MS,
    windowsHide: true,
  });
}

async function main() {
  const workDirectory = await mkdtemp(join(tmpdir(), "courseforge-audio-ffmpeg-smoke-"));
  const sourcePath = join(workDirectory, "source.wav");
  const normalizedPath = join(workDirectory, "normalized.wav");
  const outputPath = join(workDirectory, "processed.m4a");
  const waveformPath = join(workDirectory, "waveform.pcm");
  const formatPaths = ["mp3", "m4a", "aac"].map((extension) => join(workDirectory, `fixture.${extension}`));
  try {
    const policy = resolveWorkerAudioProfilePolicy("voice-course-v1");

    await runFfmpeg([
      "-hide_banner", "-nostdin", "-v", "error", "-f", "lavfi",
      "-i", "sine=frequency=1000:sample_rate=48000:duration=6",
      "-ac", "1", "-c:a", "pcm_s16le", "-y", sourcePath,
    ]);
    await probeAudioSource(sourcePath);
    for (const [index, path] of formatPaths.entries()) {
      await runFfmpeg(["-hide_banner", "-nostdin", "-v", "error", "-i", sourcePath,
        "-c:a", index === 0 ? "libmp3lame" : "aac", "-y", path]);
      await probeAudioSource(path);
      await runFfmpeg(buildNormalizeToWavArgs(path, normalizedPath));
    }
    await runFfmpeg(buildNormalizeToWavArgs(sourcePath, normalizedPath));
    await runFfmpeg(buildFfmpegArgs(normalizedPath, outputPath, policy));
    const { stderr } = await runFfmpeg(buildLoudnessAnalysisArgs(outputPath, policy.loudness), 512 * 1024);
    const analysis = parseLoudnessAnalysis(stderr, policy.loudness);
    requirePassingAudioLoudness(analysis);

    await runFfmpeg(buildWaveformExtractionArgs(outputPath, waveformPath));
    const waveformPcm = await readFile(waveformPath);
    const waveform = buildWaveformDerivative(waveformPcm, waveformPcm.byteLength / (2 * AUDIO_WAVEFORM_SAMPLE_RATE_HZ));
    assert.ok(waveform.levels.length > 0, "AUDIO_WAVEFORM_LEVELS_MISSING");
    process.stdout.write(JSON.stringify({
      ffmpegSmoke: "passed",
      compatibleFormats: ["wav", "mp3", "m4a", "aac"],
      integratedLufs: analysis.integrated_lufs,
      truePeakDbtp: analysis.true_peak_dbtp,
      waveformLevels: waveform.levels.length,
    }) + "\n");
  } finally {
    await Promise.all([sourcePath, normalizedPath, outputPath, waveformPath, ...formatPaths].map((path) => rm(path, { force: true })));
    await rmdir(workDirectory);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`AUDIO_FFMPEG_SMOKE_FAILED: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
