import { z } from "zod";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";
import { textExpectationSchema, textPresentationSchema, type TextPresentation } from "../composition-text-parity-contract";
import { isPointInConvexPaintPolygon } from "../composition-text-paint-geometry";
import { textPaintMaskSchema, measureTextPaintMask } from "./composition-text-paint-mask";
import { offcanvasTextPaintSeedSchema } from "./composition-text-paint-seed";

const geometryCoordinate = z.number().finite().min(-policy.maximumGeometryCoordinatePixels).max(policy.maximumGeometryCoordinatePixels);
/** Unrounded DOM Range bounds, separate from integer/clipped pixel ROIs. */
export const observedTextBoundsSchema = z.object({left: geometryCoordinate, top: geometryCoordinate,
  right: geometryCoordinate, bottom: geometryCoordinate}).strict().refine(bounds => bounds.right >= bounds.left
    && bounds.bottom >= bounds.top, "CONFORMANCE_TEXT_OBSERVED_BOUNDS_INVALID");
export const textParityRegionSchema = z.object({
  elementId: z.string().min(1).max(280),
  textSha256: z.string().regex(/^[a-f0-9]{64}$/),
  observedBounds: observedTextBoundsSchema.optional(),
  visibility: z.enum(["VISIBLE", "HIDDEN"]).optional(),
  presentation: textPresentationSchema.optional(),
  regionKind: z.literal("CANVAS_ABSENCE_PROBE").optional(),
  paintMask: textPaintMaskSchema.optional(),
  paintSeed: offcanvasTextPaintSeedSchema.optional(),
  left: z.number().int().nonnegative(), top: z.number().int().nonnegative(),
  width: z.number().int().positive(), height: z.number().int().positive(),
}).strict().refine((region) => !region.paintSeed || (!region.regionKind && region.presentation?.paintPose
  && Number(region.presentation.paintPose.filter.slice(5, -3)) > 0), "CONFORMANCE_TEXT_PAINT_SEED_INVALID")
  .refine((region) => !region.regionKind || (region.presentation?.paintPose?.support.empty === true
  && region.presentation.paintPose.filter === "blur(0px)"), "CONFORMANCE_TEXT_ABSENCE_PROBE_INVALID")
  .refine((region) => !region.paintMask || (!region.regionKind && region.paintMask.width === region.width
    && region.paintMask.height === region.height), "CONFORMANCE_TEXT_PAINT_MASK_REGION_INVALID");
export const textParityRegionsSchema = z.array(textParityRegionSchema).max(policy.maximumRegions)
  .refine((regions) => new Set(regions.map((region) => region.elementId)).size === regions.length);
export type TextParityRegion = z.infer<typeof textParityRegionSchema>;

export type TextRegionParityReport = {
  policy: typeof policy.id;
  status: "PASS" | "FAIL" | "INCOMPLETE";
  checkedRegionCount: number;
  expectedRegionCount: number;
  maximumAcceptedDisplacementPixels: number | null;
  regions: Array<{elementId: string; status: "PASS" | "FAIL" | "INCOMPLETE"; reason: string | null;
    displacementX: number | null; displacementY: number | null; meanAbsoluteError: number | null; mismatchedPixelRatio: number | null}>;
};

/**
 * Compare every pixel in a trusted, padded text/caption region (not a guessed glyph silhouette).
 * Only nine translations, each within the one-pixel budget, are considered. This never aligns
 * an entire frame or grants larger movements. Background/shadow differences remain evidence:
 * they may reject a region, but cannot be erased to make it pass.
 */
