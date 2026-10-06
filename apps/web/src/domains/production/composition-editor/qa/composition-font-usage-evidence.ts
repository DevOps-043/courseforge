import { createHash } from "node:crypto";
import { z } from "zod";
import { conformanceFontManifestHash, conformanceFontManifestSchema } from "../composition-conformance-font-bindings";
import type { TextParityEvidence } from "./composition-text-parity-evidence";
import type { CompositionConformanceContract } from "../composition-preview-render-conformance";

export const FONT_USAGE_EVIDENCE_POLICY = "CUSTOM_NATIVE_PREVIEW_FONT_USAGE_V1";
export const platformFontUsageSchema = z.array(z.object({familyName: z.string().min(1).max(256),
  postScriptName: z.string().max(256), isCustomFont: z.boolean(),
  glyphCount: z.number().int().nonnegative().max(1_000_000)}).strict()).max(32);
const elementSchema = z.object({elementId: z.string().min(1).max(280), fontAssetId: z.string().uuid(),
  platformFamily: z.string().min(1).max(256), fonts: platformFontUsageSchema}).strict();
export const fontUsageEvidenceSchema = z.object({schemaVersion: z.literal(1), policy: z.literal(FONT_USAGE_EVIDENCE_POLICY),
  scope: z.literal("DECLARED_CUSTOM_NATIVE_PREVIEW_ONLY"), status: z.literal("CAPTURED"),
  manifest: conformanceFontManifestSchema, manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  bindings: z.array(z.object({elementId: z.string().min(1).max(280), fontAssetId: z.string().uuid()}).strict()).max(2048),
  checkpoints: z.array(z.object({frameIndex: z.number().int().nonnegative(), timeSeconds: z.number().finite().nonnegative(),
    elements: z.array(elementSchema).max(256)}).strict()).min(1).max(48),
}).strict().superRefine((evidence, context) => {
  const fontIds = new Set(evidence.manifest.map((font) => font.fontAssetId));
  if (!conformanceFontManifestSchema.safeParse(evidence.manifest).success
    || conformanceFontManifestHash(evidence.manifest) !== evidence.manifestSha256
    || new Set(evidence.bindings.map((binding) => binding.elementId)).size !== evidence.bindings.length
    || evidence.bindings.some((binding) => !fontIds.has(binding.fontAssetId))
    || new Set(evidence.checkpoints.map((checkpoint) => checkpoint.frameIndex)).size !== evidence.checkpoints.length
    || evidence.checkpoints.reduce((total, checkpoint) => total + checkpoint.elements.length, 0) > 2048) {
    context.addIssue({code: "custom", message: "CONFORMANCE_FONT_USAGE_IDENTITY_INVALID"});
  }
});
export type FontUsageEvidence = z.infer<typeof fontUsageEvidenceSchema>;
export const fontUsageEvidenceHash = (input: unknown) => createHash("sha256").update(JSON.stringify(fontUsageEvidenceSchema.parse(input))).digest("hex");

/** This is scoped preview evidence, not a render/font-system or full parity PASS. */
export function validateFontUsageEvidence(input: unknown, textEvidence: TextParityEvidence) {
  const evidence = fontUsageEvidenceSchema.parse(input);
  validateFontUsageCheckpointCoverage(evidence, textEvidence);
  return evidence;
}

/** Shared glyph/coverage rules; callers retain distinct preview and controlled-session evidence schemas. */
export function validateFontUsageCheckpointCoverage(evidence: Pick<FontUsageEvidence, "bindings" | "checkpoints">,
  textEvidence: TextParityEvidence) {
  const bindings = new Map(evidence.bindings.map((binding) => [binding.elementId, binding.fontAssetId]));
  const checkpoints = new Map(evidence.checkpoints.map((checkpoint) => [checkpoint.frameIndex, checkpoint]));
  if (checkpoints.size !== textEvidence.checkpoints.length) throw new Error("CONFORMANCE_FONT_USAGE_CHECKPOINT_MISMATCH");
  for (const textCheckpoint of textEvidence.checkpoints) {
    const checkpoint = checkpoints.get(textCheckpoint.frameIndex);
    const expected = textCheckpoint.expectedTexts.filter((text) => bindings.has(text.elementId));
    if (!checkpoint || checkpoint.timeSeconds !== textCheckpoint.timeSeconds
      || new Set(checkpoint.elements.map((element) => element.elementId)).size !== checkpoint.elements.length
      || checkpoint.elements.length !== expected.length) throw new Error("CONFORMANCE_FONT_USAGE_COVERAGE_INVALID");
    for (const element of checkpoint.elements) {
      const text = expected.find((candidate) => candidate.elementId === element.elementId);
      const region = textCheckpoint.regions.find((candidate) => candidate.elementId === element.elementId);
      if (!text || element.fontAssetId !== bindings.get(element.elementId)) throw new Error("CONFORMANCE_FONT_USAGE_BINDING_INVALID");
      if (element.fonts.some((font) => font.glyphCount <= 0 || !font.isCustomFont || font.familyName !== element.platformFamily)) {
        throw new Error("CONFORMANCE_FONT_USAGE_FALLBACK");
      }
      if (!element.fonts.length && (!region || !(text.visibility === "HIDDEN"
        || (text.presentation?.paintPose?.support.empty && text.presentation.paintPose.filter === "blur(0px)")))) {
        throw new Error("CONFORMANCE_FONT_USAGE_ABSENCE_UNPROVEN");
      }
    }
  }
}

/** The authorized frozen contract is independent of both copies of capture metadata. */
export function assertRequiredFontUsageEvidence(evidence: FontUsageEvidence | undefined, contract: CompositionConformanceContract) {
  const obligation = contract.schemaVersion === 4 ? contract.fontUsageContract : undefined;
  if (!obligation) return;
  if (!evidence) throw new Error("CONFORMANCE_FONT_USAGE_REQUIRED_EVIDENCE_MISSING");
  if (evidence.manifestSha256 !== obligation.manifestSha256
    || JSON.stringify(evidence.bindings) !== JSON.stringify(obligation.bindings)) {
    throw new Error("CONFORMANCE_FONT_USAGE_FROZEN_BINDING_MISMATCH");
  }
}
