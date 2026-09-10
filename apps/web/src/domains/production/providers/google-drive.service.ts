import * as jose from "jose";
import {
  ARTIFACT_FOLDER_NAMES,
  MATERIAL_ASSET_FOLDER_NAMES,
  buildArtifactRootFolderName,
  buildLessonFolderName,
  buildFolderMappingKey,
  saveArtifactCloudStorageMetadata,
  saveMaterialsCloudStorageMetadata,
} from "@/domains/production/cloud-storage/artifact-folders";
import {
  decryptCredentialToken,
  getCloudStorageCredentials,
  updateCloudStorageAccessToken,
} from "@/domains/production/cloud-storage/credentials.repository";
import { uploadImportedAssetToStorage } from "@/domains/production/cloud-storage/storage-import.service";
import type {
  CloudStorageLessonInput,
  CloudStorageMaterialsLesson,
  ImportedCloudAsset,
  ProductionAssetType,
} from "@/domains/production/cloud-storage/types";
import { readResponseWithLimit } from "@/domains/production/external-media-import-policy";
import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import {
  DEFAULT_OUTBOUND_DOWNLOAD_TIMEOUT_MS,
  fetchWithDeadline,
} from "@/lib/server/outbound-http";

const MAX_GOOGLE_DRIVE_IMPORT_BYTES = 150 * 1024 * 1024;
const MAX_GOOGLE_DRIVE_CONFIRMATION_PAGE_BYTES = 1024 * 1024;
const GOOGLE_DRIVE_SIZE_LIMIT_ERROR = "El archivo de Google Drive supera el limite permitido de 150 MB.";

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface GoogleDriveMetadataResponse {
  name?: string;
  mimeType?: string;
  size?: string;
}

interface GoogleDriveFolderResponse {
  id?: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  public_url?: string;
}

const MOCK_DRIVE_FILES: DriveFile[] = [];

