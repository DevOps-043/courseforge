import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { resolveProductionComponentContext } from "../jobs/production-jobs.service";
import {
  PRODUCTION_ASSET_TYPES,
  PRODUCTION_QA_STATUSES,
  type ProductionProvider,
} from "../types/production.types";
import type { ImportedCloudAsset, ProductionAssetType } from "../cloud-storage/types";
import {
  HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES,
  hyperframesAnimatedDeckSourceSchema,
  hyperframesAssetManifestSchema,
  type HyperframesAnimatedDeckSource,
  type HyperframesAssetManifestItem,
} from "./hyperframes.types";

const SUPPORTED_HYPERFRAMES_MIME = /^(audio|font|image|video)\/[a-z0-9.+-]+$/i;

interface InternalMaterialAssetReference {
  durationSeconds?: number;
  fileName: string | null;
  mimeType: string | null;
  publicUrl: string | null;
  sourceType: "DECK_DEPENDENCY" | "PRODUCTION_MEDIA";
  storagePath: string;
  timelineRole: "AUDIO" | "AVATAR" | "BROLL" | "VISUAL";
}

export function isSupportedHyperframesSourceMime(mimeType: string | null | undefined) {
  return SUPPORTED_HYPERFRAMES_MIME.test(mimeType || "");
}

export interface HyperframesSourceAssetCandidate extends HyperframesAssetManifestItem {
  durationSeconds?: number;
  eligibleForRevision: boolean;
  metadata: Record<string, unknown>;
  qaStatus: string;
  sourceType: "DECK_DEPENDENCY" | "PRODUCTION_MEDIA";
  timelineRole: "AUDIO" | "AVATAR" | "BROLL" | "VISUAL";
  validationErrors: string[];
}

/**
 * Keeps invalid candidates visible to the authoring UI. They must not be
 * silently omitted: an author needs to know which internal file prevents a
 * preview before the revision endpoint is called.
 */
export function inspectHyperframesSourceAsset(input: {
  checksum: string | null;
  durationSeconds?: number | null;
  fileSizeBytes: number | null;
  metadata?: Record<string, unknown> | null;
  mimeType: string | null;
  productionAssetId: string;
  qaStatus?: string | null;
  sourceType: "DECK_DEPENDENCY" | "PRODUCTION_MEDIA";
  storagePath: string | null;
  timelineRole?: "AUDIO" | "AVATAR" | "BROLL" | "VISUAL";
}): HyperframesSourceAssetCandidate | null {
  if (!isSupportedHyperframesSourceMime(input.mimeType)) return null;

  const item = {
    checksum: input.checksum,
    fileSizeBytes: input.fileSizeBytes,
    mimeType: input.mimeType,
    productionAssetId: input.productionAssetId,
    storagePath: input.storagePath,
  };
  const parsed = hyperframesAssetManifestSchema.element.safeParse(item);
  const fileName = typeof input.metadata?.file_name === "string"
    ? input.metadata.file_name
    : input.storagePath?.split("/").pop() || "Asset sin nombre";
  const validationErrors = parsed.success
    ? []
    : parsed.error.issues.map((issue) => issue.path.includes("fileSizeBytes")
      && typeof input.fileSizeBytes === "number"
      && input.fileSizeBytes > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES
        ? `“${fileName}” excede el máximo individual de 200 MB (${formatAssetSize(input.fileSizeBytes)}).`
        : issue.message);

  return {
    ...item,
    durationSeconds: typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
      ? input.durationSeconds
      : undefined,
    eligibleForRevision: parsed.success,
    metadata: input.metadata || {},
    qaStatus: input.qaStatus || "PENDING",
    sourceType: input.sourceType,
    timelineRole: input.timelineRole || "VISUAL",
    validationErrors,
  } as HyperframesSourceAssetCandidate;
}

