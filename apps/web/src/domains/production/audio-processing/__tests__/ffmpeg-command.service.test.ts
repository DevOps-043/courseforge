import assert from "node:assert/strict";
import test from "node:test";
import { getAudioProcessingProfile } from "../audio-processing-profiles";
import { buildFfmpegAudioCommand, buildVoiceFilterChain } from "../ffmpeg-command.service";

const profile = getAudioProcessingProfile("voice-course-v1");

test("builds a deterministic FFmpeg command without shell interpolation", () => {
  const command = buildFfmpegAudioCommand({
    inputFilePath: "C:/worker/input/source.wav",
    outputFilePath: "C:/worker/output/processed.m4a",
    profile,
  });

  assert.equal(command.executable, "ffmpeg");
  assert.deepEqual(command.args.slice(0, 8), [
    "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-i", "C:/worker/input/source.wav", "-map",
  ]);
  assert.ok(command.args.includes("-af"));
  assert.ok(command.args.includes("-vn"));
  assert.equal(command.args.at(-1), "C:/worker/output/processed.m4a");
});

test("keeps the approved voice chain explicit and free of denoise until calibrated", () => {
  const filters = buildVoiceFilterChain(profile);
  assert.match(filters, /highpass=f=70/);
  assert.match(filters, /acompressor=threshold=-18dB/);
  assert.match(filters, /alimiter=limit=0.95/);
  assert.match(filters, /loudnorm=I=-16:LRA=11:TP=-1.5/);
  assert.doesNotMatch(filters, /(afftdn|arnndn)/);
});

test("rejects URL, NUL and conflicting worker paths", () => {
  assert.throws(() => buildFfmpegAudioCommand({
    inputFilePath: "https://untrusted.example/audio.wav",
    outputFilePath: "C:/worker/output/processed.m4a",
    profile,
  }), /FFMPEG_ENTRADA_PATH_INVALID/);
  assert.throws(() => buildFfmpegAudioCommand({
    inputFilePath: "C:/worker/input/source.wav",
    outputFilePath: "C:/worker/input/source.wav",
    profile,
  }), /FFMPEG_INPUT_OUTPUT_PATH_CONFLICT/);
});
