import assert from "node:assert/strict";
import test from "node:test";
import {hashSdrPacketTiming} from "../qa/composition-sdr-packet-timing";

const profile = {fps: 25, frameCount: 3};
function packets(scale = 512) {
  return {streams: [{codec_type: "video", time_base: `1/${scale * 25}`}],
    packets: [0, 2, 1].map((frame, index) => ({pts: frame * scale, dts: (index - 2) * scale, duration: scale}))};
}
test("packet timing preserves B-frame ordering and canonicalizes equivalent integer timescales", () => {
  const baseline = hashSdrPacketTiming(JSON.stringify(packets()), profile);
  assert.equal(hashSdrPacketTiming(JSON.stringify(packets(1024)), profile), baseline);
  const strings = packets();
  const encoded = JSON.stringify(strings, (_key, value) => typeof value === "number" ? String(value) : value);
  assert.equal(hashSdrPacketTiming(encoded, profile), baseline);
  const shiftedDecode = packets();
  for (const packet of shiftedDecode.packets) packet.dts -= 512;
  assert.notEqual(hashSdrPacketTiming(JSON.stringify(shiftedDecode), profile), baseline);
});
test("missing, duplicate, off-grid, shifted and invalid decode timestamps fail closed", () => {
  for (const kind of ["duplicate", "gap", "offset", "fraction", "duration", "decode", "missing", "unsafe", "zeroBase"] as const) {
    const changed = packets();
    if (kind === "duplicate") changed.packets[2]!.pts = 0;
    if (kind === "gap") changed.packets[2]!.pts = 1536;
    if (kind === "offset") changed.packets[0]!.pts = -512;
    if (kind === "fraction") changed.packets[0]!.pts = 1;
    if (kind === "duration") changed.packets[0]!.duration = 0;
    if (kind === "decode") changed.packets[1]!.dts = changed.packets[0]!.dts;
    if (kind === "missing") delete (changed.packets[0] as Partial<typeof changed.packets[0]>).pts;
    if (kind === "unsafe") changed.packets[0]!.pts = Number.MAX_SAFE_INTEGER + 1;
    if (kind === "zeroBase") changed.streams[0]!.time_base = "1/0";
    assert.throws(() => hashSdrPacketTiming(JSON.stringify(changed), profile), /TIMING_INVALID/, kind);
  }
});
test("parser rejects unbounded or malformed timing and incompatible profiles", () => {
  for (const encoded of [undefined, "{}", "not JSON", " ".repeat(16 * 1024 * 1024 + 1)])
    assert.throws(() => hashSdrPacketTiming(encoded, profile), /TIMING_INVALID/);
  for (const changed of [{fps: 0, frameCount: 3}, {fps: 25, frameCount: 2}, {fps: 25, frameCount: 36001}])
    assert.throws(() => hashSdrPacketTiming(JSON.stringify(packets()), changed), /TIMING_INVALID/);
});