/** Extracts only media already owned by Courseforge from the Production step. */
export function collectInternalMaterialAssetReferences(rawAssets: unknown): InternalMaterialAssetReference[] {
  const assets = isRecord(rawAssets) ? rawAssets : {};
  const references: InternalMaterialAssetReference[] = [];
  const add = (
    value: unknown,
    mimeType?: string | null,
    sourceType: InternalMaterialAssetReference["sourceType"] = "PRODUCTION_MEDIA",
    timelineRole: InternalMaterialAssetReference["timelineRole"] = "VISUAL",
  ) => {
    if (!isRecord(value) || typeof value.storage_path !== "string") return;
    if (!value.storage_path.startsWith("production-assets/")) return;
    const durationSeconds = positiveDuration(value.duration);
    references.push({
      ...(durationSeconds ? { durationSeconds } : {}),
      fileName: typeof value.file_name === "string" ? value.file_name : null,
      mimeType: typeof value.content_type === "string" ? value.content_type : mimeType || null,
      publicUrl: typeof value.public_url === "string" ? value.public_url : null,
      sourceType,
      storagePath: value.storage_path,
      timelineRole,
    });
  };

  add(assets.voice_audio, "audio/mpeg", "PRODUCTION_MEDIA", "AUDIO");
  add(assets.background_music, "audio/mpeg", "PRODUCTION_MEDIA", "AUDIO");
  for (const item of asArray(assets.b_roll_clips)) add(item, "video/mp4", "PRODUCTION_MEDIA", "BROLL");
  add(assets.avatar_video, "video/mp4", "PRODUCTION_MEDIA", "AVATAR");
  for (const item of asArray(assets.avatar_clips)) {
    if (!isRecord(item) || item.deleted === true) continue;
    add(item, "video/mp4", "PRODUCTION_MEDIA", "AVATAR");
  }
  const slides = isRecord(assets.slides) ? assets.slides : {};
  // A ready HTML deck owns its exported raster slides. Keep those files
  // traceable for preview/render, but never expose them as independent media.
  const hasReadyAnimatedDeck = Boolean(extractHyperframesAnimatedDeck(assets));
  for (const item of asArray(slides.images)) add(
    item,
    "image/png",
    hasReadyAnimatedDeck ? "DECK_DEPENDENCY" : "PRODUCTION_MEDIA",
    "VISUAL",
  );
  const animatedDeck = isRecord(slides.animated_deck) ? slides.animated_deck : {};
  for (const item of asArray(animatedDeck.remote_assets)) add(item, null, "DECK_DEPENDENCY", "VISUAL");

  return [...new Map(references.map((item) => [item.storagePath, item])).values()];
}

/**
 * Keeps the cleaned animated-deck source as HTML. Rasterized slide images are
 * deliberately not used when this source is available, so deck motion stays
 * editable and seekable in the composition preview.
 */
export function extractHyperframesAnimatedDeck(rawAssets: unknown): HyperframesAnimatedDeckSource | null {
  const assets = isRecord(rawAssets) ? rawAssets : {};
  const slides = isRecord(assets.slides) ? assets.slides : {};
  const animatedDeck = isRecord(slides.animated_deck) ? slides.animated_deck : null;
  if (!isRecord(animatedDeck)) return null;
  if (animatedDeck.status !== "READY_FOR_PREVIEW" && animatedDeck.status !== "READY_FOR_RENDER") return null;
  const parsed = hyperframesAnimatedDeckSourceSchema.safeParse({
    css: animatedDeck.css,
    fonts: animatedDeck.fonts,
    height: animatedDeck.height,
    slides: animatedDeck.slides,
    width: animatedDeck.width,
  });
  if (!parsed.success) return null;
  if (!isSafeDeckSource(parsed.data)) return null;
  return {
    ...parsed.data,
    slides: [...parsed.data.slides].sort((left, right) => left.index - right.index),
  };
}

export class HyperframesSourceAssetError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/**
 * Adds provenance for an existing internal Storage object. It does not copy or
 * delete files, so imports from Drive/OneDrive can be reused by HyperFrames.
 */
