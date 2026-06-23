import {
  ARTIFACT_FOLDER_NAMES,
  MATERIAL_ASSET_FOLDER_NAMES,
  buildArtifactRootFolderName,
  buildLessonFolderName,
  buildFolderMappingKey,
  saveArtifactCloudStorageMetadata,
  saveMaterialsCloudStorageMetadata,
} from "./artifact-folders";
import {
  decryptCredentialToken,
  getCloudStorageCredentials,
  updateCloudStorageAccessToken,
} from "./credentials.repository";
import type {
  CloudStorageFile,
  CloudStorageFolderTree,
  CloudStorageLessonInput,
  CloudStorageMaterialsLesson,
  ImportedCloudAsset,
  ProductionAssetType,
} from "./types";
import { uploadImportedAssetToStorage } from "./storage-import.service";
import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";

interface MicrosoftTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

interface GraphDriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  file?: { mimeType?: string };
  folder?: unknown;
}

export class OneDriveService {
  async refreshUserAccessToken(userId: string, organizationId: string) {
    const creds = await getCloudStorageCredentials(userId, organizationId, "onedrive");
    if (!creds) {
      throw new Error("No hay cuenta de OneDrive vinculada para este usuario.");
    }

    const accessToken = decryptCredentialToken(creds.access_token);
    if (new Date(creds.expires_at).getTime() > Date.now() + 60000) {
      return accessToken;
    }

    const refreshToken = decryptCredentialToken(creds.refresh_token);
    const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID || "",
        client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: "openid email profile offline_access User.Read Files.ReadWrite",
      }).toString(),
    });

    if (!response.ok) {
      throw new Error("La renovacion del token de Microsoft fallo. El usuario debe reconectar.");
    }

    const tokenData = (await response.json()) as MicrosoftTokenResponse;
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    await updateCloudStorageAccessToken({
      accessToken: tokenData.access_token,
      expiresAt,
      organizationId,
      provider: "onedrive",
      refreshToken: tokenData.refresh_token,
      userId,
    });

    return tokenData.access_token;
  }

  async createFolder(name: string, parentId: string | null, accessToken: string) {
    const endpoint = parentId
      ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(parentId)}/children`
      : "https://graph.microsoft.com/v1.0/me/drive/root/children";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename",
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Error de Microsoft Graph al crear carpeta: ${details || response.statusText}`);
    }

    return (await response.json()) as GraphDriveItem;
  }

  async setupArtifactFolderTree(
    artifactId: string,
    artifactName: string,
    userId: string,
    organizationId: string,
  ): Promise<CloudStorageFolderTree> {
    const token = await this.refreshUserAccessToken(userId, organizationId);
    const rootFolder = await this.createFolder(buildArtifactRootFolderName(artifactName), null, token);

    const subfolders: Record<string, string> = {};
    for (const folderName of ARTIFACT_FOLDER_NAMES) {
      const subfolder = await this.createFolder(folderName, rootFolder.id, token);
      subfolders[buildFolderMappingKey(folderName)] = subfolder.id;
    }

    const folderUrl = rootFolder.webUrl || `https://onedrive.live.com/?id=${encodeURIComponent(rootFolder.id)}`;

    await saveArtifactCloudStorageMetadata({
      artifactId,
      folderUrl,
      provider: "onedrive",
      rootFolderId: rootFolder.id,
      subfolders,
    });

    return {
      folderUrl,
      provider: "onedrive",
      rootFolderId: rootFolder.id,
    };
  }

  async setupMaterialsFolderTree(
    artifactId: string,
    userId: string,
    organizationId: string,
    lessons: CloudStorageLessonInput[],
  ): Promise<CloudStorageMaterialsLesson[]> {
    const admin = getServiceRoleClient();
    const { data: artifact, error } = await admin
      .from("artifacts")
      .select("generation_metadata")
      .eq("id", artifactId)
      .single();

    if (error) {
      throw new Error(`No se pudo leer metadata cloud del artefacto: ${error.message}`);
    }

    const cloudStorage = artifact?.generation_metadata?.cloud_storage || {};
    const materialsFolderId = cloudStorage?.subfolders?.materiales as string | undefined;
    if (!materialsFolderId) {
      throw new Error("El artefacto no tiene carpeta Materiales configurada en OneDrive.");
    }

    const token = await this.refreshUserAccessToken(userId, organizationId);
    const syncedLessons: CloudStorageMaterialsLesson[] = [];

    for (const lesson of lessons) {
      const lessonFolder = await this.createFolder(
        buildLessonFolderName({
          lessonOrder: lesson.lessonOrder,
          lessonTitle: lesson.lessonTitle,
        }),
        materialsFolderId,
        token,
      );

      const assetFolders: Record<string, string> = {};
      for (const folderName of MATERIAL_ASSET_FOLDER_NAMES) {
        const assetFolder = await this.createFolder(folderName, lessonFolder.id, token);
        assetFolders[buildFolderMappingKey(folderName)] = assetFolder.id;
      }

      syncedLessons.push({
        asset_folders: assetFolders,
        folder_id: lessonFolder.id,
        lesson_id: lesson.lessonId,
        lesson_title: lesson.lessonTitle,
      });
    }

    await saveMaterialsCloudStorageMetadata({
      artifactId,
      lessons: syncedLessons,
      materialsFolderId,
      provider: "onedrive",
    });

    return syncedLessons;
  }

  async listFiles(userId: string, organizationId: string, query = ""): Promise<CloudStorageFile[]> {
    const token = await this.refreshUserAccessToken(userId, organizationId);
    const escapedQuery = query.trim().replace(/'/g, "''");
    const endpoint = query.trim()
      ? `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(escapedQuery)}')?$top=20`
      : "https://graph.microsoft.com/v1.0/me/drive/root/children?$top=20";

    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`No se pudieron listar archivos de OneDrive: ${response.statusText}`);
    }

    const data = (await response.json()) as { value?: GraphDriveItem[] };
    return (data.value || [])
      .filter((item) => !item.folder)
      .map((item) => ({
        id: item.id,
        name: item.name,
        mimeType: item.file?.mimeType || "application/octet-stream",
        size: item.size,
        webUrl: item.webUrl,
      }));
  }

  async importFile(
    itemId: string,
    type: ProductionAssetType,
    componentId: string,
    userId: string,
    organizationId: string,
  ): Promise<ImportedCloudAsset> {
    const token = await this.refreshUserAccessToken(userId, organizationId);
    const encodedItemId = encodeURIComponent(itemId.trim());

    const metadataResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodedItemId}?$select=id,name,size,file`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!metadataResponse.ok) {
      throw new Error(`No se pudo leer metadata de OneDrive: ${metadataResponse.statusText}`);
    }

    const metadata = (await metadataResponse.json()) as GraphDriveItem;
    const contentResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodedItemId}/content`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!contentResponse.ok) {
      throw new Error(`No se pudo descargar el archivo de OneDrive: ${contentResponse.statusText}`);
    }

    const buffer = Buffer.from(await contentResponse.arrayBuffer());
    return uploadImportedAssetToStorage({
      buffer,
      componentId,
      fileName: metadata.name || `onedrive-${itemId}`,
      mimeType: metadata.file?.mimeType || contentResponse.headers.get("content-type") || "",
      sourcePrefix: "onedrive",
      type,
    });
  }
}
