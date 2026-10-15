import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import sharp from "sharp";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { buildCompositionConformanceContract } from "../composition-preview-render-conformance";
import { readPersistedVisualConformanceEvidence } from "../qa/composition-conformance-evidence-reader";
import { CONFORMANCE_EVIDENCE_STORAGE } from "../qa/composition-conformance-evidence-package";
import { textParityEvidenceHash, TEXT_PARITY_REPEATABILITY, type TextParityEvidence } from "../qa/composition-text-parity-evidence";
import { fontUsageEvidenceHash } from "../qa/composition-font-usage-evidence";
import { createFontUsageEvidenceFixture } from "./fixtures/composition-font-usage.fixture";
import { compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { COMPOSITION_SSIM_POLICY } from "../composition-visual-metrics-policy";
import { DECLARED_NATIVE_FONT_USAGE_POLICY } from "../composition-font-usage-contract";
import { browserIdentityHash, type BrowserIdentity } from "../qa/composition-browser-identity";
import { browserExecutableIdentityHash, type BrowserExecutableIdentity } from "../qa/composition-browser-executable-identity";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { EXPORTED_COLOR_TAG_POLICY } from "../composition-color-tag-policy";

const identifier = "70000000-0000-4000-8000-000000000001";
const foreignIdentifier = "80000000-0000-4000-8000-000000000001";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function fixture(run: (input: Awaited<ReturnType<typeof createFixture>>) => Promise<void>, version: 2 | 3 = 2) {
  const input = await createFixture(version);
  try { await run(input); }
  finally { assert.deepEqual(await readdir(input.outputParentDirectory), []); await rmdir(input.outputParentDirectory); }
}
async function createFixture(contractVersion: 2 | 3 = 2) {
  const document = createInitialCompositionDocument({ animatedDeck: null, assets: [{
    productionAssetId: identifier, checksum: "f".repeat(64), fileSizeBytes: 100, durationSeconds: 3,
    mimeType: "video/mp4", hasAudio: false, publicUrl: null, storageBucket: "production-assets", storagePath: "media/source.mp4", timelineRole: "BROLL",
  }],
    plan: { accentColor: "#38BDF8", durationSeconds: 3, subtitle: "Evidence", title: "Evidence" } });
  const contract = buildCompositionConformanceContract({ document, contractVersion, documentHash: hashCompositionDocument(document), assets: [{ id: identifier, checksum: "f".repeat(64) }],
    renderProfile: { format: "mp4", fps: 25, quality: "high", resolution: "1080p" } });
  const png = await sharp({ create: { width: contract.canvas.width, height: contract.canvas.height, channels: 4, background: "#020617" } }).png().toBuffer();
  const frames = contract.checkpoints.map(({ frameIndex, timeSeconds }) => ({ frameIndex, timeSeconds, sha256: digest(png), sizeBytes: png.length }));
  const receipt = { schemaVersion: 1, organizationId: identifier, revisionId: identifier, projectHash: "a".repeat(64),
    documentHash: contract.documentHash, status: "VISUAL_CAPTURED_AUDIO_PENDING", assetCount: 1, mediaBytes: 100,
    networkPolicy: "EXACT_LOCAL_ALLOWLIST_V1", frames };
  const zip = new JSZip();
  zip.file("conformance-contract.json", JSON.stringify(contract));
  zip.file("capture-receipt.json", JSON.stringify(receipt));
  zip.file("preview-metadata.json", JSON.stringify({ documentHash: contract.documentHash,
    frames: frames.map(({ frameIndex, timeSeconds }) => ({ frameIndex, timeSeconds })) }));
  for (const frame of frames) zip.file(`frame-${frame.frameIndex}.png`, png);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { zip, bytes, receipt, contract, outputParentDirectory: await mkdtemp(join(tmpdir(), "evidence-reader-test-")) };
}
function database(input: Awaited<ReturnType<typeof createFixture>>, options: {
  record?: Record<string, unknown>; unavailable?: boolean; downloadFailure?: boolean; downloadedBytes?: Buffer;
} = {}) {
  const checksum = digest(input.bytes);
  const record = { organizationId: identifier, revisionId: identifier, checksum,
    projectHash: input.receipt.projectHash, documentHash: input.contract.documentHash,
    storagePath: `${identifier}/${identifier}/${checksum}.zip`, sizeBytes: input.bytes.length,
    frames: input.receipt.frames, status: "VISUAL_CAPTURED_AUDIO_PENDING", contract: input.contract, ...options.record };
  const calls: string[] = [];
  const supabase = { rpc: async (name: string, parameters: unknown) => {
    assert.equal(name, "read_hyperframes_visual_conformance_evidence");
    assert.deepEqual(parameters, { p_organization_id: identifier, p_revision_id: identifier, p_bundle_sha256: checksum });
    calls.push("read-record"); return { error: null, data: options.unavailable ? null : record };
  }, storage: { from: (bucket: string) => {
    assert.equal(bucket, CONFORMANCE_EVIDENCE_STORAGE.bucket);
    return { download: async (path: string) => {
      calls.push("download"); assert.equal(path, record.storagePath);
      return { error: options.downloadFailure ? { message: "private error" } : null,
        data: new Blob([Uint8Array.from(options.downloadedBytes ?? input.bytes)]) };
    } };
  } } };
  return { calls, params: { supabase: supabase as never, organizationId: identifier, revisionId: identifier,
    checksum, outputParentDirectory: input.outputParentDirectory } };
}

test("private reader preserves font witness and rejects fallback with updated pins and registered ZIP", async () => {
  await fixture(async (input) => {
    const {textParity, fontUsage} = createFontUsageEvidenceFixture(input.contract.checkpoints);
    const metadata = JSON.parse(await input.zip.file("preview-metadata.json")!.async("string"));
    const rewrite = async () => {
      input.zip.file("preview-metadata.json", JSON.stringify({...metadata, textParity, fontUsage}));
      input.zip.file("capture-receipt.json", JSON.stringify({...input.receipt, textParitySha256: textParityEvidenceHash(textParity),
        fontUsageSha256: fontUsageEvidenceHash(fontUsage)}));
      input.bytes = await input.zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"});
    };
    await rewrite();
    const result = await readPersistedVisualConformanceEvidence(database(input).params);
    try {
      assert.deepEqual(JSON.parse(await readFile(result.previewMetadataPath, "utf8")).fontUsage, fontUsage);
      assert.equal(result.receipt.fontUsageSha256, fontUsageEvidenceHash(fontUsage));
    } finally {await result.cleanup();}
    fontUsage.checkpoints[0]!.elements[0]!.fonts[0]!.isCustomFont = false;
    await rewrite();
    await assert.rejects(readPersistedVisualConformanceEvidence(database(input).params), /FONT_USAGE_FALLBACK/);
    assert.deepEqual(await readdir(input.outputParentDirectory), []);
  });
});

test("authorized frozen font obligation rejects omitted or reduced witnesses even in registered archives", async () => {
  await fixture(async (input) => {
    const {textParity, fontUsage} = createFontUsageEvidenceFixture(input.contract.checkpoints);
    input.contract = compositionConformanceContractSchema.parse({...input.contract, schemaVersion: 4,
      visualMetrics: {ssimPolicy: COMPOSITION_SSIM_POLICY.id, minimumSsim: COMPOSITION_SSIM_POLICY.minimum},
      textParity: {policy: COMPOSITION_TEXT_PARITY_POLICY.id, scope: "NATIVE_TEXT_AND_CAPTIONS",
        checkpoints: textParity.checkpoints.map(({frameIndex, timeSeconds, expectedTexts}) => ({frameIndex, timeSeconds, expectedTexts}))},
      fontUsageContract: {policy: DECLARED_NATIVE_FONT_USAGE_POLICY, manifestSha256: fontUsage.manifestSha256, bindings: fontUsage.bindings}});
    input.zip.file("conformance-contract.json", JSON.stringify(input.contract));
    input.bytes = await input.zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"});
    await assert.rejects(readPersistedVisualConformanceEvidence(database(input).params), /REQUIRED_EVIDENCE_MISSING/);
    fontUsage.bindings = []; fontUsage.checkpoints.forEach((checkpoint) => {checkpoint.elements = [];});
    input.zip.file("preview-metadata.json", JSON.stringify({documentHash: input.contract.documentHash,
      frames: input.contract.checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds})), textParity, fontUsage}));
    input.zip.file("capture-receipt.json", JSON.stringify({...input.receipt, textParitySha256: textParityEvidenceHash(textParity),
      fontUsageSha256: fontUsageEvidenceHash(fontUsage)}));
    input.bytes = await input.zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"});
    await assert.rejects(readPersistedVisualConformanceEvidence(database(input).params), /FROZEN_BINDING_MISMATCH/);
    assert.deepEqual(await readdir(input.outputParentDirectory), []);
  });
});

