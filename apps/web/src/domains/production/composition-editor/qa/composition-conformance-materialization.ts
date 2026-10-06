import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import { z } from "zod";
import { HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES } from "../../hyperframes/hyperframes.types";
import { CONFORMANCE_REFERENCE_ARCHIVE_PATHS, conformanceReferenceSourceSchema, verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { HTML_EDITING_SNAPSHOT_BUNDLE_POLICY, verifyCompositionHtmlEditingSnapshotContent,
  type HtmlEditingFrozenSnapshotBundle } from "../composition-html-editing-snapshot-bundle.server";
import { conformanceFontPath, CONFORMANCE_FONT_BINDING_LIMITS } from "../composition-conformance-font-bindings";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";

export const CONFORMANCE_MATERIALIZATION_LIMITS = {
  metadataBytes: 1024 * 1024, sourceFileBytes: 20 * 1024 * 1024, fontBytes: CONFORMANCE_FONT_BINDING_LIMITS.maximumFontBytes,
  extractedBytes: 256 * 1024 * 1024, mediaBytes: 2 * 1024 * 1024 * 1024, entries: 1024,
} as const;
type Binding = ReturnType<typeof verifyConformanceReferenceSource>["metadata"]["bindings"][number];

async function zipBytes(archive: JSZip, path: string, maximumBytes: number, signal?: AbortSignal): Promise<Buffer> {
  assertConformanceJobActive(signal);
  const entry = archive.file(path);
  if (!entry || entry.unsafeOriginalName !== undefined && entry.unsafeOriginalName !== path) {
    throw new Error("CONFORMANCE_MATERIALIZATION_ENTRY_INVALID");
  }
  const chunks: Buffer[] = []; let bytes = 0;
  try {await pipeline(entry.nodeStream("nodebuffer"), new Writable({
    write(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximumBytes) return callback(new Error("CONFORMANCE_MATERIALIZATION_ENTRY_TOO_LARGE"));
      chunks.push(chunk); callback();
    },
  }), {signal});} catch (error) {assertConformanceJobActive(signal); throw error;}
  assertConformanceJobActive(signal);
  return Buffer.concat(chunks);
}

