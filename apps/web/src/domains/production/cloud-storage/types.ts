export const CLOUD_STORAGE_PROVIDERS = ["google_drive", "onedrive"] as const;

export type CloudStorageProvider = (typeof CLOUD_STORAGE_PROVIDERS)[number];

export type ProductionAssetType = "voice" | "music" | "broll" | "avatar" | "slides";

export interface CloudStorageCredentialRecord {
  access_token: string;
  account_email: string;
  expires_at: string;
  provider: CloudStorageProvider;
  refresh_token: string;
  scopes: string[] | null;
  user_id: string;
}

export interface CloudStorageConnection {
  connected: boolean;
  email: string | null;
  provider: CloudStorageProvider;
}

export interface CloudStorageFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  webUrl?: string;
}

export interface CloudStorageFolderTree {
  folderUrl: string;
  provider: CloudStorageProvider;
  rootFolderId: string;
}

export interface CloudStorageLessonInput {
  expectedComponents?: string[] | null;
  lessonId: string;
  lessonOrder?: number | null;
  lessonTitle: string;
}

export interface CloudStorageMaterialsLesson {
  asset_folders: Record<string, string>;
  folder_id: string;
  lesson_id: string;
  lesson_title: string;
}

export interface ImportedCloudAsset {
  fileName?: string;
  mimeType?: string;
  publicUrl: string;
  storagePath: string;
}

export function isCloudStorageProvider(value: unknown): value is CloudStorageProvider {
  return typeof value === "string" && CLOUD_STORAGE_PROVIDERS.includes(value as CloudStorageProvider);
}

export function getCloudStorageProviderLabel(provider: CloudStorageProvider) {
  return provider === "google_drive" ? "Google Drive" : "OneDrive";
}
