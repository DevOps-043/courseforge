import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import test from "node:test";
import { buildConformanceReferenceSource } from "../composition-conformance-reference.service";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { buildCompositionConformanceContract } from "../composition-preview-render-conformance";
import { materializeConformanceReference } from "../qa/composition-conformance-materialization";
import { assertConformanceStorageUrl, materializeAuthorizedConformanceRevision } from "../qa/composition-conformance-storage";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { conformanceFontPath } from "../composition-conformance-font-bindings";
import type { CompositionCompiledFont } from "../../fonts/organization-font.types";

const identifier = "70000000-0000-4000-8000-000000000001";
const content = Buffer.from("small pinned asset");
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
async function fixture(nativeFont = false) {
  const asset = { productionAssetId: identifier, checksum: sha256(content), fileSizeBytes: content.length,
    mimeType: "video/mp4", storageBucket: "production-assets", storagePath: "production-assets/media/source.mp4" };
  const document = createInitialCompositionDocument({ animatedDeck: null,
    assets: [{ ...asset, durationSeconds: 10, hasAudio: false, publicUrl: null, timelineRole: "BROLL" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 10, subtitle: "Materialization", title: "Pinned source" },
  });
  const fontBytes = Buffer.from("controlled font fixture bytes");
  const font = {fontAssetId: identifier, family: "Controlled Font", checksumSha256: sha256(fontBytes), fileSizeBytes: fontBytes.length,
    mimeType: "font/woff2" as const};
  if (nativeFont) {
    const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind: "TEXT", playheadSeconds: 0});
    if (clip.source.type !== "NATIVE_TEXT") throw new Error("Expected text");
    clip.source.style.fontAssetId = identifier; clip.source.style.fontFamily = font.family;
    if (track) document.tracks.push(track); document.clips.push(clip); document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  }
  const contract = buildCompositionConformanceContract({ document, documentHash: hashCompositionDocument(document),
    assets: [{ id: identifier, checksum: asset.checksum }], renderProfile: { format: "mp4", fps: 25, quality: "high", resolution: "1080p" },
  });
  const source = await buildConformanceReferenceSource({ document, contract, assets: [asset],
    ...(nativeFont ? {fontManifest: [font], fontAssets: new Map<string, CompositionCompiledFont>([[identifier,
      {assetId: identifier, family: font.family, format: "woff2", sourceUrl: conformanceFontPath(font)}]])} : {}) });
  const zip = new JSZip(); zip.file("conformance-preview.html", source.previewHtml);
  zip.file("conformance-reference.json", JSON.stringify(source.metadata)); zip.file("composition-document.json", source.documentJson);
  zip.file("conformance-contract.json", source.contractJson); zip.file("font-manifest.json", JSON.stringify(nativeFont ? [font] : []));
  if (nativeFont) zip.file(conformanceFontPath(font), fontBytes);
  const archiveBytes = await zip.generateAsync({ type: "nodebuffer" });
  return { zip, archiveBytes, expectedProjectHash: sha256(archiveBytes), organizationId: identifier, revisionId: identifier };
}
async function withParent(run: (directory: string) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), "materialization-test-"));
  try { await run(parent); } finally { await rmdir(parent); }
}

test("materializes pinned bytes into owned workspace and emits no signed URLs; cleanup preserves parent", async () => {
  const input = await fixture();
  await withParent(async (parent) => {
    const result = await materializeConformanceReference({ ...input, outputParentDirectory: parent,
      readAsset: async (binding) => { assert.equal(binding.assetId, identifier); return new Response(content); },
    });
    assert.deepEqual(await readFile(join(result.directory, `conformance-media/${identifier}`)), content);
    assert.equal(result.receipt.status, "MATERIALIZED_NOT_CAPTURED");
    assert.equal(result.receipt.projectHash, input.expectedProjectHash);
    assert.ok(!(await readFile(join(result.directory, "materialization.json"), "utf8")).includes("token"));
    await result.cleanup(); assert.deepEqual(await readdir(parent), []);
  });
});

test("archive mismatch and altered source fail before requesting any asset", async () => {
  const input = await fixture();
  await withParent(async (parent) => {
    const readAsset = async () => assert.fail("must not download");
    await assert.rejects(materializeConformanceReference({ ...input, expectedProjectHash: "a".repeat(64), outputParentDirectory: parent, readAsset }), /ARCHIVE_MISMATCH/);
    input.zip.file("conformance-preview.html", "altered");
    const archiveBytes = await input.zip.generateAsync({ type: "nodebuffer" });
    await assert.rejects(materializeConformanceReference({ ...input, archiveBytes, expectedProjectHash: sha256(archiveBytes), outputParentDirectory: parent, readAsset }), /BYTES_MISMATCH/);
    assert.deepEqual(await readdir(parent), []);
  });
});

