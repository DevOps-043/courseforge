import { createHash } from "node:crypto";
import { z } from "zod";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";
import type { CompositionConformanceContract } from "../composition-preview-render-conformance";
import { textExpectationSchema, NATIVE_TEXT_GEOMETRY_POLICY, NATIVE_TEXT_PAINT_MASK_POLICY } from "../composition-text-parity-contract";
import { textParityRegionsSchema } from "./composition-text-region-comparison";
import { TEXT_PAINT_REGION_EXPANSION_POLICY, textPaintSourceRegionsSchema } from "./composition-text-paint-region-expansion";
import { validateOffcanvasTextPaintSeed } from "./composition-text-paint-seed";

export const TEXT_PARITY_REPEATABILITY = "EXACT_TEXT_GEOMETRY_FORWARD_REVERSE_V1" as const;
export const textCheckpointEvidenceSchema = z.object({
  frameIndex: z.number().int().nonnegative(), timeSeconds: z.number().finite().nonnegative(),
  policy: z.literal(policy.id), status: z.enum(["CAPTURED", "INCOMPLETE"]),
  expectedTexts: z.array(textExpectationSchema).max(policy.maximumRegions),
  regions: textParityRegionsSchema,
  paintMaskCapture: z.object({policy: z.literal(NATIVE_TEXT_PAINT_MASK_POLICY),
    scope: z.literal("ALL_NATIVE_TEXT_SUPPRESSED_NOT_PER_GLYPH_CAUSALITY"),
    regionExpansionPolicy: z.literal(TEXT_PAINT_REGION_EXPANSION_POLICY).optional(),
    sourceRegions: textPaintSourceRegionsSchema.optional(),
    paintedPngSha256: z.string().regex(/^[a-f0-9]{64}$/), suppressedPngSha256: z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional(),
  unavailable: z.array(z.object({elementId: z.string().min(1).max(280), reason: z.enum([
    "ELEMENT_MISSING", "ELEMENT_NOT_VISIBLE", "TEXT_SIZE_INVALID", "GEOMETRY_INVALID", "TEXT_OUTSIDE_CANVAS",
  ])}).strict()).max(policy.maximumRegions),
}).strict().superRefine((checkpoint, context) => {
  if (checkpoint.expectedTexts.reduce((count, expected) => count + (expected.presentation?.opaqueOverlayIds.length ?? 0), 0)
    > policy.maximumOverlayReferencesPerCheckpoint) context.addIssue({code: "custom", message: "CONFORMANCE_TEXT_PRESENTATION_LIMIT"});
  const expected = new Map(checkpoint.expectedTexts.map((text) => [text.elementId, text.textSha256]));
  const visibility = new Map(checkpoint.expectedTexts.map((text) => [text.elementId, text.visibility]));
  const presentation = new Map(checkpoint.expectedTexts.map((text) => [text.elementId, text.presentation]));
  const observed = [...checkpoint.regions.map((region) => region.elementId), ...checkpoint.unavailable.map((row) => row.elementId)];
  const capture = checkpoint.paintMaskCapture;
  if (Boolean(capture?.regionExpansionPolicy) !== Boolean(capture?.sourceRegions)
    || capture?.sourceRegions && JSON.stringify(capture.sourceRegions.map((region) => region.elementId))
      !== JSON.stringify(checkpoint.regions.filter((region) => !region.regionKind).map((region) => region.elementId)))
    context.addIssue({code: "custom", message: "CONFORMANCE_TEXT_PAINT_SOURCE_REGIONS_INVALID"});
  if (checkpoint.paintMaskCapture && checkpoint.regions.some((region) => !region.regionKind && !region.paintMask)
    || checkpoint.regions.some((region) => region.paintMask) && !checkpoint.paintMaskCapture)
    context.addIssue({code: "custom", message: "CONFORMANCE_TEXT_PAINT_CAPTURE_EVIDENCE_MISSING"});
  if (expected.size !== checkpoint.expectedTexts.length || new Set(observed).size !== observed.length
    || observed.length !== expected.size || observed.some((id) => !expected.has(id))
    || checkpoint.regions.some((region) => expected.get(region.elementId) !== region.textSha256)
    || checkpoint.regions.some((region) => visibility.get(region.elementId) !== region.visibility)
    || checkpoint.regions.some((region) => JSON.stringify(presentation.get(region.elementId)) !== JSON.stringify(region.presentation))
    || (checkpoint.status === "CAPTURED") !== (checkpoint.unavailable.length === 0)) {
    context.addIssue({code: "custom", message: "CONFORMANCE_TEXT_EVIDENCE_COVERAGE_INVALID"});
  }
});
export const textParityEvidenceSchema = z.object({schemaVersion: z.literal(1), policy: z.literal(policy.id),
  repeatability: z.literal(TEXT_PARITY_REPEATABILITY), checkpoints: z.array(textCheckpointEvidenceSchema).min(1).max(48),
}).strict().superRefine((evidence, context) => {
  if (new Set(evidence.checkpoints.map((checkpoint) => checkpoint.frameIndex)).size !== evidence.checkpoints.length
    || evidence.checkpoints.reduce((count, checkpoint) => count + checkpoint.expectedTexts.length, 0) > policy.maximumRegionsPerCapture
    || evidence.checkpoints.reduce((count, checkpoint) => count + checkpoint.expectedTexts.reduce((references, expected) =>
      references + (expected.presentation?.opaqueOverlayIds.length ?? 0), 0), 0) > policy.maximumOverlayReferencesPerCapture) {
    context.addIssue({code: "custom", message: "CONFORMANCE_TEXT_EVIDENCE_LIMIT"});
  }
});
export type TextParityEvidence = z.infer<typeof textParityEvidenceSchema>;

/** A missing pair of witness declarations cannot erase a frozen obligation. */
export function assertRequiredTextPaintMaskEvidence(evidence: TextParityEvidence | undefined, contract: CompositionConformanceContract) {
  if (contract.schemaVersion === 4 && contract.textParity.paintMaskPolicy) {
    if (!evidence) throw new Error("CONFORMANCE_TEXT_PAINT_MASK_REQUIRED");
    validateTextParityEvidence(evidence, contract);
  }
}

/** Zod reconstructs named fields; hashing is independent of JSON object key ordering. Array order is semantic. */
export function textParityEvidenceHash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(textParityEvidenceSchema.parse(input))).digest("hex");
}

