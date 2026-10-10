import type { SupabaseClient } from "@supabase/supabase-js";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import type { HtmlHistoricalReconstructionOrigin } from "./composition-html-editing-historical-reconstruction.server";
import { readCurrentHtmlDraftImageIdentities } from "./composition-html-editing-snapshot-images.service";
import { readHtmlReconstructionResourceReferences } from "./composition-html-editing-reconstruction-resource-references.server";
import { readHtmlReconstructionSelectedResources } from "./composition-html-editing-reconstruction-selected-resources.server";
import type { HtmlReconstructionResourceSelection } from "./composition-html-editing-reconstruction-resource-selection.contract";
import { readHtmlSnapshotNativeMedia } from "./composition-html-editing-snapshot-media.server";
import { createHtmlSnapshotFontAcquirer, revalidateHtmlSnapshotFontAuthority } from "./composition-html-editing-snapshot-fonts.server";
import { assertDocumentConformanceFontBindings } from "./composition-conformance-font-bindings";
import type { assembleAcquiredCompositionHtmlEditingSnapshotArchive } from "./composition-html-editing-snapshot-archive.server";

type PackagedFonts = Parameters<typeof assembleAcquiredCompositionHtmlEditingSnapshotArchive>[0]["packagedFonts"];

/** Concrete adapter for the currently admitted self-contained slide reconstruction.
 * Only references actually parsed as resources are acquired. Text mentioning an
 * alias is not a grant. Authorize origin before/after calling this host-only port;
 * source-draft links are refreshed, never transplanted from the archived bundle.
 * Native resources are acquired by the composition adapter below. Selecting new
 * unrelated resources outside the authorized source draft remains separate. */
export function createHtmlReconstructionSlideResourceAcquirer(supabase: SupabaseClient) {
  return async (input: {origin: HtmlHistoricalReconstructionOrigin; document: CompositionEditorDocument; signal: AbortSignal}) => {
    input.signal.throwIfAborted();
    try {
      const document = compositionEditorDocumentSchema.parse(input.document);
      const {imageIds: ids} = readHtmlReconstructionResourceReferences(document);
      const imageAssets = await readCurrentHtmlDraftImageIdentities({supabase, organizationId: input.origin.organizationId,
        draftId: input.origin.draftId, productionAssetIds: ids, signal: input.signal});
      input.signal.throwIfAborted();
      return {grantedAssetIds: ids, imageSources: new Map(ids.map(id => [id, `conformance-media/${id}`])),
        imageAssets, packagedFonts: []};
    } catch {
      input.signal.throwIfAborted();
      throw new Error("HTML_RECONSTRUCTION_RESOURCES_UNAVAILABLE");
    }
  };
}

/** Concrete composition resource port. Current source-draft media links and
 * tenant READY font rows are read independently of the historical archive.
 * Refresh retains already checksum-bound font bytes, but reauthorizes their
 * metadata; no global cache, second download or browser-supplied byte trust. */
export function createHtmlReconstructionCompositionResourceAcquirer(configuration: {
  supabase: SupabaseClient; supabaseUrl: string; serviceRoleKey: string; fetchImpl?: typeof fetch;
}) {
  const {supabase, supabaseUrl, serviceRoleKey, fetchImpl} = configuration;
  const acquireImages = createHtmlReconstructionSlideResourceAcquirer(supabase);
  const acquireFonts = createHtmlSnapshotFontAcquirer({supabase, supabaseUrl, serviceRoleKey, fetchImpl});
  return async (input: {origin: HtmlHistoricalReconstructionOrigin; document: CompositionEditorDocument;
    signal: AbortSignal; existingFonts?: PackagedFonts; actorId?: string; resourceSelection?: HtmlReconstructionResourceSelection}) => {
    const document = compositionEditorDocumentSchema.parse(input.document), origin = structuredClone(input.origin);
    const signal = input.signal, existingFonts = input.existingFonts ? structuredClone(input.existingFonts) : undefined;
    const selection = input.resourceSelection ? structuredClone(input.resourceSelection) : undefined, actorId = input.actorId;
    if (selection && !actorId) throw new Error("HTML_RECONSTRUCTION_SELECTED_RESOURCES_UNAVAILABLE");
    const selected = selection && actorId ? await readHtmlReconstructionSelectedResources({supabase, origin, document, selection, actorId, signal}) : undefined;
    const images = selected ?? await acquireImages({origin, document, signal});
    const nativeAssets = selected?.nativeAssets ?? (await readHtmlSnapshotNativeMedia({supabase, organizationId: origin.organizationId,
      draftId: origin.draftId, document, signal})).assets;
    let packagedFonts: PackagedFonts;
    if (existingFonts) {
      packagedFonts = existingFonts;
      const manifest = assertDocumentConformanceFontBindings(document, packagedFonts.map(font => font.binding));
      await revalidateHtmlSnapshotFontAuthority(supabase, {organizationId: origin.organizationId, manifest, signal});
    } else packagedFonts = await acquireFonts({document, organizationId: origin.organizationId, signal});
    signal.throwIfAborted();
    return {...images, nativeAssets, packagedFonts};
  };
}
