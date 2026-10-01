import assert from "node:assert/strict";
import test from "node:test";
import { fontUsageEvidenceHash, fontUsageEvidenceSchema, validateFontUsageEvidence } from "../qa/composition-font-usage-evidence";
import { createFontUsageEvidenceFixture } from "./fixtures/composition-font-usage.fixture";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareCompositionConformanceDirectories } from "../qa/composition-conformance-files";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { buildCompositionConformanceContract } from "../composition-preview-render-conformance";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
const fixture = () => createFontUsageEvidenceFixture([{frameIndex: 0, timeSeconds: 0}, {frameIndex: 25, timeSeconds: 1}]);

test("font usage witness is preview-only and hashes named fields without persisting document text", () => {
  const {fontUsage, textParity} = fixture();
  assert.deepEqual(validateFontUsageEvidence(fontUsage, textParity), fontUsage);
  assert.equal(fontUsageEvidenceHash(Object.fromEntries(Object.entries(fontUsage).reverse())), fontUsageEvidenceHash(fontUsage));
  for (const changed of [{...fontUsage, status: "PASS"}, {...fontUsage, scope: "ALL_FONTS"}, {...fontUsage, documentText: "private"}]) {
    assert.equal(fontUsageEvidenceSchema.safeParse(changed).success, false);
  }
  assert.equal(fontUsageEvidenceSchema.safeParse({...fontUsage, manifest: [...fontUsage.manifest, ...fontUsage.manifest]}).success, false);
});

test("manifest identity and checkpoint/element coverage reject omissions, duplicates and substitutions", () => {
  type Evidence = ReturnType<typeof fixture>["fontUsage"];
  const mutations: Array<(evidence: Evidence) => void> = [
    (evidence) => {evidence.manifest[0]!.checksumSha256 = "c".repeat(64);},
    (evidence) => {evidence.bindings.push(evidence.bindings[0]!);},
    (evidence) => {evidence.bindings[0]!.fontAssetId = "70000000-0000-4000-8000-000000000002";},
    (evidence) => {evidence.checkpoints.pop();},
    (evidence) => {evidence.checkpoints.push(evidence.checkpoints[0]!);},
    (evidence) => {evidence.checkpoints[0]!.timeSeconds = 0.5;},
    (evidence) => {evidence.checkpoints[0]!.elements = [];},
    (evidence) => {evidence.checkpoints[0]!.elements[0]!.elementId = "other";},
  ];
  for (const mutate of mutations) {const {fontUsage, textParity} = fixture(); mutate(fontUsage); assert.throws(() => validateFontUsageEvidence(fontUsage, textParity));}
});

test("fallback and unproven zero usage fail; verified hidden absence stays explicitly scoped", () => {
  for (const change of ["system", "family", "zero"] as const) {
    const {fontUsage, textParity} = fixture(); const element = fontUsage.checkpoints[0]!.elements[0]!;
    if (change === "system") element.fonts.push({...element.fonts[0]!, isCustomFont: false, glyphCount: 1});
    if (change === "family") element.fonts[0]!.familyName = "Other";
    if (change === "zero") element.fonts = [];
    assert.throws(() => validateFontUsageEvidence(fontUsage, textParity));
  }
  const {fontUsage, textParity} = fixture(); fontUsage.checkpoints[0]!.elements[0]!.fonts = [];
  textParity.checkpoints[0]!.expectedTexts[0]!.visibility = "HIDDEN"; textParity.checkpoints[0]!.regions[0]!.visibility = "HIDDEN";
  assert.doesNotThrow(() => validateFontUsageEvidence(fontUsage, textParity));
  textParity.checkpoints[0]!.regions = [];
  assert.throws(() => validateFontUsageEvidence(fontUsage, textParity), /ABSENCE_UNPROVEN/);
});

test("direct directory comparison rejects invalid preview font evidence before opening any PNG", async () => {
  const directory = await mkdtemp(join(tmpdir(), "font-evidence-comparison-"));
  const paths = ["contract.json", "preview.json", "render.json"].map((name) => join(directory, name));
  try {
    const document = createInitialCompositionDocument({animatedDeck: null, assets: [], sourceInsertionMode: "MANUAL",
      plan: {accentColor: "#38BDF8", durationSeconds: 2, title: "Fonts", subtitle: "Comparator"}});
    const contract = buildCompositionConformanceContract({document, documentHash: hashCompositionDocument(document), assets: [],
      renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
    const {fontUsage, textParity} = createFontUsageEvidenceFixture(contract.checkpoints);
    const metadata = {documentHash: contract.documentHash, frames: contract.checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds}))};
    await writeFile(paths[0]!, JSON.stringify(contract)); await writeFile(paths[2]!, JSON.stringify(metadata));
    const compare = () => compareCompositionConformanceDirectories({contractPath: paths[0]!, previewDirectory: directory,
      previewMetadataPath: paths[1]!, renderDirectory: directory, renderMetadataPath: paths[2]!});
    await writeFile(paths[1]!, JSON.stringify({...metadata, fontUsage}));
    await assert.rejects(compare(), /FONT_USAGE_TEXT_EVIDENCE_MISSING/);
    fontUsage.checkpoints[0]!.elements[0]!.fonts[0]!.isCustomFont = false;
    await writeFile(paths[1]!, JSON.stringify({...metadata, textParity, fontUsage}));
    await assert.rejects(compare(), /FONT_USAGE_FALLBACK/);
    const required = buildSnapshotConformanceContract({document, documentHash: contract.documentHash, assets: [], contractVersion: 4,
      fontUsage: true, fontManifest: [], renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
    await writeFile(paths[0]!, JSON.stringify(required)); await writeFile(paths[1]!, JSON.stringify(metadata));
    await assert.rejects(compare(), /FONT_USAGE_REQUIRED_EVIDENCE_MISSING/);
  } finally {for (const path of paths) await rm(path, {force: true}); await rmdir(directory);}
});
