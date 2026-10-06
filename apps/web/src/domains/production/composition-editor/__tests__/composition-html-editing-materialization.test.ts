import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import test from "node:test";
import { createHtmlEditingReferenceFixture } from "./composition-html-editing-reference-fixtures";
import { htmlEditingFixtureId as uuid } from "./composition-html-editing-test-fixtures";
import { buildConformanceReferenceSource } from "../composition-conformance-reference.service";
import { writeConformanceReferenceArchive } from "../composition-conformance-reference-archive.server";
import { HTML_EDITING_SNAPSHOT_BUNDLE_POLICY } from "../composition-html-editing-snapshot-bundle.server";
import { materializeConformanceReference } from "../qa/composition-conformance-materialization";
import { materializeControlledRenderRevision } from "../qa/composition-controlled-render-materialization";
import { readCompositionAnimationRuntime } from "../composition-preview-compiler.service";
import { controlledRenderExecutionContractSchema } from "../composition-render-execution-contract";
import { createMaterializedControlledRenderer } from "../qa/composition-materialized-supervisor-renderer";

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
async function fixture(controlled = false) {
  const reference = createHtmlEditingReferenceFixture();
  const media = Buffer.from("pinned HTML reference media fixture");
  reference.params.assets.forEach(asset => { asset.checksum = sha256(media); asset.fileSizeBytes = media.length; });
  reference.params.contract.assets.forEach(asset => { asset.checksum = sha256(media); });
  if (controlled) {
    assert.ok(reference.params.contract.schemaVersion === 4);
    reference.params.contract.renderExecution = controlledRenderExecutionContractSchema.parse({
      policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1", backend: "CONTROLLED", sdkVersion: "0.7.106",
      expectedBrowser: { protocolVersion: "1.3", product: "Chrome/test", revision: "test", userAgent: "test", jsVersion: "test" },
      files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"]
        .map(role => [role, { sha256: "a".repeat(64), sizeBytes: 10 }])),
    });
  }
  const source = await buildConformanceReferenceSource(reference.params);
  const zip = new JSZip(); writeConformanceReferenceArchive(zip, source);
  zip.file("font-manifest.json", "[]");
  return { reference, media, source, zip };
}

