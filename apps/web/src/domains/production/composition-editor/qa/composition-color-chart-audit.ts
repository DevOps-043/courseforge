import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";

export const COLOR_CHART_AUDIT_POLICY = Object.freeze({id: "authored-neutral-chart-rgb-v1", width: 1920, height: 1080,
  patchSide: 32, maximumPngBytes: 8 * 1024 * 1024, maximumChannelDelta: 8});
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const patches = [
  {id: "gray", x: 500, y: 950, rgb: [128, 128, 128]},
  {id: "red", x: 300, y: 300, rgb: [255, 0, 0]},
  {id: "green", x: 900, y: 300, rgb: [0, 255, 0]},
  {id: "blue", x: 1500, y: 300, rgb: [0, 0, 255]},
  {id: "black", x: 500, y: 750, rgb: [0, 0, 0]},
  {id: "white", x: 1400, y: 750, rgb: [255, 255, 255]},
] as const;
const patchSchema = z.object({id: z.enum(["gray", "red", "green", "blue", "black", "white"]),
  x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
  rgb: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)])}).strict();
export const colorChartAuditPlanSchema = z.object({policy: z.literal(COLOR_CHART_AUDIT_POLICY.id),
  scope: z.literal("NEUTRAL_CORPUS_CHART_NOT_GENERAL_SDR_CONVERSION_ATTESTATION"),
  documentHash: hashSchema, sourceSvgSha256: hashSchema,
  patches: z.array(patchSchema).length(patches.length),
}).strict().refine((plan) => JSON.stringify(plan.patches) === JSON.stringify(patches), "CONFORMANCE_COLOR_CHART_PLAN_INVALID");
export type ColorChartAuditPlan = z.infer<typeof colorChartAuditPlanSchema>;
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** Authored colors are independent literals, not learned from preview or decoded render. */
export function buildColorChartAuditPlan(documentHash: string, sourceSvgSha256: string): ColorChartAuditPlan {
  return colorChartAuditPlanSchema.parse({policy: COLOR_CHART_AUDIT_POLICY.id,
    scope: "NEUTRAL_CORPUS_CHART_NOT_GENERAL_SDR_CONVERSION_ATTESTATION", documentHash, sourceSvgSha256,
    patches: patches.map((patch) => ({...patch, rgb: [...patch.rgb]}))});
}

export function hashColorChartAuditPlan(plan: unknown) {
  return digest(JSON.stringify(colorChartAuditPlanSchema.parse(plan)));
}

/** Measures decoded PNG pixels only; caller must independently bind the frame to the audited case and MP4. */
export async function auditColorChartPng(input: {plan: unknown; png: Uint8Array; documentHash: string}) {
  const plan = colorChartAuditPlanSchema.parse(input.plan);
  if (input.documentHash !== plan.documentHash || !input.png.length || input.png.length > COLOR_CHART_AUDIT_POLICY.maximumPngBytes)
    throw new Error("CONFORMANCE_COLOR_CHART_INPUT_INVALID");
  const image = sharp(input.png, {limitInputPixels: COLOR_CHART_AUDIT_POLICY.width * COLOR_CHART_AUDIT_POLICY.height});
  const metadata = await image.metadata();
  if (metadata.format !== "png" || metadata.width !== COLOR_CHART_AUDIT_POLICY.width
    || metadata.height !== COLOR_CHART_AUDIT_POLICY.height) throw new Error("CONFORMANCE_COLOR_CHART_FRAME_INVALID");
  const {data, info} = await image.ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const half = COLOR_CHART_AUDIT_POLICY.patchSide / 2;
  const measured = plan.patches.map((patch) => {
    let maximumChannelDelta = 0;
    for (let y = patch.y - half; y < patch.y + half; y++) for (let x = patch.x - half; x < patch.x + half; x++) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset + 3] !== 255) throw new Error("CONFORMANCE_COLOR_CHART_ALPHA_INVALID");
      for (let channel = 0; channel < 3; channel++)
        maximumChannelDelta = Math.max(maximumChannelDelta, Math.abs(data[offset + channel]! - patch.rgb[channel]!));
    }
    return {id: patch.id, maximumChannelDelta};
  });
  return {policy: COLOR_CHART_AUDIT_POLICY.id, scope: plan.scope, documentHash: plan.documentHash,
    sourceSvgSha256: plan.sourceSvgSha256, pngSha256: digest(input.png),
    status: measured.every((patch) => patch.maximumChannelDelta <= COLOR_CHART_AUDIT_POLICY.maximumChannelDelta) ? "PASS" as const : "FAIL" as const,
    patches: measured};
}
