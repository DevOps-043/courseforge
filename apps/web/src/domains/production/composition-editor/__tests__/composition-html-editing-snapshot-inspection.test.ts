import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import JSZip from "jszip";
import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as uuid,
  htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { freezeCompositionHtmlEditingSnapshot } from "../composition-html-editing-snapshot-bundle.server";
import { inspectHtmlSnapshotArchive, type HtmlSnapshotInspectionIdentity } from "../composition-html-editing-snapshot-inspection.server";
import { HTML_SNAPSHOT_ZIP_POLICY, readHtmlSnapshotZipMember } from "../composition-html-editing-snapshot-zip.server";

const path = "html-editing-revisions.json";
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture(kind: "current" | "v1" | "old" = "current", streamed = false) {
  const input = createHtmlEditingRevisionFixture();
  const native = bindHtmlEditingRevisionToComposition({ ...input.authority, document: input.document,
    revision: input.next.revision, revisionSha256: input.next.sha256 });
  const frozen = freezeCompositionHtmlEditingSnapshot({ document: native.document, context: {
    organizationId: uuid, documentId: uuid, documentHash: native.documentHash,
    revisions: [{ ...input.authority, encodedRevision: JSON.stringify(input.next.revision) }],
  } });
  const stored = JSON.parse(frozen.encodedBundle);
  if (kind === "v1") { delete stored.compilation; stored.schemaVersion = 1; stored.format = "courseforge-html-editable-snapshot-bundle-v1"; }
  if (kind === "old") stored.compilation.profile.geometryVersion = "historical-geometry";
  const encodedBundle = JSON.stringify(stored), zip = new JSZip();
  zip.file(path, encodedBundle); zip.file("preview.html", "<script>throw new Error('must not execute')</script>");
  zip.file("assets/font.woff2", "unselected bytes");
  const archiveBytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", streamFiles: streamed });
  return { archiveBytes, identity: { organizationId: uuid, documentId: uuid, documentHash: native.documentHash,
    archiveBytes: archiveBytes.length, projectHash: digest(archiveBytes), bundlePin: { path: path as typeof path, sha256: digest(encodedBundle) } }, encodedBundle };
}
const read = (archiveBytes: Buffer, maximumBytes = 1024) => readHtmlSnapshotZipMember({ archiveBytes, path: "safe.txt", maximumBytes });
async function zipBytes(entries: Array<[string, string]>, streamed = false) {
  const zip = new JSZip(); for (const [name, content] of entries) zip.file(name, content, { createFolders: false });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", streamFiles: streamed });
}
function positions(bytes: Buffer) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  return { end, central: bytes.readUInt32LE(end + 16) };
}

test("archive inspection classifies current, V1 and old profiles without restore or execution", async () => {
  for (const kind of ["current", "v1", "old"] as const) for (const streamed of [false, true]) {
    const input = await fixture(kind, streamed), original = Buffer.from(input.archiveBytes);
    const result = await inspectHtmlSnapshotArchive(input);
    assert.equal(result.scope, "INSPECTED_ARCHIVE_CONTENT_NOT_AUTHORIZATION_OR_EXECUTION");
    assert.equal(result.diagnostic.status, kind === "current" ? "CURRENT_PROFILE_REQUIRES_CONTENT_AND_AUTHORITY_CHECKS"
      : kind === "v1" ? "LEGACY_V1_REQUIRES_REVIEW" : "PROFILE_MISMATCH_REQUIRES_REVIEW");
    assert.equal(result.bundle.encodedBundle, input.encodedBundle); assert.deepEqual(input.archiveBytes, original);
    assert.equal("authorities" in result || "publishedRevisionId" in result, false);
  }
});

test("independent archive length/hash and bundle hash are mandatory, scope is not inferred from bytes", async () => {
  const input = await fixture("v1");
  for (const change of [{ projectHash: "f".repeat(64) }, { archiveBytes: input.archiveBytes.length + 1 },
    { bundlePin: { path, sha256: "f".repeat(64) } }, { bundlePin: { path: "preview.html", sha256: "f".repeat(64) } }]) {
    await assert.rejects(inspectHtmlSnapshotArchive({ ...input, identity: { ...input.identity, ...change } as HtmlSnapshotInspectionIdentity }), /INSPECTION_UNAVAILABLE/);
  }
  const swapped = await inspectHtmlSnapshotArchive({ ...input, identity: { ...input.identity, organizationId: other } });
  assert.equal(swapped.diagnostic.status, "REJECTED");
  assert.equal(swapped.diagnostic.reason, "SCOPE_MISMATCH");
});

