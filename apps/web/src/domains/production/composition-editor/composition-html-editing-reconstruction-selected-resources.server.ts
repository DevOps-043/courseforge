import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hyperframesAssetManifestSchema, hyperframesAssetManifestItemSchema, HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS } from "../hyperframes/hyperframes.types";
import { htmlEditingImageIdentitySchema } from "./composition-html-editing-image-identity";
import { htmlReconstructionOriginSchema, HTML_RECONSTRUCTION_POLICY } from "./composition-html-editing-reconstruction.contract";
import { htmlReconstructionResourceSelectionSchema, htmlReconstructionSelectedResourceBindingSchema,
  type HtmlReconstructionResourceSelection } from "./composition-html-editing-reconstruction-resource-selection.contract";
import { assertHtmlReconstructionResourceSelection } from "./composition-html-editing-reconstruction-resource-references.server";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";

const responseSchema = z.object({origin: htmlReconstructionOriginSchema, selection: htmlReconstructionResourceSelectionSchema,
  bindings: z.array(htmlReconstructionSelectedResourceBindingSchema).max(HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS)}).strict();
const assetSchema = hyperframesAssetManifestItemSchema.strip();

/** One bounded service-only RPC independently authorizes source/actor and current
 * tenant rows under locks. No draft links are inherited, no media download or
 * arbitrary URL. SQL repeats this at staging/creation; this read is not a grant. */
export async function readHtmlReconstructionSelectedResources(input: {supabase: SupabaseClient; actorId: string;
  origin: z.infer<typeof htmlReconstructionOriginSchema>; document: CompositionEditorDocument;
  selection: HtmlReconstructionResourceSelection; signal: AbortSignal}) {
  const origin = htmlReconstructionOriginSchema.parse(input.origin), selection = htmlReconstructionResourceSelectionSchema.parse(input.selection);
  const actorId = z.string().uuid().parse(input.actorId), document = compositionEditorDocumentSchema.parse(input.document);
  const {imageIds} = assertHtmlReconstructionResourceSelection(document, selection);
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(HTML_RECONSTRUCTION_POLICY.rpcTimeoutMs)]);
  try {
    signal.throwIfAborted();
    const result = await input.supabase.rpc("read_html_reconstruction_selected_resources", {p_org: origin.organizationId,
      p_actor: actorId, p_origin: origin, p_selection: selection}).abortSignal(signal);
    signal.throwIfAborted();
    if (result.error || Buffer.byteLength(JSON.stringify(result.data) ?? "") > HTML_RECONSTRUCTION_POLICY.registrationBytes) throw new Error();
    const decoded = responseSchema.parse(result.data);
    if (!isDeepStrictEqual(decoded.origin, origin) || !isDeepStrictEqual(decoded.selection, selection)) throw new Error();
    const expected = new Map(selection.productionAssetIds.map(id => [id, "PRODUCTION"]));
    for (const id of selection.soundEffectAssetIds) expected.set(id, "SOUND_EFFECT");
    for (const id of [selection.branding.introAssetId, selection.branding.outroAssetId]) if (id) expected.set(id, "BRANDING");
    const byId = new Map(decoded.bindings.map(binding => [binding.productionAssetId, binding]));
    if (byId.size !== expected.size || decoded.bindings.length !== expected.size) throw new Error();
    for (const [id, type] of expected) {
      const binding = byId.get(id);
      if (!binding || binding.origin !== type) throw new Error();
      if (type === "BRANDING" && !isDeepStrictEqual([...(binding.placements ?? [])].sort(),
        [selection.branding.introAssetId === id ? "INTRO" : null, selection.branding.outroAssetId === id ? "OUTRO" : null]
          .filter(placement => placement !== null).sort())) throw new Error();
    }
    // Project only after strict decoding; origin/placements are not asset fields.
    const assets = hyperframesAssetManifestSchema.parse(decoded.bindings.map(binding => assetSchema.parse(binding)))
      .sort((a,b) => a.productionAssetId.localeCompare(b.productionAssetId));
    const imageAssets = imageIds.map(id => htmlEditingImageIdentitySchema.parse(assetSchema.parse(byId.get(id))));
    const nativeIds = new Set(document.clips.flatMap(clip => clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId]
      : clip.source.type === "ASSEMBLY_BRAND_ASSET" ? [clip.source.assemblyBrandAssetId]
        : clip.source.type === "SOUND_EFFECT_ASSET" ? [clip.source.soundEffectAssetId] : []));
    for (const clip of document.clips) {
      const source = clip.source, id = source.type === "PRODUCTION_ASSET" ? source.productionAssetId
        : source.type === "ASSEMBLY_BRAND_ASSET" ? source.assemblyBrandAssetId : source.type === "SOUND_EFFECT_ASSET" ? source.soundEffectAssetId : null;
      if (!id) continue;
      const prefix = clip.kind === "VIDEO" ? "video/" : clip.kind === "AUDIO" ? "audio/" : clip.kind === "IMAGE" ? "image/" : null;
      if (!prefix || !byId.get(id)?.mimeType.startsWith(prefix)) throw new Error();
    }
    return {grantedAssetIds: imageIds, imageSources: new Map(imageIds.map(id => [id, `conformance-media/${id}`])),
      imageAssets, nativeAssets: assets.filter(asset => nativeIds.has(asset.productionAssetId))};
  } catch {input.signal.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_SELECTED_RESOURCES_UNAVAILABLE");}
}
