import { conformanceFontManifestHash } from "../../composition-conformance-font-bindings";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../../composition-text-parity-policy";
import { FONT_USAGE_EVIDENCE_POLICY, type FontUsageEvidence } from "../../qa/composition-font-usage-evidence";
import { TEXT_PARITY_REPEATABILITY, type TextParityEvidence } from "../../qa/composition-text-parity-evidence";

export function createFontUsageEvidenceFixture(checkpoints: Array<{frameIndex: number; timeSeconds: number}>) {
  const font = {fontAssetId: "70000000-0000-4000-8000-000000000001", family: "Editorial", mimeType: "font/woff2" as const,
    checksumSha256: "a".repeat(64), fileSizeBytes: 8};
  const expected = {elementId: "native-motion", textSha256: "b".repeat(64)};
  const textParity: TextParityEvidence = {schemaVersion: 1, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
    repeatability: TEXT_PARITY_REPEATABILITY, checkpoints: checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds,
      policy: COMPOSITION_TEXT_PARITY_POLICY.id, status: "CAPTURED", expectedTexts: [expected],
      regions: [{...expected, left: 0, top: 0, width: 100, height: 20}], unavailable: []}))};
  const fontUsage: FontUsageEvidence = {schemaVersion: 1, policy: FONT_USAGE_EVIDENCE_POLICY,
    scope: "DECLARED_CUSTOM_NATIVE_PREVIEW_ONLY", status: "CAPTURED", manifest: [font], manifestSha256: conformanceFontManifestHash([font]),
    bindings: [{elementId: expected.elementId, fontAssetId: font.fontAssetId}], checkpoints: checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds,
      elements: [{elementId: expected.elementId, fontAssetId: font.fontAssetId, platformFamily: "Internal Editorial",
        fonts: [{familyName: "Internal Editorial", postScriptName: "Editorial-Regular", isCustomFont: true, glyphCount: 8}]}]}))};
  return {textParity, fontUsage};
}
