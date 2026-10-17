import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureFrameSsim } from "../qa/composition-frame-ssim";
import { COMPOSITION_SSIM_POLICY as policy } from "../composition-visual-metrics-policy";
import { buildCompositionConformanceContract, evaluateCompositionConformance, resolveSnapshotConformanceContractVersion } from "../composition-preview-render-conformance";
import { compareCompositionConformanceDirectories } from "../qa/composition-conformance-files";
import { createTransitionDocument } from "./composition-transition-test-fixtures";

const rgb = (width: number, height: number, value: number) => Buffer.alloc(width * height * 3, value);
function contract(version: 2 | 3 = 3) {
  const document = createTransitionDocument(); document.canvas.width = 32; document.canvas.height = 24;
  return buildCompositionConformanceContract({document, contractVersion: version, assets: [], documentHash: "a".repeat(64),
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
}

test("identical black/white/gradient images and narrow edge windows score one", () => {
  for (const [width, height] of [[1, 1], [2, 19], [32, 24]]) {
    for (const value of [0, 255]) assert.ok(Math.abs(measureFrameSsim(rgb(width!, height!, value), rgb(width!, height!, value), width!, height!, 3) - 1) < 1e-12);
    const gradient = rgb(width!, height!, 0); gradient.forEach((_, index) => {gradient[index] = index % 256;});
    assert.ok(Math.abs(measureFrameSsim(gradient, gradient, width!, height!, 3) - 1) < 1e-12);
  }
});

test("constant fields agree with closed-form SSIM and symmetry", () => {
  const left = rgb(15, 23, 64), right = rgb(15, 23, 80);
  const c1 = (policy.k1 * policy.dynamicRange) ** 2;
  const expected = (2 * 64 * 80 + c1) / (64 ** 2 + 80 ** 2 + c1);
  const actual = measureFrameSsim(left, right, 15, 23, 3);
  assert.ok(Math.abs(actual - expected) < 1e-12);
  assert.equal(actual, measureFrameSsim(right, left, 15, 23, 3));
});

test("separable ring buffer matches independent direct 2D Gaussian oracle across evictions", () => {
  const width = 7, height = 19, left = rgb(width, height, 0), right = rgb(width, height, 0);
  for (let index = 0; index < left.length; index++) {left[index] = (index * 31) % 256; right[index] = (index * 29) % 256;}
  const weights = Array.from({length: 11}, (_, index) => Math.exp(-((index - 5) ** 2) / (2 * 1.5 ** 2)));
  const sum = weights.reduce((total, value) => total + value, 0); let totalScore = 0;
  const luma = (image: Buffer, x: number, y: number) => {
    const offset = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 3;
    return image[offset]! * 0.2126 + image[offset + 1]! * 0.7152 + image[offset + 2]! * 0.0722;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let meanLeft = 0, meanRight = 0, squareLeft = 0, squareRight = 0, product = 0;
    for (let dy = 0; dy < 11; dy++) for (let dx = 0; dx < 11; dx++) {
      const weight = weights[dy]! * weights[dx]! / (sum ** 2);
      const a = luma(left, x + dx - 5, y + dy - 5), b = luma(right, x + dx - 5, y + dy - 5);
      meanLeft += weight * a; meanRight += weight * b; squareLeft += weight * a * a;
      squareRight += weight * b * b; product += weight * a * b;
    }
    totalScore += ((2 * meanLeft * meanRight + 6.5025) * (2 * (product - meanLeft * meanRight) + 58.5225))
      / ((meanLeft ** 2 + meanRight ** 2 + 6.5025) * (squareLeft - meanLeft ** 2 + squareRight - meanRight ** 2 + 58.5225));
  }
  assert.ok(Math.abs(measureFrameSsim(left, right, width, height, 3) - totalScore / (width * height)) < 1e-12);
});

test("local structural distortion fails threshold without alignment or gain correction", () => {
  const left = rgb(32, 24, 120), right = Buffer.from(left);
  for (let y = 8; y < 16; y++) for (let x = 12; x < 20; x++) right.fill(240, (y * 32 + x) * 3, (y * 32 + x + 1) * 3);
  assert.ok(measureFrameSsim(left, right, 32, 24, 3) < policy.minimum);
});

test("frame quota, shape and channel mismatches fail explicitly", () => {
  for (const [width, height, channels] of [[0, 1, 3], [1, 1, 2], [3841, 2160, 3], [NaN, 1, 3], [1.5, 1, 3]]) {
    assert.throws(() => measureFrameSsim(Buffer.alloc(3), Buffer.alloc(3), width!, height!, channels!), /FRAME_INVALID/);
  }
  assert.throws(() => measureFrameSsim(Buffer.alloc(3), Buffer.alloc(6), 1, 1, 3), /FRAME_INVALID/);
});

test("opaque RGBA is equivalent to RGB, transparency is not silently ignored", () => {
  const rgba = Buffer.from([64, 64, 64, 255]);
  assert.equal(measureFrameSsim(rgba, rgba, 1, 1, 4), measureFrameSsim(rgb(1, 1, 64), rgb(1, 1, 64), 1, 1, 3));
  const transparent = Buffer.from(rgba); transparent[3] = 0;
  assert.throws(() => measureFrameSsim(rgba, transparent, 1, 1, 4), /NON_OPAQUE_FRAME/);
});

test("v3 freezes SSIM, preserves v1/v2 rules and requires metric plus real resolution", () => {
  const frozen = contract(); const samples = frozen.checkpoints.map(({frameIndex}) => ({frameIndex, meanAbsoluteError: 0,
    mismatchedPixelRatio: 0, psnrDb: 99, temporalDriftMs: 0, width: 32, height: 24, ssim: 1}));
  const evaluate = (input: typeof samples) => evaluateCompositionConformance({contract: frozen,
    previewDocumentHash: frozen.documentHash, renderDocumentHash: frozen.documentHash, samples: input});
  assert.equal(evaluate(samples).status, "PASS"); assert.equal(evaluate(samples).ssim?.minimumObserved, 1);
  assert.equal(evaluate(samples.map((sample) => ({...sample, ssim: 0.994}))).status, "FAIL");
  assert.equal(evaluate([{...samples[0]!, ssim: 0.994}]).status, "FAIL");
  assert.equal(evaluate(samples.map((sample) => ({...sample, width: 33}))).status, "FAIL");
  const missing = samples.map(({ssim: _ssim, ...sample}) => sample);
  assert.equal(evaluateCompositionConformance({contract: frozen, previewDocumentHash: frozen.documentHash,
    renderDocumentHash: frozen.documentHash, samples: missing}).status, "INCOMPLETE");
  assert.equal(evaluateCompositionConformance({contract: contract(2), previewDocumentHash: frozen.documentHash,
    renderDocumentHash: frozen.documentHash, samples: missing}).status, "PASS");
  assert.equal(resolveSnapshotConformanceContractVersion(undefined, "true"), 3);
  assert.equal(resolveSnapshotConformanceContractVersion("true", "TRUE"), 2);
});

test("PNG directory comparator measures SSIM through the production path and keeps observed minima", async () => {
  const root = await mkdtemp(join(tmpdir(), "composition-ssim-"));
  try {
    const frozen = contract(); const previewDirectory = join(root, "preview"), renderDirectory = join(root, "render");
    await Promise.all([mkdir(previewDirectory), mkdir(renderDirectory)]);
    const image = await sharp(rgb(32, 24, 100), {raw: {width: 32, height: 24, channels: 3}}).png().toBuffer();
    const metadata = {documentHash: frozen.documentHash, frames: frozen.checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds}))};
    const contractPath = join(root, "contract.json"), metadataPath = join(root, "metadata.json");
    await writeFile(contractPath, JSON.stringify(frozen)); await writeFile(metadataPath, JSON.stringify(metadata));
    for (const checkpoint of frozen.checkpoints) {
      await writeFile(join(previewDirectory, `frame-${checkpoint.frameIndex}.png`), image);
      await writeFile(join(renderDirectory, `frame-${checkpoint.frameIndex}.png`), image);
    }
    const result = await compareCompositionConformanceDirectories({contractPath, previewDirectory, renderDirectory,
      previewMetadataPath: metadataPath, renderMetadataPath: metadataPath});
    assert.equal(result.status, "PASS"); assert.equal(result.ssim?.checkedCheckpointCount, frozen.checkpoints.length);
    assert.ok(result.ssim!.minimumObserved! >= policy.minimum);
  } finally {await rm(root, {recursive: true, force: true});}
});
