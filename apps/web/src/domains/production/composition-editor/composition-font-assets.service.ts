import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompositionEditorDocument } from "./composition-document.types";
import type { CompositionCompiledFont, OrganizationFontRecord } from "../fonts/organization-font.types";
import { ORGANIZATION_FONT_TABLE } from "../fonts/organization-font.types";
import { compositionFontReferenceDetails } from "./composition-font-references";
import { readReadyGoogleFontFaces } from "../fonts/google-font-native-face-reader.server";
import { googleFontFaceBinding, googleFontNativeFile } from "../fonts/google-font-native-face.contract";
import { googleFontBundleStoragePath } from "../fonts/google-font-bundle.contract";
import { ORGANIZATION_FONT_STORAGE_BUCKET } from "../fonts/organization-font.types";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";
import type { ConformanceFontManifest } from "./composition-conformance-font-bindings";

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
  signal?: AbortSignal;
}) {
  let references: ReturnType<typeof compositionFontReferenceDetails>;
  try { references = compositionFontReferenceDetails(params.document); }
  catch { throw new CompositionFontAssetError("Las referencias tipográficas de la composición no son válidas."); }
  const ids = [...references.keys()];
  if (ids.length === 0) return [];
  const googleIds = ids.filter(id => references.get(id)?.googleFace);
  const uploadedIds = ids.filter(id => !references.get(id)?.googleFace);
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs)])
    : AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
  signal.throwIfAborted();
  const { data, error } = uploadedIds.length ? await params.supabase.from(ORGANIZATION_FONT_TABLE)
    .select("id, family, source, status, checksum_sha256, mime_type, file_size_bytes, storage_bucket, storage_path")
    .eq("organization_id", params.organizationId)
    .in("id", uploadedIds) : { data: [], error: null };
  if (error) throw new CompositionFontAssetError("No se pudieron verificar las fuentes de la composición.", 500);

  const records = new Map<string, OrganizationFontRecord>();
  if (googleIds.length) {
    const faces = await readReadyGoogleFontFaces({ organizationId: params.organizationId, selection: { faceIds: googleIds },
      supabase: params.supabase, signal });
    for (const face of faces) records.set(face.id, { id: face.id, family: face.family, status: "READY",
      checksumSha256: face.face.checksumSha256, fileSizeBytes: face.face.fileSizeBytes, mimeType: face.face.mimeType,
      storageBucket: ORGANIZATION_FONT_STORAGE_BUCKET,
      storagePath: googleFontBundleStoragePath(params.organizationId, face.pin.candidateSha256, googleFontNativeFile(face)), googleFace: googleFontFaceBinding(face) });
  }
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
    if (record.family !== references.get(id)?.fontFamily
      || JSON.stringify(record.googleFace) !== JSON.stringify(references.get(id)?.googleFace)) {
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
    return [font.id, compiledCompositionFont(font, data.signedUrl)];
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
  return { assetId: font.id, family: font.family, format: fontFormat(font.mimeType), sourceUrl,
    ...(font.googleFace ? { googleFace: font.googleFace } : {}) };
}
export function compositionFontManifestBinding(font: OrganizationFontRecord): ConformanceFontManifest[number] {
  return { fontAssetId: font.id, family: font.family, checksumSha256: font.checksumSha256,
    fileSizeBytes: font.fileSizeBytes, mimeType: font.mimeType as ConformanceFontManifest[number]["mimeType"],
    ...(font.googleFace ? { googleFace: font.googleFace } : {}) };
}
export function compiledManifestFont(font: ConformanceFontManifest[number], sourceUrl: string): CompositionCompiledFont {
  return { assetId: font.fontAssetId, family: font.family, format: fontFormat(font.mimeType), sourceUrl,
    ...(font.googleFace ? { googleFace: font.googleFace } : {}) };
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
