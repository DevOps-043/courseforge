import type {
  ComponentType,
  MaterialAssets,
  ProductionStatus,
} from "@/domains/materials/types/materials.types";

export const LIBRARY_CONTENT_CATEGORIES = ["ALL", "MATERIALS", "ASSETS"] as const;

export const LIBRARY_ASSET_TYPES = [
  "ALL",
  "voice",
  "music",
  "broll",
  "avatar",
  "slides",
  "video_final",
  "screencast",
] as const;

export type LibraryContentCategory = (typeof LIBRARY_CONTENT_CATEGORIES)[number];
export type LibraryAssetType = (typeof LIBRARY_ASSET_TYPES)[number];
export type LibraryItemKind = "material" | "asset";

export interface LibrarySearchFilters {
  assetType?: LibraryAssetType;
  category?: LibraryContentCategory;
  componentType?: ComponentType | "ALL";
  page?: number;
  pageSize?: number;
  status?: ProductionStatus | "ALL";
}

export interface LibraryFolderPath {
  company: string;
  workshop: string;
  lesson: string;
  section: string;
}

export interface LibrarySearchResult {
  assetType?: Exclude<LibraryAssetType, "ALL">;
  assetTypeLabel?: string;
  assets: MaterialAssets | null;
  componentId: string;
  componentType: ComponentType;
  courseCode: string;
  fileName?: string;
  folderPath: LibraryFolderPath;
  id: string;
  kind: LibraryItemKind;
  lessonId: string;
  lessonTitle: string;
  organizationId: string;
  organizationName: string;
  productionStatus: ProductionStatus | "PENDING";
  publicUrl?: string;
  storagePath?: string;
  title: string;
  updatedAt: string;
  workshopId: string;
  workshopName: string;
}

export interface LibrarySearchResponse {
  items: LibrarySearchResult[];
  page: number;
  pageSize: number;
  total: number;
}

