import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CompositionConformanceContract } from "../composition-preview-render-conformance";
import { auditColorChartPng, colorChartAuditPlanSchema, COLOR_CHART_AUDIT_POLICY, hashColorChartAuditPlan,
  type ColorChartAuditPlan } from "./composition-color-chart-audit";

export function validateExportedColorChartPlan(contract: CompositionConformanceContract, input: unknown): ColorChartAuditPlan {
  const plan = colorChartAuditPlanSchema.parse(input);
  if (plan.documentHash !== contract.documentHash
    || !contract.assets.some((asset) => asset.checksum === plan.sourceSvgSha256)
    || contract.canvas.width !== COLOR_CHART_AUDIT_POLICY.width || contract.canvas.height !== COLOR_CHART_AUDIT_POLICY.height) {
    throw new Error("EXPORTED_COLOR_CHART_CONTRACT_MISMATCH");
  }
  return plan;
}

export async function auditExportedColorChartCheckpoints(input: {
  plan: ColorChartAuditPlan;
  frameIndexes: number[];
  previewDirectory: string;
  renderDirectory: string;
}) {
  const checkpoints: Array<{frameIndex: number; preview: Awaited<ReturnType<typeof auditColorChartPng>>;
    render: Awaited<ReturnType<typeof auditColorChartPng>>}> = [];
  for (const frameIndex of input.frameIndexes) {
    const previewPath = join(input.previewDirectory, `frame-${frameIndex}.png`);
    const renderPath = join(input.renderDirectory, `frame-${frameIndex}.png`);
    const [previewFile, renderFile] = await Promise.all([stat(previewPath), stat(renderPath)]);
    if (!previewFile.isFile() || !renderFile.isFile() || previewFile.size <= 0 || renderFile.size <= 0
      || previewFile.size > COLOR_CHART_AUDIT_POLICY.maximumPngBytes
      || renderFile.size > COLOR_CHART_AUDIT_POLICY.maximumPngBytes) throw new Error("EXPORTED_COLOR_CHART_FRAME_SIZE_INVALID");
    const preview = await auditColorChartPng({plan: input.plan, png: await readFile(previewPath), documentHash: input.plan.documentHash});
    const render = await auditColorChartPng({plan: input.plan, png: await readFile(renderPath), documentHash: input.plan.documentHash});
    checkpoints.push({frameIndex, preview, render});
  }
  return {
    planSha256: hashColorChartAuditPlan(input.plan),
    scope: "NEUTRAL_CORPUS_RGB_FROM_BOUND_MP4_NOT_GENERAL_SDR_ATTESTATION" as const,
    status: checkpoints.every((checkpoint) => checkpoint.preview.status === "PASS" && checkpoint.render.status === "PASS")
      ? "PASS" as const : "FAIL" as const,
    checkpoints,
  };
}

export type ExportedColorChartReport = Awaited<ReturnType<typeof auditExportedColorChartCheckpoints>>;
