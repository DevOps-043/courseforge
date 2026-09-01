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
  HYPERFRAMES_ASSET_DELIVERY_MODES,
  hyperframesAnimatedDeckSourceSchema,
  hyperframesAssetManifestSchema,
  type HyperframesAnimatedDeckSource,
  type HyperframesAssetManifestItem,
} from "./hyperframes.types";
import { validateHyperframesMediaAsset } from "./hyperframes-media-constraints";
import { HYPERFRAMES_SOURCE_BUCKETS } from "../media-storage.config";
import {
  normalizeAnimatedDeckAppearance,
  repairLegacyAnimatedDeckAppearanceSelectors,
} from "../animated-deck/animated-deck-appearance.service";

const SUPPORTED_HYPERFRAMES_MIME = /^(audio|font|image|video)\/[a-z0-9.+-]+$/i;

interface InternalMaterialAssetReference {
  detachedFromAssetId?: string;
  detachedFromClipId?: string;
  displayName?: string;
  durationSeconds?: number;
  fileName: string | null;
  hasAudio?: boolean;
  mimeType: string | null;
  publicUrl: string | null;
  sceneClipId?: string;
  sceneOrder?: number;
  sourceType: "DECK_DEPENDENCY" | "PRODUCTION_MEDIA";
  sourceHeight?: number;
  sourceWidth?: number;
  storagePath: string;
  timelineRole: "AUDIO" | "AVATAR" | "BROLL" | "VISUAL" | "VOICE";
  timelineVariant?: "CLIP" | "FULL";
}

export function isSupportedHyperframesSourceMime(mimeType: string | null | undefined) {
  return SUPPORTED_HYPERFRAMES_MIME.test(mimeType || "");
}

export function shouldExposeProductionRegistryAsset(params: {
  assetType: string;
  hasActiveReference: boolean;
  qaStatus?: string | null;
}) {
  if (params.qaStatus === PRODUCTION_QA_STATUSES.ARCHIVED) return false;
  if (params.hasActiveReference) return true;
  return params.assetType === PRODUCTION_ASSET_TYPES.AVATAR_VIDEO
    || params.assetType === PRODUCTION_ASSET_TYPES.AVATAR_VIDEO_CLIP
    || params.assetType === PRODUCTION_ASSET_TYPES.VOICE_AUDIO;
}

export function isAutomaticTimelineSourceAsset(asset: {
  metadata: Record<string, unknown>;
  sourceType: "DECK_DEPENDENCY" | "PRODUCTION_MEDIA";
}) {
  return asset.sourceType === "PRODUCTION_MEDIA" && asset.metadata.historical_only !== true;
}

export function isRecoverableManualVoiceRegistryAsset(asset: {
  assetType: string;
  metadata?: Record<string, unknown> | null;
}) {
  return asset.assetType === PRODUCTION_ASSET_TYPES.SOURCE_MEDIA
    && (asset.metadata?.import_type === "voice" || asset.metadata?.timeline_role === "VOICE");
}

export interface HyperframesSourceAssetCandidate extends HyperframesAssetManifestItem {
  durationSeconds?: number;
  eligibleForRevision: boolean;
  hasAudio?: boolean;
  metadata: Record<string, unknown>;
  qaStatus: string;
  sceneClipId?: string;
  sceneOrder?: number;
  sourceType: "DECK_DEPENDENCY" | "PRODUCTION_MEDIA";
  timelineRole: "AUDIO" | "AVATAR" | "BROLL" | "VISUAL" | "VOICE";
  timelineVariant?: "CLIP" | "FULL";
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
  hasAudio?: boolean;
  metadata?: Record<string, unknown> | null;
  mimeType: string | null;
  productionAssetId: string;
  qaStatus?: string | null;
  sceneClipId?: string;
  sceneOrder?: number;
  sourceType: "DECK_DEPENDENCY" | "PRODUCTION_MEDIA";
  storagePath: string | null;
  timelineRole?: "AUDIO" | "AVATAR" | "BROLL" | "VISUAL" | "VOICE";
  timelineVariant?: "CLIP" | "FULL";
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
  const manifestErrors = parsed.success
    ? []
    : parsed.error.issues.map((issue) => issue.message);
  const mediaValidation = validateHyperframesMediaAsset({
    deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
    fileName,
    fileSizeBytes: input.fileSizeBytes,
    height: positiveInteger(input.metadata?.source_height),
    mimeType: input.mimeType,
    width: positiveInteger(input.metadata?.source_width),
  });
  const validationErrors = [...manifestErrors, ...mediaValidation.errors];

