import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { z } from "zod";
import { playbackVisualFramesHash } from "./composition-playback-audio-contract";
import { compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { CONFORMANCE_EVIDENCE_STORAGE } from "./composition-conformance-evidence-package";
import { AUDIO_EVIDENCE_LIMITS, audioEvidenceHashSchema, audioEvidenceMetadataSchema, audioEvidenceReceiptSchema,
  audioEvidenceSha256, audioEvidenceStoragePath, validateAudioEvidenceBytes } from "./composition-audio-evidence-contract";

async function boundedFile(path: string, maximumBytes: number) {
  const file = await lstat(path);
  if (!file.isFile() || file.size <= 0 || file.size > maximumBytes) throw new Error("AUDIO_EVIDENCE_FILE_INVALID");
  const bytes = await readFile(path);
  if (bytes.length !== file.size || bytes.length > maximumBytes) throw new Error("AUDIO_EVIDENCE_FILE_CHANGED");
  return bytes;
}
/** Worker-only operation: caller must establish organization authority before using service-role credentials. */
export async function persistAudioConformanceEvidence(params: {
  supabase: SupabaseClient<any, any, any>; organizationId: string; revisionId: string;
  visualChecksum: string; audioDirectory: string;
}) {
  z.string().uuid().parse(params.organizationId); z.string().uuid().parse(params.revisionId);
  audioEvidenceHashSchema.parse(params.visualChecksum);
  const visual = await params.supabase.rpc("read_hyperframes_visual_conformance_evidence", {
    p_organization_id: params.organizationId, p_revision_id: params.revisionId, p_bundle_sha256: params.visualChecksum,
  });
  if (visual.error || !visual.data) throw new Error("AUDIO_EVIDENCE_VISUAL_UNAVAILABLE");
  const context = z.object({ organizationId: z.string().uuid(), revisionId: z.string().uuid(), checksum: audioEvidenceHashSchema,
    projectHash: audioEvidenceHashSchema, documentHash: audioEvidenceHashSchema, contract: compositionConformanceContractSchema }).parse(visual.data);
  if (context.organizationId !== params.organizationId || context.revisionId !== params.revisionId
    || context.checksum !== params.visualChecksum) throw new Error("AUDIO_EVIDENCE_CONTEXT_MISMATCH");
  const metadata = audioEvidenceMetadataSchema.parse(JSON.parse((await boundedFile(join(params.audioDirectory, "audio-reference-metadata.json"), AUDIO_EVIDENCE_LIMITS.jsonBytes)).toString("utf8")));
  const receipt = audioEvidenceReceiptSchema.parse({
    ...JSON.parse((await boundedFile(join(params.audioDirectory, "audio-reference-receipt.json"), AUDIO_EVIDENCE_LIMITS.jsonBytes)).toString("utf8")),
    visualChecksum: params.visualChecksum,
  });
  const wavMaximumBytes = receipt.schemaVersion === 1 ? AUDIO_EVIDENCE_LIMITS.legacyWavBytes : AUDIO_EVIDENCE_LIMITS.wavBytes;
  const wav = await boundedFile(join(params.audioDirectory, "audio-reference.wav"), wavMaximumBytes);
  if (receipt.organizationId !== params.organizationId || receipt.revisionId !== params.revisionId
    || receipt.projectHash !== context.projectHash || receipt.documentHash !== context.documentHash) throw new Error("AUDIO_EVIDENCE_CONTEXT_MISMATCH");
  if (receipt.schemaVersion === 3) {
    if (playbackVisualFramesHash(visual.data.frames) !== receipt.visualFramesSha256) {
      throw new Error("AUDIO_EVIDENCE_PLAYBACK_VISUAL_MISMATCH");
    }
  }
  validateAudioEvidenceBytes({ wav, metadata, receipt, contract: context.contract });
  const zip = new JSZip(); const date = new Date("2000-01-01T00:00:00Z");
  for (const [name, bytes] of [["audio-reference.wav", wav], ["audio-reference-metadata.json", JSON.stringify(metadata)],
    ["audio-reference-receipt.json", JSON.stringify(receipt)]] as const) zip.file(name, bytes, { date, createFolders: false });
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (bytes.length > (receipt.schemaVersion === 1 ? AUDIO_EVIDENCE_LIMITS.legacyPackageBytes : AUDIO_EVIDENCE_LIMITS.packageBytes)) {
    throw new Error("AUDIO_EVIDENCE_PACKAGE_LIMIT");
  }
  const checksum = audioEvidenceSha256(bytes);
  const storagePath = audioEvidenceStoragePath(params.organizationId, params.revisionId, params.visualChecksum, checksum);
  const storage = params.supabase.storage.from(CONFORMANCE_EVIDENCE_STORAGE.bucket);
  await storage.upload(storagePath, bytes, { contentType: "application/zip", upsert: false });
  // Lost acknowledgement or an existing content-addressed object is safe only after exact readback.
  const readback = await storage.download(storagePath);
  if (readback.error || !readback.data || readback.data.size !== bytes.length) throw new Error("AUDIO_EVIDENCE_READBACK_FAILED");
  const persisted = Buffer.from(await readback.data.arrayBuffer());
  if (persisted.length !== bytes.length || audioEvidenceSha256(persisted) !== checksum) throw new Error("AUDIO_EVIDENCE_STORAGE_MISMATCH");
  const recorded = await params.supabase.rpc("record_hyperframes_audio_conformance_evidence", {
    p_organization_id: params.organizationId, p_revision_id: params.revisionId, p_visual_checksum: params.visualChecksum,
    p_bundle_sha256: checksum, p_file_size_bytes: bytes.length, p_receipt: receipt,
  });
  if (recorded.error || recorded.data !== checksum) throw new Error("AUDIO_EVIDENCE_RECORD_FAILED");
  return { checksum, storagePath, sizeBytes: bytes.length, receipt, status: receipt.status };
}
