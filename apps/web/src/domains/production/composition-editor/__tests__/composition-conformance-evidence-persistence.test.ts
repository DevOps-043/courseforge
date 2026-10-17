import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { buildCompositionConformanceContract } from "../composition-preview-render-conformance";
import { buildVisualConformanceEvidencePackage, CONFORMANCE_EVIDENCE_STORAGE } from "../qa/composition-conformance-evidence-package";
import { persistVisualConformanceEvidence } from "../qa/composition-conformance-evidence-persistence";
import { textParityEvidenceHash, TEXT_PARITY_REPEATABILITY, type TextParityEvidence } from "../qa/composition-text-parity-evidence";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { fontUsageEvidenceHash } from "../qa/composition-font-usage-evidence";
import { createFontUsageEvidenceFixture } from "./fixtures/composition-font-usage.fixture";
import { browserIdentityHash, type BrowserIdentity } from "../qa/composition-browser-identity";
import { browserExecutableIdentityHash, type BrowserExecutableIdentity } from "../qa/composition-browser-executable-identity";

const identifier = "70000000-0000-4000-8000-000000000001";
async function fixture(run: (input: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>) {
  const input = await makeFixture();
  try { await run(input); }
  finally {
    for (const frame of input.contract.checkpoints) await rm(join(input.captureDirectory, `frame-${frame.frameIndex}.png`), { force: true });
    await rm(join(input.captureDirectory, "preview-metadata.json"), { force: true });
    await rm(join(input.captureDirectory, "capture-receipt.json"), { force: true }); await rmdir(input.captureDirectory);
  }
}
async function makeFixture() {
  const captureDirectory = await mkdtemp(join(tmpdir(), "evidence-package-test-"));
  const document = createInitialCompositionDocument({ animatedDeck: null, assets: [{
    productionAssetId: identifier, checksum: "f".repeat(64), fileSizeBytes: 100, durationSeconds: 10,
    mimeType: "video/mp4", hasAudio: false, publicUrl: null, storageBucket: "production-assets", storagePath: "media/source.mp4", timelineRole: "BROLL",
  }], plan: { accentColor: "#38BDF8", durationSeconds: 10, subtitle: "Evidence", title: "Evidence" } });
  const contract = buildCompositionConformanceContract({ document, documentHash: hashCompositionDocument(document),
    assets: [{ id: identifier, checksum: "f".repeat(64) }], renderProfile: { format: "mp4", fps: 25, quality: "high", resolution: "1080p" } });
  const png = await sharp({ create: { width: contract.canvas.width, height: contract.canvas.height, channels: 4, background: "#020617" } }).png().toBuffer();
  const frames = contract.checkpoints.map(({ frameIndex, timeSeconds }) => ({ frameIndex, timeSeconds, sha256: createHash("sha256").update(png).digest("hex"), sizeBytes: png.length }));
  const receipt = { schemaVersion: 1, organizationId: identifier, revisionId: identifier, projectHash: "a".repeat(64),
    documentHash: contract.documentHash, status: "VISUAL_CAPTURED_AUDIO_PENDING", assetCount: 1, mediaBytes: 100,
    networkPolicy: "EXACT_LOCAL_ALLOWLIST_V1", frames };
  const metadata = { documentHash: contract.documentHash, frames: contract.checkpoints.map(({ frameIndex, timeSeconds }) => ({ frameIndex, timeSeconds })) };
  await writeFile(join(captureDirectory, "preview-metadata.json"), JSON.stringify(metadata));
  await writeFile(join(captureDirectory, "capture-receipt.json"), JSON.stringify(receipt));
  for (const frame of frames) await writeFile(join(captureDirectory, `frame-${frame.frameIndex}.png`), png);
  return { captureDirectory, contract, receipt, metadata, organizationId: identifier, revisionId: identifier, projectHash: receipt.projectHash };
}

test("private package preserves font usage and rejects missing, changed or semantically invalid pins", async () => {
  await fixture(async (input) => {
    const {textParity, fontUsage} = createFontUsageEvidenceFixture(input.contract.checkpoints);
    const metadataPath = join(input.captureDirectory, "preview-metadata.json"), receiptPath = join(input.captureDirectory, "capture-receipt.json");
    const receipt = {...input.receipt, textParitySha256: textParityEvidenceHash(textParity)};
    await writeFile(metadataPath, JSON.stringify({...input.metadata, textParity, fontUsage}));
    await writeFile(receiptPath, JSON.stringify(receipt));
    await assert.rejects(buildVisualConformanceEvidencePackage(input), /FONT_USAGE_PIN_MISSING/);
    await writeFile(receiptPath, JSON.stringify({...receipt, fontUsageSha256: fontUsageEvidenceHash(fontUsage)}));
    const packaged = await buildVisualConformanceEvidencePackage(input), zip = await JSZip.loadAsync(packaged.bytes);
    assert.deepEqual(JSON.parse(await zip.file("preview-metadata.json")!.async("string")).fontUsage, fontUsage);
    fontUsage.checkpoints[0]!.elements[0]!.fonts[0]!.glyphCount++;
    await writeFile(metadataPath, JSON.stringify({...input.metadata, textParity, fontUsage}));
    await assert.rejects(buildVisualConformanceEvidencePackage(input), /FONT_USAGE_PIN_MISMATCH/);
    fontUsage.checkpoints[0]!.elements[0]!.fonts[0]!.isCustomFont = false;
    await writeFile(metadataPath, JSON.stringify({...input.metadata, textParity, fontUsage}));
    await writeFile(receiptPath, JSON.stringify({...receipt, fontUsageSha256: fontUsageEvidenceHash(fontUsage)}));
    await assert.rejects(buildVisualConformanceEvidencePackage(input), /FONT_USAGE_FALLBACK/);
  });
});

test("private package pins actual browser identity and rejects omitted or altered version evidence", async () => {
  await fixture(async (input) => {
    const browserIdentity: BrowserIdentity = {policy: "CDP_BROWSER_VERSION_FORWARD_REVERSE_V1", scope: "CAPTURE_BROWSER_SELF_REPORTED_VERSION_ONLY",
      version: {protocolVersion: "1.3", product: "HeadlessChrome/130.0.0.0", revision: "controlled", userAgent: "controlled-agent", jsVersion: "13.0"}};
    const metadataPath = join(input.captureDirectory, "preview-metadata.json"), receiptPath = join(input.captureDirectory, "capture-receipt.json");
    await writeFile(metadataPath, JSON.stringify({...input.metadata, browserIdentity}));
    await assert.rejects(buildVisualConformanceEvidencePackage(input), /BROWSER_IDENTITY_PIN_MISSING/);
    await writeFile(receiptPath, JSON.stringify({...input.receipt, browserIdentitySha256: browserIdentityHash(browserIdentity)}));
    const bundle = await buildVisualConformanceEvidencePackage(input), zip = await JSZip.loadAsync(bundle.bytes);
    assert.deepEqual(JSON.parse(await zip.file("preview-metadata.json")!.async("string")).browserIdentity, browserIdentity);
    browserIdentity.version.revision = "different";
    await writeFile(metadataPath, JSON.stringify({...input.metadata, browserIdentity}));
    await assert.rejects(buildVisualConformanceEvidencePackage(input), /BROWSER_IDENTITY_PIN_MISMATCH/);
    await writeFile(metadataPath, JSON.stringify(input.metadata));
    await assert.rejects(buildVisualConformanceEvidencePackage(input), /BROWSER_IDENTITY_PIN_MISSING/);
  });
});

test("private package preserves launch file identity and rejects missing or changed pins", async () => {
  await fixture(async (input) => {
    const browserExecutableIdentity: BrowserExecutableIdentity = {policy: "LAUNCH_FILE_SHA256_BEFORE_AFTER_V1",
      scope: "LAUNCH_FILE_NOT_LOADED_MODULES_OR_REMOTE_RENDERER", sha256: "e".repeat(64), sizeBytes: 100};
    const metadataPath = join(input.captureDirectory, "preview-metadata.json"), receiptPath = join(input.captureDirectory, "capture-receipt.json");
    await writeFile(metadataPath, JSON.stringify({...input.metadata, browserExecutableIdentity}));
    await assert.rejects(buildVisualConformanceEvidencePackage(input), /BROWSER_EXECUTABLE_PIN_MISSING/);
    await writeFile(receiptPath, JSON.stringify({...input.receipt, browserExecutableIdentitySha256: browserExecutableIdentityHash(browserExecutableIdentity)}));
    const bundle = await buildVisualConformanceEvidencePackage(input), zip = await JSZip.loadAsync(bundle.bytes);
    assert.deepEqual(JSON.parse(await zip.file("preview-metadata.json")!.async("string")).browserExecutableIdentity, browserExecutableIdentity);
    browserExecutableIdentity.sha256 = "f".repeat(64);
    await writeFile(metadataPath, JSON.stringify({...input.metadata, browserExecutableIdentity}));
    await assert.rejects(buildVisualConformanceEvidencePackage(input), /BROWSER_EXECUTABLE_PIN_MISMATCH/);
    await writeFile(metadataPath, JSON.stringify(input.metadata));
    await assert.rejects(buildVisualConformanceEvidencePackage(input), /BROWSER_EXECUTABLE_PIN_MISSING/);
  });
});

test("recibo de seek reversible conserva evidencia y rechaza cobertura inventada", async () => {
  await fixture(async (input) => {
    const path = join(input.captureDirectory, "capture-receipt.json");
    const seekRepeatability = { policy: "EXACT_PNG_FORWARD_REVERSE_V1", status: "PASS", checkpointCount: input.contract.checkpoints.length };
    await writeFile(path, JSON.stringify({ ...input.receipt, seekRepeatability }));
    const evidence = await buildVisualConformanceEvidencePackage(input);
    assert.deepEqual(evidence.receipt.seekRepeatability, seekRepeatability);
    await writeFile(path, JSON.stringify({ ...input.receipt, seekRepeatability: { ...seekRepeatability, checkpointCount: 1 } }));
    await assert.rejects(buildVisualConformanceEvidencePackage(input), /REPEATABILITY_INVALID/);
  });
});

test("optional text witness is pinned inside the private ZIP; missing or changed pin is rejected", async () => {
  await fixture(async (input) => {
    const textParity: TextParityEvidence = {schemaVersion: 1, policy: COMPOSITION_TEXT_PARITY_POLICY.id, repeatability: TEXT_PARITY_REPEATABILITY,
      checkpoints: input.contract.checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
        status: "CAPTURED", expectedTexts: [], regions: [], unavailable: []}))};
    const metadataPath = join(input.captureDirectory, "preview-metadata.json"), receiptPath = join(input.captureDirectory, "capture-receipt.json");
    await writeFile(metadataPath, JSON.stringify({...input.metadata, textParity}));
    await assert.rejects(buildVisualConformanceEvidencePackage(input), /PIN_MISSING/);
    await writeFile(receiptPath, JSON.stringify({...input.receipt, textParitySha256: textParityEvidenceHash(textParity)}));
    const packaged = await buildVisualConformanceEvidencePackage(input); const zip = await JSZip.loadAsync(packaged.bytes);
    assert.deepEqual(JSON.parse(await zip.file("preview-metadata.json")!.async("string")).textParity, textParity);
    const first = textParity.checkpoints[0]!; const expected = {elementId: "native-motion", textSha256: "b".repeat(64)};
    first.expectedTexts = [expected]; first.regions = [{...expected, left: 10, top: 20, width: 30, height: 40}];
    await writeFile(metadataPath, JSON.stringify({...input.metadata, textParity}));
    await assert.rejects(buildVisualConformanceEvidencePackage(input), /PIN_MISMATCH/);
  });
});

