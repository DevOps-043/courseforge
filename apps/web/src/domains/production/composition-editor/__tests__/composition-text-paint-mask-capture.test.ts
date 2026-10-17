import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { captureNativeTextSuppressedFrame, captureTextPaintMasks } from "../qa/composition-text-paint-mask-capture";
import { textCheckpointEvidenceSchema } from "../qa/composition-text-parity-evidence";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import type { CompositionQaCdpClient } from "../qa/composition-qa-browser";
import { verifyTextPaintMaskPair } from "../qa/composition-text-paint-mask-derivation";
import { deriveTextPaintMasks } from "../qa/composition-text-paint-mask-derivation";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function client(failBegin = false) {
  const calls: string[] = [];
  const cdp = {async send(_method: string, params: {expression?: string}) {
    const restore = params.expression?.includes("removeNativeTextPaintSuppression"); calls.push(restore ? "restore" : "suppress");
    return failBegin && !restore ? {exceptionDetails: {text: "private"}} : {result: {value: true}};
  }} as unknown as CompositionQaCdpClient;
  return {cdp, calls};
}
test("suppression checks exact restoration and records hashes, without persisting transient DOM details", async () => {
  const state = client(), painted = Buffer.from("original controlled bytes"), suppressed = Buffer.from("suppressed controlled bytes");
  let screenshots = 0;
  const result = await captureNativeTextSuppressedFrame(state.cdp, ["text"], painted,
    async () => {state.calls.push("screenshot"); return screenshots++ === 0 ? suppressed : painted;});
  assert.deepEqual(state.calls, ["suppress", "screenshot", "restore", "screenshot"]);
  assert.equal(result.paintedPngSha256, hash(painted)); assert.equal(result.suppressedPngSha256, hash(suppressed));
});
test("failed suppression or screenshot still removes the owned stylesheet and verifies the original frame", async () => {
  for (const failBegin of [true, false]) {
    const state = client(failBegin), painted = Buffer.from("original"); let count = 0;
    await assert.rejects(captureNativeTextSuppressedFrame(state.cdp, ["text"], painted, async () => {
      if (!failBegin && count++ === 0) throw new Error("https://private.example/?token=secret");
      return painted;
    }), /^Error: CONFORMANCE_TEXT_PAINT_SUPPRESSION_FAILED$/);
    assert.deepEqual(state.calls, ["suppress", "restore"]);
  }
});
test("restoration mismatch overrides success and invalid duplicate targets never touch the browser", async () => {
  const state = client();
  await assert.rejects(captureNativeTextSuppressedFrame(state.cdp, ["text"], Buffer.from("original"),
    async () => Buffer.from("not original")), /RESTORE_FAILED/);
  const untouched = client();
  await assert.rejects(captureNativeTextSuppressedFrame(untouched.cdp, ["text", "text"], Buffer.from("original")), /CAPTURE_INVALID/);
  assert.deepEqual(untouched.calls, []);
});
test("controlled PNG pair produces reproducible supplemental masks and rejects missing capture identity", async () => {
  const width = 4, height = 4, raw = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) raw[pixel * 4 + 3] = 255;
  const suppressed = await sharp(raw, {raw: {width, height, channels: 4}}).png().toBuffer();
  raw.fill(240, 20, 23);
  const painted = await sharp(raw, {raw: {width, height, channels: 4}}).png().toBuffer();
  const checkpoint = textCheckpointEvidenceSchema.parse({frameIndex: 0, timeSeconds: 0, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
    status: "CAPTURED", expectedTexts: [{elementId: "text", textSha256: "a".repeat(64)}], unavailable: [],
    regions: [{elementId: "text", textSha256: "a".repeat(64), left: 0, top: 0, width, height}]});
  const capture = async () => {
    let count = 0;
    return captureTextPaintMasks(client().cdp, {checkpoint, paintedPng: painted, width, height},
      async () => count++ === 0 ? suppressed : painted);
  };
  const result = await capture(); assert.deepEqual(await capture(), result);
  await verifyTextPaintMaskPair({checkpoint: result, paintedPng: painted, suppressedPng: suppressed, width, height});
  await assert.rejects(verifyTextPaintMaskPair({checkpoint: result, paintedPng: painted,
    suppressedPng: painted, width, height}), /CAPTURE_FRAME_MISMATCH/);
  const fabricated = structuredClone(result);
  fabricated.regions[0]!.paintMask!.runs = [[6, 1]];
  await assert.rejects(verifyTextPaintMaskPair({checkpoint: fabricated, paintedPng: painted,
    suppressedPng: suppressed, width, height}), /MASK_RECOMPUTATION_MISMATCH/);
  assert.deepEqual(result.regions[0]!.paintMask!.runs, [[5, 1]]);
  assert.equal(result.paintMaskCapture!.paintedPngSha256, hash(painted));
  assert.equal(textCheckpointEvidenceSchema.safeParse({...result, paintMaskCapture: undefined}).success, false);
  assert.equal(textCheckpointEvidenceSchema.safeParse({...result, regions: checkpoint.regions}).success, false);
});

