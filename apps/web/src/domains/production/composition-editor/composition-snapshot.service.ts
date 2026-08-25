import { createHash } from "node:crypto";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentCompositionDocument } from "./composition-document.service";
import {
  COMPOSITION_COMPILATION_TARGETS,
  compileCompositionPreview,
  readCompositionAnimationRuntime,
} from "./composition-preview-compiler.service";
import { validateHyperframesPreflight } from "../hyperframes/hyperframes-preflight.service";
import {
  buildHyperframesAssetVariableNames,
  buildHyperframesAssetVariableSchema,
  resolveHyperframesAssetDeliveryUrl,
} from "../hyperframes/hyperframes-asset-delivery.service";
import {
  HYPERFRAMES_ASSET_DELIVERY_MODES,
  HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES,
  HYPERFRAMES_COMPOSITION_FORMAT,
  hyperframesAssetManifestSchema,
  hyperframesRenderProfileSchema,
} from "../hyperframes/hyperframes.types";
import {
  HYPERFRAMES_DURABLE_RENDER_PROFILE,
  validateHyperframesMediaAsset,
} from "../hyperframes/hyperframes-media-constraints";
import {
  findHyperframesRenderProfile,
  toHyperframesRenderSettings,
  type HyperframesRenderProfile,
  type HyperframesRenderSettings,
} from "../hyperframes/hyperframes-render-profiles";

const PROJECT_BUCKET = "production-assets";

export class CompositionSnapshotError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type AssetRow = { checksum: string; file_size_bytes: number; id: string; metadata: Record<string, unknown> | null; mime_type: string; public_url: string | null; storage_bucket: string; storage_path: string };

export type CompositionSnapshotSummary = {
  createdAt: string;
  documentHash: string;
  documentVersion: number;
  id: string;
  isActive: boolean;
  projectArchiveSizeBytes: number;
  renderProfile: HyperframesRenderSettings | null;
  renderProfileId: string | null;
  revisionNumber: number;
};