function database(input: Awaited<ReturnType<typeof makeFixture>>, options: { uploadError?: boolean; corrupt?: boolean; downloadError?: boolean; recordError?: boolean; foreignTenant?: boolean } = {}) {
  let stored: Buffer | null = null;
  const calls: Array<{ name: string; parameters?: unknown }> = [];
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ error: null, data: {
    id: identifier, organization_id: options.foreignTenant ? "80000000-0000-4000-8000-000000000001" : identifier,
    project_hash: input.projectHash, manifest: { conformance_reference_version: 1, conformance_contract: input.contract },
  } }) };
  const supabase = { from: () => query, storage: { from: (bucket: string) => {
    assert.equal(bucket, CONFORMANCE_EVIDENCE_STORAGE.bucket);
    return {
      upload: async (path: string, bytes: Buffer, uploadOptions: unknown) => {
        stored = bytes; calls.push({ name: "upload", parameters: { path, uploadOptions } });
        return { error: options.uploadError ? { message: "lost acknowledgement" } : null };
      },
      download: async () => {
        calls.push({ name: "download" });
        return { error: options.downloadError ? { message: "private failure" } : null,
          data: stored ? new Blob([Uint8Array.from(options.corrupt ? Buffer.alloc(stored.length) : stored)]) : null };
      },
    };
  } }, rpc: async (name: string, parameters: Record<string, unknown>) => {
    calls.push({ name, parameters }); return { error: options.recordError ? { message: "private failure" } : null, data: parameters.p_bundle_sha256 };
  } };
  return { supabase: supabase as never, calls };
}

