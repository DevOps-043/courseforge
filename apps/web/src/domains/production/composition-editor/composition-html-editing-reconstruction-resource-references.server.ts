import { isDeepStrictEqual } from "node:util";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { assertCompositionHtmlEditingDeckStyleSource } from "./composition-html-editing-deck-styles.server";
import { createLocalHtmlResourceValidator } from "./html-editing/html-local-resource-policy.server";
import { HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";
import { htmlReconstructionResourceSelectionSchema, type HtmlReconstructionResourceSelection } from "./composition-html-editing-reconstruction-resource-selection.contract";

/** Actual parsed local references only, not text matches as permission. Reuses
 * the local-resource/admission policy; no authority queries or HTML execution. */
export function readHtmlReconstructionResourceReferences(input: CompositionEditorDocument) {
  const document = compositionEditorDocumentSchema.parse(input);
  assertCompositionHtmlEditingDeckStyleSource(document);
  const fragments = document.clips.flatMap(clip => clip.source.type === "DECK_SLIDE" ? [clip.source.html] : []);
  if (fragments.length > HTML_EDITING_LIMITS.elements || fragments.some(html => Buffer.byteLength(html) > HTML_EDITING_LIMITS.sourceBytes)) throw new Error();
  const localFiles = new Set(fragments.flatMap(html => [...html.matchAll(/conformance-media\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi)]
    .map(match => match[0])));
  const validator = createLocalHtmlResourceValidator({localFiles, remoteToLocal: new Map()});
  for (const html of fragments) validator.assertFragment(html);
  const imageIds = [...validator.referencedLocalFiles].map(path => path.slice("conformance-media/".length)).sort();
  const productionIds = new Set(imageIds), soundIds = new Set<string>(), branding = {introAssetId: null as string | null, outroAssetId: null as string | null};
  for (const clip of document.clips) {
    const source = clip.source;
    if (source.type === "PRODUCTION_ASSET") productionIds.add(source.productionAssetId);
    else if (source.type === "SOUND_EFFECT_ASSET") soundIds.add(source.soundEffectAssetId);
    else if (source.type === "ASSEMBLY_BRAND_ASSET") {
      const field = source.placement === "INTRO" ? "introAssetId" : "outroAssetId";
      if (branding[field] !== null && branding[field] !== source.assemblyBrandAssetId) throw new Error();
      branding[field] = source.assemblyBrandAssetId;
    }
  }
  const selection = htmlReconstructionResourceSelectionSchema.parse({scope: "CURRENT_TENANT_RESOURCE_SELECTION_NOT_GRANTS",
    productionAssetIds: [...productionIds].sort(), soundEffectAssetIds: [...soundIds].sort(), branding});
  return {imageIds, selection};
}

export function assertHtmlReconstructionResourceSelection(document: CompositionEditorDocument, input: HtmlReconstructionResourceSelection) {
  const selected = htmlReconstructionResourceSelectionSchema.parse(input), references = readHtmlReconstructionResourceReferences(document);
  if (!isDeepStrictEqual({...selected, productionAssetIds: [...selected.productionAssetIds].sort(), soundEffectAssetIds: [...selected.soundEffectAssetIds].sort()},
    references.selection)) throw new Error("HTML_RECONSTRUCTION_RESOURCE_SELECTION_MISMATCH");
  return references;
}
