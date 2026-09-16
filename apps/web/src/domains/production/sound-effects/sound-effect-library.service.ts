import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

/** Preview URLs are deliberately much shorter lived than render-delivery URLs. */
export const SOUND_EFFECT_PREVIEW_URL_TTL_SECONDS = 5 * 60;

export const soundEffectCategorySchema = z.enum([
  "TRANSITION",
  "EMPHASIS",
  "UI",
  "IMPACT",
  "AMBIENCE",
  "OTHER",
]);

export const soundEffectLibraryQuerySchema = z.object({
  category: soundEffectCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  query: z.string().trim().max(120).optional(),
});

export const linkSoundEffectToDraftSchema = z.object({
  draftId: z.string().uuid(),
  soundEffectAssetId: z.string().uuid(),
}).strict();

export class SoundEffectLibraryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const uploadSoundEffectSchema = z.object({
  category: soundEffectCategorySchema,
  description: z.string().trim().max(1000).default(""),
  licenseReference: z.string().trim().max(1000).optional(),
  licenseType: z.string().trim().min(1).max(80).default("INTERNAL"),
  name: z.string().trim().min(1).max(160),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
}).strict();

/**
 * Experimental ingestion deliberately accepts WAV only: its duration can be
 * verified locally and deterministically without trusting browser metadata or
 * introducing a media-processing dependency into the request path.
 */
export async function uploadVerifiedWavSoundEffect(params: {
  bytes: Uint8Array;
  input: z.infer<typeof uploadSoundEffectSchema>;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
  userId: string;
}) {
  if (params.bytes.byteLength === 0 || params.bytes.byteLength > 25 * 1024 * 1024) {
    throw new SoundEffectLibraryError("El archivo debe pesar entre 1 byte y 25 MB.");
  }
  const durationMilliseconds = inspectWavDurationMilliseconds(params.bytes);
  if (durationMilliseconds > 30_000) {
    throw new SoundEffectLibraryError("Un efecto de sonido no puede durar más de 30 segundos.");
  }
  const checksum = createHash("sha256").update(params.bytes).digest("hex");
  const { data: existing, error: existingError } = await params.supabase
    .from("sound_effect_assets")
    .select("id")
    .eq("organization_id", params.organizationId)
    .eq("checksum_sha256", checksum)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) throw new SoundEffectLibraryError("Este mismo archivo ya existe en la biblioteca.", 409);

  const storagePath = `organizations/${params.organizationId}/${randomUUID()}/${checksum}.wav`;
  const { error: uploadError } = await params.supabase.storage
    .from("sound-effect-assets")
    .upload(storagePath, params.bytes, { contentType: "audio/wav", upsert: false });
  if (uploadError) throw uploadError;
  const { data, error } = await params.supabase.from("sound_effect_assets").insert({
    category: params.input.category,
    checksum_sha256: checksum,
    created_by: params.userId,
    description: params.input.description,
    duration_milliseconds: durationMilliseconds,
    file_size_bytes: params.bytes.byteLength,
    license_reference: params.input.licenseReference || null,
    license_type: params.input.licenseType,
    mime_type: "audio/wav",
    name: params.input.name,
    organization_id: params.organizationId,
    status: "READY",
    storage_bucket: "sound-effect-assets",
    storage_path: storagePath,
    tags: normalizeTags(params.input.tags),
  }).select("id, name, category, duration_milliseconds").single();
  if (error) {
    // The object is private and inaccessible without a database record. Leave
    // it for a bounded storage-orphan cleanup job rather than risking a delete
    // race against a retried request.
    throw error;
  }
  return {
    category: data.category,
    durationMilliseconds: data.duration_milliseconds,
    id: data.id,
    name: data.name,
  };
}