  return {
    ...item,
    durationSeconds: typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
      ? input.durationSeconds
      : undefined,
    eligibleForRevision: parsed.success && mediaValidation.valid,
    ...(input.hasAudio !== undefined ? { hasAudio: input.hasAudio } : {}),
    metadata: input.metadata || {},
    qaStatus: input.qaStatus || "PENDING",
    sceneClipId: input.sceneClipId,
    sceneOrder: input.sceneOrder,
    sourceType: input.sourceType,
    timelineRole: input.timelineRole || "VISUAL",
    timelineVariant: input.timelineVariant,
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
    timelineVariant?: InternalMaterialAssetReference["timelineVariant"],
    scene?: { clipId: string; order: number },
    displayName?: string,
  ) => {
    if (!isRecord(value) || typeof value.storage_path !== "string") return;
    const storageBucket = value.storage_path.split("/", 1)[0];
    if (!HYPERFRAMES_SOURCE_BUCKETS.has(storageBucket)) return;
    const durationSeconds = positiveDuration(
      value.duration_seconds ?? value.durationSeconds ?? value.duration,
    );
    const sourceHeight = positiveInteger(value.source_height ?? value.height);
    const sourceWidth = positiveInteger(value.source_width ?? value.width);
    const explicitHasAudio = optionalBoolean(value.has_audio ?? value.hasAudio);
    const hasAudio = explicitHasAudio ?? legacyAudioPresenceForRole(timelineRole);
    references.push({
      ...(typeof value.detached_from_asset_id === "string" ? { detachedFromAssetId: value.detached_from_asset_id } : {}),
      ...(typeof value.detached_from_clip_id === "string" ? { detachedFromClipId: value.detached_from_clip_id } : {}),
      ...(displayName ? { displayName } : {}),
      ...(durationSeconds ? { durationSeconds } : {}),
      fileName: typeof value.file_name === "string" ? value.file_name : null,
      ...(hasAudio !== undefined ? { hasAudio } : {}),
      mimeType: typeof value.content_type === "string" ? value.content_type : mimeType || null,
      publicUrl: typeof value.public_url === "string" ? value.public_url : null,
      ...(scene ? { sceneClipId: scene.clipId, sceneOrder: scene.order } : {}),
      sourceType,
      ...(sourceHeight && sourceWidth ? { sourceHeight, sourceWidth } : {}),
      storagePath: value.storage_path,
      timelineRole,
      timelineVariant,
    });
  };

  const usesSceneClips = assets.avatar_generation_mode === "scene_clips";
  const avatarSceneNames = new Map(asArray(assets.avatar_clips).flatMap((item) => (
    isRecord(item) && typeof item.id === "string" && typeof item.asset_name === "string"
      ? [[item.id, item.asset_name] as const]
      : []
  )));
  if (!usesSceneClips) add(assets.voice_audio, "audio/mpeg", "PRODUCTION_MEDIA", "VOICE");
  for (const item of asArray(assets.manual_voice_clips)) {
    add(item, "audio/mpeg", "PRODUCTION_MEDIA", "VOICE");
  }
  if (usesSceneClips) {
    for (const item of asArray(assets.voice_clips)) {
      if (!isRecord(item) || item.status !== "COMPLETED") continue;
      const clipId = typeof item.clip_id === "string" ? item.clip_id : "";
      const order = positiveInteger(item.order);
      if (!clipId || !order) continue;
      add(item, "audio/mpeg", "PRODUCTION_MEDIA", "VOICE", "CLIP", { clipId, order }, avatarSceneNames.get(clipId));
    }
  }
  add(assets.background_music, "audio/mpeg", "PRODUCTION_MEDIA", "AUDIO");
  for (const item of asArray(assets.detached_audio_clips)) add(item, "audio/wav", "PRODUCTION_MEDIA", "VOICE");
  for (const item of asArray(assets.b_roll_clips)) add(item, "video/mp4", "PRODUCTION_MEDIA", "BROLL");
  if (!usesSceneClips) add(assets.avatar_video, "video/mp4", "PRODUCTION_MEDIA", "AVATAR", "FULL");
  if (usesSceneClips) {
    for (const item of asArray(assets.avatar_clips)) {
      if (!isRecord(item) || item.deleted === true) continue;
      const clipId = typeof item.id === "string" ? item.id : "";
      const order = positiveInteger(item.order);
      if (!clipId || !order) continue;
      add(item, "video/mp4", "PRODUCTION_MEDIA", "AVATAR", "CLIP", { clipId, order }, typeof item.asset_name === "string" ? item.asset_name : undefined);
    }
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
    appearance: normalizeAnimatedDeckAppearance(animatedDeck.appearance ?? slides.appearance),
    css: repairLegacyAnimatedDeckAppearanceSelectors(
      typeof animatedDeck.css === "string" ? animatedDeck.css : "",
    ),
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
      .select("id, checksum, duration_milliseconds, duration_seconds, file_size_bytes, mime_type, metadata")
      .eq("organization_id", params.organizationId)
      .eq("material_component_id", params.componentId)
      .eq("asset_type", PRODUCTION_ASSET_TYPES.SOURCE_MEDIA)
      .eq("storage_bucket", stored.storageBucket)
      .eq("storage_path", reference.storagePath)
      // Historical retries may have produced duplicate provenance rows before
      // this synchronization became idempotent. One canonical row is enough;
      // listHyperframesSourceAssets already de-duplicates by storage path.
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;
    const metadata = await getStoredFileMetadata(params.supabase, stored);
    const inferredMimeType = mimeTypeFromFileName(reference.fileName || stored.fileName);
    const mimeType = metadata.mimeType
      || (inferredMimeType !== "application/octet-stream" ? inferredMimeType : reference.mimeType)
      || "application/octet-stream";
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
      && (reference.durationSeconds === undefined || preciseDurationSeconds(existing.duration_milliseconds, existing.duration_seconds) === reference.durationSeconds)
      && isRecord(existing.metadata)
      && (reference.displayName === undefined || existing.metadata.asset_display_name === reference.displayName)
      && (reference.detachedFromAssetId === undefined || existing.metadata.detached_from_asset_id === reference.detachedFromAssetId)
      && (reference.detachedFromClipId === undefined || existing.metadata.detached_from_clip_id === reference.detachedFromClipId)
      && (reference.hasAudio === undefined || existing.metadata.has_audio === reference.hasAudio)
      && (reference.sceneClipId === undefined || existing.metadata.scene_clip_id === reference.sceneClipId)
      && (reference.sceneOrder === undefined || existing.metadata.scene_order === reference.sceneOrder)
      && existing.metadata.timeline_role === reference.timelineRole
      && (reference.sourceHeight === undefined || existing.metadata.source_height === reference.sourceHeight)
      && (reference.sourceWidth === undefined || existing.metadata.source_width === reference.sourceWidth)
      && (reference.timelineVariant === undefined || existing.metadata.timeline_variant === reference.timelineVariant)
    ) continue;