export async function registerImportedHyperframesSourceAsset(params: {
  componentId: string;
  createdBy: string;
  importType: ProductionAssetType;
  importedAsset: ImportedCloudAsset;
  organizationId: string;
  provider: Extract<ProductionProvider, "google_drive" | "onedrive">;
  supabase: SupabaseClient<any, "public", any>;
}) {
  if (!isSupportedHyperframesSourceMime(params.importedAsset.mimeType)) {
    return null;
  }
  const { storageBucket } = parseStoredPath(params.importedAsset.storagePath);
  const context = await resolveProductionComponentContext({
    componentId: params.componentId,
    supabase: params.supabase,
  });
  if (context.organizationId !== params.organizationId) {
    throw new HyperframesSourceAssetError("El componente no pertenece a la empresa activa.", 403);
  }

  const { data: existing, error: existingError } = await params.supabase
    .from("production_assets")
    .select("id")
    .eq("organization_id", params.organizationId)
    .eq("material_component_id", params.componentId)
    .eq("storage_bucket", storageBucket)
    .eq("storage_path", params.importedAsset.storagePath)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return existing.id as string;

  const { data, error } = await params.supabase
    .from("production_assets")
    .insert({
      artifact_id: context.artifactId,
      asset_type: PRODUCTION_ASSET_TYPES.SOURCE_MEDIA,
      checksum: params.importedAsset.checksum,
      content: {
        imported_from: params.provider,
        import_type: params.importType,
      },
      created_by: params.createdBy,
      file_size_bytes: params.importedAsset.fileSizeBytes,
      lesson_id: context.lessonId,
      material_component_id: context.componentId,
      material_lesson_id: context.materialLessonId,
      metadata: {
        file_name: params.importedAsset.fileName || null,
        import_type: params.importType,
        source_provider: params.provider,
      },
      mime_type: params.importedAsset.mimeType,
      module_id: context.moduleId,
      organization_id: params.organizationId,
      provider: params.provider,
      public_url: params.importedAsset.publicUrl,
      qa_status: PRODUCTION_QA_STATUSES.GENERATED,
      storage_bucket: storageBucket,
      storage_path: params.importedAsset.storagePath,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/**
 * Bridges the existing Production asset JSON to the traceable asset registry.
 * Files stay in their current storage path; only metadata/provenance is added.
 */
export async function syncHyperframesSourceAssetsFromProduction(params: {
  componentId: string;
  createdBy: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const context = await resolveProductionComponentContext({ componentId: params.componentId, supabase: params.supabase });
  if (context.organizationId !== params.organizationId) {
    throw new HyperframesSourceAssetError("El componente no pertenece a la empresa activa.", 403);
  }
  const { data: component, error: componentError } = await params.supabase
    .from("material_components")
    .select("assets")
    .eq("id", params.componentId)
    .single();
  if (componentError) throw componentError;

  const animatedDeck = extractHyperframesAnimatedDeck(component?.assets);
  let synchronized = 0;
  const skipped: string[] = [];
  for (const reference of collectInternalMaterialAssetReferences(component?.assets)) {
    const stored = parseStoredPath(reference.storagePath);
    const { data: existing, error: existingError } = await params.supabase
      .from("production_assets")
      .select("id, checksum, duration_seconds, file_size_bytes, mime_type")
      .eq("organization_id", params.organizationId)
      .eq("material_component_id", params.componentId)
      .eq("asset_type", PRODUCTION_ASSET_TYPES.SOURCE_MEDIA)
      .eq("storage_bucket", stored.storageBucket)
      .eq("storage_path", reference.storagePath)
      .maybeSingle();
    if (existingError) throw existingError;
    const metadata = await getStoredFileMetadata(params.supabase, stored);
    const mimeType = reference.mimeType || metadata.mimeType || mimeTypeFromFileName(reference.fileName || stored.fileName);
    if (!isSupportedHyperframesSourceMime(mimeType)) {
      skipped.push(reference.storagePath);
      continue;
    }
    let bytes: Uint8Array | null = null;
    let fileSizeBytes = metadata.fileSizeBytes;
    if (!fileSizeBytes) {
      bytes = await downloadStoredAssetBytes(params.supabase, stored);
      fileSizeBytes = bytes.byteLength;
    }
    if (!fileSizeBytes) {
      skipped.push(reference.storagePath);
      continue;
    }
    if (
      existing?.id
      && existing.file_size_bytes === fileSizeBytes
      && existing.mime_type === mimeType
      && existing.checksum
      && (reference.durationSeconds === undefined || existing.duration_seconds === Math.round(reference.durationSeconds))
    ) continue;

    bytes = bytes || await downloadStoredAssetBytes(params.supabase, stored);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const assetRecord = {
      artifact_id: context.artifactId,
      asset_type: PRODUCTION_ASSET_TYPES.SOURCE_MEDIA,
      checksum,
      content: { imported_from: "production_step" },
      created_by: params.createdBy,
      ...(reference.durationSeconds ? { duration_seconds: Math.round(reference.durationSeconds) } : {}),
      file_size_bytes: fileSizeBytes,
      lesson_id: context.lessonId,
      material_component_id: context.componentId,
      material_lesson_id: context.materialLessonId,
      metadata: {
        assembly_source_type: reference.sourceType,
        file_name: reference.fileName || stored.fileName,
        source_provider: "production_step",
        timeline_role: reference.timelineRole,
      },
      mime_type: mimeType,
      module_id: context.moduleId,
      organization_id: params.organizationId,
      provider: "manual",
      public_url: reference.publicUrl,
      qa_status: PRODUCTION_QA_STATUSES.GENERATED,
      storage_bucket: stored.storageBucket,
      storage_path: reference.storagePath,
    };
    const { error: writeError } = existing?.id
      ? await params.supabase.from("production_assets").update(assetRecord).eq("id", existing.id)
      : await params.supabase.from("production_assets").insert(assetRecord);
    if (writeError) throw writeError;
    synchronized += 1;
  }
  return {
    animatedDeck: animatedDeck ? {
      animationCount: animatedDeck.slides.reduce((total, slide) => total + slide.animationCount, 0),
      slideCount: animatedDeck.slides.length,
    } : null,
    skipped,
    synchronized,
  };
}

/**
 * Returns every internally traceable media candidate. Invalid candidates are
 * retained with their validation errors so the UI can warn before submission.
 */
export async function listHyperframesSourceAssets(params: {
  componentId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const { data: component, error: componentError } = await params.supabase
    .from("material_components")
    .select("assets")
    .eq("id", params.componentId)
    .maybeSingle();
  if (componentError) throw componentError;
  const activeReferences = collectInternalMaterialAssetReferences(component?.assets);
  const referenceByPath = new Map(activeReferences.map((reference) => [reference.storagePath, reference]));

  const { data, error } = await params.supabase
    .from("production_assets")
    .select("id, asset_type, checksum, duration_seconds, file_size_bytes, mime_type, storage_path, storage_bucket, qa_status, created_at, metadata")
    .eq("organization_id", params.organizationId)
    .eq("material_component_id", params.componentId)
    .in("asset_type", [
      PRODUCTION_ASSET_TYPES.SOURCE_MEDIA,
      PRODUCTION_ASSET_TYPES.AVATAR_VIDEO,
      PRODUCTION_ASSET_TYPES.AVATAR_VIDEO_CLIP,
    ])
    .not("checksum", "is", null)
    .not("file_size_bytes", "is", null)
    .not("mime_type", "is", null)
    .not("storage_path", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const seenStoragePaths = new Set<string>();
  return (data || []).flatMap((asset) => {
    const reference = referenceByPath.get(asset.storage_path);
    const isAvatarRegistryAsset =
      asset.asset_type === PRODUCTION_ASSET_TYPES.AVATAR_VIDEO
      || asset.asset_type === PRODUCTION_ASSET_TYPES.AVATAR_VIDEO_CLIP;
    if (!reference && !isAvatarRegistryAsset) return [];
    if (typeof asset.storage_path !== "string" || seenStoragePaths.has(asset.storage_path)) return [];
    seenStoragePaths.add(asset.storage_path);
    const candidate = inspectHyperframesSourceAsset({
      checksum: asset.checksum,
      durationSeconds: asset.duration_seconds,
      fileSizeBytes: asset.file_size_bytes,
      metadata: isRecord(asset.metadata) ? asset.metadata : {},
      mimeType: asset.mime_type,
      productionAssetId: asset.id,
      qaStatus: asset.qa_status,
      sourceType: reference?.sourceType || "PRODUCTION_MEDIA",
      storagePath: asset.storage_path,
      timelineRole: reference?.timelineRole || (isAvatarRegistryAsset ? "AVATAR" : "VISUAL"),
    });
    return candidate ? [candidate] : [];
  });
}

function formatAssetSize(value: number) {
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function parseStoredPath(storedPath: string) {
  const [storageBucket, ...rest] = storedPath.split("/");
  const storagePath = rest.join("/");
  if (storageBucket !== "production-assets" || !storagePath || storagePath.includes("..") || storagePath.includes("\\")) {
    throw new HyperframesSourceAssetError("La ruta del asset importado no pertenece al storage interno permitido.");
  }
  return { fileName: storagePath.split("/").pop() || storagePath, storageBucket, storagePath };
}

async function downloadStoredAssetBytes(supabase: SupabaseClient<any, "public", any>, stored: ReturnType<typeof parseStoredPath>) {
  const { data: blob, error } = await supabase.storage
    .from(stored.storageBucket)
    .download(stored.storagePath);
  if (error) throw error;
  return new Uint8Array(await blob.arrayBuffer());
}

async function getStoredFileMetadata(supabase: SupabaseClient<any, "public", any>, stored: ReturnType<typeof parseStoredPath>) {
  const slashIndex = stored.storagePath.lastIndexOf("/");
  const folder = slashIndex >= 0 ? stored.storagePath.slice(0, slashIndex) : "";
  const { data, error } = await supabase.storage.from(stored.storageBucket).list(folder, {
    limit: 100,
    search: stored.fileName,
  });
  if (error) throw error;
  const file = (data || []).find((entry) => entry.name === stored.fileName);
  const metadata: Record<string, unknown> = isRecord(file?.metadata) ? file.metadata : {};
  return {
    fileSizeBytes: typeof metadata.size === "number" ? metadata.size : Number(metadata.size) || 0,
    mimeType: typeof metadata.mimetype === "string" ? metadata.mimetype : null,
  };
}

function mimeTypeFromFileName(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (["mp3", "wav", "m4a", "aac", "ogg"].includes(extension || "")) return "audio/mpeg";
  if (["mp4", "webm", "mov", "m4v"].includes(extension || "")) return "video/mp4";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension || "")) return `image/${extension === "jpg" ? "jpeg" : extension}`;
  return "application/octet-stream";
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function positiveDuration(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeDeckSource(deck: HyperframesAnimatedDeckSource) {
  const unsafe = /<\s*script\b|\son[a-z]+\s*=|javascript\s*:/i;
  if (unsafe.test(deck.css)) return false;
  return deck.slides.every((slide) => !unsafe.test(slide.html));
}
