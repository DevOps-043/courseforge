import { prepareStandaloneHtml, combineStandaloneHtmlDecks, loadStandaloneHtmlDecks } from "./standalone-html.service";
import { createHash } from "node:crypto";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import sharp from "sharp";
import type { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveProductionComponentContext } from "../jobs/production-jobs.service";
import { HYPERFRAMES_PRIVATE_SOURCE_BUCKET } from "../media-storage.config";
import { validateHyperframesMediaAsset } from "../hyperframes/hyperframes-media-constraints";
import { extractHyperframesAnimatedDeck } from "../hyperframes/hyperframes-source-asset.service";
import { STANDALONE_HTML_MAX_BYTES, STANDALONE_MEDIA_MAX_BYTES, STANDALONE_MEDIA_MIME, standaloneMediaPath, type standaloneMediaInputSchema } from "./standalone-media.types";

export class StandaloneMediaValidationError extends Error {}

/** Only registers verified files belonging to an authorized standalone component. */
export async function registerStandaloneMedia(params: {
  input: z.infer<typeof standaloneMediaInputSchema>;
  userId: string;
  supabase: SupabaseClient;
}) {
  const { input, supabase } = params;
  const context = await resolveProductionComponentContext({ componentId: input.componentId, supabase });
  const { data: project, error: projectError } = await supabase.from("standalone_assembly_projects")
    .select("id").eq("backing_component_id", input.componentId).eq("organization_id", context.organizationId).maybeSingle();
  if (projectError) throw projectError;
  if (!project) throw new StandaloneMediaValidationError("El componente no pertenece a un proyecto independiente.");
  const { data: existing, error: existingError } = await supabase.from("production_assets")
    .select("id, organization_id, material_component_id").eq("id", input.assetId).maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    if (existing.organization_id !== context.organizationId || existing.material_component_id !== input.componentId) {
      throw new StandaloneMediaValidationError("La referencia del archivo no pertenece al proyecto.");
    }
    return;
  }
  const path = standaloneMediaPath(input);
  const bucket = supabase.storage.from(HYPERFRAMES_PRIVATE_SOURCE_BUCKET);
  const { data: info, error: infoError } = await bucket.info(path);
  if (infoError || !info) throw new StandaloneMediaValidationError("El archivo todavía no está disponible. Reintenta la carga.");
  if (!info.size || info.size > STANDALONE_MEDIA_MAX_BYTES) throw new StandaloneMediaValidationError("El archivo supera el límite de 100 MiB o está vacío.");
  const mimeType = STANDALONE_MEDIA_MIME[input.extension];
  if (mimeType === "text/html" && info.size > STANDALONE_HTML_MAX_BYTES) throw new StandaloneMediaValidationError("El HTML supera el límite de 650 KB.");
  const { data: blob, error: downloadError } = await bucket.download(path);
  if (downloadError || !blob) throw new Error("No se pudo verificar el archivo subido.");
  if (blob.size !== info.size || blob.size > STANDALONE_MEDIA_MAX_BYTES) throw new StandaloneMediaValidationError("El archivo cambió durante su validación.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let deck = null;
  if (mimeType === "text/html") {
    try { deck = prepareStandaloneHtml(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new StandaloneMediaValidationError("HTML no compatible. Usa diapositivas section.slide con CSS local y sin recursos externos salvo fuentes permitidas."); }
  }
  if (deck) {
    const { data: component, error: componentError } = await supabase.from("material_components")
      .select("assets").eq("id", input.componentId).single();
    if (componentError) throw componentError;
    const existingDeck = await loadStandaloneHtmlDecks({ componentId: input.componentId, organizationId: context.organizationId!, supabase,
      legacy: extractHyperframesAnimatedDeck(component.assets) });
    try { combineStandaloneHtmlDecks(existingDeck, [{ id: input.assetId, deck }]); }
    catch { throw new StandaloneMediaValidationError("El HTML contiene CSS no compatible o supera los límites acumulados del proyecto."); }
  }
  const metadata = deck ? { width: deck.width, height: deck.height, duration: deck.slides.length * 5, hasAudio: false }
    : await inspectStandaloneMedia(bytes, mimeType);
  const validation = validateHyperframesMediaAsset({ fileName: path, mimeType, fileSizeBytes: bytes.byteLength,
    width: metadata.width, height: metadata.height });
  if (!deck && !validation.valid) throw new StandaloneMediaValidationError(validation.errors.join(" "));
  const { error } = await supabase.from("production_assets").upsert({
    id: input.assetId, artifact_id: context.artifactId, organization_id: context.organizationId,
    material_component_id: context.componentId, material_lesson_id: context.materialLessonId,
    lesson_id: context.lessonId, module_id: context.moduleId, created_by: params.userId,
    content: deck ? { deck } : {},
    asset_type: "SOURCE_MEDIA", provider: "manual", qa_status: "GENERATED",
    mime_type: mimeType, file_size_bytes: bytes.byteLength,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    storage_bucket: HYPERFRAMES_PRIVATE_SOURCE_BUCKET,
    storage_path: `${HYPERFRAMES_PRIVATE_SOURCE_BUCKET}/${path}`,
    duration_milliseconds: metadata.duration ? Math.round(metadata.duration * 1000) : null,
    duration_seconds: metadata.duration ? Math.round(metadata.duration) : null,
    metadata: { standalone_media: true, timeline_role: "MEDIA", file_name: input.fileName,
      source_width: metadata.width, source_height: metadata.height, has_audio: metadata.hasAudio },
  }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function inspectStandaloneMedia(bytes: Uint8Array, mimeType: string) {
  if (mimeType.startsWith("image/")) {
    const image = await sharp(bytes, { limitInputPixels: 1920 * 1920 }).metadata();
    if (`image/${image.format}` !== mimeType || !image.width || !image.height) {
      throw new StandaloneMediaValidationError("El contenido no corresponde al formato de imagen.");
    }
    return { width: image.width, height: image.height, duration: null, hasAudio: false };
  }
  const media = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
  try {
    const detectedMime = (await media.getFormat())?.mimeType;
    if (detectedMime !== mimeType && !(mimeType === "audio/wav" && detectedMime === "audio/x-wav")) {
      throw new StandaloneMediaValidationError("El contenido no corresponde al formato indicado.");
    }
    const video = await media.getPrimaryVideoTrack();
    const audio = await media.getPrimaryAudioTrack();
    if (mimeType.startsWith("video/") ? !video : !audio || Boolean(video)) {
      throw new StandaloneMediaValidationError("El archivo no contiene las pistas esperadas.");
    }
    const duration = await media.getDurationFromMetadata() ?? await media.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new StandaloneMediaValidationError("Duración inválida.");
    return { duration, hasAudio: Boolean(audio), width: video ? await video.getDisplayWidth() : undefined,
      height: video ? await video.getDisplayHeight() : undefined };
  } finally { media.dispose(); }
}
