import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildConformanceReferenceSource, conformanceReferenceVersion, verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { buildCompositionConformanceContract } from "../composition-preview-render-conformance";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";

function fixture() {
  const asset = {
    productionAssetId: "70000000-0000-4000-8000-000000000001", checksum: "f".repeat(64),
    fileSizeBytes: 1024, mimeType: "video/mp4", storageBucket: "production-assets", storagePath: "broll/source.mp4",
  };
  const document = createInitialCompositionDocument({ animatedDeck: null,
    assets: [{ ...asset, durationSeconds: 10, hasAudio: false, publicUrl: null, timelineRole: "BROLL" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 10, subtitle: "Frozen reference", title: "Reference" },
  });
  const contract = buildCompositionConformanceContract({ document, documentHash: hashCompositionDocument(document),
    assets: [{ id: asset.productionAssetId, checksum: asset.checksum }],
    renderProfile: { format: "mp4", fps: 25, quality: "high", resolution: "1080p" },
  });
  return { document, contract, assets: [asset] };
}

test("source flag is strict opt-in and remains off by default", () => {
  for (const value of [undefined, "false", "TRUE", "1", " true "]) assert.equal(conformanceReferenceVersion(value), null);
  assert.equal(conformanceReferenceVersion("true"), 1);
});

test("freezes deterministic interactive preview with pinned local media, semantic hash and no meters", async () => {
  const input = fixture();
  const source = await buildConformanceReferenceSource(input);
  const repeated = await buildConformanceReferenceSource(input);
  assert.deepEqual(source, repeated);
  assert.ok(source.previewHtml.includes(`src="conformance-media/${input.assets[0]!.productionAssetId}"`));
  assert.ok(source.previewHtml.includes(input.contract.documentHash));
  assert.ok(!source.previewHtml.includes("createMediaElementSource"));
  assert.equal(source.metadata.mediaState, "REQUIRES_VERIFIED_MATERIALIZATION");
  assert.equal(source.metadata.audioState, "REFERENCE_NOT_CAPTURED");
  assert.equal(source.metadata.previewSha256, createHash("sha256").update(source.previewHtml).digest("hex"));
  assert.equal(verifyConformanceReferenceSource(source).contract.documentHash, input.contract.documentHash);
});

test("rejects wrong document hash, missing assets, duplicate assets and conflicting checksums before compilation", async () => {
  const input = fixture();
  await assert.rejects(buildConformanceReferenceSource({ ...input, contract: { ...input.contract, documentHash: "a".repeat(64) } }), /DOCUMENT_MISMATCH/);
  await assert.rejects(buildConformanceReferenceSource({ ...input, assets: [] }), /ASSETS_MISMATCH/);
  await assert.rejects(buildConformanceReferenceSource({ ...input, assets: [...input.assets, ...input.assets] }), /ASSETS_MISMATCH/);
  await assert.rejects(buildConformanceReferenceSource({ ...input, assets: [{ ...input.assets[0]!, checksum: "a".repeat(64) }] }), /ASSETS_MISMATCH/);
});

test("source v3 pins the SSIM contract bytes without upgrading old revisions", async () => {
  const input = fixture();
  input.contract = buildCompositionConformanceContract({...input, contractVersion: 3, documentHash: input.contract.documentHash,
    assets: input.contract.assets, renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  const source = await buildConformanceReferenceSource(input);
  const verified = verifyConformanceReferenceSource(source);
  assert.equal(verified.contract.schemaVersion, 3);
  if (verified.contract.schemaVersion !== 3) throw new Error("Expected v3");
  assert.equal(verified.contract.visualMetrics.minimumSsim, 0.995);
  const altered = JSON.stringify({...verified.contract, visualMetrics: {...verified.contract.visualMetrics, minimumSsim: 0.9}});
  assert.throws(() => verifyConformanceReferenceSource({...source, contractJson: altered}), /BYTES_MISMATCH/);
});

test("requires resolvable bucket and complete deck dependencies without fetching remote URLs", async () => {
  const input = fixture();
  await assert.rejects(buildConformanceReferenceSource({ ...input, assets: [{ ...input.assets[0]!, storageBucket: undefined }] }), /BUCKET_MISSING/);
  await assert.rejects(buildConformanceReferenceSource({ ...input, deckPublicUrls: new Map([["missing", "https://example.invalid/deck.png"]]) }), /DECK_BINDING_MISSING/);
});

test("v4 rejects a byte-consistent text plan that disagrees with the saved document", async () => {
  const input = fixture();
  const {clip, track} = createCompositionNativeOverlay({document: input.document, id: "native", kind: "TEXT", playheadSeconds: 0});
  if (track) input.document.tracks.push(track);
  input.document.clips.push(clip);
  input.document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  const contract = buildSnapshotConformanceContract({document: input.document,
    documentHash: hashCompositionDocument(input.document), assets: input.contract.assets,
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}, contractVersion: 4});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const source = await buildConformanceReferenceSource({...input, contract});
  assert.equal(verifyConformanceReferenceSource(source).contract.schemaVersion, 4);
  const checkpoint = contract.textParity.checkpoints.find((entry) => entry.expectedTexts.length > 0);
  assert.ok(checkpoint, "Fixture must contain native text");
  for (const expectedTexts of [[], [{...checkpoint.expectedTexts[0]!, textSha256: "a".repeat(64)}]]) {
    const forged = {...contract, textParity: {...contract.textParity,
      checkpoints: contract.textParity.checkpoints.map((entry) => entry === checkpoint ? {...entry, expectedTexts} : entry)}};
    await assert.rejects(buildConformanceReferenceSource({...input, contract: forged}), /TEXT_PLAN_MISMATCH/);
    const contractJson = JSON.stringify(forged);
    assert.throws(() => verifyConformanceReferenceSource({...source, contractJson,
      metadata: {...source.metadata, contractSha256: createHash("sha256").update(contractJson).digest("hex")}}), /TEXT_PLAN_MISMATCH/);
  }
});

test("explicit motion policy freezes visibility and rejects altered states without reinterpreting older v4", async () => {
  const input = fixture();
  const {clip, track} = createCompositionNativeOverlay({document: input.document, id: "native", kind: "TEXT", playheadSeconds: 0});
  if (track) input.document.tracks.push(track); input.document.clips.push(clip);
  input.document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  input.document.motion.animations.push({id: "hide", origin: "USER", propertyGroup: "OPACITY", target: {clipId: clip.id, part: "CONTENT"},
    timing: {anchor: "CLIP_START", offsetSeconds: 0, durationSeconds: 1},
    keyframes: [{offset: 0, values: {opacity: 0}}, {offset: 1, values: {opacity: 0}, ease: "none"}]});
  const contract = buildSnapshotConformanceContract({document: input.document, documentHash: hashCompositionDocument(input.document),
    assets: input.contract.assets, contractVersion: 4, motionVisibility: true,
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  assert.equal(contract.textParity.visibilityPolicy, "NATIVE_MOTION_OPACITY_GSAP_V1");
  assert.equal(contract.textParity.checkpoints[0]!.expectedTexts[0]!.visibility, "HIDDEN");
  const source = await buildConformanceReferenceSource({...input, contract});
  verifyConformanceReferenceSource(source);
  const forged = structuredClone(contract);
  forged.textParity.checkpoints[0]!.expectedTexts[0]!.visibility = "VISIBLE";
  await assert.rejects(buildConformanceReferenceSource({...input, contract: forged}), /TEXT_PLAN_MISMATCH/);
  const legacy = buildSnapshotConformanceContract({document: input.document, documentHash: contract.documentHash,
    assets: input.contract.assets, contractVersion: 4, renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (legacy.schemaVersion !== 4) throw new Error("Expected v4");
  assert.equal(legacy.textParity.visibilityPolicy, undefined);
  assert.equal(legacy.textParity.checkpoints[0]!.expectedTexts[0]!.visibility, undefined);
});

test("detects alteration of each frozen file and rejects path substitution or binding forgery", async () => {
  const source = await buildConformanceReferenceSource(fixture());
  for (const key of ["previewHtml", "documentJson", "contractJson"] as const) {
    assert.throws(() => verifyConformanceReferenceSource({ ...source, [key]: `${source[key]} ` }), /BYTES_MISMATCH/);
  }
  const binding = source.metadata.bindings[0]!;
  for (const change of [{ localPath: "../escape" }, { checksum: "a".repeat(64) },
    { localPath: "conformance-media/80000000-0000-4000-8000-000000000001" }, { storagePath: "../escape" }]) {
    assert.throws(() => verifyConformanceReferenceSource({ ...source,
      metadata: { ...source.metadata, bindings: [{ ...binding, ...change }] },
    }));
  }
});

test("reference stays pinned after the editable caller document changes", async () => {
  const input = fixture();
  const source = await buildConformanceReferenceSource(input);
  input.document.variables.title = "Changed in a later edit";
  const verified = verifyConformanceReferenceSource(source);
  assert.equal(verified.document.variables.title, "Reference");
  assert.notEqual(hashCompositionDocument(input.document), verified.metadata.documentHash);
});