test("package is deterministic and includes only validated contract, metadata, receipt and PNGs", async () => {
  await fixture(async (input) => {
    const first = await buildVisualConformanceEvidencePackage(input); const second = await buildVisualConformanceEvidencePackage(input);
    assert.deepEqual(first.bytes, second.bytes); assert.equal(first.checksum, second.checksum);
    assert.equal(first.storagePath, `${identifier}/${identifier}/${first.checksum}.zip`);
    const archive = await JSZip.loadAsync(first.bytes);
    assert.equal(Object.keys(archive.files).length, input.contract.checkpoints.length + 3);
    assert.equal(first.receipt.status, "VISUAL_CAPTURED_AUDIO_PENDING");
  });
});

test("modified PNG or wrong tenant/revision/project cannot be packaged", async () => {
  await fixture(async (input) => {
    for (const change of [{ organizationId: "80000000-0000-4000-8000-000000000001" }, { revisionId: "80000000-0000-4000-8000-000000000001" }, { projectHash: "b".repeat(64) }]) {
      await assert.rejects(buildVisualConformanceEvidencePackage({ ...input, ...change }), /REVISION_MISMATCH/);
    }
    await writeFile(join(input.captureDirectory, `frame-${input.receipt.frames[0]!.frameIndex}.png`), "changed");
    await assert.rejects(buildVisualConformanceEvidencePackage(input), /FRAME_MISMATCH/);
  });
});

