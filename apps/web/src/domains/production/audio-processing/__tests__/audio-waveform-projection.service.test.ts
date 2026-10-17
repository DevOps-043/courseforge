import assert from "node:assert/strict";
import test from "node:test";
import { buildAudioWaveformPath } from "../audio-waveform-projection.service";

const waveform = {
  bucketSizeSamples: 1,
  durationSeconds: 4,
  max: [0.1, 0.2, 1, 0.4],
  min: [-0.1, -0.2, -1, -0.4],
  sampleRateHz: 1,
};

test("trimmed waveform projects the correct source interval and preserves peak extrema", () => {
  const path = buildAudioWaveformPath({
    clipDurationSeconds: 2,
    sourceOffsetSeconds: 1,
    viewportWidthPixels: 2,
    waveform,
  });
  assert.equal(path, "M0.5 40.0V60.0M1.5 0.0V100.0");
});

test("zoomed out waveform keeps a short peak visible within one column", () => {
  const path = buildAudioWaveformPath({
    clipDurationSeconds: 4,
    sourceOffsetSeconds: 0,
    viewportWidthPixels: 1,
    waveform,
  });
  assert.equal(path, "M0.5 0.0V100.0");
});

test("invalid or out-of-range intervals produce no path", () => {
  assert.equal(buildAudioWaveformPath({ clipDurationSeconds: 1, sourceOffsetSeconds: 4, viewportWidthPixels: 100, waveform }), "");
  assert.equal(buildAudioWaveformPath({ clipDurationSeconds: 1, sourceOffsetSeconds: -1, viewportWidthPixels: 100, waveform }), "");
});

test("an audio tail beyond measured source duration stays visually empty", () => {
  const path = buildAudioWaveformPath({
    clipDurationSeconds: 4,
    sourceOffsetSeconds: 2,
    viewportWidthPixels: 4,
    waveform,
  });
  assert.equal(path, "M0.5 0.0V100.0M1.5 30.0V70.0");
});
