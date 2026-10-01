import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { hashCompositionDocument } from "../composition-document.service";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { buildConformanceReferenceSource, verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { conformanceFontPath, conformanceFontManifestHash } from "../composition-conformance-font-bindings";
import { assertRequiredFontUsageEvidence } from "../qa/composition-font-usage-evidence";
import { createFontUsageEvidenceFixture } from "./fixtures/composition-font-usage.fixture";
import { evaluateCompositionConformance } from "../composition-preview-render-conformance";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";

function fixture() {
  const {fontUsage} = createFontUsageEvidenceFixture([{frameIndex: 0, timeSeconds: 0}]);
  const font = fontUsage.manifest[0]!;
  const document = createInitialCompositionDocument({animatedDeck: null, assets: [], sourceInsertionMode: "MANUAL",
    plan: {accentColor: "#38BDF8", durationSeconds: 2, title: "Fonts", subtitle: "Frozen obligation"}});
  const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind: "TEXT", playheadSeconds: 0});
  if (clip.source.type !== "NATIVE_TEXT") throw new Error("Expected text");
  clip.source.style.fontAssetId = font.fontAssetId; clip.source.style.fontFamily = font.family;
  if (track) document.tracks.push(track); document.clips.push(clip);
  document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  const input = {document, documentHash: hashCompositionDocument(document), assets: [],
    renderProfile: {format: "mp4" as const, fps: 25 as const, quality: "high" as const, resolution: "1080p" as const}};
  const contract = buildSnapshotConformanceContract({...input, contractVersion: 4, fontUsage: true, fontManifest: [font]});
  const fontAssets = new Map([[font.fontAssetId, {assetId: font.fontAssetId, family: font.family, format: "woff2" as const, sourceUrl: conformanceFontPath(font)}]]);
  return {font, input, contract, fontAssets, fontUsage};
}

test("font obligation is explicit v4 opt-in and freezes manifest identity and document-owned bindings", () => {
  const {input, contract, font} = fixture();
  assert.equal(contract.schemaVersion, 4);
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  assert.equal(contract.fontUsageContract?.manifestSha256, conformanceFontManifestHash([font]));
  assert.deepEqual(contract.fontUsageContract?.bindings, [{elementId: "native-motion", fontAssetId: font.fontAssetId}]);
  for (const version of [1, 2, 3] as const) assert.equal("fontUsageContract" in buildSnapshotConformanceContract({...input, contractVersion: version, fontUsage: true}), false);
  assert.equal("fontUsageContract" in buildSnapshotConformanceContract({...input, contractVersion: 4}), false);
  assert.throws(() => buildSnapshotConformanceContract({...input, contractVersion: 4, fontUsage: true}), /MANIFEST_MISSING/);
});

test("producer and source reader recompute font obligation, even after authorized source hashes are updated", async () => {
  const {input, contract, font, fontAssets} = fixture();
  const source = await buildConformanceReferenceSource({document: input.document, contract, assets: [], fontAssets, fontManifest: [font]});
  assert.doesNotThrow(() => verifyConformanceReferenceSource({...source, fontManifest: [font]}));
  const changed = structuredClone(contract);
  if (changed.schemaVersion !== 4 || !changed.fontUsageContract) throw new Error("Expected font obligation");
  changed.fontUsageContract.bindings = [];
  await assert.rejects(buildConformanceReferenceSource({document: input.document, contract: changed, assets: [], fontAssets, fontManifest: [font]}), /FONT_CONTRACT_MISMATCH/);
  const contractJson = JSON.stringify(changed);
  assert.throws(() => verifyConformanceReferenceSource({...source, contractJson, fontManifest: [font],
    metadata: {...source.metadata, contractSha256: createHash("sha256").update(contractJson).digest("hex")}}), /FONT_CONTRACT_MISMATCH/);
});

test("deleting both witness copies or reducing its bindings cannot satisfy the independent contract", () => {
  const {contract, fontUsage} = fixture();
  assert.doesNotThrow(() => assertRequiredFontUsageEvidence(fontUsage, contract));
  assert.throws(() => assertRequiredFontUsageEvidence(undefined, contract), /REQUIRED_EVIDENCE_MISSING/);
  assert.throws(() => assertRequiredFontUsageEvidence({...fontUsage, bindings: []}, contract), /FROZEN_BINDING_MISMATCH/);
  assert.throws(() => assertRequiredFontUsageEvidence({...fontUsage, manifestSha256: "c".repeat(64)}, contract), /FROZEN_BINDING_MISMATCH/);
});

test("perfect image/text samples cannot grant full PASS while required renderer font evidence is unimplemented", () => {
  const {contract} = fixture();
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const samples = contract.textParity.checkpoints.map((checkpoint) => ({frameIndex: checkpoint.frameIndex,
    meanAbsoluteError: 0, mismatchedPixelRatio: 0, psnrDb: 99, temporalDriftMs: 0, ssim: 1,
    width: contract.canvas.width, height: contract.canvas.height,
    textParity: {policy: COMPOSITION_TEXT_PARITY_POLICY.id, status: "PASS" as const,
      expectedRegionCount: checkpoint.expectedTexts.length, checkedRegionCount: checkpoint.expectedTexts.length,
      maximumAcceptedDisplacementPixels: 0, regions: checkpoint.expectedTexts.map((text) => ({elementId: text.elementId,
        status: "PASS" as const, reason: null, displacementX: 0, displacementY: 0, meanAbsoluteError: 0, mismatchedPixelRatio: 0}))}}));
  const params = {contract, samples, previewDocumentHash: contract.documentHash, renderDocumentHash: contract.documentHash};
  const pending = evaluateCompositionConformance(params);
  assert.equal(pending.status, "INCOMPLETE");
  assert.deepEqual(pending.fontUsage, {policy: contract.fontUsageContract!.policy, scope: "RENDERER_GLYPH_PROVENANCE",
    status: "INCOMPLETE", reason: "RENDERER_FONT_USAGE_EVIDENCE_UNAVAILABLE",
    manifestSha256: contract.fontUsageContract!.manifestSha256, requiredBindingCount: contract.fontUsageContract!.bindings.length});
  const {fontUsageContract: _fontUsageContract, ...legacy} = contract;
  assert.equal(evaluateCompositionConformance({...params, contract: legacy}).status, "PASS");
});
