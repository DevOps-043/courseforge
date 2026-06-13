import { OneDriveService } from "./microsoft-graph.service";
import type {
  CloudStorageFile,
  CloudStorageFolderTree,
  CloudStorageLessonInput,
  CloudStorageMaterialsLesson,
  CloudStorageProvider,
  ImportedCloudAsset,
  ProductionAssetType,
} from "./types";
import { GoogleDriveService } from "@/domains/production/providers/google-drive.service";

export interface CloudStorageService {
  importFile(
    fileIdOrUrl: string,
    type: ProductionAssetType,
    componentId: string,
    userId: string,
    accessToken?: string,
  ): Promise<ImportedCloudAsset>;
  listFiles(userId: string, query?: string): Promise<CloudStorageFile[]>;
  setupMaterialsFolderTree(
    artifactId: string,
    userId: string,
    lessons: CloudStorageLessonInput[],
  ): Promise<CloudStorageMaterialsLesson[]>;
  setupArtifactFolderTree(
    artifactId: string,
    artifactName: string,
    userId: string,
  ): Promise<CloudStorageFolderTree>;
}

class GoogleDriveCloudStorageService implements CloudStorageService {
  private readonly googleDrive = new GoogleDriveService();

  async setupArtifactFolderTree(artifactId: string, artifactName: string, userId: string) {
    const result = await this.googleDrive.setupArtifactFolderTree(artifactId, artifactName, userId);
    return {
      folderUrl: result.folderUrl,
      provider: "google_drive" as const,
      rootFolderId: result.rootFolderId,
    };
  }

  async listFiles(userId: string, query = "") {
    const accessToken = await this.googleDrive.refreshUserAccessToken(userId);
    return this.googleDrive.listFiles(query, accessToken);
  }

  async importFile(
    fileIdOrUrl: string,
    type: ProductionAssetType,
    componentId: string,
    userId: string,
    accessToken?: string,
  ) {
    return this.googleDrive.importFile(fileIdOrUrl, type, componentId, accessToken, userId);
  }

  async setupMaterialsFolderTree(
    artifactId: string,
    userId: string,
    lessons: CloudStorageLessonInput[],
  ) {
    return this.googleDrive.setupMaterialsFolderTree(artifactId, userId, lessons);
  }
}

export function getCloudStorageService(provider: CloudStorageProvider): CloudStorageService {
  if (provider === "google_drive") {
    return new GoogleDriveCloudStorageService();
  }

  return new OneDriveService();
}
