import type { CompositionEditorDocument } from "./composition-document.types";
import { compositionFontReferences } from "./composition-font-references";
import { hyperframesAssetManifestSchema } from "../hyperframes/hyperframes.types";
import { assertDocumentConformanceFontBindings, conformanceFontManifestSchema } from "./composition-conformance-font-bindings";
import { z } from "zod";

export const htmlReconstructionNativeResourcesSchema = z.object({assets: hyperframesAssetManifestSchema, fontManifest: conformanceFontManifestSchema}).strict();
const resourcesSchema = htmlReconstructionNativeResourcesSchema;
export type HtmlReconstructionNativeResources = z.infer<typeof resourcesSchema>;

/** Server-side integrity/admission only. Metadata must be independently acquired by the host
 * from CURRENT authorized rows; it does not authorize the actor or new creation. */
export function assertHtmlReconstructionNativeResources(document: CompositionEditorDocument, input: unknown) {
  const resources = resourcesSchema.parse(input);
  const byId = new Map(resources.assets.map(asset => [asset.productionAssetId, asset]));
  if (byId.size !== resources.assets.length) throw new Error("HTML_RECONSTRUCTION_NATIVE_RESOURCE_SET_MISMATCH");
  const sources = new Map<string, string>();
  const fontIds = compositionFontReferences(document);
  for (const clip of document.clips) {
    const source = clip.source;
    if (source.type === "DECK_SLIDE") continue;
    if (source.type === "NATIVE_TEXT" || source.type === "NATIVE_CAPTIONS") {
      continue;
    }
    const id = source.type === "PRODUCTION_ASSET" ? source.productionAssetId
      : source.type === "ASSEMBLY_BRAND_ASSET" ? source.assemblyBrandAssetId : source.soundEffectAssetId;
    const asset = byId.get(id), previousSource = sources.get(id);
    if (!asset || previousSource && previousSource !== source.type) throw new Error("HTML_RECONSTRUCTION_NATIVE_RESOURCE_SET_MISMATCH");
    sources.set(id, source.type);
    const mimePrefix = clip.kind === "VIDEO" ? "video/" : clip.kind === "IMAGE" ? "image/" : clip.kind === "AUDIO" ? "audio/" : null;
    if (!mimePrefix || !asset.mimeType.startsWith(mimePrefix) || source.type === "SOUND_EFFECT_ASSET" && clip.kind !== "AUDIO")
      throw new Error("HTML_RECONSTRUCTION_NATIVE_RESOURCE_KIND_MISMATCH");
  }
  if (sources.size !== byId.size || fontIds.size !== resources.fontManifest.length
    || resources.fontManifest.some(font => !fontIds.has(font.fontAssetId))) throw new Error("HTML_RECONSTRUCTION_NATIVE_RESOURCE_SET_MISMATCH");
  assertDocumentConformanceFontBindings(document, resources.fontManifest);
  return resources;
}