async function controlledInput(parent: string) {
  const f = await fixture(true);
  const archiveBytes = await f.zip.generateAsync({ type: "nodebuffer" });
  const projectHash = sha256(archiveBytes);
  const row = { id: uuid, organization_id: uuid, composition_id: uuid, project_hash: projectHash,
    project_archive_size_bytes: archiveBytes.length, project_storage_bucket: "production-assets",
    project_storage_path: `composition-snapshots/${uuid}/${uuid}/${projectHash}.zip`, manifest: { conformance_reference_version: 1 } };
  const supabase = { from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row, error: null }) }; return query;
  }, storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string) => ({ error: null,
    data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=ephemeral` } }) }) } };
  let granted = true;
  let authorityReads = 0;
  const input = { supabase: supabase as never, supabaseUrl: "https://example.supabase.co", organizationId: uuid, revisionId: uuid,
    outputParentDirectory: parent, expected: { projectHash, documentHash: f.reference.native.documentHash, contract: f.reference.contract },
    animationRuntimeSha256: sha256(await readCompositionAnimationRuntime()),
    readHtmlEditingAuthority: async (request: { organizationId: string; revisionId: string; documentHash: string }) => {
      authorityReads++;
      assert.equal(request.organizationId, uuid); assert.equal(request.revisionId, uuid);
      assert.equal(request.documentHash, f.reference.native.documentHash);
      return { scope: { organizationId: uuid, documentId: uuid }, imageAssets: f.reference.params.assets
        .filter(asset => asset.mimeType === "image/png").map(asset => ({...asset, mimeType: "image/png" as const})), authorities: [
        { ...f.reference.input.authority, grantedAssetIds: granted ? f.reference.input.authority.grantedAssetIds : [] },
      ] };
    },
    fetchImpl: (async (raw: string | URL | Request, options: RequestInit) => {
      assert.equal(options.redirect, "error");
      const archive = String(raw).includes(".zip?");
      const image = String(raw).includes("image.png?");
      return new Response(new Uint8Array(archive ? archiveBytes : f.media).buffer,
        { headers: { "content-type": archive ? "application/zip" : image ? "image/png" : "video/mp4" } });
    }) as typeof fetch,
  };
  return { input, bundle: f.reference.bundle, revoke: () => { granted = false; }, reads: () => authorityReads };
}
async function withParent(run: (directory: string) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), "html-materialization-test-"));
  try { await run(parent); } finally { await rmdir(parent); }
}
async function input(zip: JSZip, parent: string) {
  const archiveBytes = await zip.generateAsync({ type: "nodebuffer" });
  return { archiveBytes, expectedProjectHash: sha256(archiveBytes), organizationId: uuid,
    revisionId: uuid, outputParentDirectory: parent };
}

test("materializer preserves exact frozen bundle and native source without claiming execution authority", async () => {
  const { zip, reference, media } = await fixture();
  await withParent(async parent => {
    const result = await materializeConformanceReference({ ...await input(zip, parent), readAsset: async () => new Response(media) });
    try {
      const bytes = await readFile(join(result.directory, reference.bundle.archivePath));
      assert.deepEqual(bytes, Buffer.from(reference.bundle.encodedBundle));
      assert.equal(sha256(bytes), reference.bundle.sha256);
      const document = JSON.parse(await readFile(join(result.directory, "composition-document.json"), "utf8"));
      assert.match(document.clips[0].source.html, /Original/);
      assert.match(await readFile(result.previewPath, "utf8"), />Changed</);
      assert.equal(result.receipt.documentHash, reference.native.documentHash);
      assert.equal(result.receipt.status, "MATERIALIZED_NOT_CAPTURED");
    } finally { await result.cleanup(); }
    assert.deepEqual(await readdir(parent), []);
  });
});

test("missing, altered and unpinned HTML packages reject before creating files or reading media", async () => {
  for (const mutation of ["missing", "altered", "unpinned"] as const) {
    const { zip, reference, source } = await fixture();
    if (mutation === "missing") zip.remove(reference.bundle.archivePath);
    if (mutation === "altered") zip.file(reference.bundle.archivePath, reference.bundle.encodedBundle + " ");
    if (mutation === "unpinned") {
      delete source.metadata.htmlEditingSnapshot;
      zip.file("conformance-reference.json", JSON.stringify(source.metadata));
    }
    await withParent(async parent => {
      await assert.rejects(materializeConformanceReference({ ...await input(zip, parent),
        readAsset: async () => assert.fail("must not download") }), /ENTRY_INVALID|HTML_BYTES_MISMATCH|HTML_PIN_REQUIRED/);
      assert.deepEqual(await readdir(parent), []);
    });
  }
});

test("HTML organization is checked against independently authorized materialization scope", async () => {
  const { zip } = await fixture();
  await withParent(async parent => {
    await assert.rejects(materializeConformanceReference({ ...await input(zip, parent),
      organizationId: "22222222-2222-4222-8222-222222222222",
      readAsset: async () => assert.fail("must not download") }), /HTML_SCOPE_MISMATCH/);
    assert.deepEqual(await readdir(parent), []);
  });
});

test("HTML decompression is bounded before parsing even with a checksum-consistent archive", async () => {
  const { zip, source, reference } = await fixture();
  const oversized = " ".repeat(HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes + 1);
  zip.file(reference.bundle.archivePath, oversized);
  source.metadata.htmlEditingSnapshot!.sha256 = sha256(oversized);
  zip.file("conformance-reference.json", JSON.stringify(source.metadata));
  await withParent(async parent => {
    await assert.rejects(materializeConformanceReference({ ...await input(zip, parent),
      readAsset: async () => assert.fail("must not download") }), /ENTRY_TOO_LARGE/);
    assert.deepEqual(await readdir(parent), []);
  });
});

test("invalid UTF-8 cannot become different persisted bytes even if the raw checksum matches", async () => {
  const { zip, source, reference } = await fixture();
  const malformed = Buffer.concat([Buffer.from(reference.bundle.encodedBundle), Buffer.from([0xff])]);
  zip.file(reference.bundle.archivePath, malformed);
  source.metadata.htmlEditingSnapshot!.sha256 = sha256(malformed);
  zip.file("conformance-reference.json", JSON.stringify(source.metadata));
  await withParent(async parent => {
    await assert.rejects(materializeConformanceReference({ ...await input(zip, parent),
      readAsset: async () => assert.fail("must not download") }), /HTML_BYTES_MISMATCH/);
    assert.deepEqual(await readdir(parent), []);
  });
});

test("media integrity failure removes extracted HTML bundle together with partial workspace", async () => {
  const { zip, media } = await fixture();
  await withParent(async parent => {
    await assert.rejects(materializeConformanceReference({ ...await input(zip, parent),
      readAsset: async () => new Response(Buffer.alloc(media.length, 1)) }), /MEDIA_MISMATCH/);
    assert.deepEqual(await readdir(parent), []);
  });
});

test("controlled HTML entry compiles frozen edit with fresh host authority and pins package bytes", async () => {
  await withParent(async parent => {
    const f = await controlledInput(parent);
    const result = await materializeControlledRenderRevision(f.input);
    try {
      assert.match(await readFile(result.entryPath, "utf8"), />Changed</);
      assert.equal(result.receipt.documentHash, f.input.expected.documentHash);
      assert.equal(result.receipt.files.find(file => file.path === f.bundle.archivePath)?.sha256, f.bundle.sha256);
      assert.ok(f.reads() >= 2, "authority must be refreshed before handing out a compiled entry");
      await result.assertUnchanged();
      f.revoke();
      await assert.rejects(result.assertUnchanged(), /INVALID_BUNDLE/);
    } finally { await result.cleanup(); }
    assert.deepEqual(await readdir(parent), []);
  });
});

test("controlled HTML cannot execute with archived permission claims or a missing host resolver", async () => {
  await withParent(async parent => {
    const f = await controlledInput(parent);
    await assert.rejects(materializeControlledRenderRevision({ ...f.input, readHtmlEditingAuthority: undefined }), /HTML_AUTHORITY_REQUIRED/);
    assert.deepEqual(await readdir(parent), []);
    f.revoke();
    await assert.rejects(materializeControlledRenderRevision(f.input), /INVALID_BUNDLE/);
    assert.deepEqual(await readdir(parent), []);
  });
});

test("controlled HTML rejects independent authority from a different organization or document", async () => {
  await withParent(async parent => {
    const f = await controlledInput(parent);
    for (const scope of [{ organizationId: "22222222-2222-4222-8222-222222222222", documentId: uuid },
      { organizationId: uuid, documentId: "22222222-2222-4222-8222-222222222222" }]) {
      await assert.rejects(materializeControlledRenderRevision({ ...f.input, readHtmlEditingAuthority: async request => {
        const authority = await f.input.readHtmlEditingAuthority(request); return { ...authority, scope };
      } }), /AUTHORITY_SCOPE_MISMATCH|SCOPE_MISMATCH/);
      assert.deepEqual(await readdir(parent), []);
    }
  });
});

test("controlled recheck detects changed frozen package even when compiled entry is unchanged", async () => {
  await withParent(async parent => {
    const f = await controlledInput(parent);
    const result = await materializeControlledRenderRevision(f.input);
    try {
      await writeFile(join(result.directory, f.bundle.archivePath), f.bundle.encodedBundle + " ");
      await assert.rejects(result.assertUnchanged(), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
    } finally { await result.cleanup(); }
    assert.deepEqual(await readdir(parent), []);
  });
});

test("supervisor adapter withholds a simulated result when image permission is revoked during execution", async () => {
  await withParent(async parent => {
    const f = await controlledInput(parent);
    let executed = false;
    const renderer = createMaterializedControlledRenderer({ storage: f.input, execute: async (descriptor, workspace) => {
      executed = true;
      assert.match(await readFile(workspace.entryPath, "utf8"), />Changed</);
      f.revoke();
      return { videoPath: join(parent, "external-output.mp4"), artifacts: { kind: "SINGLE_CONTRACT", input: {
        contract: descriptor.contract, documentHash: descriptor.documentHash, videoSha256: "d".repeat(64), observation: {},
      } } };
    } });
    await assert.rejects(renderer({ ...f.input.expected, organizationId: uuid, revisionId: uuid, executionId: uuid }), /INVALID_BUNDLE/);
    assert.equal(executed, true);
    assert.deepEqual(await readdir(parent), []);
  });
});

test("independent template binding drift cannot authorize frozen HTML merely because bytes remain valid", async () => {
  await withParent(async parent => {
    const f = await controlledInput(parent);
    await assert.rejects(materializeControlledRenderRevision({ ...f.input, readHtmlEditingAuthority: async request => {
      const authority = await f.input.readHtmlEditingAuthority(request);
      authority.authorities[0]!.authoritativeBinding = { ...authority.authorities[0]!.authoritativeBinding,
        templateVersion: authority.authorities[0]!.authoritativeBinding.templateVersion + 1 };
      return authority;
    } }), /INVALID_BUNDLE/);
    assert.deepEqual(await readdir(parent), []);
  });
});

test("current image checksum drift rejects compilation even when UUID remains granted and local bytes are intact", async () => {
  await withParent(async parent => {
    const f = await controlledInput(parent);
    await assert.rejects(materializeControlledRenderRevision({...f.input, readHtmlEditingAuthority: async request => {
      const authority = await f.input.readHtmlEditingAuthority(request);
      authority.imageAssets[0]!.checksum = "f".repeat(64);
      return authority;
    }}), /IMAGE_IDENTITY_MISMATCH/);
    assert.deepEqual(await readdir(parent), []);
  });
});

test("post-execution image record substitution withholds a result without relying on revoked UUID grants", async () => {
  await withParent(async parent => {
    const f = await controlledInput(parent);
    let changed = false;
    const renderer = createMaterializedControlledRenderer({ storage: {...f.input, readHtmlEditingAuthority: async request => {
      const authority = await f.input.readHtmlEditingAuthority(request);
      if (changed) authority.imageAssets[0]!.storagePath = "html/substituted.png";
      return authority;
    }}, execute: async descriptor => {
      changed = true;
      return {videoPath: join(parent, "external-output.mp4"), artifacts: {kind: "SINGLE_CONTRACT", input: {
        contract: descriptor.contract, documentHash: descriptor.documentHash, videoSha256: "d".repeat(64), observation: {},
      }}};
    }});
    await assert.rejects(renderer({...f.input.expected, organizationId: uuid, revisionId: uuid, executionId: uuid}), /IMAGE_IDENTITY_MISMATCH/);
    assert.deepEqual(await readdir(parent), []);
  });
});
