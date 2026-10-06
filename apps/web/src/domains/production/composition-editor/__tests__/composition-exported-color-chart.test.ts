import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { compositionConformanceContractSchema, COMPOSITION_CONFORMANCE_THRESHOLDS } from "../composition-preview-render-conformance";
import { createCorpusColorChart } from "../qa/composition-conformance-corpus-assets";
import { auditExportedColorChartCheckpoints, validateExportedColorChartPlan } from "../qa/composition-exported-color-chart";
import { buildNativeConformanceCorpusCase } from "../qa/composition-native-conformance-corpus";

test("la carta de color exige documento, asset y dimensiones congelados", () => {
  const sample = buildNativeConformanceCorpusCase("color-neutral", 25);
  const contract = compositionConformanceContractSchema.parse({
    assets: [{id: sample.assets[0]!.id, checksum: sample.assets[0]!.checksum}],
    canvas: {durationSeconds: 8, fps: 25, width: 1920, height: 1080},
    checkpoints: [{frameIndex: 0, timeSeconds: 0, reasons: ["synthetic-test"]}],
    compilerContract: "courseforge-composition-preview-compiler-v1", documentHash: sample.documentHash,
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"},
    schemaVersion: 1, thresholds: COMPOSITION_CONFORMANCE_THRESHOLDS,
  });
  assert.equal(validateExportedColorChartPlan(contract, sample.colorAuditPlan).sourceSvgSha256, sample.assets[0]!.checksum);
  assert.throws(() => validateExportedColorChartPlan({...contract, assets: []}, sample.colorAuditPlan), /CONTRACT_MISMATCH/);
  assert.throws(() => validateExportedColorChartPlan({...contract, documentHash: "f".repeat(64)}, sample.colorAuditPlan), /CONTRACT_MISMATCH/);
  assert.throws(() => validateExportedColorChartPlan({...contract, canvas: {...contract.canvas, width: 1280}}, sample.colorAuditPlan), /CONTRACT_MISMATCH/);
});

test("mide preview y fotograma decodificado; una desviación del render falla", async () => {
  const sample = buildNativeConformanceCorpusCase("color-neutral", 25);
  const root = await mkdtemp(join(tmpdir(), "courseforge-chart-mp4-test-"));
  const previewDirectory = join(root, "preview"), renderDirectory = join(root, "render");
  try {
    await Promise.all([mkdir(previewDirectory), mkdir(renderDirectory)]);
    const png = await sharp(createCorpusColorChart().bytes).png().toBuffer();
    await Promise.all([writeFile(join(previewDirectory, "frame-0.png"), png), writeFile(join(renderDirectory, "frame-0.png"), png)]);
    const input = {plan: sample.colorAuditPlan!, frameIndexes: [0], previewDirectory, renderDirectory};
    const passing = await auditExportedColorChartCheckpoints(input);
    assert.equal(passing.status, "PASS");
    assert.equal(passing.checkpoints[0]!.render.status, "PASS");
    assert.equal(passing.checkpoints[0]!.render.pngSha256, passing.checkpoints[0]!.preview.pngSha256);
    const raw = await sharp(png).ensureAlpha().raw().toBuffer();
    const changed = Buffer.from(raw);
    changed.fill(0, (300 * 1920 + 300) * 4, (300 * 1920 + 300) * 4 + 3);
    await writeFile(join(renderDirectory, "frame-0.png"), await sharp(changed, {raw: {width: 1920, height: 1080, channels: 4}}).png().toBuffer());
    const failing = await auditExportedColorChartCheckpoints(input);
    assert.equal(failing.status, "FAIL");
    assert.equal(failing.checkpoints[0]!.preview.status, "PASS");
    assert.equal(failing.checkpoints[0]!.render.status, "FAIL");
    await assert.rejects(auditExportedColorChartCheckpoints({...input, frameIndexes: [1]}));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
