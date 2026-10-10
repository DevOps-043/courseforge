import { createHash } from "node:crypto";
import { z } from "zod";
import { withAuthorizedHtmlSnapshotArchive } from "./composition-html-editing-snapshot-inspection-read.server";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document.service";
import { prepareInitialHtmlEditingRevision } from "./html-editing/html-editing-bootstrap.server";
import type { HtmlEditingTemplateCatalog } from "./html-editing/html-editing-template-catalog.server";
import { bindHtmlEditingRevisionToComposition } from "./composition-html-editing-document.server";
import { HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";
import { assertCompositionHtmlEditingDeckStyleSource, prepareCompositionHtmlEditingDeckStyles } from "./composition-html-editing-deck-styles.server";
import { assertCompositionHtmlEditingIdsUnique, assertCompositionHtmlEditingResourcesLocal,
  compileCompositionHtmlEditingFragments } from "./composition-html-editing-compilation.server";
import { assertHtmlReconstructionNativeResources, type HtmlReconstructionNativeResources } from "./composition-html-editing-reconstruction-native-resources.server";
import { htmlReconstructionOriginSchema as originSchema, htmlReconstructionTargetSchema as targetSchema,
  HTML_RECONSTRUCTION_REQUIRED_REVIEWS } from "./composition-html-editing-reconstruction.contract";
import { assertHtmlReconstructionResourceSelection } from "./composition-html-editing-reconstruction-resource-references.server";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export type HtmlHistoricalReconstructionOrigin = z.infer<typeof originSchema>;
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Authorized provenance without current compilation of historical HTML. This
 * deliberately works for structurally recognized old bundles whose source the
 * current compiler rejects. It never exports source/grants to HTTP, executes old
 * code, approves a new source, or creates/updates a composition. */
export async function readHtmlHistoricalReconstructionOrigin(input: Parameters<typeof withAuthorizedHtmlSnapshotArchive>[0]) {
  return withAuthorizedHtmlSnapshotArchive(input, async ({identity, inspected}) => {
    if (inspected.diagnostic.status !== "LEGACY_V1_REQUIRES_REVIEW"
      && inspected.diagnostic.status !== "PROFILE_MISMATCH_REQUIRES_REVIEW") throw new Error();
    return originSchema.parse({scope: "AUTHORIZED_RECONSTRUCTION_ORIGIN_NOT_EXECUTION_OR_APPROVAL",
      organizationId: identity.organizationId, compositionId: identity.compositionId, draftId: identity.draftId,
      revisionId: identity.revisionId, documentId: identity.documentId, documentHash: identity.documentHash,
      projectHash: identity.projectHash, bundleSha256: identity.bundlePin.sha256});
  });
}

/** Private new-content preparation. The host supplies an independently authored
 * native base and an installed new template; no archive HTML is copied/repaired.
 * Scope separation is necessary but NOT proof the target is absent in DB. Atomic
 * create-only persistence must enforce that and reauthorize origin/catalog/grants.
 * Review is of this new candidate, not approval reused from the historical ZIP. */
export function prepareHtmlHistoricalReconstruction(input: {
  origin: HtmlHistoricalReconstructionOrigin;
  target: z.infer<typeof targetSchema>;
  document: unknown;
  expectedDocumentHash: string;
  catalog: HtmlEditingTemplateCatalog;
  grantedAssetIds: readonly string[];
  imageSources: ReadonlyMap<string, string>;
  nativeResources?: HtmlReconstructionNativeResources;
}) {
  try {
    const origin = originSchema.parse(input.origin), target = targetSchema.parse(input.target);
    if (target.compositionId === origin.compositionId || target.documentId === origin.documentId
      || target.documentId === origin.draftId || target.revisionId === origin.revisionId) throw new Error();
    const document = compositionEditorDocumentSchema.parse(input.document), baseHash = hashCompositionDocument(document);
    if (baseHash !== hash.parse(input.expectedDocumentHash) || document.htmlEditing?.items.length) throw new Error();
    if (target.resourceSelection) assertHtmlReconstructionResourceSelection(document, target.resourceSelection);
    // Every HTML clip needs its own installed declaration; native clips require
    // exact independently acquired media/font identities, not a bypass flag.
    const nativeResources = assertHtmlReconstructionNativeResources(document, input.nativeResources ?? {assets: [], fontManifest: []});
    const deckClips = document.clips.filter(clip => clip.source.type === "DECK_SLIDE");
    const slides = new Map(target.slides.map(slide => [slide.clipId, slide]));
    if (slides.size !== target.slides.length || deckClips.length !== slides.size) throw new Error();
    assertCompositionHtmlEditingDeckStyleSource(document);
    const initialRevisions = deckClips.map(clip => {
      const slide = slides.get(clip.id);
      if (!slide || clip.kind !== "DECK_SLIDE" || clip.source.type !== "DECK_SLIDE") throw new Error();
      const sourceHtml = clip.source.html;
      if (Buffer.byteLength(sourceHtml, "utf8") > HTML_EDITING_LIMITS.sourceBytes) throw new Error();
      const sourceSha256 = digest(sourceHtml);
      const encodedTrustedTemplate = input.catalog.resolve({organizationId: origin.organizationId,
        templateId: slide.templateId, templateVersion: slide.templateVersion, sourceSha256});
      const initial = prepareInitialHtmlEditingRevision({authoritativeAnchor: {organizationId: origin.organizationId,
        documentId: target.documentId, revisionId: target.revisionId, documentSha256: baseHash, clipId: clip.id},
        encodedTrustedTemplate, sourceHtml, grantedAssetIds: input.grantedAssetIds, imageSources: input.imageSources});
      return {clipId: clip.id, revision: initial.revision, revisionSha256: initial.sha256, sourceSha256,
        usedAssetIds: [...initial.compiled.usedAssetIds]};
    });
    let candidate = {document, documentHash: baseHash};
    for (const initial of initialRevisions) {
      candidate = bindHtmlEditingRevisionToComposition({document: candidate.document, revision: initial.revision,
        revisionSha256: initial.revisionSha256, authoritativeBinding: initial.revision.manifest.binding,
        grantedAssetIds: input.grantedAssetIds, imageSources: input.imageSources});
    }
    // Recheck the complete pointer set under the final native hash. Individually
    // valid templates can still collide once their fragments share one DOM.
    const context = {
      organizationId: origin.organizationId, documentId: target.documentId, documentHash: candidate.documentHash,
      revisions: initialRevisions.map(initial => ({encodedRevision: JSON.stringify(initial.revision),
        authoritativeBinding: initial.revision.manifest.binding, grantedAssetIds: input.grantedAssetIds,
        imageSources: input.imageSources})),
    };
    const fragments = compileCompositionHtmlEditingFragments({...candidate, context, assetUrls: input.imageSources});
    const deckCss = prepareCompositionHtmlEditingDeckStyles({...candidate, context, assetUrls: input.imageSources});
    const clipsHtml = deckClips.map(clip => fragments.get(clip.id)!).join("\n");
    assertCompositionHtmlEditingIdsUnique(clipsHtml);
    assertCompositionHtmlEditingResourcesLocal({clipsHtml, deckCss, assetUrls: input.imageSources});
    return {scope: "PREPARED_NEW_CONTENT_NOT_HISTORICAL_REPUBLICATION_OR_APPROVAL" as const,
      origin, target, document: candidate.document, documentHash: candidate.documentHash,
      initialRevisions, nativeResources,
      usedAssetIds: [...new Set([...initialRevisions.flatMap(initial => initial.usedAssetIds),
        ...nativeResources.assets.map(asset => asset.productionAssetId)])].sort(),
      requiredReviews: HTML_RECONSTRUCTION_REQUIRED_REVIEWS};
  } catch {throw new Error("HTML_HISTORICAL_RECONSTRUCTION_UNAVAILABLE");}
}