/** Freezes exactly one saved native document into the immutable render revision contract. */
export async function snapshotCompositionDocument(params: {
  compositionId: string;
  draftId: string;
  organizationId: string;
  renderProfile: HyperframesRenderProfile;
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
  assertCompositionSnapshotRenderContract(current.document);
  if (!current.document.canvas.durationSource && current.document.canvas.durationMode !== "USER_EDITED") {
    throw new CompositionSnapshotError(
      "La duración todavía no tiene un origen verificable. Usa ‘Calcular y organizar’ en el timeline antes de preparar el ensamble.",
      409,
    );
  }

  const renderSettings = toHyperframesRenderSettings(params.renderProfile);
  const persistedRenderProfile = { id: params.renderProfile.id, ...renderSettings };
  const { data: existing, error: existingError } = await params.supabase
    .from("video_composition_revisions")
    .select("id, revision_number, project_hash, project_archive_size_bytes")
    .eq("composition_id", params.compositionId)
    .contains("manifest", {
      asset_delivery_mode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
      draft_document_hash: current.documentHash,
      render_profile: persistedRenderProfile,
    })
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    await setActiveCompositionSnapshot({
      compositionId: params.compositionId,
      organizationId: params.organizationId,
      revisionId: existing.id,
      supabase: params.supabase,
    });
    return { ...existing, documentHash: current.documentHash, reused: true, version: current.version };
  }

  const referencedAssetIds = [...new Set(current.document.clips.flatMap((clip) => clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []))];
  const [clipAssets, deckDependencies] = await Promise.all([
    readSnapshotAssets(params, referencedAssetIds),
    readReferencedDeckDependencies(params, current.document),
  ]);
  const assets = [...new Map([...clipAssets, ...deckDependencies].map((asset) => [asset.id, asset])).values()];
  const mediaErrors = assets.flatMap((asset) => validateHyperframesMediaAsset({
    deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
    fileName: typeof asset.metadata?.file_name === "string" ? asset.metadata.file_name : asset.storage_path,
    fileSizeBytes: asset.file_size_bytes,
    height: readPositiveInteger(asset.metadata?.source_height),
    mimeType: asset.mime_type,
    width: readPositiveInteger(asset.metadata?.source_width),
  }).errors);
  if (mediaErrors.length > 0) throw new CompositionSnapshotError(mediaErrors.join(" "));
  const manifest = hyperframesAssetManifestSchema.parse(assets.map((asset) => ({
    checksum: asset.checksum,
    fileSizeBytes: asset.file_size_bytes,
    mimeType: asset.mime_type,
    productionAssetId: asset.id,
    storageBucket: asset.storage_bucket,
    storagePath: asset.storage_path,
  })));
  const preflight = validateHyperframesPreflight({
    assets: manifest,
    deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
    durationSeconds: current.document.canvas.durationSeconds,
    renderProfile: renderSettings,
  });
  if (!preflight.valid) throw new CompositionSnapshotError(preflight.errors.join(" "));

  const zip = new JSZip();
  const assetVariableNames = buildHyperframesAssetVariableNames(manifest);
  // Direct media is represented by provider variables and receives its URL at
  // submission time. Only deck-owned public dependencies must be rewritten in
  // the immutable HTML snapshot.
  const manifestById = new Map(manifest.map((asset) => [asset.productionAssetId, asset]));
  const assetDeliveryUrls = new Map(await Promise.all(deckDependencies.map(async (asset) => {
    const manifestAsset = manifestById.get(asset.id);
    if (!manifestAsset) throw new CompositionSnapshotError("Falta una dependencia del deck en el manifiesto.");
    return [
      asset.id,
      await resolveHyperframesAssetDeliveryUrl({ asset: manifestAsset, supabase: params.supabase }),
    ] as const;
  })));
  const deckAssetUrls = new Map(deckDependencies.flatMap((asset) => (
    asset.public_url ? [[asset.public_url, assetDeliveryUrls.get(asset.id)!] as const] : []
  )));
  const [snapshotHtml, animationRuntime] = await Promise.all([
    compileCompositionPreview({
      assetUrls: assetDeliveryUrls,
      assetVariableNames,
      deckAssetUrls,
      document: current.document,
      target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
    }),
    readCompositionAnimationRuntime(),
  ]);
  zip.file("index.html", snapshotHtml);
  zip.file("assets/gsap.min.js", animationRuntime);
  zip.file("composition-document.json", JSON.stringify(current.document, null, 2));
  zip.file("asset-manifest.json", JSON.stringify(manifest, null, 2));
  const archive = await zip.generateAsync({ compression: "DEFLATE", type: "uint8array", compressionOptions: { level: 6 } });
  const archivePreflight = validateHyperframesPreflight({
    archiveSizeBytes: archive.byteLength,
    assets: manifest,
    deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
    durationSeconds: current.document.canvas.durationSeconds,
    renderProfile: renderSettings,
  });
  if (!archivePreflight.valid || archive.byteLength > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES) {
    throw new CompositionSnapshotError(archivePreflight.errors.join(" ") || "El snapshot excede el l\u00edmite de 200 MB.");
  }
  const projectHash = createHash("sha256").update(archive).digest("hex");
  // The document hash identifies the semantic edit; the archive hash identifies
  // the exact bytes that a renderer will download. A repeated path can only be
  // produced by the same bytes, so retrying an interrupted upload is safe.
  const projectPath = `composition-snapshots/${params.organizationId}/${params.compositionId}/${projectHash}.zip`;
  // The path is content-addressed by projectHash. Replacing an orphan left by
  // an interrupted request is therefore idempotent: the bytes are identical.
  const { error: uploadError } = await params.supabase.storage.from(PROJECT_BUCKET).upload(projectPath, archive, { contentType: "application/zip", upsert: true });
  if (uploadError) {
    throw new CompositionSnapshotError(
      `No se pudo cargar el archivo del snapshot${readExternalErrorCode(uploadError) ? ` (${readExternalErrorCode(uploadError)})` : ""}.`,
      502,
    );
  }
  const { data: latest, error: latestError } = await params.supabase.from("video_composition_revisions").select("revision_number").eq("composition_id", params.compositionId).order("revision_number", { ascending: false }).limit(1).maybeSingle();
  if (latestError) {
    throw new CompositionSnapshotError(
      `No se pudo calcular la siguiente revisión${readExternalErrorCode(latestError) ? ` (${readExternalErrorCode(latestError)})` : ""}.`,
      500,
    );
  }
  const creatorId = await resolveSnapshotCreatorId(params.supabase, params.userId);
  const { data: revision, error: revisionError } = await params.supabase.from("video_composition_revisions").insert({
    composition_id: params.compositionId,
    created_by: creatorId,
    entry_point: "index.html",
    format: HYPERFRAMES_COMPOSITION_FORMAT,
    generation_mode: "AUTOMATIC",
    manifest: {
      asset_delivery_mode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
      asset_manifest: manifest,
      canvas_duration_seconds: current.document.canvas.durationSeconds,
      draft_document_hash: current.documentHash,
      draft_document_version: current.version,
      render_profile: {
        ...persistedRenderProfile,
      },
      snapshot: true,
    },
    organization_id: params.organizationId,
    project_archive_size_bytes: archive.byteLength,
    project_hash: projectHash,
    project_storage_bucket: PROJECT_BUCKET,
    project_storage_path: projectPath,
    revision_number: (latest?.revision_number || 0) + 1,
    variables_schema: buildHyperframesAssetVariableSchema(manifest),
    variables_values: current.document.variables,
  }).select("id, revision_number, project_hash, project_archive_size_bytes").single();
  if (revisionError) {
    throw new CompositionSnapshotError(
      `El archivo se cargó, pero no se pudo registrar la revisión${readExternalErrorCode(revisionError) ? ` (${readExternalErrorCode(revisionError)})` : ""}.`,
      500,
    );
  }
  if (manifest.length > 0) {
    const { error: linkError } = await params.supabase.from("video_composition_assets").insert(manifest.map((asset) => ({
      composition_revision_id: revision.id, file_size_bytes: asset.fileSizeBytes, mime_type: asset.mimeType, organization_id: params.organizationId,
      production_asset_id: asset.productionAssetId, role: asset.mimeType.startsWith("audio/") ? "AUDIO" : asset.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE",
      source_checksum: asset.checksum, source_storage_path: asset.storagePath,
    })));
    if (linkError) {
      throw new CompositionSnapshotError(
        `La revisión se creó, pero no se pudieron vincular sus assets${readExternalErrorCode(linkError) ? ` (${readExternalErrorCode(linkError)})` : ""}.`,
        500,
      );
    }
  }
  await setActiveCompositionSnapshot({
    compositionId: params.compositionId,
    organizationId: params.organizationId,
    revisionId: revision.id,
    supabase: params.supabase,
  });
  return { ...revision, documentHash: current.documentHash, preflight: archivePreflight, reused: false, version: current.version };
}