function escapeGoogleDriveQueryLiteral(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function readGoogleDriveResponse(
  response: Response,
  maxBytes = MAX_GOOGLE_DRIVE_IMPORT_BYTES,
  sizeLimitMessage = GOOGLE_DRIVE_SIZE_LIMIT_ERROR,
) {
  try {
    return await readResponseWithLimit(response, maxBytes);
  } catch (error) {
    if (error instanceof Error && error.message === "EXTERNAL_MEDIA_TOO_LARGE") {
      throw new Error(sizeLimitMessage);
    }
    throw error;
  }
}

export class GoogleDriveService {
  private serviceAccountKey: string | null;

  constructor() {
    this.serviceAccountKey = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY || null;
  }

  private isConfigured(): boolean {
    return Boolean(this.serviceAccountKey);
  }

  /**
   * Parse File ID from any Google Drive URL
   */
  parseFileId(urlOrId: string): string {
    const clean = urlOrId.trim();
    if (!clean.includes("google.com")) {
      if (!/^[a-zA-Z0-9_-]+$/.test(clean)) {
        throw new Error("El ID de Google Drive no tiene un formato valido");
      }
      return clean;
    }

    const fileDMatch = clean.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileDMatch) return fileDMatch[1];

    const idParamMatch = clean.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idParamMatch) return idParamMatch[1];

    const openIdMatch = clean.match(/\/open\?id=([a-zA-Z0-9_-]+)/);
    if (openIdMatch) return openIdMatch[1];

    const folderMatch = clean.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) return folderMatch[1];

    throw new Error("No se pudo extraer el ID de Google Drive de la URL proporcionada");
  }

  /**
   * Authenticate and get Google Drive Access Token using Service Account JWT
   */
  private async getAccessToken(): Promise<string> {
    if (!this.serviceAccountKey) {
      throw new Error("Google Drive Service Account Key no configurada");
    }

    try {
      const credentials = JSON.parse(this.serviceAccountKey);
      const privateKey = await jose.importPKCS8(credentials.private_key, "RS256");

      const jwt = await new jose.SignJWT({
        scope: "https://www.googleapis.com/auth/drive.file",
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(credentials.client_email)
        .setAudience("https://oauth2.googleapis.com/token")
        .setExpirationTime("1h")
        .setIssuedAt()
        .sign(privateKey);

      const tokenResponse = await fetchWithDeadline("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Error en intercambio de token Google: ${tokenResponse.statusText}`);
      }

      const data = (await tokenResponse.json()) as GoogleTokenResponse;
      if (!data.access_token) {
        throw new Error("Google devolvio una respuesta de autenticacion incompleta");
      }
      return data.access_token;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "error desconocido";
      throw new Error(`Autenticación de cuenta de servicio de Google fallida: ${message}`);
    }
  }

  /**
   * Search / List Drive Files
   */
  async listFiles(query: string = "", accessTokenOverride?: string): Promise<DriveFile[]> {
    const cleanQuery = query.toLowerCase().trim();

    if (this.isConfigured()) {
      try {
        const accessToken = accessTokenOverride || await this.getAccessToken();
        let searchString = "mimeType != 'application/vnd.google-apps.folder'";
        if (cleanQuery) {
          searchString += ` and name contains '${escapeGoogleDriveQueryLiteral(query)}'`;
        }

        const response = await fetchWithDeadline(
          `https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,mimeType,size)&q=${encodeURIComponent(
            searchString
          )}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (response.ok) {
          const data = await response.json();
          return data.files || [];
        }
      } catch (err) {
        console.error("[GoogleDriveService] Error llamando a API real, usando mock:", err);
      }
    }

    // Fallback to Mock Catalog
    if (!cleanQuery) return MOCK_DRIVE_FILES;
    return MOCK_DRIVE_FILES.filter(
      (file) =>
        file.name.toLowerCase().includes(cleanQuery) ||
        file.mimeType.toLowerCase().includes(cleanQuery)
    );
  }

  /**
   * Download and stream Google Drive file directly into Supabase Storage
   */
  async importFile(
    urlOrId: string,
    type: ProductionAssetType,
    componentId: string,
    accessToken?: string,
    userId?: string,
    organizationId?: string,
  ): Promise<ImportedCloudAsset> {
    const fileId = this.parseFileId(urlOrId);
    let buffer: Buffer | null = null;
    let fileName = `drive-${fileId}`;
    let mimeType = "";

    // 1. Check if mock file first
    const mockFile = MOCK_DRIVE_FILES.find((f) => f.id === fileId);
    if (mockFile && mockFile.public_url) {
      const response = await fetchWithDeadline(
        mockFile.public_url,
        {},
        DEFAULT_OUTBOUND_DOWNLOAD_TIMEOUT_MS,
      );
      if (!response.ok) {
        throw new Error(`No se pudo descargar el archivo mock desde ${mockFile.public_url}`);
      }
      buffer = await readGoogleDriveResponse(response);
      fileName = mockFile.name;
      mimeType = mockFile.mimeType;
    }

    // 2. Real Google Drive download if not mock
    if (!buffer) {
      const activeToken =
        accessToken ||
        (userId && organizationId ? await this.refreshUserAccessToken(userId, organizationId) : null) ||
        (this.isConfigured() ? await this.getAccessToken() : null);
      if (activeToken) {
        try {
          // Get metadata
          const metadataUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,size`;
          const metaRes = await fetchWithDeadline(metadataUrl, {
            headers: { Authorization: `Bearer ${activeToken}` },
          });
          if (metaRes.ok) {
            const meta = (await metaRes.json()) as GoogleDriveMetadataResponse;
            fileName = meta.name || fileName;
            mimeType = meta.mimeType || "";
            const declaredSize = Number(meta.size || 0);
            if (Number.isFinite(declaredSize) && declaredSize > MAX_GOOGLE_DRIVE_IMPORT_BYTES) {
              throw new Error(GOOGLE_DRIVE_SIZE_LIMIT_ERROR);
            }
          }

          // Get file content
          const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
          const downloadRes = await fetchWithDeadline(
            downloadUrl,
            { headers: { Authorization: `Bearer ${activeToken}` } },
            DEFAULT_OUTBOUND_DOWNLOAD_TIMEOUT_MS,
          );

          if (!downloadRes.ok) {
            throw new Error(`Google Drive API error de descarga: ${downloadRes.statusText}`);
          }

          buffer = await readGoogleDriveResponse(downloadRes);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "error desconocido";
          if (message === GOOGLE_DRIVE_SIZE_LIMIT_ERROR) {
            throw error;
          }
          console.warn("[GoogleDriveService] Descarga autenticada fallida, reintentando descarga pública:", message);
        }
      }

      // Fallback: Public download
      if (!buffer) {
        let downloadUrl = `https://docs.google.com/uc?export=download&id=${fileId}`;
        let response = await fetchWithDeadline(
          downloadUrl,
          {},
          DEFAULT_OUTBOUND_DOWNLOAD_TIMEOUT_MS,
        );

        if (!response.ok) {
          throw new Error(`No se pudo descargar el archivo público de Drive: ${response.statusText}`);
        }

        const responseContentType = response.headers.get("content-type") || "";
        if (responseContentType.includes("text/html")) {
          const confirmationPage = await readGoogleDriveResponse(
            response,
            MAX_GOOGLE_DRIVE_CONFIRMATION_PAGE_BYTES,
            "La pagina de confirmacion de Google Drive supera el limite permitido.",
          );
          const confirmMatch = confirmationPage.toString("utf8").match(/confirm=([a-zA-Z0-9_-]+)/);
          if (!confirmMatch) {
            throw new Error("Google Drive no devolvio un archivo publico descargable.");
          }
          const confirmToken = confirmMatch[1];
          downloadUrl = `https://docs.google.com/uc?export=download&id=${fileId}&confirm=${confirmToken}`;
          response = await fetchWithDeadline(
            downloadUrl,
            {},
            DEFAULT_OUTBOUND_DOWNLOAD_TIMEOUT_MS,
          );
          if (!response.ok) {
            throw new Error(`No se pudo confirmar la descarga publica de Drive (HTTP ${response.status}).`);
          }
        }

        buffer = await readGoogleDriveResponse(response);
        mimeType = response.headers.get("content-type") || "";
        const contentDispo = response.headers.get("content-disposition") || "";
        const filenameMatch = contentDispo.match(/filename="?([^";]+)"?/);
        if (filenameMatch) {
          fileName = filenameMatch[1];
        }
      }
    }

    if (!buffer) {
      throw new Error("El archivo no se pudo descargar de Google Drive.");
    }

    return uploadImportedAssetToStorage({
      buffer,
      componentId,
      fileName,
      mimeType,
      sourcePrefix: "drive",
      type,
    });
  }

  /**
   * Asegura un access_token válido descifrando y renovando si es necesario
   */
  async refreshUserAccessToken(userId: string, organizationId: string): Promise<string> {
    const creds = await getCloudStorageCredentials(userId, organizationId, "google_drive");
    if (!creds) {
      throw new Error("No hay cuenta de Google vinculada para este usuario.");
    }

    const decryptedAccessToken = decryptCredentialToken(creds.access_token);

    // Retorna el actual si aún es válido (más de 1 minuto de holgura)
    if (new Date(creds.expires_at).getTime() > Date.now() + 60000) {
      return decryptedAccessToken;
    }

    const decryptedRefreshToken = decryptCredentialToken(creds.refresh_token);

    // Solicitar renovación del access_token
    const response = await fetchWithDeadline("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        refresh_token: decryptedRefreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });

    if (!response.ok) {
      throw new Error("La renovación del token de Google falló. El usuario debe reconectar.");
    }

    const tokenData = (await response.json()) as GoogleTokenResponse;
    if (!tokenData.access_token || !tokenData.expires_in) {
      throw new Error("Google devolvio una respuesta de renovacion incompleta.");
    }
    const nextExpires = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    await updateCloudStorageAccessToken({
      accessToken: tokenData.access_token,
      expiresAt: nextExpires,
      organizationId,
      provider: "google_drive",
      userId,
    });

    return tokenData.access_token;
  }

  /**
   * Crea una carpeta en Google Drive y retorna su ID
   */
  async createFolder(name: string, parentId: string | null, accessToken: string): Promise<string> {
    const metadata: { name: string; mimeType: string; parents?: string[] } = {
      name,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (parentId) {
      metadata.parents = [parentId];
    }

    const response = await fetchWithDeadline("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metadata),
    });

    if (!response.ok) {
      throw new Error(`Error de Google Drive API al crear carpeta (HTTP ${response.status}).`);
    }

    const data = (await response.json()) as GoogleDriveFolderResponse;
    if (!data.id) {
      throw new Error("Google Drive no devolvio el ID de la carpeta creada.");
    }
    return data.id;
  }

  /**
   * Crea el árbol de carpetas organizado para un taller/artefacto
   */
  async setupArtifactFolderTree(
    artifactId: string,
    artifactName: string,
    userId: string,
    organizationId: string,
  ): Promise<{ rootFolderId: string; folderUrl: string }> {
    try {
      const token = await this.refreshUserAccessToken(userId, organizationId);

      // 1. Crear carpeta raíz del taller
      const rootFolderName = buildArtifactRootFolderName(artifactName);
      const rootFolderId = await this.createFolder(rootFolderName, null, token);

      // 2. Crear subcarpetas estructuradas
      const folderMappings: Record<string, string> = {};
      for (const folderName of ARTIFACT_FOLDER_NAMES) {
        const subFolderId = await this.createFolder(folderName, rootFolderId, token);
        folderMappings[buildFolderMappingKey(folderName)] = subFolderId;
      }

      const folderUrl = `https://drive.google.com/drive/folders/${rootFolderId}`;

      await saveArtifactCloudStorageMetadata({
        artifactId,
        folderUrl,
        provider: "google_drive",
        rootFolderId,
        subfolders: folderMappings,
      });

      return { rootFolderId, folderUrl };
    } catch (error: unknown) {
      console.error("[GoogleDriveService] Error creando árbol de carpetas:", error);
      throw error;
    }
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
      throw new Error("El artefacto no tiene carpeta Materiales configurada en Google Drive.");
    }

    const token = await this.refreshUserAccessToken(userId, organizationId);
    const syncedLessons: CloudStorageMaterialsLesson[] = [];

    for (const lesson of lessons) {
      const lessonFolderId = await this.createFolder(
        buildLessonFolderName({
          lessonOrder: lesson.lessonOrder,
          lessonTitle: lesson.lessonTitle,
        }),
        materialsFolderId,
        token,
      );

      const assetFolders: Record<string, string> = {};
      for (const folderName of MATERIAL_ASSET_FOLDER_NAMES) {
        const assetFolderId = await this.createFolder(folderName, lessonFolderId, token);
        assetFolders[buildFolderMappingKey(folderName)] = assetFolderId;
      }

      syncedLessons.push({
        asset_folders: assetFolders,
        folder_id: lessonFolderId,
        lesson_id: lesson.lessonId,
        lesson_title: lesson.lessonTitle,
      });
    }

    await saveMaterialsCloudStorageMetadata({
      artifactId,
      lessons: syncedLessons,
      materialsFolderId,
      provider: "google_drive",
    });

    return syncedLessons;
  }
}
