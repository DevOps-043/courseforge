import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import type { CloudStorageProvider, CloudStorageMaterialsLesson } from "./types";

export const ARTIFACT_FOLDER_NAMES = ["Materiales"] as const;

export const MATERIAL_ASSET_FOLDER_NAMES = [
  "01 - Voz",
  "02 - Musica",
  "03 - B-roll",
  "04 - Avatar",
  "05 - Slides",
  "06 - Video Final",
] as const;

export function buildArtifactRootFolderName(artifactName: string) {
  return `SofLIA - Engine - ${artifactName}`;
}

export function buildFolderMappingKey(folderName: string) {
  return folderName.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

export function buildLessonFolderName(params: {
  lessonOrder?: number | null;
  lessonTitle: string;
}) {
  const prefix = params.lessonOrder
    ? String(params.lessonOrder).padStart(2, "0")
    : "00";
  const cleanTitle = params.lessonTitle
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 90);

  return `${prefix} - ${cleanTitle || "Leccion"}`;
}

export async function saveArtifactCloudStorageMetadata(params: {
  artifactId: string;
  folderUrl: string;
  provider: CloudStorageProvider;
  rootFolderId: string;
  subfolders: Record<string, string>;
}) {
  const admin = getServiceRoleClient();
  const { data: artifact, error: fetchError } = await admin
    .from("artifacts")
    .select("generation_metadata")
    .eq("id", params.artifactId)
    .single();

  if (fetchError) {
    throw new Error(`No se pudo leer metadata del artefacto: ${fetchError.message}`);
  }

  const metadata = artifact?.generation_metadata || {};
  const cloudStorageMetadata = {
    enabled: true,
    provider: params.provider,
    root_folder_id: params.rootFolderId,
    folder_url: params.folderUrl,
    subfolders: params.subfolders,
    created_at: new Date().toISOString(),
  };

  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    cloud_storage: cloudStorageMetadata,
  };

  if (params.provider === "google_drive") {
    nextMetadata.google_drive = cloudStorageMetadata;
  }

  const { error: updateError } = await admin
    .from("artifacts")
    .update({ generation_metadata: nextMetadata })
    .eq("id", params.artifactId);

  if (updateError) {
    throw new Error(`No se pudo guardar metadata cloud del artefacto: ${updateError.message}`);
  }
}

export async function saveMaterialsCloudStorageMetadata(params: {
  artifactId: string;
  lessons: CloudStorageMaterialsLesson[];
  materialsFolderId: string;
  provider: CloudStorageProvider;
}) {
  const admin = getServiceRoleClient();
  const { data: artifact, error: fetchError } = await admin
    .from("artifacts")
    .select("generation_metadata")
    .eq("id", params.artifactId)
    .single();

  if (fetchError) {
    throw new Error(`No se pudo leer metadata del artefacto: ${fetchError.message}`);
  }

  const metadata = artifact?.generation_metadata || {};
  const currentCloudStorage =
    typeof metadata.cloud_storage === "object" && metadata.cloud_storage !== null
      ? (metadata.cloud_storage as Record<string, unknown>)
      : {};

  const nextCloudStorage = {
    ...currentCloudStorage,
    provider: params.provider,
    materials: {
      folder_id: params.materialsFolderId,
      lessons: params.lessons,
      synced_at: new Date().toISOString(),
    },
  };

  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    cloud_storage: nextCloudStorage,
  };

  if (params.provider === "google_drive") {
    nextMetadata.google_drive = nextCloudStorage;
  }

  const { error: updateError } = await admin
    .from("artifacts")
    .update({ generation_metadata: nextMetadata })
    .eq("id", params.artifactId);

  if (updateError) {
    throw new Error(`No se pudo guardar metadata de carpetas de materiales: ${updateError.message}`);
  }
}
