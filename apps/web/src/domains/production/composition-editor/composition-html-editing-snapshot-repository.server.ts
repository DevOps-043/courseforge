import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { hyperframesAssetManifestSchema, hyperframesRenderProfileSchema, HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES } from "../hyperframes/hyperframes.types";
import { HTML_EDITING_SNAPSHOT_STORAGE_BUCKET, type HtmlEditingSnapshotPublicationPorts } from "./composition-html-editing-snapshot-publication.server";
import { readCompositionHtmlEditingSnapshot } from "./composition-html-editing-reader.service";
import { restoreCompositionHtmlEditingSnapshot, verifyCompositionHtmlEditingSnapshotContent } from "./composition-html-editing-snapshot-bundle.server";
import { normalizeConformanceFontManifest, conformanceFontManifestHash } from "./composition-conformance-font-bindings";
import { conformanceReferenceSourceSchema } from "./composition-conformance-reference.service";
import { compositionConformanceContractSchema } from "./composition-preview-render-conformance";
import { buildSnapshotConformanceContract } from "./composition-snapshot-conformance-contract";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";

const scopeSchema = z.object({actorId:z.string().uuid(), organizationId:z.string().uuid(), compositionId:z.string().uuid(),
  draftId:z.string().uuid(), operationId:z.string().uuid(), expectedActiveRevisionId:z.string().uuid().nullable(),
  documentHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const archiveSchema = z.object({projectHash:z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes:z.number().int().positive().max(HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES),
  storageBucket:z.literal(HTML_EDITING_SNAPSHOT_STORAGE_BUCKET), storagePath:z.string().max(1024)}).strict();

/** Concrete service-only adapter; migration remains prepared, not applied.
 * Caller supplies only trusted assembler receipts and Storage readback ACKs.
 * The pre-read validates canonical content; the RPC reauthorizes under locks
 * and owns CAS/provenance/reuse/audit/activation as one transaction. No retries.
 * Returned ACK is checked by the publication coordinator, never treated as an
 * HTTP payload to forward directly. Does not prove SQL runtime behavior. */
export function createHtmlEditingSnapshotRepository(supabase: SupabaseClient): HtmlEditingSnapshotPublicationPorts["commitSnapshotAtomically"] {
  return async input => {
    const request = scopeSchema.parse({actorId:input.actorId, organizationId:input.organizationId,
      compositionId:input.compositionId, draftId:input.draftId, operationId:input.operationId,
      expectedActiveRevisionId:input.expectedActiveRevisionId, documentHash:input.documentHash});
    const archive = archiveSchema.parse(input.archive);
    if (archive.projectHash !== input.prepared.projectHash || input.prepared.documentHash !== request.documentHash
      || input.prepared.scope !== "PREPARED_ARCHIVE_NOT_UPLOADED_OR_RENDERED"
      || archive.storagePath !== `composition-snapshots/${request.organizationId}/${request.compositionId}/${archive.projectHash}.zip`) {
      throw new Error("HTML_SNAPSHOT_RECEIPT_INVALID");
    }
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs)]);
    signal.throwIfAborted();
    const current = await readCompositionHtmlEditingSnapshot({actorId:request.actorId, organizationId:request.organizationId,
      documentId:request.draftId, documentHash:request.documentHash, supabase, signal});
    const frozen = input.prepared.bundle;
    restoreCompositionHtmlEditingSnapshot({...frozen, document:current.document, documentHash:request.documentHash,
      scope:{organizationId:request.organizationId, documentId:request.draftId}, authorities:current.context.revisions});
    const content = verifyCompositionHtmlEditingSnapshotContent({...frozen, document:current.document, documentHash:request.documentHash});
    const assets = hyperframesAssetManifestSchema.parse(input.prepared.assets);
    const fonts = normalizeConformanceFontManifest(input.prepared.fontManifest);
    const contract = compositionConformanceContractSchema.parse(input.prepared.contract);
    if (contract.schemaVersion !== 4 || !contract.renderExecution) throw new Error("HTML_SNAPSHOT_CONTRACT_INVALID");
    const expected = buildSnapshotConformanceContract({document:current.document, documentHash:request.documentHash,
      assets:assets.map(asset => ({id:asset.productionAssetId, checksum:asset.checksum})), renderProfile:hyperframesRenderProfileSchema.parse(contract.renderProfile),
      contractVersion:4, renderExecution:contract.renderExecution, deckText:true, htmlEditingBundle:frozen, fontUsage:true, fontManifest:fonts});
    const metadata = conformanceReferenceSourceSchema.parse(input.prepared.metadata);
    const digest = (value:string) => createHash("sha256").update(value).digest("hex");
    if (!isDeepStrictEqual(contract, expected) || metadata.documentHash !== request.documentHash
      || metadata.htmlEditingSnapshot?.sha256 !== frozen.sha256 || metadata.htmlEditingSnapshot.path !== frozen.archivePath
      || metadata.contractSha256 !== digest(JSON.stringify(contract,null,2))
      || metadata.nativeDocumentSha256 !== digest(JSON.stringify(current.document,null,2))
      || metadata.fontManifestSha256 !== conformanceFontManifestHash(fonts)
      || !isDeepStrictEqual(metadata.bindings, assets.map(asset => ({assetId:asset.productionAssetId,
        checksum:asset.checksum, fileSizeBytes:asset.fileSizeBytes, localPath:`conformance-media/${asset.productionAssetId}`,
        mimeType:asset.mimeType, storageBucket:asset.storageBucket ?? "production-assets", storagePath:asset.storagePath})))) {
      throw new Error("HTML_SNAPSHOT_CONTRACT_INVALID");
    }
    const manifest = {snapshot:true, draft_document_id:request.draftId, draft_document_hash:request.documentHash,
      asset_manifest:assets, font_manifest:fonts, render_profile:contract.renderProfile,
      conformance_contract:contract, conformance_contract_version:4, conformance_reference_version:1,
      conformance_reference:metadata, html_editing_snapshot:metadata.htmlEditingSnapshot,
      canvas_duration_seconds:current.document.canvas.durationSeconds};
    const payload = {archive, manifest, htmlUsedAssetIds:content.usedAssetIds};
    if (Buffer.byteLength(JSON.stringify(payload)) > HTML_EDITING_REPOSITORY_POLICY.responseBytes)
      throw new Error("HTML_SNAPSHOT_PAYLOAD_LIMIT");
    signal.throwIfAborted();
    let result: {data:unknown; error:unknown};
    try {
      result = await supabase.rpc("commit_html_editing_snapshot", {p_org:request.organizationId, p_actor:request.actorId,
        p_composition:request.compositionId, p_draft:request.draftId, p_operation:request.operationId,
        p_expected_active:request.expectedActiveRevisionId, p_payload:payload}).abortSignal(signal);
      signal.throwIfAborted();
    } catch {throw new Error("HTML_SNAPSHOT_COMMIT_UNCONFIRMED");}
    if (result.error || result.data == null || Buffer.byteLength(JSON.stringify(result.data)) > HTML_EDITING_REPOSITORY_POLICY.acknowledgmentBytes)
      throw new Error("HTML_SNAPSHOT_COMMIT_UNCONFIRMED");
    return result.data;
  };
}
