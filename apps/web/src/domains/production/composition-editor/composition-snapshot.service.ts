import { createHash } from "node:crypto";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentCompositionDocument } from "./composition-document.service";
import { compileCompositionPreview } from "./composition-preview-compiler.service";
import { validateHyperframesPreflight } from "../hyperframes/hyperframes-preflight.service";
import { HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES, HYPERFRAMES_COMPOSITION_FORMAT, hyperframesAssetManifestSchema } from "../hyperframes/hyperframes.types";

const PROJECT_BUCKET = "production-assets";

export class CompositionSnapshotError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type AssetRow = { checksum: string; file_size_bytes: number; id: string; mime_type: string; storage_bucket: string; storage_path: string };

/** Freezes exactly one saved native document into the immutable render revision contract. */
export async function snapshotCompositionDocument(params: {
  compositionId: string;
  draftId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
  userId: string;
}) {
  const [{ data: draft, error: draftError }, { data: composition, error: compositionError }, current] = await Promise.all([
    params.supabase.from("video_composition_drafts").select("id, composition_id, state").eq("id", params.draftId).eq("organization_id", params.organizationId).maybeSingle(),
    params.supabase.from("video_compositions").select("id, status").eq("id", params.compositionId).eq("organization_id", params.organizationId).maybeSingle(),
    getCurrentCompositionDocument({ draftId: params.draftId, organizationId: params.organizationId, supabase: params.supabase }),
  ]);
  if (draftError) throw draftError;
  if (compositionError) throw compositionError;
  if (!draft || draft.composition_id !== params.compositionId || draft.state !== "ACTIVE") throw new CompositionSnapshotError("El borrador no pertenece a una composici\u00f3n editable.", 409);
  if (!composition) throw new CompositionSnapshotError("La composici\u00f3n no existe.", 404);

  const { data: existing, error: existingError } = await params.supabase
    .from("video_composition_revisions")
    .select("id, revision_number, project_hash, project_archive_size_bytes")
    .eq("composition_id", params.compositionId)
    .contains("manifest", { draft_document_hash: current.documentHash })
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { ...existing, documentHash: current.documentHash, reused: true, version: current.version };

  const referencedAssetIds = [...new Set(current.document.clips.flatMap((clip) => clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []))];
  const assets = await readSnapshotAssets(params, referencedAssetIds);
  const manifest = hyperframesAssetManifestSchema.parse(assets.map((asset) => ({
    checksum: asset.checksum,
    fileSizeBytes: asset.file_size_bytes,
    mimeType: asset.mime_type,
    productionAssetId: asset.id,
    storagePath: asset.storage_path,
  })));
  const preflight = validateHyperframesPreflight({ assets: manifest });
  if (!preflight.valid) throw new CompositionSnapshotError(preflight.errors.join(" "));

  const zip = new JSZip();
  const assetFiles = new Map<string, string>();
  for (const asset of assets) assetFiles.set(asset.id, `assets/${asset.id}.${fileExtension(asset.mime_type)}`);
  const snapshotHtml = await compileCompositionPreview({ document: current.document, assetUrls: assetFiles });
  zip.file("index.html", snapshotHtml);
  zip.file("composition-document.json", JSON.stringify(current.document, null, 2));
  zip.file("asset-manifest.json", JSON.stringify(manifest, null, 2));
  for (const asset of assets) {
    const bytes = await downloadAndVerify(params.supabase, asset);
    zip.file(assetFiles.get(asset.id)!, bytes);
  }
  const archive = await zip.generateAsync({ compression: "DEFLATE", type: "uint8array", compressionOptions: { level: 9 } });
  const archivePreflight = validateHyperframesPreflight({ archiveSizeBytes: archive.byteLength, assets: manifest });
  if (!archivePreflight.valid || archive.byteLength > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES) {
    throw new CompositionSnapshotError(archivePreflight.errors.join(" ") || "El snapshot excede el l\u00edmite de 200 MB.");
  }
  const projectHash = createHash("sha256").update(archive).digest("hex");
  // The document hash identifies the semantic edit; the archive hash identifies
  // the exact bytes that a renderer will download. Never overwrite a prior
  // snapshot path, because an already-submitted render may still reference it.
  const projectPath = `composition-snapshots/${params.organizationId}/${params.compositionId}/${projectHash}.zip`;
  const { error: uploadError } = await params.supabase.storage.from(PROJECT_BUCKET).upload(projectPath, archive, { contentType: "application/zip", upsert: false });
  if (uploadError) throw uploadError;
  const { data: latest, error: latestError } = await params.supabase.from("video_composition_revisions").select("revision_number").eq("composition_id", params.compositionId).order("revision_number", { ascending: false }).limit(1).maybeSingle();
  if (latestError) throw latestError;
  const { data: revision, error: revisionError } = await params.supabase.from("video_composition_revisions").insert({
    composition_id: params.compositionId,
    created_by: params.userId,
    entry_point: "index.html",
    format: HYPERFRAMES_COMPOSITION_FORMAT,
    generation_mode: "AUTOMATIC",
    manifest: { asset_manifest: manifest, draft_document_hash: current.documentHash, draft_document_version: current.version, snapshot: true },
    organization_id: params.organizationId,
    project_archive_size_bytes: archive.byteLength,
    project_hash: projectHash,
    project_storage_bucket: PROJECT_BUCKET,
    project_storage_path: projectPath,
    revision_number: (latest?.revision_number || 0) + 1,
    variables_schema: [],
    variables_values: current.document.variables,
  }).select("id, revision_number, project_hash, project_archive_size_bytes").single();
  if (revisionError) throw revisionError;
  if (manifest.length > 0) {
    const { error: linkError } = await params.supabase.from("video_composition_assets").insert(manifest.map((asset) => ({
      composition_revision_id: revision.id, file_size_bytes: asset.fileSizeBytes, mime_type: asset.mimeType, organization_id: params.organizationId,
      production_asset_id: asset.productionAssetId, role: asset.mimeType.startsWith("audio/") ? "AUDIO" : asset.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE",
      source_checksum: asset.checksum, source_storage_path: asset.storagePath,
    })));
    if (linkError) throw linkError;
  }
  const { error: compositionUpdateError } = await params.supabase.from("video_compositions").update({ active_revision_id: revision.id, status: "READY_FOR_PREVIEW", updated_at: new Date().toISOString() }).eq("id", params.compositionId).eq("organization_id", params.organizationId);
  if (compositionUpdateError) throw compositionUpdateError;
  return { ...revision, documentHash: current.documentHash, preflight: archivePreflight, reused: false, version: current.version };
}

