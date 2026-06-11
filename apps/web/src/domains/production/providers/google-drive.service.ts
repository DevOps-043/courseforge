import * as jose from "jose";
import { encrypt, decrypt } from "@/lib/server/crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase URL or Service Role Key in environment variables");
  }
  return createSupabaseClient(supabaseUrl, supabaseServiceKey);
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  public_url?: string;
}

const MOCK_DRIVE_FILES: DriveFile[] = [];

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
        scope: "https://www.googleapis.com/auth/drive.readonly",
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(credentials.client_email)
        .setAudience("https://oauth2.googleapis.com/token")
        .setExpirationTime("1h")
        .setIssuedAt()
        .sign(privateKey);

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
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

      const data = await tokenResponse.json();
      return data.access_token;
    } catch (err: any) {
      throw new Error(`Autenticación de cuenta de servicio de Google fallida: ${err.message}`);
    }
  }

  /**
   * Search / List Drive Files
   */
  async listFiles(query: string = ""): Promise<DriveFile[]> {
    const cleanQuery = query.toLowerCase().trim();

    if (this.isConfigured()) {
      try {
        const accessToken = await this.getAccessToken();
        let searchString = "mimeType != 'application/vnd.google-apps.folder'";
        if (cleanQuery) {
          searchString += ` and name contains '${query}'`;
        }

        const response = await fetch(
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
    type: "voice" | "music" | "broll" | "avatar" | "slides",
    componentId: string,
    accessToken?: string
  ): Promise<{
    publicUrl: string;
    storagePath: string;
    duration?: number;
    mimeType?: string;
    fileName?: string;
  }> {
    const fileId = this.parseFileId(urlOrId);
    let buffer: Buffer | null = null;
    let fileName = `drive-${fileId}`;
    let mimeType = "";

    // 1. Check if mock file first
    const mockFile = MOCK_DRIVE_FILES.find((f) => f.id === fileId);
    if (mockFile && mockFile.public_url) {
      const response = await fetch(mockFile.public_url);
      if (!response.ok) {
        throw new Error(`No se pudo descargar el archivo mock desde ${mockFile.public_url}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      fileName = mockFile.name;
      mimeType = mockFile.mimeType;
    }

    // 2. Real Google Drive download if not mock
    if (!buffer) {
      const activeToken = accessToken || (this.isConfigured() ? await this.getAccessToken() : null);
      if (activeToken) {
        try {
          // Get metadata
          const metadataUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`;
          const metaRes = await fetch(metadataUrl, {
            headers: { Authorization: `Bearer ${activeToken}` },
          });
          if (metaRes.ok) {
            const meta = await metaRes.json();
            fileName = meta.name || fileName;
            mimeType = meta.mimeType || "";
          }

          // Get file content
          const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
          const downloadRes = await fetch(downloadUrl, {
            headers: { Authorization: `Bearer ${activeToken}` },
          });

          if (!downloadRes.ok) {
            throw new Error(`Google Drive API error de descarga: ${downloadRes.statusText}`);
          }

          const arrayBuffer = await downloadRes.arrayBuffer();
          buffer = Buffer.from(arrayBuffer);
        } catch (err: any) {
          console.warn("[GoogleDriveService] Descarga autenticada fallida, reintentando descarga pública:", err.message);
        }
      }

      // Fallback: Public download
      if (!buffer) {
        let downloadUrl = `https://docs.google.com/uc?export=download&id=${fileId}`;
        let response = await fetch(downloadUrl);
        
        if (!response.ok) {
          throw new Error(`No se pudo descargar el archivo público de Drive: ${response.statusText}`);
        }

        const text = await response.clone().text();
        const confirmMatch = text.match(/confirm=([a-zA-Z0-9_&-]+)/);
        if (confirmMatch) {
          const confirmToken = confirmMatch[1];
          downloadUrl = `https://docs.google.com/uc?export=download&id=${fileId}&confirm=${confirmToken}`;
          response = await fetch(downloadUrl);
        }

        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
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

    // 3. Setup folders and file extension
    let folder = "";
    let defaultExt = "";
    let storageContentType = mimeType;

    switch (type) {
      case "voice":
        folder = "voices";
        defaultExt = "mp3";
        storageContentType = storageContentType || "audio/mp3";
        break;
      case "music":
        folder = "music";
        defaultExt = "mp3";
        storageContentType = storageContentType || "audio/mp3";
        break;
      case "broll":
        folder = "broll";
        defaultExt = "mp4";
        storageContentType = storageContentType || "video/mp4";
        break;
      case "avatar":
        folder = "avatars";
        defaultExt = "mp4";
        storageContentType = storageContentType || "video/mp4";
        break;
      case "slides":
        folder = "slides";
        defaultExt = fileName.endsWith(".zip") ? "zip" : "html";
        storageContentType = storageContentType || (defaultExt === "zip" ? "application/zip" : "text/html");
        break;
    }

    const ext = fileName.includes(".") ? fileName.split(".").pop() : defaultExt;
    const cleanFileName = fileName
      .toLowerCase()
      .replace(/[^a-z0-9]/gi, "-")
      .substring(0, 50);

    const storagePath = `${folder}/${componentId}-${cleanFileName}.${ext}`;

    // 4. Upload to Supabase Storage
    const admin = getAdminClient();
    const { error: uploadError } = await admin.storage
      .from("production-assets")
      .upload(storagePath, buffer, {
        contentType: storageContentType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Error subiendo el archivo de Drive a Supabase Storage: ${uploadError.message}`);
    }

    // 5. Get Public URL
    const { data: { publicUrl } } = admin.storage
      .from("production-assets")
      .getPublicUrl(storagePath);

    return {
      publicUrl,
      storagePath: `production-assets/${storagePath}`,
      mimeType: storageContentType,
      fileName,
    };
  }

  /**
   * Asegura un access_token válido descifrando y renovando si es necesario
   */
  async refreshUserAccessToken(userId: string): Promise<string> {
    const admin = getAdminClient();
    const { data: creds, error } = await admin
      .from("user_google_credentials")
      .select("refresh_token, expires_at, access_token")
      .eq("user_id", userId)
      .single();

    if (error || !creds) {
      throw new Error("No hay cuenta de Google vinculada para este usuario.");
    }

    const decryptedAccessToken = decrypt(creds.access_token);

    // Retorna el actual si aún es válido (más de 1 minuto de holgura)
    if (new Date(creds.expires_at).getTime() > Date.now() + 60000) {
      return decryptedAccessToken;
    }

    const decryptedRefreshToken = decrypt(creds.refresh_token);

    // Solicitar renovación del access_token
    const response = await fetch("https://oauth2.googleapis.com/token", {
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

    const tokenData = await response.json();
    const nextExpires = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const encryptedNewAccess = encrypt(tokenData.access_token);

    await admin
      .from("user_google_credentials")
      .update({
        access_token: encryptedNewAccess,
        expires_at: nextExpires,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    return tokenData.access_token;
  }

  /**
   * Crea una carpeta en Google Drive y retorna su ID
   */
  async createFolder(name: string, parentId: string | null, accessToken: string): Promise<string> {
    const metadata: Record<string, any> = {
      name,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (parentId) {
      metadata.parents = [parentId];
    }

    const response = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metadata),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Error de Google Drive API al crear carpeta: ${err.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.id;
  }

  /**
   * Crea el árbol de carpetas organizado para un taller/artefacto
   */
  async setupArtifactFolderTree(
    artifactId: string,
    artifactName: string,
    userId: string
  ): Promise<{ rootFolderId: string; folderUrl: string }> {
    try {
      const token = await this.refreshUserAccessToken(userId);

      // 1. Crear carpeta raíz del taller
      const rootFolderName = `Courseforge - ${artifactName}`;
      const rootFolderId = await this.createFolder(rootFolderName, null, token);

      // 2. Crear subcarpetas estructuradas
      const foldersToCreate = [
        "01 - Syllabus",
        "02 - Curacion",
        "03 - Materiales (Audios y Slides)",
        "04 - Produccion Final"
      ];

      const folderMappings: Record<string, string> = {};
      for (const folderName of foldersToCreate) {
        const subFolderId = await this.createFolder(folderName, rootFolderId, token);
        folderMappings[folderName.toLowerCase().replace(/[^a-z0-9]/g, "_")] = subFolderId;
      }

      const folderUrl = `https://drive.google.com/drive/folders/${rootFolderId}`;

      // 3. Registrar los IDs en la metadata del artefacto
      const admin = getAdminClient();
      const { data: artifact } = await admin
        .from("artifacts")
        .select("generation_metadata")
        .eq("id", artifactId)
        .single();

      const metadata = artifact?.generation_metadata || {};
      metadata.google_drive = {
        enabled: true,
        root_folder_id: rootFolderId,
        folder_url: folderUrl,
        subfolders: folderMappings,
        created_at: new Date().toISOString(),
      };

      await admin
        .from("artifacts")
        .update({ generation_metadata: metadata })
        .eq("id", artifactId);

      return { rootFolderId, folderUrl };
    } catch (error: any) {
      console.error("[GoogleDriveService] Error creando árbol de carpetas:", error);
      throw error;
    }
  }
}

