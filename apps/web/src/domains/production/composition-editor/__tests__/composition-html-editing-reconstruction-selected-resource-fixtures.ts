import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHistoricalCandidatePreparationFixture } from "./composition-html-editing-historical-candidate-fixtures";
import { createHtmlReconstructionFixture } from "./composition-html-editing-reconstruction-fixtures";
import { htmlEditingFixtureId as actor } from "./composition-html-editing-test-fixtures";
import { readHtmlReconstructionResourceReferences } from "../composition-html-editing-reconstruction-resource-references.server";
import { HtmlEditingTemplateCatalog } from "../html-editing/html-editing-template-catalog.server";
import { hashCompositionDocument } from "../composition-document.service";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import type { HtmlReconstructionResourceSelection } from "../composition-html-editing-reconstruction-resource-selection.contract";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";

const imageId = "44444444-4444-4444-8444-444444444444", videoId = "55555555-5555-4555-8555-555555555555";
const introId = "66666666-6666-4666-8666-666666666666", outroId = "77777777-7777-4777-8777-777777777777";
const soundId = "88888888-8888-4888-8888-888888888888", audioId = "99999999-9999-4999-8999-999999999999";
export async function createSelectedReconstructionResourceFixture() {
  const source = await createHistoricalCandidatePreparationFixture("v1", true), reconstruction = createHtmlReconstructionFixture();
  reconstruction.document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  const slide = reconstruction.document.clips[0]; if (slide.source.type !== "DECK_SLIDE") throw new Error();
  slide.source.html = slide.source.html.replaceAll(`conformance-media/${actor}`, `conformance-media/${imageId}`);
  const template = {format: "courseforge-html-editable-template-v1", templateId: "new-content", templateVersion: 1,
    sourceSha256: createHash("sha256").update(slide.source.html).digest("hex"),
    elements: source.original.compilation.revisions[0].revision.manifest.elements.map(element => element.kind === "IMAGE"
      ? {...element, allowedAssetIds: [imageId]} : element)};
  reconstruction.catalog = new HtmlEditingTemplateCatalog(JSON.stringify({format: "courseforge-html-editable-catalog-v1", organizationId: actor, templates: [template]}));
  reconstruction.target.slides = [{clipId: slide.id, templateId: template.templateId, templateVersion: 1}];
  const media = [{id: "independent-video", kind: "VIDEO" as const, source: {type: "PRODUCTION_ASSET" as const, productionAssetId: videoId}},
    {id: "independent-audio", kind: "AUDIO" as const, source: {type: "PRODUCTION_ASSET" as const, productionAssetId: audioId}},
    {id: "independent-intro", kind: "VIDEO" as const, source: {type: "ASSEMBLY_BRAND_ASSET" as const, assemblyBrandAssetId: introId, placement: "INTRO" as const}},
    {id: "independent-outro", kind: "VIDEO" as const, source: {type: "ASSEMBLY_BRAND_ASSET" as const, assemblyBrandAssetId: outroId, placement: "OUTRO" as const}},
    {id: "independent-sound", kind: "AUDIO" as const, source: {type: "SOUND_EFFECT_ASSET" as const, soundEffectAssetId: soundId}}];
  for (const item of media) reconstruction.document.clips.push({...slide, ...item, hfId: item.id, label: item.id});
  const {clip: text, track} = createCompositionNativeOverlay({document: reconstruction.document, id: "independent-font", kind: "TEXT", playheadSeconds: 0});
  if (text.source.type !== "NATIVE_TEXT") throw new Error();
  text.source.style.fontAssetId = source.font.id; text.source.style.fontFamily = source.font.family;
  if (track) reconstruction.document.tracks.push(track); reconstruction.document.clips.push(text);
  const selection = readHtmlReconstructionResourceReferences(reconstruction.document).selection;
  const target = {...reconstruction.target, resourceSelection: selection};
  const bindings = [{id: imageId, mime: "image/png", origin: "PRODUCTION"}, {id: videoId, mime: "video/mp4", origin: "PRODUCTION"},
    {id: audioId, mime: "audio/mpeg", origin: "PRODUCTION"}, {id: introId, mime: "video/mp4", origin: "BRANDING", placements: ["INTRO"]},
    {id: outroId, mime: "video/mp4", origin: "BRANDING", placements: ["OUTRO"]}, {id: soundId, mime: "audio/mpeg", origin: "SOUND_EFFECT"}]
    .map((asset, index) => ({productionAssetId: asset.id, mimeType: asset.mime, origin: asset.origin, placements: asset.placements,
      checksum: String(index + 1).repeat(64), fileSizeBytes: 4096, storageBucket: "production-assets", storagePath: `independent/${asset.id}`}));
  const calls: Record<string, unknown>[] = [], state = {deny: false, beforeRead: undefined as ((count: number) => void) | undefined,
    response: undefined as unknown};
  const supabase = {...source.configuration.supabase, rpc: (name: string, parameters: Record<string, unknown>) => {
    if (name !== "read_html_reconstruction_selected_resources") return source.configuration.supabase.rpc(name, parameters);
    return {abortSignal: async (signal: AbortSignal) => {
      signal.throwIfAborted(); calls.push(structuredClone(parameters)); state.beforeRead?.(calls.length);
      return {data: state.response ?? {origin: parameters.p_origin, selection: parameters.p_selection, bindings: structuredClone(bindings)},
        error: state.deny ? {message: "PRIVATE_TENANT_STORAGE_SECRET"} : null};
    }};
  }} as unknown as SupabaseClient;
  const configuration = {...source.configuration, supabase};
  const input = {...source.input, reconstruction: {target, document: reconstruction.document, expectedDocumentHash: hashCompositionDocument(reconstruction.document)}};
  return {source, reconstruction, target, selection: selection as HtmlReconstructionResourceSelection, bindings, calls, state, configuration, input};
}
