import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import JSZip from "jszip";
import { htmlEditingFixtureId as uuid } from "./composition-html-editing-test-fixtures";
import { createHtmlEditingReferenceFixture as fixture } from "./composition-html-editing-reference-fixtures";
import { buildDeckTextPlan } from "../composition-deck-text-plan";
import { buildConformanceReferenceSource, verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { writeConformanceReferenceArchive } from "../composition-conformance-reference-archive.server";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

test("deck text plan uses frozen edited source while retaining the original native document hash", () => {
  const { native, bundle, contract } = fixture();
  assert.throws(() => buildDeckTextPlan(native.document), /HTML_BUNDLE_REQUIRED/);
  assert.equal(contract.schemaVersion, 4);
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const plan = contract.deckTextPlan!;
  assert.equal(plan.documentHash, native.documentHash);
  assert.ok(plan.clips[0]!.entries.some(entry => entry.textSha256 === digest("Changed")));
  assert.ok(!plan.clips[0]!.entries.some(entry => entry.textSha256 === digest("Original")));
  assert.deepEqual(buildDeckTextPlan(native.document, bundle), plan);
});

test("reference ZIP round trip pins exact HTML revisions, edited preview and unchanged native document", async () => {
  const { params, bundle, native } = fixture();
  const source = await buildConformanceReferenceSource(params);
  assert.deepEqual(source.metadata.htmlEditingSnapshot, { schemaVersion: 1, path: bundle.archivePath, sha256: bundle.sha256 });
  assert.equal(source.fontManifest?.length, 0);
  const zip = new JSZip();
  writeConformanceReferenceArchive(zip, source);
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  const archive = await JSZip.loadAsync(bytes);
  const encodedBundle = await archive.file(bundle.archivePath)!.async("string");
  assert.equal(encodedBundle, bundle.encodedBundle);
  assert.equal(digest(encodedBundle), bundle.sha256);
  const verified = verifyConformanceReferenceSource({
    previewHtml: await archive.file("conformance-preview.html")!.async("string"),
    documentJson: await archive.file("composition-document.json")!.async("string"),
    contractJson: await archive.file("conformance-contract.json")!.async("string"),
    metadata: JSON.parse(await archive.file("conformance-reference.json")!.async("string")),
    fontManifest: source.fontManifest,
    htmlEditingBundle: { ...bundle, encodedBundle },
  });
  assert.equal(verified.metadata.documentHash, native.documentHash);
  const clip = verified.document.clips[0]!;
  assert.ok(clip.source.type === "DECK_SLIDE"); assert.match(clip.source.html, /Original/);
  assert.match(source.previewHtml, />Changed</);
});

test("reader rejects missing package, stripped pin, altered bytes and pin substitution", async () => {
  const source = await buildConformanceReferenceSource(fixture().params);
  assert.throws(() => verifyConformanceReferenceSource({ ...source, htmlEditingBundle: undefined }), /HTML_BUNDLE_REQUIRED/);
  assert.throws(() => verifyConformanceReferenceSource({ ...source,
    metadata: { ...source.metadata, htmlEditingSnapshot: undefined } }), /HTML_BUNDLE_REQUIRED/);
  assert.throws(() => verifyConformanceReferenceSource({ ...source,
    htmlEditingBundle: { ...source.htmlEditingBundle!, encodedBundle: source.htmlEditingBundle!.encodedBundle + " " } }), /BYTE_INTEGRITY_MISMATCH/);
  assert.throws(() => verifyConformanceReferenceSource({ ...source,
    metadata: { ...source.metadata, htmlEditingSnapshot: { ...source.metadata.htmlEditingSnapshot!, sha256: "f".repeat(64) } } }), /PIN_MISMATCH/);
});

test("reference rejects an original-source text plan even when all serialized checksums agree", async () => {
  const { params } = fixture();
  assert.ok(params.contract.schemaVersion === 4);
  const plan = params.contract.deckTextPlan!;
  plan.clips[0]!.entries[0]!.textSha256 = digest("Original");
  await assert.rejects(buildConformanceReferenceSource(params), /SOURCE_MISMATCH/);
});

test("reference producer still requires current grants even though offline text integrity can be verified", async () => {
  const { params } = fixture();
  params.htmlEditingSnapshot.authorities[0]!.grantedAssetIds = [];
  await assert.rejects(buildConformanceReferenceSource(params), /INVALID_BUNDLE/);
});

test("byte-consistent source cannot omit a used HTML image from frozen asset bindings", async () => {
  const source = await buildConformanceReferenceSource(fixture().params);
  const contract = JSON.parse(source.contractJson);
  contract.assets = contract.assets.filter((asset: { id: string }) => asset.id !== uuid);
  const contractJson = JSON.stringify(contract);
  assert.throws(() => verifyConformanceReferenceSource({ ...source, contractJson, metadata: {
    ...source.metadata, contractSha256: digest(contractJson),
    bindings: source.metadata.bindings.filter(binding => binding.assetId !== uuid),
  } }), /HTML_ASSETS_MISMATCH/);
});

test("archive writer verifies all pins before changing any destination file", async () => {
  const source = await buildConformanceReferenceSource(fixture().params);
  const zip = new JSZip(); zip.file("preserved.txt", "User content");
  assert.throws(() => writeConformanceReferenceArchive(zip, { ...source, previewHtml: source.previewHtml + " " }), /BYTES_MISMATCH/);
  assert.deepEqual(Object.keys(zip.files), ["preserved.txt"]);
});

test("HTML reference cannot omit the version-4 edited-text contract", async () => {
  const { params } = fixture();
  assert.ok(params.contract.schemaVersion === 4);
  delete params.contract.deckTextPlan;
  await assert.rejects(buildConformanceReferenceSource(params), /HTML_TEXT_PLAN_REQUIRED/);
});
