import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ORGANIZATION_FONT_TABLE, ORGANIZATION_FONT_STORAGE_BUCKET } from "../fonts/organization-font.types";
import { conformanceFontManifestSchema, CONFORMANCE_FONT_BINDING_LIMITS } from "./composition-conformance-font-bindings";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";
import { readReadyGoogleFontFaces } from "../fonts/google-font-native-face-reader.server";
import { googleFontFaceBinding, googleFontNativeFile, type GoogleFontFaceBinding } from "../fonts/google-font-native-face.contract";
import { googleFontBundleStoragePath } from "../fonts/google-font-bundle.contract";

const binding = conformanceFontManifestSchema.element;
const fontRow = z.object({ id: z.string().uuid(), organization_id: z.string().uuid(), family: binding.shape.family,
  source: z.literal("uploaded"), status: z.literal("READY"), checksum_sha256: binding.shape.checksumSha256,
  file_size_bytes: binding.shape.fileSizeBytes, mime_type: binding.shape.mimeType,
  storage_bucket: z.literal(ORGANIZATION_FONT_STORAGE_BUCKET),
  storage_path: z.string().min(1).max(1024).refine(path => path.split("/").every(segment =>
    /^[a-zA-Z0-9_.-]+$/.test(segment) && segment !== "." && segment !== "..")),
}).strict();
export type CompositionReadyFontRow = Omit<z.infer<typeof fontRow>, "source"> & {
  source: "uploaded" | "google"; google_face?: GoogleFontFaceBinding;
};

/** Current tenant-owned READY authority only. Metadata is not font decoding or a permission lease. */
export async function readReadyCompositionFontRows(supabase: SupabaseClient, organizationId: string, ids: string[], signal: AbortSignal): Promise<CompositionReadyFontRow[]> {
  z.string().uuid().parse(organizationId);
  z.array(z.string().uuid()).max(CONFORMANCE_FONT_BINDING_LIMITS.maximumFonts).parse(ids);
  if (new Set(ids).size !== ids.length) throw new Error("COMPOSITION_FONT_REGISTRY_UNAVAILABLE");
  signal.throwIfAborted();
  if (!ids.length) return [];
  const result = await supabase.from(ORGANIZATION_FONT_TABLE)
    .select("id,organization_id,family,source,status,checksum_sha256,file_size_bytes,mime_type,storage_bucket,storage_path")
    .eq("organization_id", organizationId).in("id", ids).limit(ids.length + 1).abortSignal(signal);
  signal.throwIfAborted();
  if (result.error || Buffer.byteLength(JSON.stringify(result.data) ?? "") > HTML_EDITING_REPOSITORY_POLICY.responseBytes) throw new Error("COMPOSITION_FONT_REGISTRY_UNAVAILABLE");
  const rows: CompositionReadyFontRow[] = z.array(fontRow).max(ids.length).parse(result.data);
  const missing = ids.filter(id => !rows.some(row => row.id === id));
  if (missing.length) {
    const faces = await readReadyGoogleFontFaces({ organizationId, selection: { faceIds: missing }, supabase, signal });
    rows.push(...faces.map((face): CompositionReadyFontRow => ({ id: face.id, organization_id: face.organizationId, family: face.family,
      source: "google" as const, status: "READY" as const, checksum_sha256: face.face.checksumSha256,
      file_size_bytes: face.face.fileSizeBytes, mime_type: face.face.mimeType, storage_bucket: ORGANIZATION_FONT_STORAGE_BUCKET,
      storage_path: googleFontBundleStoragePath(organizationId, face.pin.candidateSha256, googleFontNativeFile(face)), google_face: googleFontFaceBinding(face) })));
  }
  if (rows.length !== ids.length || new Set(rows.map(font => font.id)).size !== ids.length
    || rows.some(font => font.organization_id !== organizationId || !ids.includes(font.id))) throw new Error("COMPOSITION_FONT_REGISTRY_UNAVAILABLE");
  return rows;
}