test("paint outside all captured regions rejects cropped blur/shadow evidence rather than certifying a truncated mask", async () => {
  const width = 8, height = 8, raw = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) raw[pixel * 4 + 3] = 255;
  const encode = () => sharp(raw, {raw: {width, height, channels: 4}}).png().toBuffer();
  const suppressed = await encode();
  const checkpoint = textCheckpointEvidenceSchema.parse({frameIndex: 0, timeSeconds: 0, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
    status: "CAPTURED", expectedTexts: [{elementId: "text", textSha256: "a".repeat(64)}], unavailable: [],
    regions: [{elementId: "text", textSha256: "a".repeat(64), left: 2, top: 2, width: 4, height: 4}]});
  raw[(3 * width + 3) * 4] = 240;
  await deriveTextPaintMasks({checkpoint, paintedPng: await encode(), suppressedPng: suppressed, width, height});
  raw[(3 * width + 1) * 4] = COMPOSITION_TEXT_PARITY_POLICY.pixelDifferenceThreshold;
  await deriveTextPaintMasks({checkpoint, paintedPng: await encode(), suppressedPng: suppressed, width, height});
  raw[(3 * width + 1) * 4]++;
  await assert.rejects(deriveTextPaintMasks({checkpoint, paintedPng: await encode(), suppressedPng: suppressed, width, height}),
    /PAINT_OUTSIDE_CAPTURED_REGIONS/);
  const union = textCheckpointEvidenceSchema.parse({...checkpoint,
    expectedTexts: [...checkpoint.expectedTexts, {elementId: "second", textSha256: "b".repeat(64)}],
    regions: [...checkpoint.regions, {elementId: "second", textSha256: "b".repeat(64), left: 0, top: 0, width: 2, height: 8}]});
  assert.equal((await deriveTextPaintMasks({checkpoint: union, paintedPng: await encode(), suppressedPng: suppressed, width, height})).length, 2);
  raw[(3 * width + 1) * 4] = 0;
  raw[3] = 254;
  await assert.rejects(deriveTextPaintMasks({checkpoint, paintedPng: await encode(), suppressedPng: suppressed, width, height}),
    /NON_OPAQUE/);
});

test("producer expands to the observed halo and readback rejects substituted expansion geometry", async () => {
  const width = 8, height = 8, raw = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) raw[pixel * 4 + 3] = 255;
  const encode = () => sharp(raw, {raw: {width, height, channels: 4}}).png().toBuffer();
  const suppressed = await encode(); raw[(1 * width + 1) * 4] = 50;
  const painted = await encode();
  const checkpoint = textCheckpointEvidenceSchema.parse({frameIndex: 0, timeSeconds: 0, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
    status: "CAPTURED", expectedTexts: [{elementId: "text", textSha256: "a".repeat(64)}], unavailable: [],
    regions: [{elementId: "text", textSha256: "a".repeat(64), left: 2, top: 2, width: 4, height: 4}]});
  let screenshots = 0;
  const result = await captureTextPaintMasks(client().cdp, {checkpoint, paintedPng: painted, width, height},
    async () => screenshots++ === 0 ? suppressed : painted);
  assert.deepEqual(result.paintMaskCapture!.sourceRegions, [{elementId: "text", left: 2, top: 2, width: 4, height: 4}]);
  assert.equal(result.regions[0]!.left, 1); assert.equal(result.regions[0]!.width, 5);
  await verifyTextPaintMaskPair({checkpoint: result, paintedPng: painted, suppressedPng: suppressed, width, height});
  const altered = structuredClone(result);
  altered.regions[0]!.width++;
  altered.regions[0]!.paintMask!.width++;
  await assert.rejects(verifyTextPaintMaskPair({checkpoint: altered, paintedPng: painted, suppressedPng: suppressed, width, height}),
    /EXPANSION_RECOMPUTATION_MISMATCH/);
});

test("controlled Gaussian halo is retained outside the unfiltered text rectangle", async () => {
  const width = 16, height = 16, raw = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) raw[pixel * 4 + 3] = 255;
  const suppressed = await sharp(raw, {raw: {width, height, channels: 4}}).png().toBuffer();
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) raw.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 3);
  const painted = await sharp(raw, {raw: {width, height, channels: 4}}).blur(2).png().toBuffer();
  const checkpoint = textCheckpointEvidenceSchema.parse({frameIndex: 0, timeSeconds: 0, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
    status: "CAPTURED", expectedTexts: [{elementId: "text", textSha256: "a".repeat(64)}], unavailable: [],
    regions: [{elementId: "text", textSha256: "a".repeat(64), left: 6, top: 6, width: 4, height: 4}]});
  let screenshots = 0;
  const result = await captureTextPaintMasks(client().cdp, {checkpoint, paintedPng: painted, width, height},
    async () => screenshots++ === 0 ? suppressed : painted);
  assert.ok(result.regions[0]!.left < 6); assert.ok(result.regions[0]!.top < 6);
  assert.ok(result.regions[0]!.width > 4); assert.ok(result.regions[0]!.paintMask!.pixelCount > 16);
  await verifyTextPaintMaskPair({checkpoint: result, paintedPng: painted, suppressedPng: suppressed, width, height});
});
