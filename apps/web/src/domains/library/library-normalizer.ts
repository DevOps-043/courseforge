import type {
  ComponentType,
  MaterialAssets,
  ProductionStatus,
} from "@/domains/materials/types/materials.types";
import type { LibrarySearchResult } from "./types";

type AssetType = NonNullable<LibrarySearchResult["assetType"]>;

export interface LibraryComponentSource {
  assets?: MaterialAssets | null;
  componentId: string;
  componentType: ComponentType;
  courseCode?: string | null;
  generatedAt: string;
  lessonId?: string | null;
  lessonTitle?: string | null;
  organizationId: string;
  organizationName: string;
  workshopId: string;
  workshopName?: string | null;
}

interface AssetEntryInput {
  assetType: AssetType;
  publicUrl?: string | null;
  storagePath?: string | null;
  fallbackName: string;
  fileName?: string | null;
  title?: string;
}

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  avatar: "Avatar",
  broll: "B-roll",
  music: "Musica",
  screencast: "Screencast",
  slides: "Slides",
  video_final: "Video final",
  voice: "Voz",
};

export function getAssetTypeLabel(assetType: AssetType) {
  return ASSET_TYPE_LABELS[assetType];
}

function cleanFileName(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function getLastPathSegment(value: string | null | undefined) {
  const cleanValue = cleanFileName(value);
  if (!cleanValue) return null;

  try {
    const parsed = new URL(cleanValue);
    const lastUrlSegment = parsed.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(lastUrlSegment || parsed.hostname);
  } catch {
    const normalized = cleanValue.replace(/\\/g, "/");
    return normalized.split("/").filter(Boolean).pop() ?? cleanValue;
  }
}

export function deriveLibraryFileName(params: {
  fallbackName: string;
  fileName?: string | null;
  publicUrl?: string | null;
  storagePath?: string | null;
}) {
  return (
    cleanFileName(params.fileName) ||
    getLastPathSegment(params.storagePath) ||
    getLastPathSegment(params.publicUrl) ||
    params.fallbackName
  );
}

function getProductionStatus(assets: MaterialAssets | null | undefined): ProductionStatus | "PENDING" {
  return assets?.production_status || "PENDING";
}

function buildFolderPath(params: {
  assetTypeLabel?: string;
  lessonTitle: string;
  organizationName: string;
  workshopName: string;
}) {
  return {
    company: params.organizationName,
    workshop: params.workshopName,
    lesson: params.lessonTitle,
    section: params.assetTypeLabel || "Materiales",
  };
}

function makeAssetItem(source: LibraryComponentSource, asset: AssetEntryInput): LibrarySearchResult | null {
  const publicUrl = cleanFileName(asset.publicUrl);
  const storagePath = cleanFileName(asset.storagePath);
  if (!publicUrl && !storagePath) {
    return null;
  }

  const lessonTitle = source.lessonTitle || "Leccion sin titulo";
  const workshopName = source.workshopName || "Taller sin titulo";
  const assetTypeLabel = getAssetTypeLabel(asset.assetType);
  const fileName = deriveLibraryFileName({
    fallbackName: asset.fallbackName,
    fileName: asset.fileName,
    publicUrl,
    storagePath,
  });

  return {
    assetType: asset.assetType,
    assetTypeLabel,
    assets: source.assets || null,
    componentId: source.componentId,
    componentType: source.componentType,
    courseCode: source.courseCode || "SIN-CODIGO",
    fileName,
    folderPath: buildFolderPath({
      assetTypeLabel,
      lessonTitle,
      organizationName: source.organizationName,
      workshopName,
    }),
    id: `${source.componentId}:asset:${asset.assetType}:${fileName}`,
    kind: "asset",
    lessonId: source.lessonId || "sin-leccion",
    lessonTitle,
    organizationId: source.organizationId,
    organizationName: source.organizationName,
    productionStatus: getProductionStatus(source.assets),
    publicUrl: publicUrl || undefined,
    storagePath: storagePath || undefined,
    title: asset.title || fileName,
    updatedAt: source.assets?.updated_at || source.generatedAt,
    workshopId: source.workshopId,
    workshopName,
  };
}

export function normalizeLibraryAssets(source: LibraryComponentSource): LibrarySearchResult[] {
  const assets = source.assets ?? {};
  const items: LibrarySearchResult[] = [];

  const pushAsset = (asset: AssetEntryInput) => {
    const item = makeAssetItem(source, asset);
    if (item) items.push(item);
  };

  pushAsset({
    assetType: "voice",
    fallbackName: "voz",
    fileName: assets.voice_audio?.file_name,
    publicUrl: assets.voice_audio?.public_url,
    storagePath: assets.voice_audio?.storage_path,
    title: "Audio de voz",
  });

  pushAsset({
    assetType: "music",
    fallbackName: "musica",
    fileName: assets.background_music?.file_name,
    publicUrl: assets.background_music?.public_url,
    storagePath: assets.background_music?.storage_path,
    title: "Musica de fondo",
  });

  for (const clip of assets.b_roll_clips ?? []) {
    pushAsset({
      assetType: "broll",
      fallbackName: `b-roll-${clip.order || items.length + 1}`,
      fileName: clip.file_name,
      publicUrl: clip.public_url,
      storagePath: clip.storage_path,
      title: `B-roll ${clip.order || items.length + 1}`,
    });
  }

  pushAsset({
    assetType: "avatar",
    fallbackName: "avatar",
    fileName: assets.avatar_video?.file_name,
    publicUrl: assets.avatar_video?.public_url,
    storagePath: assets.avatar_video?.storage_path,
    title: "Video de avatar",
  });

  if (assets.slides?.html_public_url || assets.slides?.html_content_path || assets.slides_url) {
    pushAsset({
      assetType: "slides",
      fallbackName: "slides",
      publicUrl: assets.slides?.html_public_url || assets.slides_url,
      storagePath: assets.slides?.html_content_path,
      title: "Slides",
    });
  }

  for (const image of assets.slides?.images ?? []) {
    pushAsset({
      assetType: "slides",
      fallbackName: `slide-${image.slide_index}`,
      fileName: image.file_name,
      publicUrl: image.public_url,
      storagePath: image.storage_path,
      title: `Slide ${image.slide_index}`,
    });
  }

  pushAsset({
    assetType: "video_final",
    fallbackName: "video-final",
    publicUrl: assets.final_video_url || assets.video_url,
    title: assets.final_video_url ? "Video final" : "Video de produccion",
  });

  pushAsset({
    assetType: "screencast",
    fallbackName: "screencast",
    publicUrl: assets.screencast_url,
    title: "Screencast",
  });

  return items;
}

export function normalizeLibraryMaterial(source: LibraryComponentSource): LibrarySearchResult {
  const lessonTitle = source.lessonTitle || "Leccion sin titulo";
  const workshopName = source.workshopName || "Taller sin titulo";

  return {
    assets: source.assets || null,
    componentId: source.componentId,
    componentType: source.componentType,
    courseCode: source.courseCode || "SIN-CODIGO",
    folderPath: buildFolderPath({
      lessonTitle,
      organizationName: source.organizationName,
      workshopName,
    }),
    id: `${source.componentId}:material`,
    kind: "material",
    lessonId: source.lessonId || "sin-leccion",
    lessonTitle,
    organizationId: source.organizationId,
    organizationName: source.organizationName,
    productionStatus: getProductionStatus(source.assets),
    title: lessonTitle,
    updatedAt: source.assets?.updated_at || source.generatedAt,
    workshopId: source.workshopId,
    workshopName,
  };
}

export function normalizeLibraryComponent(source: LibraryComponentSource) {
  return [normalizeLibraryMaterial(source), ...normalizeLibraryAssets(source)];
}

export function libraryItemMatchesQuery(item: LibrarySearchResult, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const haystack = [
    item.title,
    item.fileName,
    item.storagePath,
    item.publicUrl,
    item.lessonTitle,
    item.workshopName,
    item.courseCode,
    item.folderPath.company,
    item.folderPath.workshop,
    item.folderPath.lesson,
    item.folderPath.section,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