async function readSnapshotAssets(params: { draftId: string; organizationId: string; supabase: SupabaseClient<any, "public", any> }, ids: string[]) {
  if (ids.length === 0) return [] as AssetRow[];
  const { data: linked, error: linkError } = await params.supabase.from("video_composition_draft_assets").select("production_asset_id").eq("draft_id", params.draftId).eq("organization_id", params.organizationId).in("production_asset_id", ids);
  if (linkError) throw linkError;
  if ((linked || []).length !== ids.length) throw new CompositionSnapshotError("El documento contiene assets que no pertenecen al borrador.", 409);
  const { data, error } = await params.supabase.from("production_assets").select("id, checksum, file_size_bytes, mime_type, storage_bucket, storage_path").eq("organization_id", params.organizationId).in("id", ids);
  if (error) throw error;
  if ((data || []).length !== ids.length) throw new CompositionSnapshotError("No se pudo resolver uno o m\u00e1s assets del snapshot.", 409);
  return data as AssetRow[];
}

async function downloadAndVerify(supabase: SupabaseClient<any, "public", any>, asset: AssetRow) {
  const path = bucketRelativePath(asset.storage_bucket, asset.storage_path);
  const { data, error } = await supabase.storage.from(asset.storage_bucket).download(path);
  if (error) throw error;
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength !== asset.file_size_bytes) throw new CompositionSnapshotError(`El tama\u00f1o de ${asset.id} no coincide con su registro.`);
  if (createHash("sha256").update(bytes).digest("hex") !== asset.checksum.toLowerCase()) throw new CompositionSnapshotError(`El checksum de ${asset.id} no coincide con su registro.`);
  return bytes;
}

function bucketRelativePath(bucket: string, storagePath: string) {
  const path = storagePath.startsWith(`${bucket}/`) ? storagePath.slice(bucket.length + 1) : storagePath;
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) throw new CompositionSnapshotError("La ruta de un asset no es segura.");
  return path;
}
function fileExtension(mime: string) { const value = mime.split("/")[1]?.toLowerCase(); return value === "jpeg" ? "jpg" : value === "mpeg" ? "mp3" : value?.replace(/[^a-z0-9]/g, "") || "bin"; }