test("missing, duplicate, extra or mistimed checkpoints are rejected", async () => {
  await fixture(async (input) => {
    for (const frames of [input.receipt.frames.slice(1), [...input.receipt.frames, input.receipt.frames[0]],
      input.receipt.frames.map((frame, index) => index === 0 ? { ...frame, timeSeconds: frame.timeSeconds + 1 } : frame)]) {
      await writeFile(join(input.captureDirectory, "capture-receipt.json"), JSON.stringify({ ...input.receipt, frames }));
      await assert.rejects(buildVisualConformanceEvidencePackage(input), /CHECKPOINTS_INVALID/);
    }
  });
});

test("persists without overwrite, verifies readback and only then records worker evidence", async () => {
  await fixture(async (input) => {
    const db = database(input);
    const result = await persistVisualConformanceEvidence({ ...input, supabase: db.supabase });
    assert.deepEqual(db.calls.map((call) => call.name), ["upload", "download", "record_hyperframes_visual_conformance_evidence"]);
    assert.deepEqual((db.calls[0]!.parameters as { uploadOptions: unknown }).uploadOptions, { contentType: "application/zip", upsert: false });
    assert.equal(result.status, "VISUAL_CAPTURED_AUDIO_PENDING");
    assert.equal((db.calls[2]!.parameters as Record<string, unknown>).p_bundle_sha256, result.checksum);
    assert.ok(!JSON.stringify(result).includes("token"));
  });
});

test("lost upload acknowledgement is recoverable only if existing object has exact bytes", async () => {
  await fixture(async (input) => {
    const db = database(input, { uploadError: true });
    assert.equal((await persistVisualConformanceEvidence({ ...input, supabase: db.supabase })).status, "VISUAL_CAPTURED_AUDIO_PENDING");
    const corrupt = database(input, { uploadError: true, corrupt: true });
    await assert.rejects(persistVisualConformanceEvidence({ ...input, supabase: corrupt.supabase }), /STORAGE_MISMATCH/);
    assert.equal(corrupt.calls.length, 2);
  });
});

test("unavailable or altered storage readback never registers evidence", async () => {
  await fixture(async (input) => {
    for (const options of [{ downloadError: true }, { corrupt: true }]) {
      const db = database(input, options);
      await assert.rejects(persistVisualConformanceEvidence({ ...input, supabase: db.supabase }));
      assert.equal(db.calls.length, 2);
    }
  });
});

test("record failure stays explicit and retry emits same content address without deleting the object", async () => {
  await fixture(async (input) => {
    const failing = database(input, { recordError: true });
    await assert.rejects(persistVisualConformanceEvidence({ ...input, supabase: failing.supabase }), /RECORD_FAILED/);
    const retry = database(input);
    const result = await persistVisualConformanceEvidence({ ...input, supabase: retry.supabase });
    assert.equal((failing.calls[0]!.parameters as { path: string }).path, result.storagePath);
  });
});

test("scoped revision mismatch fails before uploading anything", async () => {
  await fixture(async (input) => {
    const db = database(input, { foreignTenant: true });
    await assert.rejects(persistVisualConformanceEvidence({ ...input, supabase: db.supabase }), /REVISION_UNAVAILABLE/);
    assert.equal(db.calls.length, 0);
    assert.ok((await readFile(join(input.captureDirectory, "capture-receipt.json"), "utf8")).includes(identifier));
  });
});