test("authorized color policy survives private round-trip and cannot be deleted in a rehashed archive", async () => {
  await fixture(async (input) => {
    const {textParity} = createFontUsageEvidenceFixture(input.contract.checkpoints);
    input.contract = compositionConformanceContractSchema.parse({...input.contract, schemaVersion: 4,
      visualMetrics: {ssimPolicy: COMPOSITION_SSIM_POLICY.id, minimumSsim: COMPOSITION_SSIM_POLICY.minimum},
      colorTagPolicy: EXPORTED_COLOR_TAG_POLICY,
      textParity: {policy: COMPOSITION_TEXT_PARITY_POLICY.id, scope: "NATIVE_TEXT_AND_CAPTIONS",
        checkpoints: textParity.checkpoints.map(({frameIndex, timeSeconds, expectedTexts}) => ({frameIndex, timeSeconds, expectedTexts}))}});
    input.zip.file("conformance-contract.json", JSON.stringify(input.contract));
    const metadata = JSON.parse(await input.zip.file("preview-metadata.json")!.async("string"));
    input.zip.file("preview-metadata.json", JSON.stringify({...metadata, textParity}));
    input.zip.file("capture-receipt.json", JSON.stringify({...input.receipt, textParitySha256: textParityEvidenceHash(textParity)}));
    input.bytes = await input.zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"});
    const result = await readPersistedVisualConformanceEvidence(database(input).params);
    try {
      const stored = JSON.parse(await readFile(result.contractPath, "utf8"));
      assert.equal(stored.colorTagPolicy, EXPORTED_COLOR_TAG_POLICY);
    } finally {await result.cleanup();}
    if (input.contract.schemaVersion !== 4) throw new Error("Expected v4 color contract");
    const {colorTagPolicy: _policy, ...reduced} = input.contract;
    input.zip.file("conformance-contract.json", JSON.stringify(reduced));
    input.bytes = await input.zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"});
    await assert.rejects(readPersistedVisualConformanceEvidence(database(input).params), /CONTRACT/);
    assert.deepEqual(await readdir(input.outputParentDirectory), []);
  });
});

