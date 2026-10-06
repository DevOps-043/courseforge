import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { hyperframesAssetManifestSchema, hyperframesAssetManifestItemSchema, HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS } from "../hyperframes/hyperframes.types";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";

const uuid = z.string().uuid();
const owner = {organization_id:uuid,draft_id:uuid};
const row = z.object({id:uuid,organization_id:uuid,checksum:z.string(),file_size_bytes:z.number(),mime_type:z.string(),
  storage_bucket:z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/),storage_path:z.string()});
const productionRow = row.extend({qa_status:z.enum(["GENERATED","READY_FOR_QA","APPROVED","EXPORTED","PUBLISHED"]),
  public_url:z.string().max(4096).nullable()}).strict();
const brandingRow = row.extend({status:z.literal("APPROVED")}).strict();
const soundRow = row.omit({checksum:true}).extend({checksum_sha256:z.string(),status:z.literal("READY")}).strict();

/** Server-only acquisition from an independently authorized saved document.
 * Bounded batched reads recheck tenant/draft links and current status. They are
 * not an atomic authority snapshot: commit and worker must revalidate identity.
 * Public URLs are mapping keys only, never fetched or treated as permission. */
export async function readHtmlSnapshotNativeMedia(params:{supabase:SupabaseClient;organizationId:string;draftId:string;
  document:CompositionEditorDocument;signal?:AbortSignal}) {
  const scope = z.object({organizationId:uuid,draftId:uuid}).parse(params);
  params.signal?.throwIfAborted();
  const document = compositionEditorDocumentSchema.parse(params.document);
  const idsFor = (type:string) => [...new Set(document.clips.flatMap(clip => {
    if (type === "PRODUCTION_ASSET" && clip.source.type === type) return [clip.source.productionAssetId];
    if (type === "ASSEMBLY_BRAND_ASSET" && clip.source.type === type) return [clip.source.assemblyBrandAssetId];
    if (type === "SOUND_EFFECT_ASSET" && clip.source.type === type) return [clip.source.soundEffectAssetId];
    return [];
  }))].sort();
  const productionIds = idsFor("PRODUCTION_ASSET"), brandingIds = idsFor("ASSEMBLY_BRAND_ASSET"), soundIds = idsFor("SOUND_EFFECT_ASSET");
  if (productionIds.length + brandingIds.length + soundIds.length > HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS)
    throw new Error("HTML_SNAPSHOT_MEDIA_LIMIT");
  const timeout = AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
  const signal = params.signal ? AbortSignal.any([params.signal,timeout]) : timeout;
  const execute = async (query: {abortSignal(signal:AbortSignal):PromiseLike<{data:unknown;error:unknown}>}) => {
    signal.throwIfAborted();const result = await query.abortSignal(signal);signal.throwIfAborted();
    if (result.error || Buffer.byteLength(JSON.stringify(result.data) ?? "") > HTML_EDITING_REPOSITORY_POLICY.responseBytes)
      throw new Error("HTML_SNAPSHOT_MEDIA_UNAVAILABLE");
    return result.data;
  };
  const read = (table:string,columns:string) => params.supabase.from(table).select(columns).eq("organization_id",scope.organizationId);
  const verifyLinks = async (table:string,column:"production_asset_id" | "sound_effect_asset_id",ids:string[]) => {
    if (!ids.length) return;
    const raw = await execute(read(table,`organization_id,draft_id,${column}`).eq("draft_id",scope.draftId).in(column,ids).limit(ids.length+1));
    const links = column === "production_asset_id"
      ? z.array(z.object({...owner,production_asset_id:uuid}).strict()).max(ids.length).parse(raw)
        .map(link => ({...link,assetId:link.production_asset_id}))
      : z.array(z.object({...owner,sound_effect_asset_id:uuid}).strict()).max(ids.length).parse(raw)
        .map(link => ({...link,assetId:link.sound_effect_asset_id}));
    const linked = new Set(links.map(link => link.assetId));
    if (links.length !== ids.length || linked.size !== ids.length || ids.some(id => !linked.has(id))
      || links.some(link => link.organization_id !== scope.organizationId || link.draft_id !== scope.draftId))
      throw new Error("HTML_SNAPSHOT_MEDIA_FORBIDDEN");
  };
  const assertRows = (rows:Array<{id:string;organization_id:string}>,ids:string[]) => {
    if (rows.length !== ids.length || new Set(rows.map(asset => asset.id)).size !== ids.length
      || rows.some(asset => asset.organization_id !== scope.organizationId || !ids.includes(asset.id)))
      throw new Error("HTML_SNAPSHOT_MEDIA_FORBIDDEN");
  };
  try {
    await Promise.all([verifyLinks("video_composition_draft_assets","production_asset_id",productionIds),
      verifyLinks("video_composition_draft_sound_effect_assets","sound_effect_asset_id",soundIds)]);
    // Dependencies are still draft linked and bounded even when only one URL is used.
    const deckSource = document.clips.flatMap(clip => clip.source.type === "DECK_SLIDE" ? [clip.source.html] : []).join("\n")
      + JSON.stringify(document.deckStyles);
    const hasDeck = document.clips.some(clip => clip.source.type === "DECK_SLIDE");
    const dependencyRaw = hasDeck ? await execute(read("video_composition_draft_assets","organization_id,draft_id,production_asset_id,source_reference")
      .eq("draft_id",scope.draftId).eq("source_reference","DECK_DEPENDENCY").limit(HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS+1)) : [];
    const dependencies = z.array(z.object({...owner,production_asset_id:uuid,source_reference:z.literal("DECK_DEPENDENCY")}).strict())
      .max(HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS).parse(dependencyRaw);
    if (dependencies.some(link => link.organization_id !== scope.organizationId || link.draft_id !== scope.draftId)
      || new Set(dependencies.map(link => link.production_asset_id)).size !== dependencies.length) throw new Error();
    const allProductionIds = [...new Set([...productionIds,...dependencies.map(link => link.production_asset_id)])].sort();
    if (allProductionIds.length + brandingIds.length + soundIds.length > HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS) throw new Error();
    const common = "id,organization_id,checksum,file_size_bytes,mime_type,storage_bucket,storage_path";
    const production = allProductionIds.length ? z.array(productionRow).max(allProductionIds.length).parse(await execute(
      read("production_assets",`${common},qa_status,public_url`).in("id",allProductionIds).limit(allProductionIds.length+1))) : [];
    assertRows(production,allProductionIds);
    if (brandingIds.length) {
      const branding = z.array(z.object({...owner,intro_asset_id:uuid.nullable(),outro_asset_id:uuid.nullable()}).strict()).length(1).parse(await execute(
        read("video_composition_draft_branding","organization_id,draft_id,intro_asset_id,outro_asset_id").eq("draft_id",scope.draftId).limit(2)))[0]!;
      if (branding.organization_id !== scope.organizationId || branding.draft_id !== scope.draftId
        || brandingIds.some(id => id !== branding.intro_asset_id && id !== branding.outro_asset_id)) throw new Error();
    }
    const brands = brandingIds.length ? z.array(brandingRow).max(brandingIds.length).parse(await execute(
      read("organization_assembly_assets",`${common},status`).in("id",brandingIds).eq("status","APPROVED").limit(brandingIds.length+1))) : [];
    assertRows(brands,brandingIds);
    const sounds = soundIds.length ? z.array(soundRow).max(soundIds.length).parse(await execute(
      read("sound_effect_assets","id,organization_id,checksum_sha256,file_size_bytes,mime_type,storage_bucket,storage_path,status")
        .in("id",soundIds).eq("status","READY").limit(soundIds.length+1))) : [];
    assertRows(sounds,soundIds);
    const usedProduction = production.filter(asset => productionIds.includes(asset.id) || asset.public_url && deckSource.includes(asset.public_url));
    const deckPublicUrls = new Map<string,string>();const urlOwners = new Map<string,string>();
    for (const asset of usedProduction) if (asset.public_url && deckSource.includes(asset.public_url)) {
      if (urlOwners.has(asset.public_url) && urlOwners.get(asset.public_url) !== asset.id) throw new Error();
      urlOwners.set(asset.public_url,asset.id);deckPublicUrls.set(asset.id,asset.public_url);
    }
    const resources = [...usedProduction,...brands,...sounds.map(asset => ({...asset,checksum:asset.checksum_sha256}))];
    // Same UUID in distinct origin tables is ambiguous even if bytes match.
    if (new Set(resources.map(asset => asset.id)).size !== resources.length) throw new Error();
    const assets = hyperframesAssetManifestSchema.parse(resources.map(asset => hyperframesAssetManifestItemSchema.parse({
      productionAssetId:asset.id,checksum:asset.checksum,fileSizeBytes:asset.file_size_bytes,mimeType:asset.mime_type,
      storageBucket:asset.storage_bucket,storagePath:asset.storage_path}))).sort((a,b) => a.productionAssetId.localeCompare(b.productionAssetId));
    signal.throwIfAborted();return {assets,deckPublicUrls};
  } catch {
    params.signal?.throwIfAborted();throw new Error("HTML_SNAPSHOT_MEDIA_UNAVAILABLE_OR_FORBIDDEN");
  }
}
