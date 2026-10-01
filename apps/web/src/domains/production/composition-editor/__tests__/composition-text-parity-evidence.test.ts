import assert from "node:assert/strict";
import test from "node:test";
import { textParityEvidenceHash, textParityEvidenceSchema, validateTextParityEvidence, TEXT_PARITY_REPEATABILITY } from "../qa/composition-text-parity-evidence";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { buildCompositionConformanceContract } from "../composition-preview-render-conformance";
import { createTransitionDocument } from "./composition-transition-test-fixtures";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { NATIVE_TEXT_GEOMETRY_POLICY } from "../composition-text-parity-contract";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";

function fixture() {
  const contract = buildCompositionConformanceContract({assets: [], document: createTransitionDocument(), documentHash: "a".repeat(64),
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  const expected = {elementId: "native-motion", textSha256: "b".repeat(64)};
  const evidence = {schemaVersion: 1 as const, policy: COMPOSITION_TEXT_PARITY_POLICY.id, repeatability: TEXT_PARITY_REPEATABILITY,
    checkpoints: contract.checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
      status: "CAPTURED" as "CAPTURED" | "INCOMPLETE", expectedTexts: [expected],
      regions: [{...expected, left: 10, top: 20, width: 40, height: 30}], unavailable: [] as Array<{elementId: string; reason: "ELEMENT_MISSING"}>}))};
  return {contract, evidence};
}

test("exact checkpoint witness validates and hash ignores JSON object key ordering, not geometry", () => {
  const {contract, evidence} = fixture(); assert.deepEqual(validateTextParityEvidence(evidence, contract), evidence);
  const reversed = Object.fromEntries(Object.entries(evidence).reverse());
  assert.equal(textParityEvidenceHash(reversed), textParityEvidenceHash(evidence));
  const changed = structuredClone(evidence); changed.checkpoints[0]!.regions[0]!.left++;
  assert.notEqual(textParityEvidenceHash(changed), textParityEvidenceHash(evidence));
});

test("appearance overlay references are bounded per checkpoint and across the private witness", () => {
  const {evidence} = fixture(); const first = evidence.checkpoints[0]!;
  const expected = {elementId: "native-motion", textSha256: "b".repeat(64), visibility: "VISIBLE",
    presentation: {effectiveOpacity: 1, opaqueOverlayIds: Array.from({length: 499}, (_, index) => `overlay-${index}`)}};
  const withAppearance = {...first, expectedTexts: [expected], regions: [{...first.regions[0]!, ...expected}]};
  assert.equal(textParityEvidenceSchema.safeParse({...evidence, checkpoints: [withAppearance]}).success, true);
  const crowded = {...withAppearance,
    expectedTexts: Array.from({length: 3}, (_, index) => ({...expected, elementId: `native-${index}`})),
    regions: Array.from({length: 3}, (_, index) => ({...withAppearance.regions[0]!, elementId: `native-${index}`}))};
  assert.equal(textParityEvidenceSchema.safeParse({...evidence, checkpoints: [crowded]}).success, false);
  const checkpoints = Array.from({length: 9}, (_, frameIndex) => ({...withAppearance, frameIndex, timeSeconds: frameIndex / 25}));
  assert.equal(textParityEvidenceSchema.safeParse({...evidence, checkpoints}).success, false);
});

test("missing events remain INCOMPLETE; fabricated coverage/status/hash fails schema", () => {
  const {evidence} = fixture(); const first = evidence.checkpoints[0]!;
  first.status = "INCOMPLETE"; first.regions = []; first.unavailable = [{elementId: "native-motion", reason: "ELEMENT_MISSING"}];
  assert.ok(textParityEvidenceSchema.safeParse(evidence).success);
  first.status = "CAPTURED"; assert.equal(textParityEvidenceSchema.safeParse(evidence).success, false);
  const other = fixture().evidence; other.checkpoints[0]!.regions[0]!.textSha256 = "c".repeat(64);
  assert.equal(textParityEvidenceSchema.safeParse(other).success, false);
});

test("duplicate checkpoints, wrong time, canvas escape and missing checkpoint are rejected", () => {
  for (const mutation of [
    (value: ReturnType<typeof fixture>["evidence"]) => {value.checkpoints.pop();},
    (value: ReturnType<typeof fixture>["evidence"]) => {value.checkpoints[0]!.timeSeconds += 0.01;},
    (value: ReturnType<typeof fixture>["evidence"]) => {value.checkpoints[0]!.regions[0]!.left = 100000;},
    (value: ReturnType<typeof fixture>["evidence"]) => {value.checkpoints.push(value.checkpoints[0]!);},
  ]) {
    const {contract, evidence} = fixture(); mutation(evidence); assert.throws(() => validateTextParityEvidence(evidence, contract));
  }
});

test("aggregate capture quota counts unavailable candidates as well as measured regions", () => {
  const expectedTexts = Array.from({length: 256}, (_, index) => ({elementId: `text-${index}`, textSha256: "b".repeat(64)}));
  const evidence = {schemaVersion: 1, policy: COMPOSITION_TEXT_PARITY_POLICY.id, repeatability: TEXT_PARITY_REPEATABILITY,
    checkpoints: Array.from({length: 9}, (_, frameIndex) => ({frameIndex, timeSeconds: frameIndex / 25,
      policy: COMPOSITION_TEXT_PARITY_POLICY.id, status: "INCOMPLETE", expectedTexts, regions: [],
      unavailable: expectedTexts.map(({elementId}) => ({elementId, reason: "ELEMENT_MISSING"}))}))};
  assert.equal(textParityEvidenceSchema.safeParse(evidence).success, false);
});

test("private absence probes pin their marker and require the entire authorized v4 canvas", () => {
  const document = createTransitionDocument();
  const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind: "TEXT", playheadSeconds: 0});
  if (track) document.tracks.push(track); document.clips.push(clip); document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  clip.layout.x = -clip.layout.width - 100;
  const contract = buildSnapshotConformanceContract({document, documentHash: "a".repeat(64), assets: [], contractVersion: 4,
    visibilityPolicy: NATIVE_TEXT_GEOMETRY_POLICY, renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const evidence = textParityEvidenceSchema.parse({schemaVersion: 1, policy: COMPOSITION_TEXT_PARITY_POLICY.id, repeatability: TEXT_PARITY_REPEATABILITY,
    checkpoints: contract.textParity.checkpoints.map((checkpoint) => ({...checkpoint, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
      status: "CAPTURED", unavailable: [], regions: checkpoint.expectedTexts.map((text) => ({...text, left: 0, top: 0,
        width: contract.canvas.width, height: contract.canvas.height, regionKind: "CANVAS_ABSENCE_PROBE"}))}))});
  validateTextParityEvidence(evidence, contract);
  const partial = structuredClone(evidence); partial.checkpoints[0]!.regions[0]!.width--;
  assert.throws(() => validateTextParityEvidence(partial, contract), /CHECKPOINT_MISMATCH/);
  const untagged = structuredClone(evidence); delete untagged.checkpoints[0]!.regions[0]!.regionKind;
  assert.notEqual(textParityEvidenceHash(untagged), textParityEvidenceHash(evidence));
  assert.throws(() => validateTextParityEvidence(evidence, fixture().contract), /PROBE_CONTRACT_INVALID/);
});