test("private reader preserves browser identity and rejects changed metadata with a registered archive hash", async () => {
  await fixture(async (input) => {
    const browserIdentity: BrowserIdentity = {policy: "CDP_BROWSER_VERSION_FORWARD_REVERSE_V1", scope: "CAPTURE_BROWSER_SELF_REPORTED_VERSION_ONLY",
      version: {protocolVersion: "1.3", product: "HeadlessChrome/130.0.0.0", revision: "controlled", userAgent: "controlled-agent", jsVersion: "13.0"}};
    const metadata = JSON.parse(await input.zip.file("preview-metadata.json")!.async("string"));
    input.zip.file("preview-metadata.json", JSON.stringify({...metadata, browserIdentity}));
    input.zip.file("capture-receipt.json", JSON.stringify({...input.receipt, browserIdentitySha256: browserIdentityHash(browserIdentity)}));
    input.bytes = await input.zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"});
    const result = await readPersistedVisualConformanceEvidence(database(input).params);
    try {
      assert.deepEqual(JSON.parse(await readFile(result.previewMetadataPath, "utf8")).browserIdentity, browserIdentity);
      assert.equal(result.receipt.browserIdentitySha256, browserIdentityHash(browserIdentity));
    } finally {await result.cleanup();}
    browserIdentity.version.product = "DifferentBrowser/1";
    input.zip.file("preview-metadata.json", JSON.stringify({...metadata, browserIdentity}));
    input.bytes = await input.zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"});
    await assert.rejects(readPersistedVisualConformanceEvidence(database(input).params), /BROWSER_IDENTITY_PIN_MISMATCH/);
    assert.deepEqual(await readdir(input.outputParentDirectory), []);
  });
});

