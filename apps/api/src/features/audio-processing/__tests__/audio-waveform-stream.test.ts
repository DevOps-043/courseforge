import assert from "node:assert/strict";
import test from "node:test";
import { createWaveformAccumulator } from "../audio-waveform-stream";
import { buildNativeWaveformDecodeArgs } from "../audio-waveform-worker";

test("retains 1 kHz peaks and opposite-phase channels across unaligned stream chunks", () => {
  const pcm = Buffer.alloc(48000 * 2 * 4);
  for (let frame = 0; frame < 48000; frame += 1) {
    const amplitude = Math.sin(2 * Math.PI * 1000 * frame / 48000);
    pcm.writeFloatLE(amplitude, frame * 8); pcm.writeFloatLE(-amplitude, frame * 8 + 4);
  }
  const accumulator = createWaveformAccumulator(48000, 2, 1);
  for (let offset = 0; offset < pcm.length; offset += 997) accumulator.push(pcm.subarray(offset, offset + 997));
  const derivative = accumulator.finish();
  assert.equal(derivative.duration_seconds, 1);
  assert.equal(derivative.channels.length, 2);
  for (const channel of derivative.channels) {
    assert.equal(Math.max(...channel.levels[0].max), 1);
    assert.equal(Math.min(...channel.levels[0].min), -1);
  }
  assert.equal(derivative.channels[0].levels[0].max[12], -derivative.channels[1].levels[0].min[12]);
});

test("rejects unsupported/unbounded formats, nonfinite samples and incomplete frames", () => {
  assert.throws(() => createWaveformAccumulator(48000, 9, 1));
  assert.throws(() => createWaveformAccumulator(48000, 2, 1801));
  const incomplete = createWaveformAccumulator(48000, 2, 1); incomplete.push(Buffer.alloc(9));
  assert.throws(() => incomplete.finish(), /INCOMPLETE/);
  const poisoned = Buffer.alloc(4); poisoned.writeFloatLE(NaN);
  assert.throws(() => createWaveformAccumulator(48000, 1, 1).push(poisoned), /PCM_INVALID/);
});

test("decoder preserves source rate/channels and excludes network and playlist demuxers", () => {
  const args = buildNativeWaveformDecodeArgs("C:/worker/source.input");
  assert.ok(!args.includes("-ar")); assert.ok(!args.includes("-ac"));
  assert.ok(args.includes("file,pipe")); assert.ok(!args.join(" ").includes("hls"));
  assert.throws(() => buildNativeWaveformDecodeArgs("https://example.org/audio.mp3"));
});