/** Caller supplies a revision-authorized project hash and a trusted, scoped Storage reader. */
export async function materializeConformanceReference(params: {
  archiveBytes: Buffer; expectedProjectHash: string; organizationId: string; revisionId: string;
  outputParentDirectory: string; readAsset: (binding: Binding) => Promise<Response>;
  signal?: AbortSignal;
}) {
  assertConformanceJobActive(params.signal);
  z.string().uuid().parse(params.organizationId); z.string().uuid().parse(params.revisionId);
  if (!/^[a-f0-9]{64}$/.test(params.expectedProjectHash) || params.archiveBytes.length > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES
    || createHash("sha256").update(params.archiveBytes).digest("hex") !== params.expectedProjectHash) {
    throw new Error("CONFORMANCE_MATERIALIZATION_ARCHIVE_MISMATCH");
  }
  const archive = await JSZip.loadAsync(params.archiveBytes);
  assertConformanceJobActive(params.signal);
  if (Object.keys(archive.files).length > CONFORMANCE_MATERIALIZATION_LIMITS.entries) throw new Error("CONFORMANCE_MATERIALIZATION_ENTRY_LIMIT");
  const text = async (path: string, maximum = CONFORMANCE_MATERIALIZATION_LIMITS.sourceFileBytes) =>
    (await zipBytes(archive, path, maximum, params.signal)).toString("utf8");
  const previewHtml = await text(CONFORMANCE_REFERENCE_ARCHIVE_PATHS.preview);
  const documentJson = await text("composition-document.json");
  const contractJson = await text("conformance-contract.json");
  const metadataJson = await text(CONFORMANCE_REFERENCE_ARCHIVE_PATHS.metadata, CONFORMANCE_MATERIALIZATION_LIMITS.metadataBytes);
  const metadata = conformanceReferenceSourceSchema.parse(JSON.parse(metadataJson));
  let htmlEditingBundle: HtmlEditingFrozenSnapshotBundle | undefined;
  if (metadata.htmlEditingSnapshot) {
    const pin = metadata.htmlEditingSnapshot;
    const bytes = await zipBytes(archive, pin.path, HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes, params.signal);
    const encodedBundle = bytes.toString("utf8");
    if (createHash("sha256").update(bytes).digest("hex") !== pin.sha256
      || !Buffer.from(encodedBundle, "utf8").equals(bytes)) {
      throw new Error("CONFORMANCE_MATERIALIZATION_HTML_BYTES_MISMATCH");
    }
    htmlEditingBundle = { archivePath: pin.path, encodedBundle, sha256: pin.sha256 };
  } else if (archive.file(HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.archivePath)) {
    throw new Error("CONFORMANCE_MATERIALIZATION_HTML_PIN_REQUIRED");
  }
  const fontManifest = JSON.parse(await text("font-manifest.json", CONFORMANCE_MATERIALIZATION_LIMITS.metadataBytes));
  const source = verifyConformanceReferenceSource({ previewHtml, documentJson, contractJson, metadata, fontManifest, htmlEditingBundle });
  // Content scope is not a current permission grant. Storage authorization and
  // any execution authority must still come from the host independently.
  if (htmlEditingBundle) {
    const content = verifyCompositionHtmlEditingSnapshotContent({ ...htmlEditingBundle,
      document: source.document, documentHash: source.metadata.documentHash });
    if (content.organizationId !== params.organizationId) throw new Error("CONFORMANCE_MATERIALIZATION_HTML_SCOPE_MISMATCH");
  }
  const fonts = source.fontManifest;
  if (!fonts) throw new Error("CONFORMANCE_MATERIALIZATION_FONT_BINDINGS_MISSING");
  const mediaBytes = source.metadata.bindings.reduce((total, binding) => total + binding.fileSizeBytes, 0);
  const extractedBytes = [previewHtml, documentJson, contractJson, metadataJson].reduce((total, value) => total + Buffer.byteLength(value), 0)
    + Buffer.byteLength(JSON.stringify(fonts))
    + (htmlEditingBundle ? Buffer.byteLength(htmlEditingBundle.encodedBundle, "utf8") : 0)
    + fonts.reduce((total, font) => total + font.fileSizeBytes, 0);
  if (mediaBytes > CONFORMANCE_MATERIALIZATION_LIMITS.mediaBytes || extractedBytes > CONFORMANCE_MATERIALIZATION_LIMITS.extractedBytes) {
    throw new Error("CONFORMANCE_MATERIALIZATION_BYTE_BUDGET");
  }
  const directory = await mkdtemp(join(resolve(params.outputParentDirectory), "conformance-reference-"));
  const ownedFiles: string[] = []; const ownedDirectories: string[] = [directory];
  const cleanup = async () => {
    for (const path of [...ownedFiles].reverse()) await rm(path, { force: true });
    for (const path of [...ownedDirectories].reverse()) await rmdir(path);
  };
  const writeOwned = async (relativePath: string, bytes: string | Buffer) => {
    assertConformanceJobActive(params.signal);
    const path = join(directory, relativePath); ownedFiles.push(path);
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    assertConformanceJobActive(params.signal);
  };
  try {
    assertConformanceJobActive(params.signal);
    for (const relative of ["assets", "assets/fonts", "conformance-media"]) {
      const path = join(directory, relative); await mkdir(path); ownedDirectories.push(path);
    }
    await writeOwned(CONFORMANCE_REFERENCE_ARCHIVE_PATHS.preview, previewHtml);
    await writeOwned(CONFORMANCE_REFERENCE_ARCHIVE_PATHS.metadata, metadataJson);
    await writeOwned("composition-document.json", documentJson); await writeOwned("conformance-contract.json", contractJson);
    await writeOwned("font-manifest.json", JSON.stringify(fonts));
    if (htmlEditingBundle) await writeOwned(htmlEditingBundle.archivePath, htmlEditingBundle.encodedBundle);
    const writtenFonts = new Set<string>();
    for (const font of fonts) {
      const path = conformanceFontPath(font);
      if (writtenFonts.has(path)) continue;
      const bytes = await zipBytes(archive, path, font.fileSizeBytes, params.signal);
      if (bytes.length !== font.fileSizeBytes || createHash("sha256").update(bytes).digest("hex") !== font.checksumSha256) {
        throw new Error("CONFORMANCE_MATERIALIZATION_FONT_MISMATCH");
      }
      await writeOwned(path, bytes); writtenFonts.add(path);
    }
    for (const binding of source.metadata.bindings) {
      assertConformanceJobActive(params.signal);
      const response = await params.readAsset(binding);
      if (params.signal?.aborted) {
        try {await response.body?.cancel();} catch { /* Preserve cancellation; workspace cleanup still runs. */ }
        assertConformanceJobActive(params.signal);
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (response.status !== 200 || !response.body || response.headers.has("content-range")
        || contentType && ![binding.mimeType.toLowerCase(), "application/octet-stream"].includes(contentType)
        || response.headers.get("content-length") !== null && response.headers.get("content-length") !== String(binding.fileSizeBytes)) {
        await response.body?.cancel(); throw new Error("CONFORMANCE_MATERIALIZATION_RESPONSE_INVALID");
      }
      const path = join(directory, binding.localPath); ownedFiles.push(path);
      const digest = createHash("sha256"); let bytes = 0;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > binding.fileSizeBytes) return callback(new Error("CONFORMANCE_MATERIALIZATION_MEDIA_SIZE_MISMATCH"));
        digest.update(chunk); callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), meter,
        createWriteStream(path, { flags: "wx", mode: 0o600 }), {signal: params.signal});
      assertConformanceJobActive(params.signal);
      if (bytes !== binding.fileSizeBytes || digest.digest("hex") !== binding.checksum) throw new Error("CONFORMANCE_MATERIALIZATION_MEDIA_MISMATCH");
    }
    const receipt = { schemaVersion: 1, organizationId: params.organizationId, revisionId: params.revisionId,
      projectHash: params.expectedProjectHash, documentHash: source.metadata.documentHash,
      status: "MATERIALIZED_NOT_CAPTURED", assetCount: source.metadata.bindings.length, mediaBytes };
    await writeOwned("materialization.json", `${JSON.stringify(receipt, null, 2)}\n`);
    assertConformanceJobActive(params.signal);
    return { directory, previewPath: join(directory, CONFORMANCE_REFERENCE_ARCHIVE_PATHS.preview), receipt, cleanup };
  } catch (error) {await cleanup(); assertConformanceJobActive(params.signal); throw error;}
}