test("private reader revalidates launch identity even when the modified ZIP hash is registered", async () => {
  await fixture(async (input) => {
    const browserExecutableIdentity: BrowserExecutableIdentity = {policy: "LAUNCH_FILE_SHA256_BEFORE_AFTER_V1",
      scope: "LAUNCH_FILE_NOT_LOADED_MODULES_OR_REMOTE_RENDERER", sha256: "e".repeat(64), sizeBytes: 100};
    const metadata = JSON.parse(await input.zip.file("preview-metadata.json")!.async("string"));
    input.zip.file("preview-metadata.json", JSON.stringify({...metadata, browserExecutableIdentity}));
    input.zip.file("capture-receipt.json", JSON.stringify({...input.receipt, browserExecutableIdentitySha256: browserExecutableIdentityHash(browserExecutableIdentity)}));
    input.bytes = await input.zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"});
    const result = await readPersistedVisualConformanceEvidence(database(input).params);
    try {
      assert.deepEqual(JSON.parse(await readFile(result.previewMetadataPath, "utf8")).browserExecutableIdentity, browserExecutableIdentity);
      assert.equal(result.receipt.browserExecutableIdentitySha256, browserExecutableIdentityHash(browserExecutableIdentity));
    } finally {await result.cleanup();}
    browserExecutableIdentity.sizeBytes++;
    input.zip.file("preview-metadata.json", JSON.stringify({...metadata, browserExecutableIdentity}));
    input.bytes = await input.zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"});
    await assert.rejects(readPersistedVisualConformanceEvidence(database(input).params), /BROWSER_EXECUTABLE_PIN_MISMATCH/);
    assert.deepEqual(await readdir(input.outputParentDirectory), []);
  });
});

test("scoped reader delivers verified comparator inputs and idempotent owned cleanup", async () => {
  await fixture(async (input) => {
    const db = database(input); const result = await readPersistedVisualConformanceEvidence(db.params);
    try {
      assert.deepEqual(db.calls, ["read-record", "download"]);
      assert.deepEqual(JSON.parse(await readFile(result.contractPath, "utf8")), input.contract);
      assert.equal(result.status, "VISUAL_CAPTURED_AUDIO_PENDING");
      assert.equal(result.previewDirectory, result.directory);
      assert.deepEqual(result.receipt.frames, input.receipt.frames);
    } finally { await result.cleanup(); await result.cleanup(); }
  });
});

test("private reader preserves optional text witness and rejects changed metadata even with a registered ZIP checksum", async () => {
  await fixture(async (input) => {
    const textParity: TextParityEvidence = {schemaVersion: 1, policy: COMPOSITION_TEXT_PARITY_POLICY.id, repeatability: TEXT_PARITY_REPEATABILITY,
      checkpoints: input.contract.checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
        status: "CAPTURED", expectedTexts: [], regions: [], unavailable: []}))};
    const metadata = JSON.parse(await input.zip.file("preview-metadata.json")!.async("string"));
    input.zip.file("preview-metadata.json", JSON.stringify({...metadata, textParity}));
    input.zip.file("capture-receipt.json", JSON.stringify({...input.receipt, textParitySha256: textParityEvidenceHash(textParity)}));
    input.bytes = await input.zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"});
    const result = await readPersistedVisualConformanceEvidence(database(input).params);
    try {
      assert.equal(result.receipt.textParitySha256, textParityEvidenceHash(textParity));
      assert.deepEqual(JSON.parse(await readFile(result.previewMetadataPath, "utf8")).textParity, textParity);
    } finally {await result.cleanup();}
    const expected = {elementId: "native-motion", textSha256: "b".repeat(64)};
    textParity.checkpoints[0]!.expectedTexts = [expected];
    textParity.checkpoints[0]!.regions = [{...expected, left: 10, top: 20, width: 30, height: 40}];
    input.zip.file("preview-metadata.json", JSON.stringify({...metadata, textParity}));
    input.bytes = await input.zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"});
    await assert.rejects(readPersistedVisualConformanceEvidence(database(input).params), /PIN_MISMATCH/);
  });
});
test("missing or foreign tenant/revision/hash/path/contract records fail before storage", async () => {
  await fixture(async (input) => {
    for (const options of [{ unavailable: true }, ...[
      { organizationId: foreignIdentifier }, { revisionId: foreignIdentifier }, { checksum: "b".repeat(64) },
      { storagePath: "../unexpected.zip" }, { documentHash: "b".repeat(64) },
    ].map((record) => ({ record }))]) {
      const db = database(input, options);
      await assert.rejects(readPersistedVisualConformanceEvidence(db.params)); assert.deepEqual(db.calls, ["read-record"]);
    }
  });
});

