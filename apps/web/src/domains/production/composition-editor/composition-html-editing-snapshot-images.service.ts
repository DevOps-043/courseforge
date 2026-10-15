import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { hyperframesAssetManifestSchema, HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS } from "../hyperframes/hyperframes.types";
import { htmlEditingImageIdentitySchema } from "./composition-html-editing-image-identity";
import { readCompositionHtmlEditingSnapshot, type HtmlEditingHistoricalRead } from "./composition-html-editing-reader.service";
import { verifyCompositionHtmlEditingSnapshotContent } from "./composition-html-editing-snapshot-bundle.server";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";
import type { HtmlPreviewCandidateSelector } from "./composition-html-editing-preview-candidate.contract";
import { readHtmlPreviewCandidateSnapshot } from "./composition-html-editing-preview-candidate.server";

const linkSchema = z.object({ organization_id: z.string().uuid(), draft_id: z.string().uuid(), production_asset_id: z.string().uuid() }).strict();
const assetSchema = z.object({ id: z.string().uuid(), organization_id: z.string().uuid(), checksum: z.string(),
  file_size_bytes: z.number(), mime_type: z.string(), storage_bucket: z.string(), storage_path: z.string(),
  qa_status: z.enum(["GENERATED", "READY_FOR_QA", "APPROVED", "EXPORTED", "PUBLISHED"]) }).strict();

/** Prepared producer acquisition. Exact RPC authorizes actor/history first;
 * bounded batched queries recheck draft links, current status and image identity.
 * No signed URLs, uploads or decode claims. Reads are not one transaction; worker
 * authority must recheck current identity before/after execution. */
export async function prepareCompositionHtmlEditingSnapshotImages(params: HtmlEditingHistoricalRead & {
  supabase: SupabaseClient; candidate?: HtmlPreviewCandidateSelector;
}) {
  params.signal?.throwIfAborted();
  const snapshot = params.candidate ? await readHtmlPreviewCandidateSnapshot({...params, candidate: params.candidate})
    : await readCompositionHtmlEditingSnapshot(params);
  params.signal?.throwIfAborted();
  const content = verifyCompositionHtmlEditingSnapshotContent({...snapshot.bundle, document: snapshot.document,
    documentHash: params.documentHash});
  const imageAssets = await readCurrentHtmlDraftImageIdentities({...params, draftId: params.documentId,
    productionAssetIds: content.usedAssetIds});
  return {...snapshot, imageAssets};
}

/** Shared host-only resource acquisition for an independently authorized source
 * draft. This checks CURRENT links/metadata, not historic embedded grants and not
 * actor access by itself. The caller must authorize the source before/after use. */
export async function readCurrentHtmlDraftImageIdentities(params: {
  supabase: SupabaseClient; organizationId: string; draftId: string;
  productionAssetIds: readonly string[]; signal?: AbortSignal;
}) {
  params.signal?.throwIfAborted();
  const scope = z.object({organizationId: z.string().uuid(), draftId: z.string().uuid()}).parse(params);
  // Reuse the actual render manifest's asset-count contract before any query.
  if (Array.isArray(params.productionAssetIds) && params.productionAssetIds.length > HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS)
    throw new Error("HTML_EDITING_SNAPSHOT_IMAGE_LIMIT");
  const ids = z.array(z.string().uuid()).max(HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS)
    .refine(values => new Set(values).size === values.length).parse(params.productionAssetIds);
  if (!ids.length) return [];
  params.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
  const signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout;
  let assets: unknown;
  try {
    const links = await params.supabase.from("video_composition_draft_assets")
      .select("organization_id,draft_id,production_asset_id").eq("organization_id", scope.organizationId)
      .eq("draft_id", scope.draftId).in("production_asset_id", ids).limit(ids.length + 1).abortSignal(signal);
    signal.throwIfAborted();
    if (links.error) throw new Error();
    const decodedLinks = z.array(linkSchema).max(ids.length).parse(links.data);
    const linkedIds = new Set(decodedLinks.map(link => link.production_asset_id));
    if (linkedIds.size !== ids.length || decodedLinks.length !== ids.length
      || decodedLinks.some(link => link.organization_id !== scope.organizationId || link.draft_id !== scope.draftId)
      || ids.some(id => !linkedIds.has(id))) throw new Error("HTML_EDITING_SNAPSHOT_IMAGE_SCOPE_MISMATCH");
    const records = await params.supabase.from("production_assets")
      .select("id,organization_id,checksum,file_size_bytes,mime_type,storage_bucket,storage_path,qa_status")
      .eq("organization_id", scope.organizationId).in("id", ids).limit(ids.length + 1).abortSignal(signal);
    signal.throwIfAborted();
    if (records.error) throw new Error();
    assets = records.data;
  } catch (error) {
    params.signal?.throwIfAborted();
    if (error instanceof Error && error.message === "HTML_EDITING_SNAPSHOT_IMAGE_SCOPE_MISMATCH") throw error;
    throw new Error("HTML_EDITING_SNAPSHOT_IMAGES_UNAVAILABLE");
  }
  try {
    if (Buffer.byteLength(JSON.stringify(assets) ?? "", "utf8") > HTML_EDITING_REPOSITORY_POLICY.responseBytes) throw new Error();
    const rows = z.array(assetSchema).max(ids.length).parse(assets);
    const byId = new Map(rows.map(row => [row.id, row]));
    if (byId.size !== ids.length || rows.length !== ids.length || rows.some(row => row.organization_id !== scope.organizationId)) throw new Error();
    const imageAssets = ids.map(id => {
      const row = byId.get(id);
      if (!row) throw new Error();
      return htmlEditingImageIdentitySchema.parse({productionAssetId: row.id, checksum: row.checksum,
        fileSizeBytes: row.file_size_bytes, mimeType: row.mime_type, storageBucket: row.storage_bucket, storagePath: row.storage_path});
    });
    hyperframesAssetManifestSchema.parse(imageAssets);
    return imageAssets;
  } catch { throw new Error("HTML_EDITING_SNAPSHOT_IMAGE_IDENTITY_INVALID"); }
}
