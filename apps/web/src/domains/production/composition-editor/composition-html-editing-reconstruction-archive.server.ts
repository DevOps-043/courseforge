import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { prepareHtmlHistoricalReconstruction, readHtmlHistoricalReconstructionOrigin,
  type HtmlHistoricalReconstructionOrigin } from "./composition-html-editing-historical-reconstruction.server";
import { assembleAcquiredCompositionHtmlEditingSnapshotArchive } from "./composition-html-editing-snapshot-archive.server";
import { freezeCompositionHtmlEditingSnapshot } from "./composition-html-editing-snapshot-bundle.server";
import { htmlSnapshotInspectionReadRequestSchema, type HtmlSnapshotInspectionReadRequest } from "./composition-html-editing-snapshot-inspection.contract";
import { HTML_RECONSTRUCTION_POLICY as policy } from "./composition-html-editing-reconstruction.contract";
import { hyperframesRenderProfileSchema } from "../hyperframes/hyperframes.types";
import { controlledRenderExecutionContractSchema } from "./composition-render-execution-contract";
import { HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";
import type { HtmlEditingTemplateCatalog } from "./html-editing/html-editing-template-catalog.server";
import type { HtmlReconstructionResourceSelection } from "./composition-html-editing-reconstruction-resource-selection.contract";

type Assembly = Parameters<typeof assembleAcquiredCompositionHtmlEditingSnapshotArchive>[0];
type Reconstruction = Parameters<typeof prepareHtmlHistoricalReconstruction>[0];
type ResourceAcquisition = {
  grantedAssetIds: readonly string[];
  imageSources: ReadonlyMap<string, string>;
  imageAssets: Assembly["prepared"]["imageAssets"];
  packagedFonts: Assembly["packagedFonts"];
  nativeAssets?: Assembly["otherAssets"];
};
let activePreparations = 0;

/** Private host workflow, not an HTTP request adapter. Resource and catalog
 * ports must independently authorize CURRENT tenant resources/declarations;
 * archive grants are never passed to them. This produces new-content bytes,
 * not a faithful historical publication, approval or create authorization. */
export function createHtmlHistoricalReconstructionArchivePreparer(configuration: {
  supabase: SupabaseClient; storageOrigin: string; fetchResource?: typeof fetch;
  readCatalog: () => HtmlEditingTemplateCatalog;
  acquireResources: (input: {origin: HtmlHistoricalReconstructionOrigin; document: CompositionEditorDocument;
    signal: AbortSignal; existingFonts?: Assembly["packagedFonts"]; actorId: string; resourceSelection?: HtmlReconstructionResourceSelection}) => Promise<ResourceAcquisition>;
}) {
  const {supabase, storageOrigin, fetchResource, readCatalog, acquireResources} = configuration;
  return async (input: {
    request: HtmlSnapshotInspectionReadRequest;
    reconstruction: Pick<Reconstruction, "target" | "document" | "expectedDocumentHash">;
    renderProfile: Assembly["renderProfile"]; renderExecution: Assembly["renderExecution"];
    animationRuntimeSha256: string; signal?: AbortSignal;
  }) => {
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(policy.preparationTimeoutMs)])
      : AbortSignal.timeout(policy.preparationTimeoutMs);
    signal.throwIfAborted();
    if (activePreparations >= policy.maximumConcurrentPreparations)
      throw new Error("HTML_RECONSTRUCTION_ARCHIVE_BUSY");
    activePreparations++;
    try {
      const request = htmlSnapshotInspectionReadRequestSchema.parse(input.request);
      const reconstruction = {...structuredClone(input.reconstruction),
        document: compositionEditorDocumentSchema.parse(input.reconstruction.document)};
      const runtime = {renderProfile: structuredClone(hyperframesRenderProfileSchema.parse(input.renderProfile)),
        renderExecution: controlledRenderExecutionContractSchema.parse(input.renderExecution),
        animationRuntimeSha256: z.string().regex(/^[a-f0-9]{64}$/).parse(input.animationRuntimeSha256)};
      const read = {request, supabase, storageOrigin, fetchResource, signal};
      const origin = await readHtmlHistoricalReconstructionOrigin(read);
      const acquire = async (existingFonts?: Assembly["packagedFonts"]) => structuredClone(await acquireResources({origin: structuredClone(origin),
        document: structuredClone(reconstruction.document), actorId: request.actorId,
        resourceSelection: reconstruction.target.resourceSelection ? structuredClone(reconstruction.target.resourceSelection) : undefined,
        signal, existingFonts: existingFonts ? structuredClone(existingFonts) : undefined}));
      const prepare = (resources: ResourceAcquisition) => {
        signal.throwIfAborted();
        const grantedAssetIds = z.array(z.string().uuid()).max(HTML_EDITING_LIMITS.elements * HTML_EDITING_LIMITS.choices)
          .refine(ids => new Set(ids).size === ids.length).parse(resources.grantedAssetIds);
        const candidate = prepareHtmlHistoricalReconstruction({...reconstruction, origin,
          catalog: readCatalog(), grantedAssetIds, imageSources: new Map(resources.imageSources),
          nativeResources: {assets: resources.nativeAssets ?? [], fontManifest: resources.packagedFonts.map(font => font.binding)}});
        const context = {organizationId: origin.organizationId, documentId: candidate.target.documentId,
          documentHash: candidate.documentHash, revisions: candidate.initialRevisions.map(initial => ({
            authoritativeBinding: initial.revision.manifest.binding, encodedRevision: JSON.stringify(initial.revision),
            grantedAssetIds, imageSources: new Map(resources.imageSources)}))};
        return {candidate, acquired: {document: candidate.document, context,
          bundle: freezeCompositionHtmlEditingSnapshot({document: candidate.document, context}), imageAssets: resources.imageAssets}};
      };
      const resources = await acquire();
      const initial = prepare(resources);
      const prepared = await assembleAcquiredCompositionHtmlEditingSnapshotArchive({...runtime, signal,
        organizationId: origin.organizationId, documentId: initial.candidate.target.documentId,
        documentHash: initial.candidate.documentHash, prepared: initial.acquired,
        otherAssets: resources.nativeAssets ?? [], packagedFonts: resources.packagedFonts,
        refresh: async () => {
          const refreshedOrigin = await readHtmlHistoricalReconstructionOrigin(read);
          if (!isDeepStrictEqual(origin, refreshedOrigin)) throw new Error();
          const currentResources = await acquire(resources.packagedFonts);
          if (!isDeepStrictEqual(resources.packagedFonts, currentResources.packagedFonts)
            || !isDeepStrictEqual(resources.nativeAssets ?? [], currentResources.nativeAssets ?? [])) throw new Error();
          const refreshed = prepare(currentResources);
          if (initial.candidate.documentHash !== refreshed.candidate.documentHash) throw new Error();
          return refreshed.acquired;
        }});
      signal.throwIfAborted();
      return {scope: "PREPARED_RECONSTRUCTED_ARCHIVE_NOT_APPROVED_CREATED_OR_PUBLISHED" as const,
        candidate: initial.candidate, prepared};
    } catch {
      signal.throwIfAborted();
      throw new Error("HTML_RECONSTRUCTION_ARCHIVE_UNAVAILABLE");
    } finally {activePreparations--;}
  };
}