test("scoped reader preserves frozen v3 SSIM threshold and rejects a different authorized contract", async () => {
  await fixture(async (input) => {
    assert.equal(input.contract.schemaVersion, 3);
    const db = database(input); const result = await readPersistedVisualConformanceEvidence(db.params);
    try {assert.deepEqual(JSON.parse(await readFile(result.contractPath, "utf8")), input.contract);}
    finally {await result.cleanup();}
    const changed = {...input.contract, visualMetrics: {ssimPolicy: "ssim-gaussian-11-coded-bt709-luma-v1", minimumSsim: 0.9}};
    await assert.rejects(readPersistedVisualConformanceEvidence(database(input, {record: {contract: changed}}).params));
  }, 3);
});
test("download error, truncated bytes or changed checksum fail before decompression", async () => {
  await fixture(async (input) => {
    for (const options of [{ downloadFailure: true }, { downloadedBytes: input.bytes.subarray(1) },
      { downloadedBytes: Buffer.alloc(input.bytes.length) }]) {
      await assert.rejects(readPersistedVisualConformanceEvidence(database(input, options).params), /DOWNLOAD_FAILED|STORAGE_MISMATCH/);
    }
  });
});
test("suppressed frames without corresponding mask witnesses are rejected and cleaned", async () => {
  await fixture(async (input) => {
    const frameIndex = input.contract.checkpoints[0]!.frameIndex;
    const png = await input.zip.file(`frame-${frameIndex}.png`)!.async("nodebuffer");
    input.zip.file(`text-suppressed-${frameIndex}.png`, png);
    input.bytes = await input.zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"});
    await assert.rejects(readPersistedVisualConformanceEvidence(database(input).params), /ARCHIVE_INVALID/);
    assert.deepEqual(await readdir(input.outputParentDirectory), []);
  });
});

test("extra files, missing frames and archive traversal paths are rejected", async () => {
  await fixture(async (input) => {
    for (const variant of ["extra", "missing", "traversal"]) {
      const zip = await JSZip.loadAsync(input.bytes);
      if (variant === "extra") zip.file("unexpected.txt", "untrusted");
      else if (variant === "missing") zip.remove(`frame-${input.receipt.frames[0]!.frameIndex}.png`);
      else {
        zip.remove("conformance-contract.json");
        zip.file("../conformance-contract.json", JSON.stringify(input.contract), { createFolders: false });
      }
      const bytes = await zip.generateAsync({ type: "nodebuffer" });
      await assert.rejects(readPersistedVisualConformanceEvidence(database({ ...input, bytes }).params), /ARCHIVE_INVALID/);
    }
  });
});
test("oversized compressed entry is bounded and temporary extraction is removed", async () => {
  await fixture(async (input) => {
    input.zip.file("preview-metadata.json", Buffer.alloc(1024 * 1024 + 1));
    const bytes = await input.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await assert.rejects(readPersistedVisualConformanceEvidence(database({ ...input, bytes }).params), /EXTRACTION_LIMIT/);
  });
});
test("different authorized contract with same document hash cannot loosen the comparison", async () => {
  await fixture(async (input) => {
    const contract = { ...input.contract, checkpoints: input.contract.checkpoints.map((checkpoint, index) =>
      index === 0 ? { ...checkpoint, timeSeconds: checkpoint.timeSeconds + 0.005 } : checkpoint) };
    await assert.rejects(readPersistedVisualConformanceEvidence(database(input, { record: { contract } }).params), /CONTRACT_MISMATCH/);
  });
});
test("receipt must match the persisted frame records, not just archive checksum", async () => {
  await fixture(async (input) => {
    const frames = input.receipt.frames.map((frame) => ({ ...frame, sha256: "b".repeat(64) }));
    await assert.rejects(readPersistedVisualConformanceEvidence(database(input, { record: { frames } }).params), /RECEIPT_MISMATCH/);
  });
});
test("checks frame bytes even when altered archive has its own valid registered checksum", async () => {
  await fixture(async (input) => {
    input.zip.file(`frame-${input.receipt.frames[0]!.frameIndex}.png`, "altered");
    const bytes = await input.zip.generateAsync({ type: "nodebuffer" });
    await assert.rejects(readPersistedVisualConformanceEvidence(database({ ...input, bytes }).params), /FRAME_MISMATCH/);
  });
});
