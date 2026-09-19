import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompositionEditorDocument } from "./composition-document.types";
import type { CompositionCompiledFont, OrganizationFontRecord } from "../fonts/organization-font.types";
import { ORGANIZATION_FONT_TABLE } from "../fonts/organization-font.types";

export class CompositionFontAssetError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "CompositionFontAssetError";
  }
}

export async function readReferencedCompositionFonts(params: {
  document: CompositionEditorDocument;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const references = new Map<string, string>();
  for (const clip of params.document.clips) {
    if (clip.source.type !== "NATIVE_TEXT" && clip.source.type !== "NATIVE_CAPTIONS") continue;
    const { fontAssetId, fontFamily } = clip.source.style;
    if (!fontAssetId) continue;
    const previousFamily = references.get(fontAssetId);
    if (previousFamily && previousFamily !== fontFamily) {
      throw new CompositionFontAssetError("Una misma fuente no puede declararse con dos familias diferentes.");
    }
    references.set(fontAssetId, fontFamily);
  }
  const ids = [...references.keys()];
  if (ids.length === 0) return [];
  const { data, error } = await params.supabase.from(ORGANIZATION_FONT_TABLE)
    .select("id, family, source, status, checksum_sha256, mime_type, file_size_bytes, storage_bucket, storage_path")
    .eq("organization_id", params.organizationId)
    .in("id", ids);
  if (error) throw new CompositionFontAssetError("No se pudieron verificar las fuentes de la composición.", 500);

  const records = new Map<string, OrganizationFontRecord>();
  for (const row of data || []) {
    if (row.source !== "uploaded" || row.status !== "READY" || !row.checksum_sha256 || !row.mime_type
      || !row.file_size_bytes || !row.storage_bucket || !row.storage_path) continue;
    records.set(String(row.id), {
      checksumSha256: String(row.checksum_sha256),
      family: String(row.family),
      fileSizeBytes: Number(row.file_size_bytes),
      id: String(row.id),
      mimeType: String(row.mime_type),
      status: "READY",
      storageBucket: String(row.storage_bucket),
      storagePath: String(row.storage_path),
    });
  }
  return ids.map((id) => {
    const record = records.get(id);
    if (!record) throw new CompositionFontAssetError("Una fuente usada por la composición no está lista para render.");
    if (record.family !== references.get(id)) {
      throw new CompositionFontAssetError(`La familia declarada no coincide con la fuente ${record.family}.`);
    }
    return record;
  });
}

export async function resolveCompositionPreviewFonts(params: {
  document: CompositionEditorDocument;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const fonts = await readReferencedCompositionFonts(params);
  const compiled = await Promise.all(fonts.map(async (font): Promise<[string, CompositionCompiledFont]> => {
    const { data, error } = await params.supabase.storage.from(font.storageBucket).createSignedUrl(font.storagePath, 15 * 60);
    if (error || !data?.signedUrl) throw new CompositionFontAssetError(`No se pudo firmar la fuente ${font.family}.`, 500);
    return [font.id, {
      assetId: font.id,
      family: font.family,
      format: fontFormat(font.mimeType),
      sourceUrl: data.signedUrl,
    }];
  }));
  return new Map(compiled);
}

export async function downloadCompositionFont(params: {
  font: OrganizationFontRecord;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const { data, error } = await params.supabase.storage.from(params.font.storageBucket).download(params.font.storagePath);
  if (error || !data) throw new CompositionFontAssetError(`No se pudo descargar la fuente ${params.font.family}.`, 500);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength !== params.font.fileSizeBytes) {
    throw new CompositionFontAssetError(`La fuente ${params.font.family} cambió de tamaño después de validarse.`, 409);
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== params.font.checksumSha256) {
    throw new CompositionFontAssetError(`La integridad de la fuente ${params.font.family} no coincide con su registro.`, 409);
  }
  return bytes;
}

export function compositionFontArchivePath(font: OrganizationFontRecord) {
  return `assets/fonts/${font.checksumSha256}.${fontExtension(font.mimeType)}`;
}

export function compiledCompositionFont(font: OrganizationFontRecord, sourceUrl: string): CompositionCompiledFont {
  return { assetId: font.id, family: font.family, format: fontFormat(font.mimeType), sourceUrl };
}

function fontExtension(mimeType: string) {
  if (mimeType === "font/woff2") return "woff2";
  if (mimeType === "font/woff") return "woff";
  if (mimeType === "font/otf") return "otf";
  if (mimeType === "font/ttf") return "ttf";
  throw new CompositionFontAssetError("La fuente tiene un tipo MIME no soportado.");
}

function fontFormat(mimeType: string): CompositionCompiledFont["format"] {
  const extension = fontExtension(mimeType);
  if (extension === "otf") return "opentype";
  if (extension === "ttf") return "truetype";
  return extension;
}
