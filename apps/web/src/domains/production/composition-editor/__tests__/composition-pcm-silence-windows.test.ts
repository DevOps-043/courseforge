import assert from "node:assert/strict";
import test from "node:test";
import {measurePcmSilenceWindows} from "../qa/composition-pcm-silence-windows";

function input(frames = 100, channelCount = 2) {
  return {pcm: Buffer.alloc(frames * channelCount * 4), channelCount, startFrame: 0,
    endFrame: frames, windowFrames: 20, hopFrames: 10};
}
test("silence measurement covers both channels and partial final windows", () => {
  const measured = input(95);
  assert.deepEqual(measurePcmSilenceWindows(measured), {maximumRms: 0, windowCount: 20});
  measured.pcm.writeFloatLE(0.1, ((95 - 1) * 2 + 1) * 4);
  assert.ok(measurePcmSilenceWindows(measured).maximumRms > 0.04);
});
test("short bursts retain local RMS instead of disappearing in the interval average", () => {
  const measured = input(10000);
  measured.pcm.writeFloatLE(0.01, 5000 * 2 * 4);
  const result = measurePcmSilenceWindows(measured);
  assert.ok(result.maximumRms > 0.002);
  assert.ok(Math.sqrt(0.01 ** 2 / measured.endFrame) < 0.001);
});
test("range bounds exclude guard samples while channels remain independent", () => {
  const measured = {...input(), startFrame: 20, endFrame: 80};
  measured.pcm.writeFloatLE(1, 19 * 2 * 4);
  measured.pcm.writeFloatLE(1, 80 * 2 * 4);
  assert.equal(measurePcmSilenceWindows(measured).maximumRms, 0);
  measured.pcm.writeFloatLE(0.2, (30 * 2 + 1) * 4);
  assert.ok(measurePcmSilenceWindows(measured).maximumRms > 0.04);
});
test("invalid ranges, unbounded overlap, malformed buffers and nonfinite samples fail closed", () => {
  for (const patch of [{channelCount: 0}, {channelCount: 9}, {startFrame: -1}, {endFrame: 101},
    {startFrame: 100}, {windowFrames: 0}, {windowFrames: 101}, {hopFrames: 1}, {hopFrames: 21},
    {endFrame: NaN}, {pcm: Buffer.alloc(7)}, {pcm: Buffer.alloc(32 * 1024 * 1024 + 8)}])
    assert.throws(() => measurePcmSilenceWindows({...input(), ...patch}), /ARGUMENT_INVALID/);
  const invalid = input(); invalid.pcm.writeFloatLE(Infinity, 0);
  assert.throws(() => measurePcmSilenceWindows(invalid), /SAMPLE_INVALID/);
});
