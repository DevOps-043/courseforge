import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { z } from "zod";
import { compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { CONFORMANCE_EVIDENCE_STORAGE, validateVisualConformanceCapture, visualCaptureReceiptSchema } from "./composition-conformance-evidence-package";
import { eventBatchAuthorizationManifestSchema, COMPOSITION_EVENT_PLAN_MAX_BATCHES } from "../composition-conformance-batch-contract";
import { assertEventBatchCaptureLineage, eventBatchCaptureLineageSchema } from "../composition-conformance-event-batch-lineage";
import { suppressedTextFrameName } from "./composition-text-paint-mask-derivation";
import { suppressedDeckTextFrameName } from "./composition-deck-text-paint-derivation";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceRecordSchema = z.object({
  organizationId: z.string().uuid(), revisionId: z.string().uuid(), checksum: digestSchema,
  projectHash: digestSchema, documentHash: digestSchema, storagePath: z.string(),
  sizeBytes: z.number().int().positive().max(CONFORMANCE_EVIDENCE_STORAGE.maximumBytes),
  frames: visualCaptureReceiptSchema.shape.frames, status: z.literal("VISUAL_CAPTURED_AUDIO_PENDING"),
  contract: compositionConformanceContractSchema,
  eventAuthorization: z.object({parentContract: compositionConformanceContractSchema,
    batchAuthorization: eventBatchAuthorizationManifestSchema, lineage: eventBatchCaptureLineageSchema}).strict().optional(),
}).strict();

/** Only for trusted workers: the caller must establish organization authority before using service-role credentials. */
export async function readPersistedVisualConformanceEvidence(params: {
  supabase: SupabaseClient<any, any, any>; organizationId: string; revisionId: string;
  checksum: string; outputParentDirectory: string;
  eventBatchIndex?: number;
}) {
  z.string().uuid().parse(params.organizationId); z.string().uuid().parse(params.revisionId);
  digestSchema.parse(params.checksum);
  if (params.eventBatchIndex !== undefined) z.number().int().nonnegative().max(COMPOSITION_EVENT_PLAN_MAX_BATCHES - 1).parse(params.eventBatchIndex);
  const recorded = await params.supabase.rpc(params.eventBatchIndex !== undefined
    ? "read_hyperframes_event_visual_conformance_evidence" : "read_hyperframes_visual_conformance_evidence", {
    p_organization_id: params.organizationId, p_revision_id: params.revisionId, p_bundle_sha256: params.checksum,
    ...(params.eventBatchIndex !== undefined ? {p_batch_index: params.eventBatchIndex} : {}),
  });
  if (recorded.error || !recorded.data) throw new Error("CONFORMANCE_EVIDENCE_RECORD_UNAVAILABLE");
  const record = evidenceRecordSchema.parse(recorded.data);
  if (params.eventBatchIndex !== undefined) {
    if (!record.eventAuthorization || record.contract.schemaVersion !== 4
      || record.contract.checkpointBatch?.batchIndex !== params.eventBatchIndex) throw new Error("CONFORMANCE_EVENT_EVIDENCE_AUTHORIZATION_REQUIRED");
    assertEventBatchCaptureLineage(record.eventAuthorization.lineage, record.contract, undefined, record.eventAuthorization);
  } else if (record.eventAuthorization) throw new Error("CONFORMANCE_EVENT_EVIDENCE_UNEXPECTED_AUTHORIZATION");
  const storagePath = `${params.organizationId}/${params.revisionId}/${params.checksum}.zip`;
  if (record.organizationId !== params.organizationId || record.revisionId !== params.revisionId
    || record.checksum !== params.checksum || record.storagePath !== storagePath
    || record.documentHash !== record.contract.documentHash) throw new Error("CONFORMANCE_EVIDENCE_RECORD_MISMATCH");
  const downloaded = await params.supabase.storage.from(CONFORMANCE_EVIDENCE_STORAGE.bucket).download(storagePath);
  if (downloaded.error || !downloaded.data || downloaded.data.size !== record.sizeBytes) {
    throw new Error("CONFORMANCE_EVIDENCE_DOWNLOAD_FAILED");
  }
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  if (bytes.length !== record.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== record.checksum) {
    throw new Error("CONFORMANCE_EVIDENCE_STORAGE_MISMATCH");
  }
  // Hash verification precedes decompression. Never extract archive-controlled paths.
  const zip = await JSZip.loadAsync(bytes);
  const files = new Map<string, number>([
    ["conformance-contract.json", 1024 * 1024], ["preview-metadata.json", 1024 * 1024], ["capture-receipt.json", 1024 * 1024],
    ...record.contract.checkpoints.map(({ frameIndex }) => [`frame-${frameIndex}.png`, 20 * 1024 * 1024] as [string, number]),
  ]);
  const entries = Object.values(zip.files);
  for (const checkpoint of record.contract.checkpoints) {
    const name = suppressedTextFrameName(checkpoint.frameIndex);
    if (zip.file(name)) files.set(name, COMPOSITION_TEXT_PARITY_POLICY.maximumPaintCapturePngBytes);
    const deckName = suppressedDeckTextFrameName(checkpoint.frameIndex);
    if (zip.file(deckName)) files.set(deckName, COMPOSITION_TEXT_PARITY_POLICY.maximumPaintCapturePngBytes);
  }
  if (entries.length !== files.size || entries.some((entry) => entry.dir || !files.has(entry.name)
    || entry.unsafeOriginalName !== entry.name)) throw new Error("CONFORMANCE_EVIDENCE_ARCHIVE_INVALID");
  const directory = await mkdtemp(join(params.outputParentDirectory, "conformance-evidence-"));
  const ownedPaths: string[] = [];
  const cleanup = async () => {
    for (const path of ownedPaths) await rm(path, { force: true });
    await rmdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  };
  try {
    let totalBytes = 0;
    for (const [name, maximumBytes] of files) {
      const destination = join(directory, name); ownedPaths.push(destination);
      let entryBytes = 0;
      const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        entryBytes += chunk.length; totalBytes += chunk.length;
        if (entryBytes > maximumBytes || totalBytes > 131 * 1024 * 1024) {
          callback(new Error("CONFORMANCE_EVIDENCE_EXTRACTION_LIMIT"));
        } else callback(null, chunk);
      } });
      await pipeline(zip.file(name)!.nodeStream("nodebuffer"), bound, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
    }
    const contract = compositionConformanceContractSchema.parse(JSON.parse(await readFile(join(directory, "conformance-contract.json"), "utf8")));
    if (!isDeepStrictEqual(contract, record.contract)) throw new Error("CONFORMANCE_EVIDENCE_CONTRACT_MISMATCH");
    const capture = await validateVisualConformanceCapture({ captureDirectory: directory,
      organizationId: record.organizationId, revisionId: record.revisionId, projectHash: record.projectHash, contract,
      ...(record.eventAuthorization ? {authorizedEventRevision: record.eventAuthorization} : {}) });
    if (capture.images.length + 3 !== files.size || capture.images.some((image) => !files.has(image.name)))
      throw new Error("CONFORMANCE_EVIDENCE_ARCHIVE_INVALID");
    if (record.eventAuthorization && !isDeepStrictEqual(capture.receipt.eventBatchLineage, record.eventAuthorization.lineage)) {
      throw new Error("CONFORMANCE_EVENT_EVIDENCE_LINEAGE_MISMATCH");
    }
    if (!isDeepStrictEqual(capture.receipt.frames, record.frames)) throw new Error("CONFORMANCE_EVIDENCE_RECEIPT_MISMATCH");
    return { directory, contract, contractPath: join(directory, "conformance-contract.json"),
      previewDirectory: directory, previewMetadataPath: join(directory, "preview-metadata.json"),
      receipt: capture.receipt, checksum: record.checksum, status: record.status, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
