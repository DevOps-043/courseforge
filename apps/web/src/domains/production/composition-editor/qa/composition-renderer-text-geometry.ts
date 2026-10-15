import {COMPOSITION_TEXT_PARITY_POLICY as policy} from "../composition-text-parity-policy";
import {textRegionReportSchema} from "../composition-text-parity-contract";
import {textCheckpointEvidenceSchema} from "./composition-text-parity-evidence";
import type {TextRegionParityReport} from "./composition-text-region-comparison";

/** Intersects pixel parity with independently observed bounds; cannot turn pixel failure into PASS. */
export function applyRendererTextGeometry(input: {pixels: TextRegionParityReport; preview: unknown; rendered?: unknown}) {
  const report = textRegionReportSchema.parse(input.pixels);
  const preview = textCheckpointEvidenceSchema.parse(input.preview);
  const rendered = input.rendered === undefined ? undefined : textCheckpointEvidenceSchema.parse(input.rendered);
  if (rendered && (rendered.frameIndex !== preview.frameIndex || rendered.timeSeconds !== preview.timeSeconds
    || JSON.stringify(rendered.expectedTexts) !== JSON.stringify(preview.expectedTexts)))
    throw new Error("CONFORMANCE_RENDERER_GEOMETRY_CHECKPOINT_MISMATCH");
  if (report.expectedRegionCount !== preview.expectedTexts.length
    || report.regions.some(region => !preview.expectedTexts.some(expected => expected.elementId === region.elementId)))
    throw new Error("CONFORMANCE_RENDERER_GEOMETRY_PIXEL_COVERAGE_INVALID");
  const observed = new Map(rendered?.regions.map(region => [region.elementId, region]));
  const original = new Map(preview.regions.map(region => [region.elementId, region]));
  let acceptedGeometryDisplacement = 0;
  const regions = report.regions.map(region => {
    const first = original.get(region.elementId), second = observed.get(region.elementId);
    const bounds = first?.observedBounds, renderedBounds = second?.observedBounds;
    let reason: string | undefined;
    let status: "FAIL" | "INCOMPLETE" = "FAIL";
    if (!rendered || !first || !second || !bounds || !renderedBounds) {
      reason = "RENDERER_TEXT_GEOMETRY_MISSING"; status = "INCOMPLETE";
    } else if (first.regionKind !== second.regionKind) reason = "RENDERER_TEXT_GEOMETRY_ABSENCE_MISMATCH";
    else if (first.paintSeed || second.paintSeed) {
      reason = "RENDERER_TEXT_GEOMETRY_OFFCANVAS_UNVERIFIED"; status = "INCOMPLETE";
    } else if (Math.max(Math.abs(bounds.left - renderedBounds.left), Math.abs(bounds.top - renderedBounds.top),
      Math.abs(bounds.right - renderedBounds.right), Math.abs(bounds.bottom - renderedBounds.bottom)) > policy.maximumDisplacementPixels)
      reason = "RENDERER_TEXT_GEOMETRY_OUTSIDE_TOLERANCE";
    if (!reason && region.status === "PASS" && bounds && renderedBounds)
      acceptedGeometryDisplacement = Math.max(acceptedGeometryDisplacement,
        Math.abs(bounds.left - renderedBounds.left), Math.abs(bounds.top - renderedBounds.top),
        Math.abs(bounds.right - renderedBounds.right), Math.abs(bounds.bottom - renderedBounds.bottom));
    if (!reason || region.status === "FAIL" || region.status === "INCOMPLETE" && status === "INCOMPLETE") return region;
    return {...region, status, reason, displacementX: null, displacementY: null};
  });
  return textRegionReportSchema.parse({...report, regions,
    status: regions.some(region => region.status === "FAIL") ? "FAIL"
      : regions.some(region => region.status === "INCOMPLETE") ? "INCOMPLETE" : "PASS",
    checkedRegionCount: regions.filter(region => region.status !== "INCOMPLETE").length,
    maximumAcceptedDisplacementPixels: regions.some(region => region.status === "PASS")
      ? Math.max(report.maximumAcceptedDisplacementPixels ?? 0, Math.ceil(acceptedGeometryDisplacement)) : null});
}
