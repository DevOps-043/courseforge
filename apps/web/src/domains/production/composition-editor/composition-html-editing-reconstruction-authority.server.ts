import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { htmlEditingTrustedTemplateSchema } from "./html-editing/html-editing-bootstrap.server";
import type { HtmlEditingTemplateCatalog } from "./html-editing/html-editing-template-catalog.server";
import { createHtmlReconstructionSlideResourceAcquirer } from "./composition-html-editing-reconstruction-resources.server";
import { readHtmlSnapshotNativeMedia } from "./composition-html-editing-snapshot-media.server";
import { revalidateHtmlSnapshotFontAuthority } from "./composition-html-editing-snapshot-fonts.server";
import { htmlSnapshotArchiveIdentitySchema } from "./composition-html-editing-snapshot-inspection-read.server";
import type { HtmlReconstructionCandidate } from "./composition-html-editing-reconstruction-candidate.server";
import { HTML_RECONSTRUCTION_POLICY as policy } from "./composition-html-editing-reconstruction.contract";
import { readHtmlReconstructionSelectedResources } from "./composition-html-editing-reconstruction-selected-resources.server";

/** Independently configured host catalog and current tenant rows, never archive
 * grants. No historical HTML compile, media/font download or new ZIP assembly.
 * SQL must repeat DB authority checks under locks; catalog is trusted host config,
 * not a claimed SQL-linearizable catalog registry. */
export function createHtmlReconstructionAuthorityVerifier(configuration: {
  supabase: SupabaseClient; readCatalog: () => HtmlEditingTemplateCatalog;
}) {
  const {supabase, readCatalog} = configuration, acquireImages = createHtmlReconstructionSlideResourceAcquirer(supabase);
  return async (input: HtmlReconstructionCandidate, signal: AbortSignal) => {
    const candidate = structuredClone(input);
    const {origin, document, initialRevisions, target} = candidate.content.candidate, actorId = candidate.review.approval.reviewerId;
    const checkCatalog = () => {
      const catalog = readCatalog();
      for (const initial of initialRevisions) {
        const {binding, elements} = initial.revision.manifest;
        const current = htmlEditingTrustedTemplateSchema.parse(JSON.parse(catalog.resolve({organizationId: origin.organizationId,
          templateId: binding.templateId, templateVersion: binding.templateVersion, sourceSha256: binding.sourceSha256})));
        if (!isDeepStrictEqual(elements, current.elements)) throw new Error();
      }
    };
    try {
      signal.throwIfAborted(); checkCatalog();
      const response = await supabase.rpc("read_html_editing_snapshot_archive", {p_org: origin.organizationId, p_actor: actorId,
        p_composition: origin.compositionId, p_draft: origin.draftId, p_revision: origin.revisionId}).abortSignal(signal);
      if (response.error || !response.data || Buffer.byteLength(JSON.stringify(response.data)) > policy.receiptBytes) throw new Error();
      const identity = htmlSnapshotArchiveIdentitySchema.parse(response.data);
      if (identity.organizationId !== origin.organizationId || identity.actorId !== actorId || identity.compositionId !== origin.compositionId
        || identity.draftId !== origin.draftId || identity.revisionId !== origin.revisionId || identity.documentId !== origin.documentId
        || identity.documentHash !== origin.documentHash || identity.projectHash !== origin.projectHash
        || identity.bundlePin.sha256 !== origin.bundleSha256) throw new Error();
      const selected = target.resourceSelection ? await readHtmlReconstructionSelectedResources({supabase, origin, document,
        selection: target.resourceSelection, actorId, signal}) : undefined;
      const images = selected ?? await acquireImages({origin, document, signal});
      const nativeAssets = selected?.nativeAssets ?? (await readHtmlSnapshotNativeMedia({supabase, organizationId: origin.organizationId, draftId: origin.draftId, document, signal})).assets;
      const current = [...images.imageAssets, ...nativeAssets].sort((a,b) => a.productionAssetId.localeCompare(b.productionAssetId));
      const expected = [...candidate.content.prepared.assets].sort((a,b) => a.productionAssetId.localeCompare(b.productionAssetId));
      // An image can be both an HTML dependency and a native IMAGE clip.
      const byId = new Map<string, typeof current[number]>();
      for (const asset of current) {
        if (byId.has(asset.productionAssetId) && !isDeepStrictEqual(byId.get(asset.productionAssetId), asset)) throw new Error();
        byId.set(asset.productionAssetId, asset);
      }
      if (!isDeepStrictEqual([...byId.values()].sort((a,b) => a.productionAssetId.localeCompare(b.productionAssetId)), expected)) throw new Error();
      await revalidateHtmlSnapshotFontAuthority(supabase, {organizationId: origin.organizationId,
        manifest: candidate.content.prepared.fontManifest, signal});
      signal.throwIfAborted(); checkCatalog();
    } catch {signal.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_CURRENT_AUTHORITY_UNAVAILABLE");}
  };
}