test("wrong checksum, truncation and oversize clean all partial files", async () => {
  const input = await fixture();
  for (const bytes of [Buffer.alloc(content.length, 1), Buffer.alloc(1), Buffer.alloc(content.length + 1)]) {
    await withParent(async (parent) => {
      await assert.rejects(materializeConformanceReference({ ...input, outputParentDirectory: parent, readAsset: async () => new Response(bytes) }), /MEDIA_(SIZE_)?MISMATCH/);
      assert.deepEqual(await readdir(parent), []);
    });
  }
});

test("partial HTTP bodies, wrong declared lengths and network failures cannot leave ready workspace", async () => {
  const input = await fixture();
  for (const response of [new Response(content, { status: 206 }), new Response(content, { headers: { "content-length": "1" } }),
    new Response(content, { headers: { "content-type": "text/html" } }),
    new Response(content, { headers: { "content-range": "bytes 0-1/2" } })]) {
    await withParent(async (parent) => {
      await assert.rejects(materializeConformanceReference({ ...input, outputParentDirectory: parent, readAsset: async () => response }), /RESPONSE_INVALID/);
      assert.deepEqual(await readdir(parent), []);
    });
  }
  await withParent(async (parent) => {
    await assert.rejects(materializeConformanceReference({ ...input, outputParentDirectory: parent, readAsset: async () => { throw new Error("controlled failure"); } }), /controlled failure/);
    assert.deepEqual(await readdir(parent), []);
  });
});

test("packaged fonts require matching hash and size; invalid font bytes abort before assets", async () => {
  const input = await fixture(); const fontBytes = Buffer.from("controlled font bytes"); const checksumSha256 = sha256(fontBytes);
  input.zip.file("font-manifest.json", JSON.stringify([{ checksumSha256, family: "Controlled Font", fileSizeBytes: fontBytes.length,
    fontAssetId: identifier, mimeType: "font/woff2" }]));
  const fontPath = `assets/fonts/${checksumSha256}.woff2`; input.zip.file(fontPath, fontBytes);
  let archiveBytes = await input.zip.generateAsync({ type: "nodebuffer" });
  await withParent(async (parent) => {
    const result = await materializeConformanceReference({ ...input, archiveBytes, expectedProjectHash: sha256(archiveBytes), outputParentDirectory: parent,
      readAsset: async () => new Response(content),
    });
    assert.deepEqual(await readFile(join(result.directory, fontPath)), fontBytes); await result.cleanup();
    input.zip.file(fontPath, Buffer.alloc(fontBytes.length, 1)); archiveBytes = await input.zip.generateAsync({ type: "nodebuffer" });
    await assert.rejects(materializeConformanceReference({ ...input, archiveBytes, expectedProjectHash: sha256(archiveBytes), outputParentDirectory: parent,
      readAsset: async () => assert.fail("assets must not download"),
    }), /FONT_MISMATCH/);
    assert.deepEqual(await readdir(parent), []);
  });
});

test("native packaged font bindings are required even when an altered archive has a valid authorized checksum", async () => {
  const input = await fixture(true);
  const originalManifest = JSON.parse(await input.zip.file("font-manifest.json")!.async("string"));
  await withParent(async (parent) => {
    const materialized = await materializeConformanceReference({...input, outputParentDirectory: parent, readAsset: async () => new Response(content)});
    assert.deepEqual(JSON.parse(await readFile(join(materialized.directory, "font-manifest.json"), "utf8")), originalManifest);
    await materialized.cleanup();
    for (const manifest of [[], [{...originalManifest[0], family: "Wrong Font"}], [originalManifest[0], originalManifest[0]],
      [{...originalManifest[0], checksumSha256: "b".repeat(64)}]]) {
      input.zip.file("font-manifest.json", JSON.stringify(manifest));
      const archiveBytes = await input.zip.generateAsync({type: "nodebuffer"});
      await assert.rejects(materializeConformanceReference({...input, archiveBytes, expectedProjectHash: sha256(archiveBytes),
        outputParentDirectory: parent, readAsset: async () => assert.fail("must not download assets")}), /FONT_.*(?:MISMATCH|DUPLICATE)/);
      assert.deepEqual(await readdir(parent), []);
    }
  });
});

test("signed URL policy rejects foreign origins, redirects targets, credentials and unsafe buckets/paths", () => {
  const project = "https://example.supabase.co"; const path = "media/source.mp4";
  const url = `${project}/storage/v1/object/sign/production-assets/${path}?token=temporary`;
  assert.doesNotThrow(() => assertConformanceStorageUrl(url, project, "production-assets", path));
  for (const invalid of [url.replace("example.supabase.co", "attacker.invalid"), url.replace("source.mp4", "other.mp4"),
    url.replace("https://", "https://user:password@"), url.replace("?token=temporary", "")]) {
    assert.throws(() => assertConformanceStorageUrl(invalid, project, "production-assets", path));
  }
  assert.throws(() => assertConformanceStorageUrl(url, project, "private-secrets", path));
  assert.throws(() => assertConformanceStorageUrl(url, project, "production-assets", "../escape"));
});

