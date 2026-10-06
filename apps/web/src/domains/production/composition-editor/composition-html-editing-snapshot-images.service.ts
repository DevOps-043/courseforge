import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { hyperframesAssetManifestSchema, HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS } from "../hyperframes/hyperframes.types";
import { htmlEditingImageIdentitySchema } from "./composition-html-editing-image-identity";
import { readCompositionHtmlEditingSnapshot, type HtmlEditingHistoricalRead } from "./composition-html-editing-reader.service";
import { verifyCompositionHtmlEditingSnapshotContent } from "./composition-html-editing-snapshot-bundle.server";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";

const linkSchema = z.object({ organization_id: z.string().uuid(), draft_id: z.string().uuid(), production_asset_id: z.string().uuid() }).strict();
const assetSchema = z.object({ id: z.string().uuid(), organization_id: z.string().uuid(), checksum: z.string(),
  file_size_bytes: z.number(), mime_type: z.string(), storage_bucket: z.string(), storage_path: z.string(),
  qa_status: z.enum(["GENERATED", "READY_FOR_QA", "APPROVED", "EXPORTED", "PUBLISHED"]) }).strict();

/** Prepared producer acquisition. Exact RPC authorizes actor/history first;
 * bounded batched queries recheck draft links, current status and image identity.
 * No signed URLs, uploads or decode claims. Reads are not one transaction; worker
 * authority must recheck current identity before/after execution. */
export async function prepareCompositionHtmlEditingSnapshotImages(params: HtmlEditingHistoricalRead & { supabase: SupabaseClient }) {
  params.signal?.throwIfAborted();
  const snapshot = await readCompositionHtmlEditingSnapshot(params);
  params.signal?.throwIfAborted();
  const content = verifyCompositionHtmlEditingSnapshotContent({...snapshot.bundle, document: snapshot.document,
    documentHash: params.documentHash});
  const ids = [...content.usedAssetIds];
  // Reuse the actual render manifest's asset-count contract before any query.
  if (ids.length > HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS)
    throw new Error("HTML_EDITING_SNAPSHOT_IMAGE_LIMIT");
  if (!ids.length) return {...snapshot, imageAssets: []};
  params.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
  const signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout;
  let assets: unknown;
  try {
    const links = await params.supabase.from("video_composition_draft_assets")
      .select("organization_id,draft_id,production_asset_id").eq("organization_id", params.organizationId)
      .eq("draft_id", params.documentId).in("production_asset_id", ids).limit(ids.length + 1).abortSignal(signal);
    signal.throwIfAborted();
    if (links.error) throw new Error();
    const decodedLinks = z.array(linkSchema).max(ids.length).parse(links.data);
    const linkedIds = new Set(decodedLinks.map(link => link.production_asset_id));
    if (linkedIds.size !== ids.length || decodedLinks.length !== ids.length
      || decodedLinks.some(link => link.organization_id !== params.organizationId || link.draft_id !== params.documentId)
      || ids.some(id => !linkedIds.has(id))) throw new Error("HTML_EDITING_SNAPSHOT_IMAGE_SCOPE_MISMATCH");
    const records = await params.supabase.from("production_assets")
      .select("id,organization_id,checksum,file_size_bytes,mime_type,storage_bucket,storage_path,qa_status")
      .eq("organization_id", params.organizationId).in("id", ids).limit(ids.length + 1).abortSignal(signal);
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
    if (byId.size !== ids.length || rows.length !== ids.length || rows.some(row => row.organization_id !== params.organizationId)) throw new Error();
    const imageAssets = ids.map(id => {
      const row = byId.get(id);
      if (!row) throw new Error();
      return htmlEditingImageIdentitySchema.parse({productionAssetId: row.id, checksum: row.checksum,
        fileSizeBytes: row.file_size_bytes, mimeType: row.mime_type, storageBucket: row.storage_bucket, storagePath: row.storage_path});
    });
    hyperframesAssetManifestSchema.parse(imageAssets);
    return {...snapshot, imageAssets};
  } catch { throw new Error("HTML_EDITING_SNAPSHOT_IMAGE_IDENTITY_INVALID"); }
}