/** Lists only READY assets; file paths and signed URLs never reach the editor catalogue. */
export async function listReadySoundEffects(params: {
  filters: z.infer<typeof soundEffectLibraryQuerySchema>;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  let request = params.supabase
    .from("sound_effect_assets")
    .select("id, name, description, category, tags, duration_milliseconds, mime_type, license_type, attribution_text")
    .eq("organization_id", params.organizationId)
    .eq("status", "READY")
    .order("created_at", { ascending: false })
    .limit(params.filters.limit);
  if (params.filters.category) request = request.eq("category", params.filters.category);
  if (params.filters.query) {
    const query = escapePostgrestSearch(params.filters.query);
    request = request.or(`name.ilike.%${query}%,description.ilike.%${query}%`);
  }
  const { data, error } = await request;
  if (error) throw error;
  return (data || []).map((asset) => ({
    attributionText: asset.attribution_text || null,
    category: asset.category,
    description: asset.description,
    durationMilliseconds: asset.duration_milliseconds,
    id: asset.id,
    licenseType: asset.license_type,
    mimeType: asset.mime_type,
    name: asset.name,
    tags: asset.tags || [],
  }));
}

/** Resolves only the private Storage identity of a READY, tenant-owned effect. */
export async function getReadySoundEffectStorageIdentity(params: {
  organizationId: string;
  soundEffectAssetId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const { data, error } = await params.supabase
    .from("sound_effect_assets")
    .select("storage_bucket, storage_path")
    .eq("id", params.soundEffectAssetId)
    .eq("organization_id", params.organizationId)
    .eq("status", "READY")
    .maybeSingle();
  if (error) throw error;
  if (!data?.storage_bucket || !data.storage_path) {
    throw new SoundEffectLibraryError("El efecto de sonido no está disponible para preescucha.", 404);
  }
  return { storageBucket: data.storage_bucket, storagePath: data.storage_path };
}

/** Links a READY organization asset to a draft before it may enter the document. */
export async function linkReadySoundEffectToDraft(params: {
  draftId: string;
  organizationId: string;
  soundEffectAssetId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const [{ data: draft, error: draftError }, { data: asset, error: assetError }] = await Promise.all([
    params.supabase.from("video_composition_drafts").select("id").eq("id", params.draftId).eq("organization_id", params.organizationId).eq("state", "ACTIVE").maybeSingle(),
    params.supabase.from("sound_effect_assets").select("id, duration_milliseconds, name").eq("id", params.soundEffectAssetId).eq("organization_id", params.organizationId).eq("status", "READY").maybeSingle(),
  ]);
  if (draftError) throw draftError;
  if (assetError) throw assetError;
  if (!draft) throw new SoundEffectLibraryError("El borrador no está disponible para editar.", 409);
  if (!asset) throw new SoundEffectLibraryError("El efecto de sonido no existe o no está listo.", 404);
  const { error: linkError } = await params.supabase
    .from("video_composition_draft_sound_effect_assets")
    .upsert({ draft_id: params.draftId, organization_id: params.organizationId, sound_effect_asset_id: params.soundEffectAssetId }, { onConflict: "draft_id,sound_effect_asset_id" });
  if (linkError) throw linkError;
  return { durationMilliseconds: asset.duration_milliseconds, id: asset.id, name: asset.name };
}

function escapePostgrestSearch(value: string) {
  return value.replace(/[%,()]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.toLocaleLowerCase("es-MX").replace(/\s+/g, " ").trim()))];
}

function inspectWavDurationMilliseconds(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    throw new SoundEffectLibraryError("El experimento acepta únicamente archivos WAV RIFF válidos.");
  }
  let byteRate = 0;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + chunkSize;
    if (payloadEnd > bytes.byteLength) throw new SoundEffectLibraryError("El archivo WAV está truncado.");
    if (chunkId === "fmt " && chunkSize >= 16) byteRate = view.getUint32(payloadStart + 8, true);
    if (chunkId === "data") dataBytes = chunkSize;
    if (byteRate > 0 && dataBytes > 0) break;
    offset = payloadEnd + (chunkSize % 2);
  }
  if (!byteRate || !dataBytes) throw new SoundEffectLibraryError("El WAV no contiene datos de audio válidos.");
  return Math.max(1, Math.round((dataBytes / byteRate) * 1000));
}

function readAscii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}