test("scoped adapter reads exact archive and assets without redirects; rejects cross-tenant response", async () => {
  const input = await fixture();
  const revision = { id: identifier, organization_id: identifier, composition_id: identifier, project_hash: input.expectedProjectHash,
    project_archive_size_bytes: input.archiveBytes.length, project_storage_bucket: "production-assets",
    project_storage_path: `composition-snapshots/${identifier}/${identifier}/${input.expectedProjectHash}.zip`, manifest: { conformance_reference_version: 1 } };
  const filters: Array<[string, unknown]> = [];
  const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
    maybeSingle: async () => ({ data: revision, error: null }) };
  const supabase = { from: () => query, storage: { from: (bucket: string) => ({
    createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=temporary` }, error: null }),
  }) } };
  await withParent(async (parent) => {
    const readSignals: AbortSignal[] = [];
    const result = await materializeAuthorizedConformanceRevision({ supabase: supabase as never, supabaseUrl: "https://example.supabase.co",
      organizationId: identifier, revisionId: identifier, outputParentDirectory: parent,
      fetchImpl: (async (url, options) => {
        assert.equal(options?.redirect, "error"); assert.ok(options?.signal);
        readSignals.push(options!.signal as AbortSignal);
        return new Response(Uint8Array.from(String(url).includes(".zip?") ? input.archiveBytes : content));
      }) as typeof fetch,
    });
    assert.deepEqual(filters, [["id", identifier], ["organization_id", identifier]]);
    assert.ok(readSignals.length >= 2); assert.ok(readSignals.every(signal => signal === readSignals[0]));
    await result.cleanup();
    const cancellation = new AbortController(); let streamCancelled = false, receivedSignal: AbortSignal | undefined;
    const reading = materializeAuthorizedConformanceRevision({supabase: supabase as never, supabaseUrl: "https://example.supabase.co",
      organizationId: identifier, revisionId: identifier, outputParentDirectory: parent, signal: cancellation.signal,
      fetchImpl: (async (_url, options) => {
        receivedSignal = options!.signal as AbortSignal;
        const body = new ReadableStream({start() {queueMicrotask(() => cancellation.abort("private token"));},
          cancel() {streamCancelled = true;}});
        return new Response(body);
      }) as typeof fetch});
    await assert.rejects(reading, error => error instanceof Error && error.message === "CONFORMANCE_JOB_EXECUTION_CANCELLED");
    assert.equal(streamCancelled, true); assert.equal(receivedSignal!.aborted, true);
    assert.equal((receivedSignal!.reason as Error).message, "CONFORMANCE_JOB_EXECUTION_CANCELLED");
    assert.deepEqual(await readdir(parent), []);
    revision.organization_id = "80000000-0000-4000-8000-000000000001";
    await assert.rejects(materializeAuthorizedConformanceRevision({ supabase: supabase as never, supabaseUrl: "https://example.supabase.co",
      organizationId: identifier, revisionId: identifier, outputParentDirectory: parent,
      fetchImpl: (async () => assert.fail("must not fetch")) as typeof fetch,
    }), /REVISION_MISMATCH/);
  });
});

test("pre-aborted materialization does not read assets or create a workspace", async () => {
  const input = await fixture(), cancellation = new AbortController(); cancellation.abort("private reason");
  await withParent(async parent => {
    await assert.rejects(materializeConformanceReference({...input, outputParentDirectory: parent, signal: cancellation.signal,
      readAsset: async () => assert.fail("must not read asset")}), /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
    assert.deepEqual(await readdir(parent), []);
  });
});

test("abort after asset response cancels its body and removes only owned materialization files", async () => {
  const input = await fixture(), cancellation = new AbortController(); let bodyCancelled = false;
  await withParent(async parent => {
    await assert.rejects(materializeConformanceReference({...input, outputParentDirectory: parent, signal: cancellation.signal,
      readAsset: async () => {
        const response = new Response(new ReadableStream({cancel() {bodyCancelled = true;}}));
        cancellation.abort("private reason"); return response;
      }}), /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
    assert.equal(bodyCancelled, true); assert.deepEqual(await readdir(parent), []);
  });
});

test("abort during a stalled asset stream interrupts pipeline and cleans its partial file", async () => {
  const input = await fixture(), cancellation = new AbortController(); let bodyCancelled = false;
  await withParent(async parent => {
    await assert.rejects(materializeConformanceReference({...input, outputParentDirectory: parent, signal: cancellation.signal,
      readAsset: async () => new Response(new ReadableStream({
        pull() {setTimeout(() => cancellation.abort("private token"), 10);},
        cancel() {bodyCancelled = true;},
      }))}), /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
    assert.equal(bodyCancelled, true); assert.deepEqual(await readdir(parent), []);
  });
});