    bytes = bytes || await downloadStoredAssetBytes(params.supabase, stored);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const assetRecord = {
      artifact_id: context.artifactId,
      asset_type: PRODUCTION_ASSET_TYPES.SOURCE_MEDIA,
      checksum,
      content: { imported_from: "production_step" },
      created_by: params.createdBy,
      ...(reference.durationSeconds ? {
        duration_milliseconds: Math.round(reference.durationSeconds * 1_000),
        duration_seconds: Math.round(reference.durationSeconds),
      } : {}),
      file_size_bytes: fileSizeBytes,
      lesson_id: context.lessonId,
      material_component_id: context.componentId,
      material_lesson_id: context.materialLessonId,
      metadata: {
        ...(reference.displayName ? { asset_display_name: reference.displayName } : {}),
        assembly_source_type: reference.sourceType,
        ...(reference.detachedFromAssetId ? { detached_from_asset_id: reference.detachedFromAssetId } : {}),
        ...(reference.detachedFromClipId ? { detached_from_clip_id: reference.detachedFromClipId } : {}),
        file_name: reference.fileName || stored.fileName,
        ...(reference.hasAudio !== undefined ? { has_audio: reference.hasAudio } : {}),
        ...(reference.sceneClipId ? { scene_clip_id: reference.sceneClipId } : {}),
        ...(reference.sceneOrder ? { scene_order: reference.sceneOrder } : {}),
        source_provider: "production_step",
        ...(reference.sourceHeight && reference.sourceWidth ? {
          source_height: reference.sourceHeight,
          source_width: reference.sourceWidth,
        } : {}),
        timeline_role: reference.timelineRole,
        ...(reference.timelineVariant ? { timeline_variant: reference.timelineVariant } : {}),
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
    .select("id, asset_type, checksum, duration_milliseconds, duration_seconds, file_size_bytes, mime_type, storage_path, storage_bucket, qa_status, created_at, metadata")
    .eq("organization_id", params.organizationId)
    .eq("material_component_id", params.componentId)
    .in("asset_type", [
      PRODUCTION_ASSET_TYPES.SOURCE_MEDIA,
      PRODUCTION_ASSET_TYPES.AVATAR_VIDEO,
      PRODUCTION_ASSET_TYPES.AVATAR_VIDEO_CLIP,
      PRODUCTION_ASSET_TYPES.VOICE_AUDIO,
    ])
    .not("checksum", "is", null)
    .not("file_size_bytes", "is", null)
    .not("mime_type", "is", null)
    .not("storage_path", "is", null)
    .neq("qa_status", PRODUCTION_QA_STATUSES.ARCHIVED)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const seenStoragePaths = new Set<string>();
  return (data || []).flatMap((asset) => {
    const reference = referenceByPath.get(asset.storage_path);
    const assetMetadata = isRecord(asset.metadata) ? asset.metadata : {};
    const isAvatarRegistryAsset =
      asset.asset_type === PRODUCTION_ASSET_TYPES.AVATAR_VIDEO
      || asset.asset_type === PRODUCTION_ASSET_TYPES.AVATAR_VIDEO_CLIP;
    const isVoiceRegistryAsset = asset.asset_type === PRODUCTION_ASSET_TYPES.VOICE_AUDIO;
    const isManualVoiceRegistryAsset = isRecoverableManualVoiceRegistryAsset({
      assetType: asset.asset_type,
      metadata: assetMetadata,
    });
    // Material assets are the mutable Production source of truth. Registry
    // rows are provenance and may outlive a video cleared for regeneration.
    if (!shouldExposeProductionRegistryAsset({
      assetType: asset.asset_type,
      hasActiveReference: Boolean(reference) || isManualVoiceRegistryAsset,
      qaStatus: asset.qa_status,
    })) return [];
    if (typeof asset.storage_path !== "string" || seenStoragePaths.has(asset.storage_path)) return [];
    seenStoragePaths.add(asset.storage_path);
    const candidate = inspectHyperframesSourceAsset({
      checksum: asset.checksum,
      durationSeconds: preciseDurationSeconds(asset.duration_milliseconds, asset.duration_seconds),
      fileSizeBytes: asset.file_size_bytes,
      hasAudio: reference?.hasAudio ?? optionalBoolean(isRecord(asset.metadata) ? asset.metadata.has_audio : undefined),
      metadata: reference || isManualVoiceRegistryAsset ? assetMetadata : { ...assetMetadata, historical_only: true },
      mimeType: asset.mime_type,
      productionAssetId: asset.id,
      qaStatus: asset.qa_status,
      sceneClipId: reference?.sceneClipId
        || (isRecord(asset.metadata) && typeof asset.metadata.scene_clip_id === "string"
          ? asset.metadata.scene_clip_id
          : undefined),
      sceneOrder: reference?.sceneOrder
        || positiveInteger(isRecord(asset.metadata) ? asset.metadata.scene_order : undefined),
      sourceType: reference?.sourceType || "PRODUCTION_MEDIA",
      storagePath: asset.storage_path,
      timelineRole: reference?.timelineRole
        || (isAvatarRegistryAsset ? "AVATAR" : isVoiceRegistryAsset || isManualVoiceRegistryAsset ? "VOICE" : "VISUAL"),
      timelineVariant: reference?.timelineVariant
        || (isRecord(asset.metadata) && asset.metadata.timeline_variant === "FULL" ? "FULL" : undefined)
        || (isAvatarRegistryAsset
          ? (asset.asset_type === PRODUCTION_ASSET_TYPES.AVATAR_VIDEO ? "FULL" : "CLIP")
          : isVoiceRegistryAsset ? "CLIP" : undefined),
    });
    return candidate ? [candidate] : [];
  });
}

function parseStoredPath(storedPath: string) {
  const [storageBucket, ...rest] = storedPath.split("/");
  const storagePath = rest.join("/");
  if (!HYPERFRAMES_SOURCE_BUCKETS.has(storageBucket) || !storagePath || storagePath.includes("..") || storagePath.includes("\\")) {
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
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  if (["m4a", "aac", "ogg"].includes(extension || "")) return `audio/${extension}`;
  if (extension === "mp4") return "video/mp4";
  if (extension === "webm") return "video/webm";
  if (extension === "mov") return "video/quicktime";
  if (extension === "m4v") return "video/x-m4v";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension || "")) return `image/${extension === "jpg" ? "jpeg" : extension}`;
  return "application/octet-stream";
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function positiveDuration(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 16_384
    ? value
    : undefined;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Historical Production JSON predates track probing. Avatars are generated
 * with narration, while B-roll is intentionally silent by default. New files
 * always persist an explicit value and do not use this compatibility rule.
 */
function legacyAudioPresenceForRole(role: InternalMaterialAssetReference["timelineRole"]) {
  if (role === "AVATAR") return true;
  if (role === "BROLL") return false;
  return undefined;
}

function preciseDurationSeconds(milliseconds: unknown, legacySeconds: unknown) {
  const precise = typeof milliseconds === "number" && Number.isFinite(milliseconds) && milliseconds > 0
    ? milliseconds / 1_000
    : null;
  return precise ?? positiveDuration(legacySeconds);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeDeckSource(deck: HyperframesAnimatedDeckSource) {
  const unsafe = /<\s*script\b|\son[a-z]+\s*=|javascript\s*:/i;
  if (unsafe.test(deck.css)) return false;
  return deck.slides.every((slide) => !unsafe.test(slide.html));
}