export function validateTextParityEvidence(input: unknown, contract: CompositionConformanceContract,
  role: "PREVIEW_PAINT" | "RENDERER_GEOMETRY" = "PREVIEW_PAINT") {
  if (role !== "PREVIEW_PAINT" && role !== "RENDERER_GEOMETRY")
    throw new Error("CONFORMANCE_TEXT_EVIDENCE_ROLE_INVALID");
  const evidence = textParityEvidenceSchema.parse(input);
  // Renderer geometry is not a suppression/paint witness. Preview obligations remain unchanged.
  if (role === "RENDERER_GEOMETRY" && evidence.checkpoints.some(point => point.paintMaskCapture
    || point.regions.some(region => region.paintMask || region.paintSeed)))
    throw new Error("CONFORMANCE_RENDERER_GEOMETRY_PAINT_WITNESS_UNAUTHORIZED");
  for (const checkpoint of evidence.checkpoints) for (const region of checkpoint.regions) if (region.paintSeed) {
    const seed = validateOffcanvasTextPaintSeed(region.paintSeed, contract.canvas.width, contract.canvas.height);
    const original = checkpoint.paintMaskCapture?.sourceRegions?.find((source) => source.elementId === region.elementId);
    if (contract.schemaVersion !== 4 || contract.textParity.visibilityPolicy !== NATIVE_TEXT_GEOMETRY_POLICY
      || !contract.textParity.paintMaskPolicy || !contract.textParity.paintRegionExpansionPolicy
      || contract.textParity.paintOffcanvasSeedPolicy !== region.paintSeed.policy
      || !checkpoint.paintMaskCapture?.regionExpansionPolicy || !region.paintMask)
      throw new Error("CONFORMANCE_TEXT_PAINT_SEED_CONTRACT_INVALID");
    if (!original || original.left !== seed.left || original.top !== seed.top || original.width !== seed.width || original.height !== seed.height)
      throw new Error("CONFORMANCE_TEXT_PAINT_SEED_INVALID");
  }
  if (evidence.checkpoints.some((checkpoint) => checkpoint.regions.some((region) => region.regionKind))
    && (contract.schemaVersion !== 4 || contract.textParity.visibilityPolicy !== NATIVE_TEXT_GEOMETRY_POLICY)) {
    throw new Error("CONFORMANCE_TEXT_ABSENCE_PROBE_CONTRACT_INVALID");
  }
  const checkpoints = new Map(evidence.checkpoints.map((checkpoint) => [checkpoint.frameIndex, checkpoint]));
  if (checkpoints.size !== contract.checkpoints.length || contract.checkpoints.some((checkpoint) => {
    const witness = checkpoints.get(checkpoint.frameIndex);
    return !witness || witness.timeSeconds !== checkpoint.timeSeconds || witness.regions.some((region) =>
      region.left + region.width > contract.canvas.width || region.top + region.height > contract.canvas.height
      || (region.regionKind && (region.left !== 0 || region.top !== 0 || region.width !== contract.canvas.width || region.height !== contract.canvas.height)));
  })) throw new Error("CONFORMANCE_TEXT_EVIDENCE_CHECKPOINT_MISMATCH");
  if (contract.schemaVersion === 4) {
    for (const expected of contract.textParity.checkpoints) {
      const actual = checkpoints.get(expected.frameIndex);
      if (!actual || actual.timeSeconds !== expected.timeSeconds || JSON.stringify(actual.expectedTexts) !== JSON.stringify(expected.expectedTexts)) {
        throw new Error("CONFORMANCE_TEXT_EVIDENCE_EXPECTATION_MISMATCH");
      }
      if (role === "PREVIEW_PAINT" && contract.textParity.paintMaskPolicy && actual.status === "CAPTURED"
        && actual.regions.some((region) => !region.regionKind)
        && (!actual.paintMaskCapture || actual.paintMaskCapture.policy !== contract.textParity.paintMaskPolicy
          || actual.regions.some((region) => !region.regionKind && !region.paintMask))) {
        throw new Error("CONFORMANCE_TEXT_PAINT_MASK_REQUIRED");
      }
      if (role === "PREVIEW_PAINT" && contract.textParity.paintRegionExpansionPolicy && actual.status === "CAPTURED"
        && actual.regions.some((region) => !region.regionKind)
        && actual.paintMaskCapture?.regionExpansionPolicy !== contract.textParity.paintRegionExpansionPolicy)
        throw new Error("CONFORMANCE_TEXT_PAINT_EXPANSION_REQUIRED");
    }
  }
  return evidence;
}
