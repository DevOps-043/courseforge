import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildVisualConformanceEvidencePackage, CONFORMANCE_EVIDENCE_STORAGE } from "./composition-conformance-evidence-package";
import { compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { COMPOSITION_EVENT_PLAN_MAX_BATCHES } from "../composition-conformance-batch-contract";

/** Internal worker operation: organization authority must be established by the caller, not user input. */
export async function persistVisualConformanceEvidence(params: {
  supabase: SupabaseClient<any, any, any>; organizationId: string; revisionId: string; captureDirectory: string;
  eventBatchIndex?: number; eventContract?: unknown;
}) {
  z.string().uuid().parse(params.organizationId); z.string().uuid().parse(params.revisionId);
  if (params.eventBatchIndex !== undefined) z.number().int().nonnegative().max(COMPOSITION_EVENT_PLAN_MAX_BATCHES - 1).parse(params.eventBatchIndex);
  if ((params.eventBatchIndex !== undefined) !== (params.eventContract !== undefined)) throw new Error("CONFORMANCE_EVENT_PERSIST_SELECTION_REQUIRED");
  const { data, error } = await params.supabase.from("video_composition_revisions")
    .select("id, organization_id, project_hash, manifest").eq("id", params.revisionId)
    .eq("organization_id", params.organizationId).maybeSingle();
  if (error || !data || data.id !== params.revisionId || data.organization_id !== params.organizationId
    || data.manifest?.conformance_reference_version !== 1) throw new Error("CONFORMANCE_EVIDENCE_REVISION_UNAVAILABLE");
  const contract = compositionConformanceContractSchema.parse(params.eventContract ?? data.manifest.conformance_contract);
  if (params.eventBatchIndex !== undefined && (contract.schemaVersion !== 4 || contract.checkpointBatch?.batchIndex !== params.eventBatchIndex)) {
    throw new Error("CONFORMANCE_EVENT_PERSIST_INDEX_MISMATCH");
  }
  const bundle = await buildVisualConformanceEvidencePackage({...params, projectHash: data.project_hash, contract,
    ...(params.eventBatchIndex !== undefined ? {authorizedEventRevision: {parentContract: data.manifest.conformance_contract,
      batchAuthorization: data.manifest.conformance_event_batch_authorization}} : {})});
  const storage = params.supabase.storage.from(CONFORMANCE_EVIDENCE_STORAGE.bucket);
  const uploaded = await storage.upload(bundle.storagePath, bundle.bytes, { contentType: "application/zip", upsert: false });
  // A content-addressed object may already exist after a lost acknowledgement. Never overwrite it.
  const readback = await storage.download(bundle.storagePath);
  if (readback.error || !readback.data || readback.data.size !== bundle.bytes.length
    || readback.data.size > CONFORMANCE_EVIDENCE_STORAGE.maximumBytes) {
    throw new Error(uploaded.error ? "CONFORMANCE_EVIDENCE_UPLOAD_FAILED" : "CONFORMANCE_EVIDENCE_READBACK_FAILED");
  }
  const persistedBytes = Buffer.from(await readback.data.arrayBuffer());
  if (persistedBytes.length !== bundle.bytes.length || createHash("sha256").update(persistedBytes).digest("hex") !== bundle.checksum) {
    throw new Error("CONFORMANCE_EVIDENCE_STORAGE_MISMATCH");
  }
  const recorded = await params.supabase.rpc(params.eventBatchIndex !== undefined
    ? "record_hyperframes_event_visual_conformance_evidence" : "record_hyperframes_visual_conformance_evidence", {
    p_organization_id: params.organizationId, p_revision_id: params.revisionId,
    p_project_hash: bundle.receipt.projectHash, p_document_hash: bundle.receipt.documentHash,
    p_bundle_sha256: bundle.checksum, p_file_size_bytes: bundle.bytes.length, p_frames: bundle.receipt.frames,
    ...(params.eventBatchIndex !== undefined ? {p_batch_index: params.eventBatchIndex, p_contract: contract,
      p_lineage: bundle.receipt.eventBatchLineage} : {}),
  });
  if (recorded.error || recorded.data !== bundle.checksum) throw new Error("CONFORMANCE_EVIDENCE_RECORD_FAILED");
  return { status: "VISUAL_CAPTURED_AUDIO_PENDING" as const, organizationId: params.organizationId, revisionId: params.revisionId,
    documentHash: bundle.receipt.documentHash, projectHash: bundle.receipt.projectHash,
    bucket: CONFORMANCE_EVIDENCE_STORAGE.bucket, storagePath: bundle.storagePath, checksum: bundle.checksum, sizeBytes: bundle.bytes.length };
}
