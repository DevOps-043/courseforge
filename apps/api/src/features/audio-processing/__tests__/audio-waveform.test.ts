import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWaveformDerivative,
  buildWaveformExtractionArgs,
} from "../audio-waveform";

test("builds a bounded mono PCM extraction command without shell interpolation", () => {
  const args = buildWaveformExtractionArgs("C:/worker/processed.m4a", "C:/worker/waveform.pcm");
  assert.ok(args.includes("400"));
  assert.ok(args.includes("pcm_s16le"));
  assert.equal(args.at(-1), "C:/worker/waveform.pcm");
  assert.throws(
    () => buildWaveformExtractionArgs("C:/worker/audio.m4a", "C:/worker/audio.m4a"),
    /AUDIO_WAVEFORM_PATH_CONFLICT/,
  );
});

test("creates a deterministic extrema pyramid that preserves peaks", () => {
  const samples = [0, 16_384, -32_768, 32_767, -8_192, 8_192];
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
  const derivative = buildWaveformDerivative(pcm, 1);

  assert.equal(derivative.contract_version, 1);
  assert.equal(derivative.levels[0].min[2], -1);
  assert.equal(derivative.levels[0].max[3], 1);
  assert.equal(derivative.levels.at(-1)?.min.includes(-1), true);
  assert.equal(derivative.levels.at(-1)?.max.includes(1), true);
});

test("rejects empty, odd-length and invalid-duration PCM", () => {
  assert.throws(() => buildWaveformDerivative(Buffer.alloc(0), 1), /AUDIO_WAVEFORM_PCM_INVALID/);
  assert.throws(() => buildWaveformDerivative(Buffer.alloc(3), 1), /AUDIO_WAVEFORM_PCM_INVALID/);
  assert.throws(() => buildWaveformDerivative(Buffer.alloc(2), 0), /AUDIO_WAVEFORM_DURATION_INVALID/);
});