/** Lists immutable snapshots for one composition without exposing Storage paths. */
export async function listCompositionSnapshots(params: {
  compositionId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}): Promise<{ activeRevisionId: string | null; snapshots: CompositionSnapshotSummary[]; status: string }> {
  const { data: composition, error: compositionError } = await params.supabase
    .from("video_compositions")
    .select("active_revision_id, status")
    .eq("id", params.compositionId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (compositionError) throw compositionError;
  if (!composition) throw new CompositionSnapshotError("La composición no existe.", 404);

  const { data, error } = await params.supabase
    .from("video_composition_revisions")
    .select("id, revision_number, project_archive_size_bytes, manifest, created_at")
    .eq("composition_id", params.compositionId)
    .eq("organization_id", params.organizationId)
    .contains("manifest", { snapshot: true })
    .order("revision_number", { ascending: false })
    .limit(50);
  if (error) throw error;

  return {
    activeRevisionId: composition.active_revision_id as string | null,
    snapshots: (data || []).map((row) => {
      const manifest = asRecord(row.manifest);
      const persistedRenderProfile = readPersistedRenderProfile(manifest);
      return {
        createdAt: String(row.created_at),
        documentHash: typeof manifest.draft_document_hash === "string" ? manifest.draft_document_hash : "",
        documentVersion: typeof manifest.draft_document_version === "number" ? manifest.draft_document_version : 0,
        id: String(row.id),
        isActive: row.id === composition.active_revision_id,
        projectArchiveSizeBytes: Number(row.project_archive_size_bytes),
        renderProfile: persistedRenderProfile.settings,
        renderProfileId: persistedRenderProfile.id,
        revisionNumber: Number(row.revision_number),
      };
    }),
    status: String(composition.status),
  };
}

/** Reactivates a prior immutable snapshot; approval is intentionally revoked. */
export async function activateCompositionSnapshot(params: {
  compositionId: string;
  organizationId: string;
  revisionId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const { data: revision, error } = await params.supabase
    .from("video_composition_revisions")
    .select("id, revision_number, project_archive_size_bytes, manifest, created_at")
    .eq("id", params.revisionId)
    .eq("composition_id", params.compositionId)
    .eq("organization_id", params.organizationId)
    .contains("manifest", { snapshot: true })
    .maybeSingle();
  if (error) throw error;
  if (!revision) throw new CompositionSnapshotError("El snapshot no existe o no pertenece a esta composición.", 404);
  await setActiveCompositionSnapshot(params);
  const manifest = asRecord(revision.manifest);
  const persistedRenderProfile = readPersistedRenderProfile(manifest);
  return {
    createdAt: String(revision.created_at),
    documentHash: typeof manifest.draft_document_hash === "string" ? manifest.draft_document_hash : "",
    documentVersion: typeof manifest.draft_document_version === "number" ? manifest.draft_document_version : 0,
    id: String(revision.id),
    isActive: true,
    projectArchiveSizeBytes: Number(revision.project_archive_size_bytes),
    renderProfile: persistedRenderProfile.settings,
    renderProfileId: persistedRenderProfile.id,
    revisionNumber: Number(revision.revision_number),
    status: "READY_FOR_PREVIEW" as const,
  };
}

async function setActiveCompositionSnapshot(params: {
  compositionId: string;
  organizationId: string;
  revisionId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const { data, error } = await params.supabase
    .from("video_compositions")
    .update({ active_revision_id: params.revisionId, status: "READY_FOR_PREVIEW", updated_at: new Date().toISOString() })
    .eq("id", params.compositionId)
    .eq("organization_id", params.organizationId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new CompositionSnapshotError("La composición no existe.", 404);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function readSnapshotAssets(params: { draftId: string; organizationId: string; supabase: SupabaseClient<any, "public", any> }, ids: string[]) {
  if (ids.length === 0) return [] as AssetRow[];
  const { data: linked, error: linkError } = await params.supabase.from("video_composition_draft_assets").select("production_asset_id").eq("draft_id", params.draftId).eq("organization_id", params.organizationId).in("production_asset_id", ids);
  if (linkError) throw linkError;
  if ((linked || []).length !== ids.length) throw new CompositionSnapshotError("El documento contiene assets que no pertenecen al borrador.", 409);
  const { data, error } = await params.supabase.from("production_assets").select("id, checksum, file_size_bytes, metadata, mime_type, public_url, storage_bucket, storage_path").eq("organization_id", params.organizationId).in("id", ids);
  if (error) throw error;
  if ((data || []).length !== ids.length) throw new CompositionSnapshotError("No se pudo resolver uno o m\u00e1s assets del snapshot.", 409);
  return data as AssetRow[];
}

async function readReferencedDeckDependencies(
  params: { draftId: string; organizationId: string; supabase: SupabaseClient<any, "public", any> },
  document: Awaited<ReturnType<typeof getCurrentCompositionDocument>>["document"],
) {
  const { data: links, error: linksError } = await params.supabase
    .from("video_composition_draft_assets")
    .select("production_asset_id")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .eq("source_reference", "DECK_DEPENDENCY");
  if (linksError) throw linksError;
  const dependencyIds = [...new Set((links || []).map((link) => link.production_asset_id as string))];
  if (dependencyIds.length === 0) return [] as AssetRow[];

  const { data, error } = await params.supabase
    .from("production_assets")
    .select("id, checksum, file_size_bytes, metadata, mime_type, public_url, storage_bucket, storage_path")
    .eq("organization_id", params.organizationId)
    .in("id", dependencyIds);
  if (error) throw error;
  const deckSource = JSON.stringify({
    deckStyles: document.deckStyles,
    slides: document.clips.flatMap((clip) => clip.source.type === "DECK_SLIDE" ? [clip.source.html] : []),
  });
  return (data || []).filter((asset) => (
    typeof asset.public_url === "string" && asset.public_url.length > 0 && deckSource.includes(asset.public_url)
  )) as AssetRow[];
}

async function resolveSnapshotCreatorId(
  supabase: SupabaseClient<any, "public", any>,
  userId: string,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw new CompositionSnapshotError(
      `No se pudo validar el autor del snapshot${readExternalErrorCode(error) ? ` (${readExternalErrorCode(error)})` : ""}.`,
      500,
    );
  }
  // created_by is optional, but when present it references profiles rather
  // than auth.users. Auth Bridge identities without a synchronized profile
  // must not make an otherwise valid snapshot fail its foreign key.
  return data?.id ? String(data.id) : null;
}

function readExternalErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : "";
}

function readPersistedRenderProfile(manifest: Record<string, unknown>) {
  const parsed = hyperframesRenderProfileSchema.safeParse(manifest.render_profile);
  if (!parsed.success) return { id: null, settings: null };
  const settings = toHyperframesRenderSettings(parsed.data);
  return {
    id: parsed.data.id || findHyperframesRenderProfile(settings)?.id || null,
    settings,
  };
}

export function assertCompositionSnapshotRenderContract(
  document: Awaited<ReturnType<typeof getCurrentCompositionDocument>>["document"],
) {
  if (document.canvas.fps !== HYPERFRAMES_DURABLE_RENDER_PROFILE.fps) {
    throw new CompositionSnapshotError(
      "El documento usa un perfil de render anterior. Recarga el editor para migrarlo a 25 FPS antes de generar el snapshot.",
      409,
    );
  }
  const clipWithoutAudioMetadata = document.clips.find((clip) => (
    clip.kind === "VIDEO"
    && clip.source.type === "PRODUCTION_ASSET"
    && typeof clip.source.hasAudio !== "boolean"
  ));
  if (clipWithoutAudioMetadata) {
    throw new CompositionSnapshotError(
      `El video “${clipWithoutAudioMetadata.label}” todavía no tiene metadatos de audio. Recarga el editor antes de generar el snapshot.`,
      409,
    );
  }
}
function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}