export function compareTextParityRegions(input: {
  preview: Uint8Array; rendered: Uint8Array; width: number; height: number; channels: number;
  regions: unknown; expectedTexts: Array<{elementId: string; textSha256: string; visibility?: "VISIBLE" | "HIDDEN";
    presentation?: TextPresentation}>;
}): TextRegionParityReport {
  const {preview, rendered, width, height, channels} = input;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0
    || width * height > policy.maximumFramePixels || (channels !== 3 && channels !== 4)
    || preview.length !== width * height * channels || rendered.length !== preview.length) {
    throw new Error("CONFORMANCE_TEXT_FRAME_INVALID");
  }
  const expectedTexts = z.array(textExpectationSchema).max(policy.maximumRegions).parse(input.expectedTexts);
  const expected = expectedTexts.map((text) => text.elementId);
  if (new Set(expected).size !== expected.length) throw new Error("CONFORMANCE_TEXT_EXPECTED_DUPLICATE");
  const report: TextRegionParityReport = {policy: policy.id, status: "PASS", checkedRegionCount: 0,
    expectedRegionCount: expected.length, maximumAcceptedDisplacementPixels: null, regions: []};
  if (input.regions === undefined || input.regions === null) return {...report, status: "INCOMPLETE"};
  const regions = textParityRegionsSchema.parse(input.regions);
  const expectedIds = new Set(expected), actualIds = new Set(regions.map((region) => region.elementId));
  if (regions.some((region) => !expectedIds.has(region.elementId))) throw new Error("CONFORMANCE_TEXT_UNEXPECTED_REGION");
  const expectedHashes = new Map(expectedTexts.map((text) => [text.elementId, text.textSha256]));
  if (regions.some((region) => expectedHashes.get(region.elementId) !== region.textSha256)) throw new Error("CONFORMANCE_TEXT_CONTENT_MISMATCH");
  const expectedVisibility = new Map(expectedTexts.map((text) => [text.elementId, text.visibility]));
  if (regions.some((region) => expectedVisibility.get(region.elementId) !== region.visibility)) throw new Error("CONFORMANCE_TEXT_VISIBILITY_MISMATCH");
  const expectedPresentation = new Map(expectedTexts.map((text) => [text.elementId, text.presentation]));
  if (regions.some((region) => JSON.stringify(expectedPresentation.get(region.elementId)) !== JSON.stringify(region.presentation))) {
    throw new Error("CONFORMANCE_TEXT_PRESENTATION_MISMATCH");
  }
  for (const elementId of expected) {
    if (!actualIds.has(elementId)) report.regions.push({elementId, status: "INCOMPLETE", reason: "TEXT_REGION_MISSING",
      displacementX: null, displacementY: null, meanAbsoluteError: null, mismatchedPixelRatio: null});
  }
  let comparedPixels = 0, paintMaskPixels = 0;
  let canvasProbeResult: TextRegionParityReport["regions"][number] | null = null;
  const windows = regions.map((region) => {
    if (region.left + region.width > width || region.top + region.height > height) throw new Error("CONFORMANCE_TEXT_REGION_OUTSIDE_CANVAS");
    const padding = policy.regionPaddingPixels;
    const left = Math.max(0, region.left - padding), top = Math.max(0, region.top - padding);
    const right = Math.min(width, region.left + region.width + padding), bottom = Math.min(height, region.top + region.height + padding);
    if (region.regionKind && (region.left !== 0 || region.top !== 0 || region.width !== width || region.height !== height)) {
      throw new Error("CONFORMANCE_TEXT_ABSENCE_PROBE_INVALID");
    }
    // One bounded full-frame scan is shared by all explicit absence probes; ordinary ROI quota is unchanged.
    if (!region.regionKind) comparedPixels += (right - left) * (bottom - top);
    paintMaskPixels += region.paintMask?.pixelCount ?? 0;
    if (paintMaskPixels > policy.maximumComparedPixels) throw new Error("CONFORMANCE_TEXT_PAINT_MASK_PIXEL_BUDGET");
    if (comparedPixels > policy.maximumComparedPixels) throw new Error("CONFORMANCE_TEXT_PIXEL_BUDGET");
    return {region, left, top, right, bottom};
  });
  for (const {region, left, top, right, bottom} of windows) {
    if (region.paintSeed && !region.paintMask) {
      report.regions.push({elementId: region.elementId, status: "INCOMPLETE", reason: "TEXT_PAINT_SEED_MASK_MISSING",
        displacementX: null, displacementY: null, meanAbsoluteError: null, mismatchedPixelRatio: null});
      continue;
    }
    if (region.regionKind && canvasProbeResult) {
      report.regions.push({...canvasProbeResult, elementId: region.elementId});
      report.checkedRegionCount++;
      continue;
    }
    const paintPose = region.presentation?.paintPose;
    const unfilteredSupport = paintPose && !paintPose.support.empty && paintPose.filter === "blur(0px)" ? paintPose.support.polygon : undefined;
    let minimumLuminance = 255, maximumLuminance = 0;
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const offset = (y * width + x) * channels;
      if (channels === 4 && (preview[offset + 3] !== 255 || rendered[offset + 3] !== 255)) throw new Error("CONFORMANCE_TEXT_NON_OPAQUE_FRAME");
      // Only the informativeness probe is restricted. Pixel parity below still measures the entire ROI,
      // including background and unexpected paint outside the frozen clip support.
      if (unfilteredSupport && !isPointInConvexPaintPolygon({x: x + 0.5, y: y + 0.5}, unfilteredSupport)) continue;
      const luminance = preview[offset]! * 0.2126 + preview[offset + 1]! * 0.7152 + preview[offset + 2]! * 0.0722;
      minimumLuminance = Math.min(minimumLuminance, luminance); maximumLuminance = Math.max(maximumLuminance, luminance);
    }
    const occluded = (region.presentation?.opaqueOverlayIds.length ?? 0) > 0;
    const geometricallyAbsent = paintPose?.support.empty === true && paintPose.filter === "blur(0px)";
    const lowOpacity = region.presentation !== undefined && region.presentation.effectiveOpacity * 255 <= policy.pixelDifferenceThreshold;
    if (region.paintMask?.pixelCount === 0 && region.visibility !== "HIDDEN" && !occluded && !geometricallyAbsent && !lowOpacity) {
      report.regions.push({elementId: region.elementId, status: "INCOMPLETE", reason: "TEXT_PAINT_MASK_UNINFORMATIVE",
        displacementX: null, displacementY: null, meanAbsoluteError: null, mismatchedPixelRatio: null});
      continue;
    }
    // The audited paint/suppressed delta measures RGB paint directly. Luminance contrast is
    // only the fallback probe when no nonempty mask exists, not a second test of glyph identity.
    const measuredPaint = (region.paintMask?.pixelCount ?? 0) > 0;
    if (!measuredPaint && region.visibility !== "HIDDEN" && !occluded && !geometricallyAbsent && !lowOpacity
      && maximumLuminance - minimumLuminance < policy.minimumLuminanceRange) {
      report.regions.push({elementId: region.elementId, status: "INCOMPLETE", reason: "TEXT_REGION_UNINFORMATIVE",
        displacementX: null, displacementY: null, meanAbsoluteError: null, mismatchedPixelRatio: null});
      continue;
    }
    type Candidate = {x: number; y: number; meanAbsoluteError: number; mismatchedPixelRatio: number; maskPasses: boolean};
    let best: Candidate | null = null;
    const maximumMismatchRatio = region.regionKind ? policy.maximumAbsenceProbeMismatchedPixelRatio : policy.maximumMismatchedPixelRatio;
    // Hidden text has no permissible displacement: measure absence at its actual region.
    const shifts: readonly number[] = region.visibility === "HIDDEN" || occluded || geometricallyAbsent ? [0] : [0, -1, 1];
    for (const shiftY of shifts) for (const shiftX of shifts) {
      if (left + shiftX < 0 || right + shiftX > width || top + shiftY < 0 || bottom + shiftY > height) continue;
      let absoluteError = 0, mismatchedPixels = 0;
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const first = (y * width + x) * channels, second = ((y + shiftY) * width + x + shiftX) * channels;
        if (channels === 4 && rendered[second + 3] !== 255) throw new Error("CONFORMANCE_TEXT_NON_OPAQUE_FRAME");
        let mismatch = false;
        for (let channel = 0; channel < 3; channel++) {
          const difference = Math.abs(preview[first + channel]! - rendered[second + channel]!);
          absoluteError += difference; if (difference > policy.pixelDifferenceThreshold) mismatch = true;
        }
        if (mismatch) mismatchedPixels++;
      }
      const area = (right - left) * (bottom - top);
      const masked = region.paintMask ? measureTextPaintMask({mask: region.paintMask, preview, rendered,
        frameWidth: width, channels, left: region.left, top: region.top, shiftX, shiftY}) : null;
      const maskPasses = !masked || masked.meanAbsoluteError <= policy.maximumMeanAbsoluteError
        && masked.mismatchedPixelRatio <= maximumMismatchRatio;
      const candidate = {x: shiftX, y: shiftY, meanAbsoluteError: absoluteError / (3 * area), mismatchedPixelRatio: mismatchedPixels / area, maskPasses};
      // A lower average must never hide a candidate that violates the pixel gate.
      const passes = (value: Candidate) => value.maskPasses && value.meanAbsoluteError <= policy.maximumMeanAbsoluteError
        && value.mismatchedPixelRatio <= maximumMismatchRatio;
      if (!best || (passes(candidate) && !passes(best)) || (passes(candidate) === passes(best)
        && (candidate.mismatchedPixelRatio < best.mismatchedPixelRatio
          || (candidate.mismatchedPixelRatio === best.mismatchedPixelRatio && candidate.meanAbsoluteError < best.meanAbsoluteError)))) best = candidate;
    }
    if (!best) throw new Error("CONFORMANCE_TEXT_COMPARISON_EMPTY");
    const passed = best.maskPasses && best.meanAbsoluteError <= policy.maximumMeanAbsoluteError && best.mismatchedPixelRatio <= maximumMismatchRatio;
    report.checkedRegionCount++;
    const displacement = Math.max(Math.abs(best.x), Math.abs(best.y));
    if (passed) report.maximumAcceptedDisplacementPixels = Math.max(report.maximumAcceptedDisplacementPixels ?? 0, displacement);
    report.regions.push({elementId: region.elementId, status: passed ? "PASS" : "FAIL", reason: passed ? null
      : !best.maskPasses ? "TEXT_PAINT_MASK_OUTSIDE_TOLERANCE" : "TEXT_REGION_PIXELS_OUTSIDE_TOLERANCE",
      displacementX: passed ? best.x : null, displacementY: passed ? best.y : null,
      meanAbsoluteError: best.meanAbsoluteError, mismatchedPixelRatio: best.mismatchedPixelRatio});
    if (region.regionKind) canvasProbeResult = report.regions[report.regions.length - 1]!;
  }
  report.status = report.regions.some((region) => region.status === "FAIL") ? "FAIL"
    : report.regions.some((region) => region.status === "INCOMPLETE") ? "INCOMPLETE" : "PASS";
  return report;
}
