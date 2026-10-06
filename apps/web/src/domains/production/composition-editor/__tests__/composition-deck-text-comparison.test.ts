import assert from "node:assert/strict";
import test from "node:test";
import { buildDeckConformanceCorpusCase } from "../qa/composition-deck-conformance-corpus";
import { buildDeckTextPlan } from "../composition-deck-text-plan";
import { hashCompositionDocument } from "../composition-document.service";
import { compareDeckTextRegions } from "../qa/composition-deck-text-comparison";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { evaluateCompositionConformance, compositionConformanceSampleSchema } from "../composition-preview-render-conformance";
import type { deckTextCheckpointEvidenceSchema } from "../qa/composition-deck-text-evidence";
import type { z } from "zod";
import { mkdtemp, mkdir, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { measureCompositionConformanceDirectories } from "../qa/composition-conformance-files";
import { hashDeckTextPlan } from "../composition-deck-text-plan";
import { attachDeckTextPaintMasks, suppressedDeckTextFrameName } from "../qa/composition-deck-text-paint-derivation";

const width = 48, height = 24, channels = 3;
function frame(shift = 0, missing = false) {
  const pixels = Buffer.alloc(width * height * channels);
  if (!missing) for (let y = 6; y < 14; y++) for (let x = 10; x < 24; x++) {
    if (x === 10 || x === 16 || y === 6 || y === 10) pixels.fill(240, (y * width + x + shift) * channels, (y * width + x + shift) * channels + 3);
  }
  return pixels;
}
function fixture() {
  const document = buildDeckConformanceCorpusCase("deck-basic", 25).document;
  document.canvas.width = width; document.canvas.height = height;
  const plan = buildDeckTextPlan(document), clip = plan.clips[0]!, entry = clip.entries[0]!;
  const checkpoint: z.infer<typeof deckTextCheckpointEvidenceSchema> = {frameIndex: 0, timeSeconds: 0,
    status: "CAPTURED", unavailable: [], limitedClipIds: [], regions: [{clipId: clip.clipId, ...entry, left: 8, top: 4, width: 20, height: 12}]};
  const compare = (rendered = frame()) => compareDeckTextRegions({preview: frame(), rendered, width, height, channels, plan, checkpoint});
  return {document, plan, checkpoint, compare};
}

test("deck ROI preserves strict one-pixel displacement budget and rejects removed paint", () => {
  const {compare} = fixture();
  assert.equal(compare().status, "PASS");
  assert.equal(compare(frame(1)).status, "PASS");
  assert.equal(compare(frame(2)).status, "FAIL");
  assert.equal(compare(frame(0, true)).status, "FAIL");
});

test("unavailable deck nodes produce incomplete regional metrics rather than zero-region PASS", () => {
  const state = fixture();
  state.checkpoint.status = "INCOMPLETE";
  state.checkpoint.regions = [];
  state.checkpoint.unavailable = [{clipId: state.plan.clips[0]!.clipId, nodePath: [1, 0], reason: "NODE_MISSING"}];
  const result = state.compare();
  assert.equal(result.status, "INCOMPLETE"); assert.equal(result.expectedRegionCount, 1); assert.equal(result.checkedRegionCount, 0);
});

test("deck metrics survive sample validation and fail the evaluator even when full-frame metrics pass", () => {
  const state = fixture();
  const contract = buildSnapshotConformanceContract({document: state.document, documentHash: hashCompositionDocument(state.document),
    assets: [], contractVersion: 4, deckText: true, renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  for (const failing of [false, true]) {
    const samples = contract.checkpoints.map(({frameIndex}) => compositionConformanceSampleSchema.parse({frameIndex,
      meanAbsoluteError: 0, mismatchedPixelRatio: 0, psnrDb: 99, temporalDriftMs: 0, ssim: 1, width, height,
      deckText: state.compare(failing ? frame(0, true) : frame()),
      textParity: {policy: contract.textParity.policy, status: "PASS", checkedRegionCount: 0, expectedRegionCount: 0,
        maximumAcceptedDisplacementPixels: null, regions: []}}));
    const report = evaluateCompositionConformance({contract, samples, previewDocumentHash: contract.documentHash, renderDocumentHash: contract.documentHash});
    assert.equal(report.status, failing ? "FAIL" : "INCOMPLETE");
    assert.equal(report.deckText?.status, failing ? "FAIL" : "PASS");
    assert.equal(report.deckText?.checkedCheckpointCount, contract.checkpoints.length);
    assert.equal(report.deckText?.checkedRegionCount, report.deckText?.expectedRegionCount);
    assert.equal(report.failures.some((failure) => failure.metric === "deck_text_parity"), failing);
    assert.ok(report.incompletenessReasons!.includes("DECK_TEXT_EVIDENCE_INCOMPLETE"));
  }
});

test("deck summary distinguishes absent measurements from a measured regional failure", () => {
  const state = fixture();
  const contract = buildSnapshotConformanceContract({document: state.document, documentHash: hashCompositionDocument(state.document),
    assets: [], contractVersion: 4, deckText: true, renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const samples = contract.checkpoints.map(({frameIndex}) => ({frameIndex,
    meanAbsoluteError: 0, mismatchedPixelRatio: 0, psnrDb: 99, temporalDriftMs: 0, ssim: 1, width, height,
    deckText: state.compare(), textParity: {policy: contract.textParity.policy, status: "PASS" as const,
      checkedRegionCount: 0, expectedRegionCount: 0, maximumAcceptedDisplacementPixels: null, regions: []}}));
  delete (samples[0] as Partial<typeof samples[number]>).deckText;
  const report = evaluateCompositionConformance({contract, samples, previewDocumentHash: contract.documentHash, renderDocumentHash: contract.documentHash});
  assert.equal(report.deckText?.status, "INCOMPLETE");
  assert.equal(report.deckText?.checkedCheckpointCount, contract.checkpoints.length - 1);
  assert.equal(report.failures.some((failure) => failure.metric === "deck_text_parity"), false);
  assert.equal(report.status, "INCOMPLETE");
});

test("directory comparator reads private deck geometry and retains its local defect in measurements", async () => {
  const state = fixture();
  const contract = buildSnapshotConformanceContract({document: state.document, documentHash: hashCompositionDocument(state.document),
    assets: [], contractVersion: 4, deckText: true, deckTextPaintMasks: true, renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const parent = await mkdtemp(join(tmpdir(), "deck-roi-")), previewDirectory = join(parent, "preview"), renderDirectory = join(parent, "render");
  const owned: string[] = [];
  await mkdir(previewDirectory); await mkdir(renderDirectory);
  const save = async (path: string, bytes: string | Buffer) => {if (!owned.includes(path)) owned.push(path); await writeFile(path, bytes);};
  try {
    const frames = contract.checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds}));
    const png = await sharp(frame(), {raw: {width, height, channels}}).png().toBuffer();
    const suppressedPng = await sharp(frame(0, true), {raw: {width, height, channels}}).png().toBuffer();
    const masked = await attachDeckTextPaintMasks({checkpoint: state.checkpoint, paintedPng: png, suppressedPng, width, height});
    const deckText = {policy: "DECK_SOURCE_NODE_CAPTURE_V1", scope: "PREVIEW_TEXT_CONTENT_GEOMETRY_NOT_PAINT_OR_RENDER_FONT_EVIDENCE",
      documentHash: contract.documentHash, planSha256: hashDeckTextPlan(state.plan), repeatability: "EXACT_DECK_TEXT_GEOMETRY_FORWARD_REVERSE_V1",
      checkpoints: frames.map((checkpoint) => ({...masked, ...checkpoint}))};
    const textParity = {schemaVersion: 1, policy: contract.textParity.policy, repeatability: "EXACT_TEXT_GEOMETRY_FORWARD_REVERSE_V1",
      checkpoints: contract.textParity.checkpoints.map((checkpoint) => ({...checkpoint, policy: contract.textParity.policy,
        status: "CAPTURED", regions: [], unavailable: []}))};
    const input = {contractPath: join(parent, "contract.json"), previewDirectory, renderDirectory,
      previewMetadataPath: join(parent, "preview.json"), renderMetadataPath: join(parent, "render.json")};
    await save(input.contractPath, JSON.stringify(contract));
    await save(input.previewMetadataPath, JSON.stringify({documentHash: contract.documentHash, frames, deckText, textParity}));
    await save(input.renderMetadataPath, JSON.stringify({documentHash: contract.documentHash, frames}));
    for (const checkpoint of frames) for (const directory of [previewDirectory, renderDirectory])
      await save(join(directory, `frame-${checkpoint.frameIndex}.png`), png);
    for (const checkpoint of frames) await save(join(previewDirectory, suppressedDeckTextFrameName(checkpoint.frameIndex)), suppressedPng);
    const matching = await measureCompositionConformanceDirectories(input);
    assert.equal(matching.report.status, "INCOMPLETE");
    assert.ok(matching.measurements.samples.every((sample) => sample.deckText?.status === "PASS"));
    const forged = structuredClone(deckText);
    forged.checkpoints[0]!.regions[0]!.paintMask!.runs = []; forged.checkpoints[0]!.regions[0]!.paintMask!.pixelCount = 0;
    await save(input.previewMetadataPath, JSON.stringify({documentHash: contract.documentHash, frames, deckText: forged, textParity}));
    await assert.rejects(measureCompositionConformanceDirectories(input), /RECOMPUTATION_MISMATCH/);
    await save(input.previewMetadataPath, JSON.stringify({documentHash: contract.documentHash, frames, deckText, textParity}));
    await save(join(renderDirectory, `frame-${frames[0]!.frameIndex}.png`), await sharp(frame(0, true), {raw: {width, height, channels}}).png().toBuffer());
    const failed = await measureCompositionConformanceDirectories(input);
    assert.equal(failed.report.status, "FAIL");
    assert.equal(failed.measurements.samples[0]!.deckText!.status, "FAIL");
    assert.ok(failed.report.failures.some((failure) => failure.metric === "deck_text_parity"));
  } finally {
    for (const path of owned) await rm(path, {force: true});
    await rmdir(previewDirectory); await rmdir(renderDirectory); await rmdir(parent);
  }
});
