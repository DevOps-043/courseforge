import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {COMPOSITION_CONFORMANCE_THRESHOLDS} from "../composition-preview-render-conformance";
import {CONTROLLED_SEEK_LIMITS, measureControlledSeekRepeatability} from "../qa/composition-controlled-seek-repeatability";

function contract() {return {schemaVersion: 1, documentHash: "a".repeat(64), assets: [],
  compilerContract: "courseforge-composition-preview-compiler-v1", canvas: {width: 2, height: 2, fps: 25, durationSeconds: 1},
  renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}, thresholds: COMPOSITION_CONFORMANCE_THRESHOLDS,
  checkpoints: [25, 0, 24].map(frameIndex => ({frameIndex, timeSeconds: frameIndex / 25, reasons: ["test"]}))};}
const image = (red = 40, compressionLevel = 6, width = 2) => sharp({create: {width, height: 2, channels: 4,
  background: {r: red, g: 20, b: 10, alpha: 1}}}).png({compressionLevel}).toBuffer();

test("seek measurement orders both sweeps, includes terminal checkpoint and compares pixels rather than PNG encoding", async () => {
  const calls: number[] = [];
  const result = await measureControlledSeekRepeatability({contract: contract(), capture: async (frame, time) => {
    assert.equal(time, frame / 25); calls.push(frame); return image(40, calls.length > 3 ? 0 : 9);
  }});
  assert.deepEqual(calls, [0, 24, 25, 25, 24, 0]);
  assert.equal(result.status, "PASS"); assert.equal(result.checkpointCount, 3);
  assert.equal(result.scope, "SDK_SESSION_CHECKPOINTS_NOT_PREVIEW_PARITY_OR_JOB_ATTESTATION");
  assert.ok(result.samples.every(sample => /^[a-f0-9]{64}$/.test(sample.rgbaSha256)));
  assert.deepEqual(result.samples.map(sample => sample.frameIndex), [0, 24, 25]);
});

test("reverse pixel mismatch rejects the run even when other checkpoints match", async () => {
  let count = 0;
  await assert.rejects(measureControlledSeekRepeatability({contract: contract(), capture: async () => image(++count === 5 ? 41 : 40)}),
    /SEEK_REVERSE_MISMATCH/);
});

test("duplicate, non-frame and out-of-duration plans fail before capture", async () => {
  for (const kind of ["duplicate", "grid", "duration", "pixels"] as const) {
    const invalid = contract();
    if (kind === "duplicate") invalid.checkpoints.push(invalid.checkpoints[0]);
    if (kind === "grid") invalid.checkpoints[0].timeSeconds = 0.99;
    if (kind === "duration") invalid.canvas.durationSeconds = 0.5;
    if (kind === "pixels") invalid.canvas.width = CONTROLLED_SEEK_LIMITS.pixels;
    let calls = 0;
    await assert.rejects(measureControlledSeekRepeatability({contract: invalid, capture: async () => {calls++; return image();}}),
      /SEEK_PLAN_INVALID/);
    assert.equal(calls, 0);
  }
});

test("invalid buffers, wrong dimensions and oversize captures cannot emit PASS", async () => {
  for (const png of [Buffer.alloc(0), Buffer.from("not an image"), await image(40, 6, 3),
    Buffer.alloc(CONTROLLED_SEEK_LIMITS.pngBytes + 1)])
    await assert.rejects(measureControlledSeekRepeatability({contract: contract(), capture: async () => png}),
      /SEEK_BYTES_INVALID|SEEK_IMAGE_INVALID/);
});

test("cancellation and adapter failures stop without disclosing caller errors", async () => {
  const before = new AbortController(); before.abort("private caller reason");
  let calls = 0;
  await assert.rejects(measureControlledSeekRepeatability({contract: contract(), signal: before.signal,
    capture: async () => {calls++; return image();}}), /SEEK_CANCELLED/);
  assert.equal(calls, 0);
  const during = new AbortController();
  await assert.rejects(measureControlledSeekRepeatability({contract: contract(), signal: during.signal,
    capture: async () => {during.abort(); return image();}}), /SEEK_CANCELLED/);
  await assert.rejects(measureControlledSeekRepeatability({contract: contract(), capture: async () => {
    throw new Error("secret/path/token");
  }}), error => error instanceof Error && error.message === "CONTROLLED_RENDER_SEEK_CAPTURE_FAILED");
});
