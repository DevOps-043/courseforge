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
import { readResponseWithLimit } from "@/domains/production/external-media-import-policy";
import {
  DEFAULT_OUTBOUND_DOWNLOAD_TIMEOUT_MS,
  fetchIdempotentWithRetry,
  fetchWithDeadline,
  OutboundCircuitBreaker,
  readJsonResponseWithLimit,
} from "@/lib/server/outbound-http";
import {
  parseAccessTokenPayload,
  parseMicrosoftGraphItem,
  parseMicrosoftGraphItemList,
} from "../providers/provider-json-contracts";

const MAX_ONEDRIVE_IMPORT_BYTES = 150 * 1024 * 1024;
const MAX_MICROSOFT_GRAPH_JSON_BYTES = 2 * 1024 * 1024;
const MAX_MICROSOFT_GRAPH_METADATA_BYTES = 256 * 1024;
const MAX_MICROSOFT_TOKEN_BYTES = 64 * 1024;
const microsoftGraphCircuitBreaker = new OutboundCircuitBreaker(5, 30_000);

function fetchMicrosoftGraph(
  input: string,
  init: RequestInit = {},
  timeoutMilliseconds?: number,
) {
  const method = (init.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return fetchIdempotentWithRetry(input, init, timeoutMilliseconds
      ? {
          perAttemptTimeoutMilliseconds: timeoutMilliseconds,
          totalTimeoutMilliseconds: timeoutMilliseconds,
          circuitBreaker: microsoftGraphCircuitBreaker,
        }
      : { circuitBreaker: microsoftGraphCircuitBreaker });
  }
  return fetchWithDeadline(input, init, timeoutMilliseconds);
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
    const response = await fetchMicrosoftGraph("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
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

    const tokenData = parseAccessTokenPayload(
      await readJsonResponseWithLimit(response, MAX_MICROSOFT_TOKEN_BYTES),
      "Microsoft",
      true,
    );
    const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000).toISOString();

    await updateCloudStorageAccessToken({
      accessToken: tokenData.accessToken,
      expiresAt,
      organizationId,
      provider: "onedrive",
      refreshToken: tokenData.refreshToken,
      userId,
    });

    return tokenData.accessToken;
  }

  async createFolder(name: string, parentId: string | null, accessToken: string) {
    const endpoint = parentId
      ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(parentId)}/children`
      : "https://graph.microsoft.com/v1.0/me/drive/root/children";

    const response = await fetchMicrosoftGraph(endpoint, {
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
      throw new Error(`Microsoft Graph rechazó la creación de carpeta (${response.status}).`);
    }

    return parseMicrosoftGraphItem(
      await readJsonResponseWithLimit(response, MAX_MICROSOFT_GRAPH_METADATA_BYTES),
    );
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

    const response = await fetchMicrosoftGraph(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`No se pudieron listar archivos de OneDrive: ${response.statusText}`);
    }

    return parseMicrosoftGraphItemList(
      await readJsonResponseWithLimit(response, MAX_MICROSOFT_GRAPH_JSON_BYTES),
    )
      .filter((item) => !item.isFolder)
      .map((item) => ({
        id: item.id,
        name: item.name,
        mimeType: item.mimeType || "application/octet-stream",
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

    const metadataResponse = await fetchMicrosoftGraph(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodedItemId}?$select=id,name,size,file`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!metadataResponse.ok) {
      throw new Error(`No se pudo leer metadata de OneDrive: ${metadataResponse.statusText}`);
    }

    const metadata = parseMicrosoftGraphItem(
      await readJsonResponseWithLimit(metadataResponse, MAX_MICROSOFT_GRAPH_METADATA_BYTES),
    );
    if (typeof metadata.size === "number" && metadata.size > MAX_ONEDRIVE_IMPORT_BYTES) {
      throw new Error("El archivo de OneDrive supera el límite de importación de 150 MB.");
    }

    const contentResponse = await fetchMicrosoftGraph(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodedItemId}/content`,
      { headers: { Authorization: `Bearer ${token}` } },
      DEFAULT_OUTBOUND_DOWNLOAD_TIMEOUT_MS,
    );

    if (!contentResponse.ok) {
      throw new Error(`No se pudo descargar el archivo de OneDrive: ${contentResponse.statusText}`);
    }

    let buffer: Buffer;
    try {
      buffer = await readResponseWithLimit(contentResponse, MAX_ONEDRIVE_IMPORT_BYTES);
    } catch (error) {
      if (error instanceof Error && error.message === "EXTERNAL_MEDIA_TOO_LARGE") {
        throw new Error("El archivo de OneDrive supera el límite de importación de 150 MB.");
      }
      throw error;
    }
    return uploadImportedAssetToStorage({
      buffer,
      componentId,
      fileName: metadata.name || `onedrive-${itemId}`,
      mimeType: metadata.mimeType || contentResponse.headers.get("content-type") || "",
      sourcePrefix: "onedrive",
      type,
    });
  }
}
