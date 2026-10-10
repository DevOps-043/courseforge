import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { prepareCompositionHtmlEditingSnapshotArchive } from "../composition-html-editing-snapshot-archive.server";
import { verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { materializeConformanceReference } from "../qa/composition-conformance-materialization";

import { createPreparedHtmlArchiveFixture as fixture } from "./composition-html-editing-snapshot-archive-fixtures";
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

test("prepared archive joins edited render, interactive reference, exact bundle, text contract and local asset manifest", async () => {
  const f = await fixture(), result = await prepareCompositionHtmlEditingSnapshotArchive(f.input);
  assert.equal(result.scope, "PREPARED_ARCHIVE_NOT_UPLOADED_OR_RENDERED");
  assert.equal(result.projectHash, digest(result.archiveBytes));
  assert.equal(result.documentHash, f.input.documentHash);
  assert.equal(f.state.rpcReads, 2); assert.equal(f.state.assetReads, 2);
  const archive = await JSZip.loadAsync(result.archiveBytes);
  const render = await archive.file("index.html")!.async("string");
  const previewHtml = await archive.file("conformance-preview.html")!.async("string");
  assert.match(render, />Changed</); assert.match(previewHtml, />Changed</); assert.notEqual(render, previewHtml);
  assert.match(render, /Content-Security-Policy/); assert.match(render, new RegExp(`conformance-media/${uuid}`));
  assert.equal(await archive.file(result.bundle.archivePath)!.async("string"), result.bundle.encodedBundle);
  const documentJson = await archive.file("composition-document.json")!.async("string");
  assert.match(JSON.parse(documentJson).clips[0].source.html, /Original/);
  const verified = verifyConformanceReferenceSource({previewHtml, documentJson,
    metadata: JSON.parse(await archive.file("conformance-reference.json")!.async("string")),
    contractJson: await archive.file("conformance-contract.json")!.async("string"),
    fontManifest: [], htmlEditingBundle: result.bundle});
  assert.equal(verified.contract.schemaVersion, 4);
  assert.deepEqual(JSON.parse(await archive.file("asset-manifest.json")!.async("string")), result.assets);
  assert.doesNotMatch(await archive.file(result.bundle.archivePath)!.async("string"), /grantedAssetIds|imageSources|signedUrl/);
});

test("prepared archive round-trips through bounded materializer without upload or registration", async () => {
  const f = await fixture(), result = await prepareCompositionHtmlEditingSnapshotArchive(f.input);
  const parent = await mkdtemp(join(tmpdir(), "html-archive-preparation-"));
  try {
    const materialized = await materializeConformanceReference({archiveBytes: result.archiveBytes, expectedProjectHash: result.projectHash,
      organizationId: uuid, revisionId: uuid, outputParentDirectory: parent, readAsset: async () => new Response(f.media)});
    try {
      assert.equal(materialized.receipt.documentHash, result.documentHash);
      assert.deepEqual(await readFile(join(materialized.directory, `conformance-media/${uuid}`)), f.media);
    } finally {await materialized.cleanup();}
    assert.deepEqual(await readdir(parent), []);
  } finally {await rmdir(parent);}
});

test("permission revocation or image identity replacement during assembly prevents issuing an archive", async () => {
  for (const change of ["revokeOnRefresh", "replaceOnRefresh"] as const) {
    const f = await fixture(); f.state[change] = true;
    await assert.rejects(prepareCompositionHtmlEditingSnapshotArchive(f.input), /INVALID_REVISION|IMAGE_IDENTITY_MISMATCH/);
    assert.equal(f.state.rpcReads, 2);
  }
});

test("conflicting non-HTML and HTML records cannot silently overwrite each other in the manifest", async () => {
  const f = await fixture();
  f.input.otherAssets.push({...f.input.otherAssets[0]!, productionAssetId: uuid, mimeType: "image/png"});
  await assert.rejects(prepareCompositionHtmlEditingSnapshotArchive(f.input), /ASSET_CONFLICT/);
  assert.equal(f.state.rpcReads, 1);
});

test("missing native media binding and unsupported deck dependency reject before archive issuance", async () => {
  const f = await fixture(); f.input.otherAssets = [];
  await assert.rejects(prepareCompositionHtmlEditingSnapshotArchive(f.input));
  const fresh = await fixture();
  await assert.rejects(prepareCompositionHtmlEditingSnapshotArchive({...fresh.input,
    deckPublicUrls: new Map([[other, "https://unbound.example/image.png"]])}), /DECK_BINDING_MISSING/);
});

test("runtime identity and font byte integrity are independent mandatory checks", async () => {
  const f = await fixture();
  await assert.rejects(prepareCompositionHtmlEditingSnapshotArchive({...f.input, animationRuntimeSha256: "f".repeat(64)}), /RUNTIME_MISMATCH/);
  const fresh = await fixture();
  fresh.input.packagedFonts.push({binding: {fontAssetId: other, family: "Prepared font", checksumSha256: "a".repeat(64),
    mimeType: "font/woff2", fileSizeBytes: 4}, bytes: new Uint8Array(4)});
  await assert.rejects(prepareCompositionHtmlEditingSnapshotArchive(fresh.input), /FONT_BYTES_MISMATCH/);
});

test("pre-cancelled host preparation never reads authorized state or creates an archive", async () => {
  const f = await fixture(), cancellation = new AbortController();
  cancellation.abort(new Error("CANCELLED_PREPARATION"));
  await assert.rejects(prepareCompositionHtmlEditingSnapshotArchive({...f.input, signal: cancellation.signal}), /CANCELLED_PREPARATION/);
  assert.equal(f.state.rpcReads, 0);
});

test("verified packaged font bytes are copied before asynchronous refresh and pinned in the final archive", async () => {
  const f = await fixture();
  const bytes = Buffer.from("font fixture bytes, not a real font"), original = Buffer.from(bytes), checksum = digest(bytes);
  f.input.packagedFonts.push({binding: {fontAssetId: other, family: "Prepared font", checksumSha256: checksum,
    mimeType: "font/woff2", fileSizeBytes: bytes.length}, bytes});
  f.state.onRefresh = () => bytes.fill(0);
  const result = await prepareCompositionHtmlEditingSnapshotArchive(f.input);
  const archive = await JSZip.loadAsync(result.archiveBytes);
  assert.deepEqual(await archive.file(`assets/fonts/${checksum}.woff2`)!.async("nodebuffer"), original);
  assert.equal(result.fontManifest[0]!.checksumSha256, checksum);
});

test("identical duplicate asset identities coalesce but oversized font sets fail before mapping bytes", async () => {
  const f = await fixture();
  f.input.otherAssets.push({...f.input.otherAssets[0]!});
  assert.equal((await prepareCompositionHtmlEditingSnapshotArchive(f.input)).assets.length, 2);
  const fresh = await fixture();
  fresh.input.packagedFonts = Array.from({length: 33}, () => ({binding: {fontAssetId: other, family: "Excessive",
    checksumSha256: "a".repeat(64), mimeType: "font/woff2", fileSizeBytes: 4}, bytes: new Uint8Array(4)}));
  await assert.rejects(prepareCompositionHtmlEditingSnapshotArchive(fresh.input), /FONT_LIMIT/);
});

test("saved archive producer owns runtime, media, identity and font bytes before its first authorized read", async () => {
  const f = await fixture(), bytes = Buffer.from("frozen before the first await"), original = Buffer.from(bytes);
  const checksum = digest(bytes), documentHash = f.input.documentHash;
  f.input.packagedFonts = [{binding: {fontAssetId: other, family: "Prepared font", checksumSha256: checksum,
    mimeType: "font/woff2", fileSizeBytes: bytes.length}, bytes}];
  f.state.onRead = count => {
    if (count !== 1) return;
    f.input.otherAssets.length = 0;
    f.input.documentHash = "f".repeat(64);
    f.input.animationRuntimeSha256 = "f".repeat(64);
    bytes.fill(0);
  };
  const result = await prepareCompositionHtmlEditingSnapshotArchive(f.input);
  assert.equal(result.documentHash, documentHash);
  assert.equal(result.assets.length, 2);
  const archive = await JSZip.loadAsync(result.archiveBytes);
  assert.deepEqual(await archive.file(`assets/fonts/${checksum}.woff2`)!.async("nodebuffer"), original);
});

test("font capture never coerces arbitrary arrays into trusted byte buffers", async () => {
  const f = await fixture();
  f.input.packagedFonts = [{binding: {fontAssetId: other, family: "Invalid bytes", checksumSha256: "a".repeat(64),
    mimeType: "font/woff2", fileSizeBytes: 4}, bytes: [0, 0, 0, 0] as unknown as Uint8Array}];
  await assert.rejects(prepareCompositionHtmlEditingSnapshotArchive(f.input), /FONT_BYTES_MISMATCH/);
  assert.equal(f.state.rpcReads, 0);
});
