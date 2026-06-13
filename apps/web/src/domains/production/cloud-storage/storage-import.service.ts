import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import type { ImportedCloudAsset, ProductionAssetType } from "./types";

function getStorageTarget(type: ProductionAssetType, fileName: string, mimeType: string) {
  switch (type) {
    case "voice":
      return { defaultExt: "mp3", folder: "voices", mimeType: mimeType || "audio/mp3" };
    case "music":
      return { defaultExt: "mp3", folder: "music", mimeType: mimeType || "audio/mp3" };
    case "broll":
      return { defaultExt: "mp4", folder: "broll", mimeType: mimeType || "video/mp4" };
    case "avatar":
      return { defaultExt: "mp4", folder: "avatars", mimeType: mimeType || "video/mp4" };
    case "slides":
      return {
        defaultExt: fileName.toLowerCase().endsWith(".zip") ? "zip" : "html",
        folder: "slides",
        mimeType: mimeType || (fileName.toLowerCase().endsWith(".zip") ? "application/zip" : "text/html"),
      };
  }
}

export async function uploadImportedAssetToStorage(params: {
  buffer: Buffer;
  componentId: string;
  fileName: string;
  mimeType: string;
  sourcePrefix: string;
  type: ProductionAssetType;
}): Promise<ImportedCloudAsset> {
  const target = getStorageTarget(params.type, params.fileName, params.mimeType);
  const ext = params.fileName.includes(".")
    ? params.fileName.split(".").pop() || target.defaultExt
    : target.defaultExt;
  const cleanFileName = params.fileName
    .toLowerCase()
    .replace(/[^a-z0-9]/gi, "-")
    .substring(0, 50);
  const storagePath = `${target.folder}/${params.componentId}-${params.sourcePrefix}-${cleanFileName}.${ext}`;

  const admin = getServiceRoleClient();
  const { error: uploadError } = await admin.storage
    .from("production-assets")
    .upload(storagePath, params.buffer, {
      contentType: target.mimeType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Error subiendo el archivo a Supabase Storage: ${uploadError.message}`);
  }

  const {
    data: { publicUrl },
  } = admin.storage.from("production-assets").getPublicUrl(storagePath);

  return {
    fileName: params.fileName,
    mimeType: target.mimeType,
    publicUrl,
    storagePath: `production-assets/${storagePath}`,
  };
}