test("ZIP namespace rejects duplicate, traversal, backslash, absolute, alias and file-parent entries", async () => {
  for (const name of ["../safe.txt", "/safe.txt", "a/../safe.txt", "a\\safe.txt", "a//safe.txt", "./safe.txt", "C:safe.txt"]) {
    await assert.rejects(read(await zipBytes([["safe.txt", "okay"], [name, "unsafe"]])), /ZIP_INVALID/);
  }
  await assert.rejects(read(await zipBytes([["safe.txt", "okay"], ["parent", "file"], ["parent/child", "file"]])), /ZIP_INVALID/);
  const duplicate = await zipBytes([["safe.txt", "first"], ["evil.txt", "second"]]);
  for (let at = duplicate.indexOf("evil.txt"); at !== -1; at = duplicate.indexOf("evil.txt", at + 8)) duplicate.write("safe.txt", at);
  await assert.rejects(read(duplicate), /ZIP_INVALID/);
});

test("ZIP budgets and exact central/local ranges reject truncated, split, ZIP64, encrypted and overlap inputs", async () => {
  const original = await zipBytes([["safe.txt", "okay"]]);
  const { end, central } = positions(original);
  for (const mutate of [
    (bytes: Buffer) => bytes.writeUInt16LE(1, end + 4),
    (bytes: Buffer) => bytes.writeUInt16LE(0xffff, end + 10),
    (bytes: Buffer) => bytes.writeUInt32LE(0xffffffff, central + 24),
    (bytes: Buffer) => bytes.writeUInt16LE(1, central + 8),
    (bytes: Buffer) => bytes.writeUInt16LE(9, central + 10),
    (bytes: Buffer) => bytes.writeUInt32LE(1, central + 42),
    (bytes: Buffer) => bytes.writeUInt32LE(central + 1, end + 16),
    (bytes: Buffer) => bytes.writeUInt32LE(HTML_SNAPSHOT_ZIP_POLICY.maximumDeclaredBytes + 1, central + 24),
  ]) {
    const bytes = Buffer.from(original); mutate(bytes); await assert.rejects(read(bytes), /ZIP_INVALID/);
  }
  await assert.rejects(read(original.subarray(0, original.length - 1)), /ZIP_INVALID/);
  await assert.rejects(read(Buffer.concat([original, Buffer.from("trailing")])), /ZIP_INVALID/);
  const many = await zipBytes(Array.from({ length: HTML_SNAPSHOT_ZIP_POLICY.maximumEntries + 1 }, (_, index) => [`${index}`, ""]));
  await assert.rejects(read(many), /ZIP_INVALID/);
});

test("bounded decompression rejects declared oversize and malicious underreported expanded size", async () => {
  const original = await zipBytes([["safe.txt", "a".repeat(128 * 1024)]]);
  await assert.rejects(read(original, 127 * 1024), /ZIP_INVALID/);
  const bytes = Buffer.from(original), { central } = positions(bytes);
  bytes.writeUInt32LE(1, central + 24); bytes.writeUInt32LE(1, 22);
  await assert.rejects(read(bytes, 1024), /ZIP_INVALID/);
});

test("ZIP reader rejects symlink metadata and accepts ordinary UNIX files without filesystem extraction", async () => {
  for (const symlink of [false, true]) {
    const zip = new JSZip(); zip.file("safe.txt", "okay", { unixPermissions: symlink ? 0o120777 : 0o100644 });
    const bytes = await zip.generateAsync({ type: "nodebuffer", platform: "UNIX" });
    if (symlink) await assert.rejects(read(bytes), /ZIP_INVALID/);
    else assert.equal((await read(bytes)).toString(), "okay");
  }
});

test("local name, sizes and streamed descriptors cannot contradict the directory", async () => {
  for (const streamed of [false, true]) {
    const original = await zipBytes([["safe.txt", "okay"]], streamed), { central } = positions(original);
    const renamed = Buffer.from(original); renamed.write("evil.txt", 30);
    await assert.rejects(read(renamed), /ZIP_INVALID/);
    const sizes = Buffer.from(original); sizes.writeUInt32LE(99, 22);
    await assert.rejects(read(sizes), /ZIP_INVALID/);
    if (streamed) {
      const descriptor = central - 16, damaged = Buffer.from(original); damaged.writeUInt32LE(99, descriptor + 12);
      await assert.rejects(read(damaged), /ZIP_INVALID/);
      assert.equal((await read(original)).toString(), "okay");
    }
  }
});

test("inspection rejects non-UTF8 bundle bytes and preserves cancellation without exposing content", async () => {
  const input = await fixture(), zip = new JSZip(), malformed = Buffer.from([0xc3, 0x28]); zip.file(path, malformed);
  const archiveBytes = await zip.generateAsync({ type: "nodebuffer" });
  await assert.rejects(inspectHtmlSnapshotArchive({ identity: { ...input.identity,
    archiveBytes: archiveBytes.length, projectHash: digest(archiveBytes), bundlePin: { path, sha256: digest(malformed) } }, archiveBytes }), /INSPECTION_UNAVAILABLE/);
  const controller = new AbortController(); controller.abort(new Error("INSPECTION_CANCELLED"));
  await assert.rejects(inspectHtmlSnapshotArchive({ ...input, signal: controller.signal }), /INSPECTION_CANCELLED/);
});
