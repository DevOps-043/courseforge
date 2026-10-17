import assert from "node:assert/strict";
import test from "node:test";
import {validateSdrEncodedOutput} from "../qa/composition-sdr-output-profile";
const expected = {width: 1920, height: 1080, fps: 25, frameCount: 200, sizeBytes: 100};
const fixture = () => ({streams: [{codec_type: "video", codec_name: "h264", width: 1920, height: 1080,
  pix_fmt: "yuv420p", avg_frame_rate: "25/1", nb_read_frames: "200", color_space: "bt709", color_transfer: "bt709",
  color_primaries: "bt709", color_range: "tv", chroma_location: "left", start_time: "0"}],
  format: {duration: "8", size: "100", format_name: "mov,mp4", start_time: "0"}});
test("counted profile match remains metadata only", () => {
  assert.equal(validateSdrEncodedOutput(JSON.stringify(fixture()), expected).scope, "PROBED_METADATA_NOT_SDR_PIXEL_CONVERSION_ATTESTATION");
});
test("wrong or missing stream fields, frame count, fps, color and extra streams fail closed", () => {
  for (const [key, value] of Object.entries({codec_name: "hevc", width: 1918, height: 1078, pix_fmt: "yuv444p",
    avg_frame_rate: "25/0", nb_read_frames: "199", color_transfer: "unknown", color_range: "pc", chroma_location: "center", start_time: "0.04"})) {
    const probe = fixture(); Object.assign(probe.streams[0]!, {[key]: value});
    assert.throws(() => validateSdrEncodedOutput(JSON.stringify(probe), expected), /PROFILE_INVALID/);
  }
  const extra = fixture(); extra.streams.push({...extra.streams[0]!});
  assert.throws(() => validateSdrEncodedOutput(JSON.stringify(extra), expected));
});
test("truncated duration, altered size/container/start and malformed or oversized JSON are rejected", () => {
  for (const patch of [{duration: "7"}, {duration: "0"}, {size: "101"}, {format_name: "matroska"}, {start_time: "1"}]) {
    const probe = fixture(); Object.assign(probe.format, patch);
    assert.throws(() => validateSdrEncodedOutput(JSON.stringify(probe), expected));
  }
  for (const encoded of ["invalid", " ".repeat(65537), undefined, "{}"])
    assert.throws(() => validateSdrEncodedOutput(encoded, expected), /^Error: SDR_FRAME_OUTPUT_PROFILE_INVALID$/);
});
