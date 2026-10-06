import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNativeConformanceCorpusCase } from "../qa/composition-native-conformance-corpus";
import { createCorpusColorChart } from "../qa/composition-conformance-corpus-assets";
import { auditColorChartPng, buildColorChartAuditPlan, hashColorChartAuditPlan } from "../qa/composition-color-chart-audit";
import { parseColorChartAuditArgs } from "../qa/run-composition-color-chart-audit";

test("neutral corpus freezes an authored chart ledger independent of captured RGB", async () => {
  const sample = buildNativeConformanceCorpusCase("color-neutral", 25);
  assert.ok(sample.colorAuditPlan);
  assert.equal(sample.colorAuditPlanSha256, hashColorChartAuditPlan(sample.colorAuditPlan));
  assert.equal(sample.colorAuditPlan.sourceSvgSha256, sample.assets[0]!.checksum);
  const png = await sharp(createCorpusColorChart().bytes).png().toBuffer();
  const report = await auditColorChartPng({plan: sample.colorAuditPlan, png, documentHash: sample.documentHash});
  assert.equal(report.status, "PASS");
  assert.deepEqual(report.patches.map((patch) => patch.id), ["gray", "red", "green", "blue", "black", "white"]);
  assert.ok(report.patches.every((patch) => patch.maximumChannelDelta === 0));
});

test("altered pixels fail while forged expectations, foreign documents and invalid frames are rejected", async () => {
  const sample = buildNativeConformanceCorpusCase("color-neutral", 25), plan = sample.colorAuditPlan!;
  const original = await sharp(createCorpusColorChart().bytes).ensureAlpha().raw().toBuffer();
  const changed = Buffer.from(original);
  changed.fill(0, (300 * 1920 + 300) * 4, (300 * 1920 + 300) * 4 + 3);
  const png = await sharp(changed, {raw: {width: 1920, height: 1080, channels: 4}}).png().toBuffer();
  const report = await auditColorChartPng({plan, png, documentHash: sample.documentHash});
  assert.equal(report.status, "FAIL");
  assert.ok(report.patches.find((patch) => patch.id === "red")!.maximumChannelDelta > 8);
  const forged = structuredClone(plan); forged.patches[1]!.rgb = [0, 0, 0];
  await assert.rejects(auditColorChartPng({plan: forged, png, documentHash: sample.documentHash}), /CONFORMANCE_COLOR_CHART_PLAN_INVALID/);
  await assert.rejects(auditColorChartPng({plan, png, documentHash: "f".repeat(64)}), /INPUT_INVALID/);
  await assert.rejects(auditColorChartPng({plan, png: await sharp({create: {width: 16, height: 16, channels: 3,
    background: "#ff0000"}}).png().toBuffer(), documentHash: sample.documentHash}), /FRAME_INVALID/);
  assert.equal(hashColorChartAuditPlan(buildColorChartAuditPlan(sample.documentHash, plan.sourceSvgSha256)), sample.colorAuditPlanSha256);
});

test("operator audit arguments require one frozen case and two distinct absolute frames", () => {
  const sample = buildNativeConformanceCorpusCase("color-neutral", 25);
  const preview = join(tmpdir(), "preview.png"), render = join(tmpdir(), "render.png");
  const args = ["--fps", "25", "--case-sha256", sample.caseSha256, "--preview-png", preview, "--render-png", render];
  assert.equal(parseColorChartAuditArgs(args).caseSha256, sample.caseSha256);
  assert.throws(() => parseColorChartAuditArgs([...args, "--fps", "25"]), /ARGUMENTS_INVALID/);
  assert.throws(() => parseColorChartAuditArgs(args.map((value) => value === render ? preview : value)), /ARGUMENTS_INVALID/);
  assert.throws(() => parseColorChartAuditArgs(args.map((value) => value === preview ? "relative.png" : value)), /ARGUMENTS_INVALID/);
  assert.throws(() => parseColorChartAuditArgs(args.map((value) => value === "25" ? "29" : value)), /ARGUMENTS_INVALID/);
});
