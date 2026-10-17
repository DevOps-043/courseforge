import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { z } from "zod";
import { CONFORMANCE_EVIDENCE_STORAGE } from "./composition-conformance-evidence-package";
import { AUDIO_EVIDENCE_LIMITS, audioEvidenceHashSchema, audioEvidenceReceiptSchema, audioEvidenceRecordSchema,
  audioEvidenceSha256, audioEvidenceStoragePath, validateAudioEvidenceBytes } from "./composition-audio-evidence-contract";

/** Internal worker read. Scope must come from an authorized job, not arbitrary user input. */
export async function readPersistedAudioConformanceEvidence(params: {
  supabase: SupabaseClient<any, any, any>; organizationId: string; revisionId: string;
  visualChecksum: string; checksum: string; outputParentDirectory: string;
}) {
  z.string().uuid().parse(params.organizationId); z.string().uuid().parse(params.revisionId);
  audioEvidenceHashSchema.parse(params.visualChecksum); audioEvidenceHashSchema.parse(params.checksum);
  const result = await params.supabase.rpc("read_hyperframes_audio_conformance_evidence", {
    p_organization_id: params.organizationId, p_revision_id: params.revisionId,
    p_visual_checksum: params.visualChecksum, p_bundle_sha256: params.checksum,
  });
  if (result.error || !result.data) throw new Error("AUDIO_EVIDENCE_RECORD_UNAVAILABLE");
  const record = audioEvidenceRecordSchema.parse(result.data);
  const storagePath = audioEvidenceStoragePath(params.organizationId, params.revisionId, params.visualChecksum, params.checksum);
  if (record.organizationId !== params.organizationId || record.revisionId !== params.revisionId
    || record.visualChecksum !== params.visualChecksum || record.checksum !== params.checksum || record.storagePath !== storagePath
    || record.receipt.organizationId !== record.organizationId || record.receipt.revisionId !== record.revisionId
    || record.receipt.projectHash !== record.projectHash || record.receipt.documentHash !== record.documentHash
    || record.receipt.visualChecksum !== record.visualChecksum) throw new Error("AUDIO_EVIDENCE_CONTEXT_MISMATCH");
  const downloaded = await params.supabase.storage.from(CONFORMANCE_EVIDENCE_STORAGE.bucket).download(storagePath);
  if (downloaded.error || !downloaded.data || downloaded.data.size !== record.sizeBytes) throw new Error("AUDIO_EVIDENCE_DOWNLOAD_FAILED");
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  if (bytes.length !== record.sizeBytes || audioEvidenceSha256(bytes) !== record.checksum) throw new Error("AUDIO_EVIDENCE_STORAGE_MISMATCH");
  const zip = await JSZip.loadAsync(bytes);
  const limits = new Map([["audio-reference.wav", record.receipt.schemaVersion === 1 ? AUDIO_EVIDENCE_LIMITS.legacyWavBytes : AUDIO_EVIDENCE_LIMITS.wavBytes],
    ["audio-reference-metadata.json", AUDIO_EVIDENCE_LIMITS.jsonBytes], ["audio-reference-receipt.json", AUDIO_EVIDENCE_LIMITS.jsonBytes]]);
  const entries = Object.values(zip.files);
  if (entries.length !== limits.size || entries.some((entry) => entry.dir || !limits.has(entry.name)
    || entry.unsafeOriginalName !== entry.name)) throw new Error("AUDIO_EVIDENCE_ARCHIVE_INVALID");
  const files = new Map<string, Buffer>();
  for (const [name, maximum] of limits) {
    let size = 0; const chunks: Buffer[] = [];
    await pipeline(zip.file(name)!.nodeStream("nodebuffer"), new Writable({ write(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > maximum) callback(new Error("AUDIO_EVIDENCE_EXTRACTION_LIMIT"));
      else { chunks.push(chunk); callback(); }
    } }));
    files.set(name, Buffer.concat(chunks));
  }
  const receipt = audioEvidenceReceiptSchema.parse(JSON.parse(files.get("audio-reference-receipt.json")!.toString("utf8")));
  if (!isDeepStrictEqual(receipt, record.receipt)) throw new Error("AUDIO_EVIDENCE_RECEIPT_MISMATCH");
  const metadata = validateAudioEvidenceBytes({ wav: files.get("audio-reference.wav")!, receipt, contract: record.contract,
    metadata: JSON.parse(files.get("audio-reference-metadata.json")!.toString("utf8")) });
  const directory = await mkdtemp(join(params.outputParentDirectory, "conformance-audio-evidence-"));
  const cleanup = async () => {
    for (const name of limits.keys()) await rm(join(directory, name), { force: true });
    await rmdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  };
  try {
    for (const [name, content] of files) await writeFile(join(directory, name), content, { flag: "wx", mode: 0o600 });
    return { directory, receipt, metadata, contract: record.contract, checksum: record.checksum, audioReferencePath: join(directory, "audio-reference.wav"),
      audioReferenceMetadataPath: join(directory, "audio-reference-metadata.json"), cleanup };
  } catch (error) { await cleanup(); throw error; }
}
