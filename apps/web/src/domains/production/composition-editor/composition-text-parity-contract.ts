import { z } from "zod";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "./composition-text-parity-policy";
import { nativeTextPaintPoseSchema } from "./composition-text-paint-pose";
import { TEXT_PAINT_REGION_EXPANSION_POLICY, OFFCANVAS_TEXT_PAINT_SEED_POLICY } from "./composition-text-parity-policy";
export const NATIVE_MOTION_VISIBILITY_POLICY = "NATIVE_MOTION_OPACITY_GSAP_V1" as const;
export const NATIVE_TRANSITION_VISIBILITY_POLICY = "NATIVE_MOTION_TRANSITION_OPACITY_GSAP_V2" as const;
export const NATIVE_TEXT_APPEARANCE_POLICY = "NATIVE_TRANSITION_APPEARANCE_GSAP_V3" as const;
export const NATIVE_TEXT_GEOMETRY_POLICY = "NATIVE_TRANSFORM_CLIP_GEOMETRY_GSAP_V4" as const;
export const NATIVE_TEXT_PAINT_MASK_POLICY = "NATIVE_TEXT_PAINT_SUPPRESSION_RESTORED_V1" as const;
export type NativeTextVisibilityPolicy = typeof NATIVE_MOTION_VISIBILITY_POLICY | typeof NATIVE_TRANSITION_VISIBILITY_POLICY | typeof NATIVE_TEXT_APPEARANCE_POLICY | typeof NATIVE_TEXT_GEOMETRY_POLICY;
export const textPresentationSchema = z.object({effectiveOpacity: z.number().finite().min(0).max(1),
  opaqueOverlayIds: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,135}$/i)).max(499)
    .refine((ids) => new Set(ids).size === ids.length),
  paintPose: nativeTextPaintPoseSchema.optional(),
}).strict();
export type TextPresentation = z.infer<typeof textPresentationSchema>;

export const textExpectationSchema = z.object({elementId: z.string().min(1).max(280), textSha256: z.string().regex(/^[a-f0-9]{64}$/),
  visibility: z.enum(["VISIBLE", "HIDDEN"]).optional(), presentation: textPresentationSchema.optional()}).strict()
  .refine((text) => !text.presentation || (text.visibility !== undefined
    && (text.visibility === "HIDDEN") === (text.presentation.effectiveOpacity === 0)), "CONFORMANCE_TEXT_OPACITY_VISIBILITY_MISMATCH");
export const textCheckpointPlanSchema = z.object({frameIndex: z.number().int().nonnegative(), timeSeconds: z.number().finite().nonnegative(),
  expectedTexts: z.array(textExpectationSchema).max(policy.maximumRegions)
    .refine((texts) => new Set(texts.map((text) => text.elementId)).size === texts.length),
}).strict();
export const textParityContractSchema = z.object({policy: z.literal(policy.id), scope: z.literal("NATIVE_TEXT_AND_CAPTIONS"),
  paintMaskPolicy: z.literal(NATIVE_TEXT_PAINT_MASK_POLICY).optional(),
  paintRegionExpansionPolicy: z.literal(TEXT_PAINT_REGION_EXPANSION_POLICY).optional(),
  paintOffcanvasSeedPolicy: z.literal(OFFCANVAS_TEXT_PAINT_SEED_POLICY).optional(),
  visibilityPolicy: z.enum([NATIVE_MOTION_VISIBILITY_POLICY, NATIVE_TRANSITION_VISIBILITY_POLICY, NATIVE_TEXT_APPEARANCE_POLICY, NATIVE_TEXT_GEOMETRY_POLICY]).optional(),
  checkpoints: z.array(textCheckpointPlanSchema).min(1).max(48),
}).strict().refine((text) => !text.paintRegionExpansionPolicy || Boolean(text.paintMaskPolicy), "CONFORMANCE_TEXT_PAINT_EXPANSION_POLICY_INVALID")
  .refine((text) => !text.paintOffcanvasSeedPolicy || Boolean(text.paintRegionExpansionPolicy
    && text.visibilityPolicy === NATIVE_TEXT_GEOMETRY_POLICY), "CONFORMANCE_TEXT_PAINT_SEED_POLICY_INVALID")
  .refine((text) => new Set(text.checkpoints.map((checkpoint) => checkpoint.frameIndex)).size === text.checkpoints.length
  && text.checkpoints.reduce((count, checkpoint) => count + checkpoint.expectedTexts.length, 0) <= policy.maximumRegionsPerCapture
  && text.checkpoints.reduce((count, checkpoint) => count + checkpoint.expectedTexts.reduce((references, expected) =>
    references + (expected.presentation?.opaqueOverlayIds.length ?? 0), 0), 0) <= policy.maximumOverlayReferencesPerCapture)
  .refine((text) => text.checkpoints.every((checkpoint) => checkpoint.expectedTexts.every((expected) =>
    Boolean(text.visibilityPolicy) === (expected.visibility !== undefined)
      && ([NATIVE_TEXT_APPEARANCE_POLICY, NATIVE_TEXT_GEOMETRY_POLICY] as Array<NativeTextVisibilityPolicy | undefined>).includes(text.visibilityPolicy) === (expected.presentation !== undefined)
      && (text.visibilityPolicy === NATIVE_TEXT_GEOMETRY_POLICY) === (expected.presentation?.paintPose !== undefined))), "CONFORMANCE_TEXT_VISIBILITY_POLICY_MISMATCH");

export const textRegionReportSchema = z.object({policy: z.literal(policy.id), status: z.enum(["PASS", "FAIL", "INCOMPLETE"]),
  checkedRegionCount: z.number().int().nonnegative().max(policy.maximumRegions), expectedRegionCount: z.number().int().nonnegative().max(policy.maximumRegions),
  maximumAcceptedDisplacementPixels: z.number().int().min(0).max(1).nullable(),
  regions: z.array(z.object({elementId: z.string().min(1).max(280), status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), reason: z.string().nullable(),
    displacementX: z.number().int().min(-1).max(1).nullable(), displacementY: z.number().int().min(-1).max(1).nullable(),
    meanAbsoluteError: z.number().finite().nonnegative().nullable(), mismatchedPixelRatio: z.number().finite().min(0).max(1).nullable(),
  }).strict()).max(policy.maximumRegions),
}).strict().superRefine((report, context) => {
  const checked = report.regions.filter((region) => region.status !== "INCOMPLETE").length;
  const failed = report.regions.some((region) => region.status === "FAIL");
  const incomplete = report.regions.some((region) => region.status === "INCOMPLETE");
  const derivedStatus = failed ? "FAIL" : incomplete ? "INCOMPLETE" : "PASS";
  if (report.expectedRegionCount !== report.regions.length || report.checkedRegionCount !== checked || report.status !== derivedStatus
    || new Set(report.regions.map((region) => region.elementId)).size !== report.regions.length
    || report.regions.some((region) => region.status === "PASS" && (region.meanAbsoluteError === null
      || region.meanAbsoluteError > policy.maximumMeanAbsoluteError || region.mismatchedPixelRatio === null
      || region.mismatchedPixelRatio > policy.maximumMismatchedPixelRatio || region.displacementX === null || region.displacementY === null))) {
    context.addIssue({code: "custom", message: "CONFORMANCE_TEXT_METRICS_INVALID"});
  }
});
