import { isDeepStrictEqual } from "node:util";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document.service";
import { bindHtmlEditingRevisionToComposition } from "./composition-html-editing-document.server";
import { prepareInitialHtmlEditingRevision, htmlEditingTrustedTemplateSchema } from "./html-editing/html-editing-bootstrap.server";
import type { HtmlEditingTemplateCatalog } from "./html-editing/html-editing-template-catalog.server";
import { verifyLegacyHtmlEditingPilotPackage } from "./html-editing/html-editing-legacy-pilot-verification.server";
import { decodeHtmlEditingBoundedJson } from "./html-editing/html-editing-validation";
import { HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";

export class HtmlEditingLegacyAdoptionError extends Error {
  constructor(readonly code: "BASE_CONFLICT" | "CLIP_UNAVAILABLE" | "ALREADY_EDITABLE" | "CANDIDATE_UNAVAILABLE") {
    super(`HTML_EDITING_LEGACY_ADOPTION_${code}`); this.name = "HtmlEditingLegacyAdoptionError";
  }
}

/** Host-only preparation, NOT commit/approval. Source is read from the authorized
 * native base, never taken from the submitted pilot. Operator catalogue is an
 * independent installation requirement. Persistence must CAS the original base,
 * append the proposed native + initial HTML + receipt in ONE transaction. */
export function prepareHtmlEditingLegacyAdoption(params: {
  document: CompositionEditorDocument; expectedDocumentHash: string;
  anchor: { organizationId: string; documentId: string; revisionId: string; clipId: string };
  templateId: string; templateVersion: number; encodedPilot: string; expectedProvenanceSha256: string;
  catalog: HtmlEditingTemplateCatalog; grantedAssetIds: readonly string[]; imageSources: ReadonlyMap<string, string>;
}) {
  const current = compositionEditorDocumentSchema.parse(params.document);
  if (hashCompositionDocument(current) !== params.expectedDocumentHash) throw new HtmlEditingLegacyAdoptionError("BASE_CONFLICT");
  const clip = current.clips.find(candidate => candidate.id === params.anchor.clipId);
  if (!clip || clip.kind !== "DECK_SLIDE" || clip.source.type !== "DECK_SLIDE") throw new HtmlEditingLegacyAdoptionError("CLIP_UNAVAILABLE");
  if (current.htmlEditing?.items.some(reference => reference.clipId === clip.id)) throw new HtmlEditingLegacyAdoptionError("ALREADY_EDITABLE");
  const authoritativeAnchor = { ...params.anchor, documentSha256: params.expectedDocumentHash };
  const pilot = verifyLegacyHtmlEditingPilotPackage({ encodedPilot: params.encodedPilot, expectedProvenanceSha256: params.expectedProvenanceSha256,
    authoritativeInputs: { sourceHtml: clip.source.html, templateId: params.templateId, templateVersion: params.templateVersion,
      authoritativeAnchor, grantedAssetIds: params.grantedAssetIds, imageSources: params.imageSources } });
  const encodedTrustedTemplate = params.catalog.resolve({ organizationId: params.anchor.organizationId,
    templateId: params.templateId, templateVersion: params.templateVersion, sourceSha256: pilot.candidate.sha256 });
  const installed = htmlEditingTrustedTemplateSchema.parse(decodeHtmlEditingBoundedJson(encodedTrustedTemplate, HTML_EDITING_LIMITS.manifestBytes));
  if (!isDeepStrictEqual(installed, pilot.candidate.template)) throw new HtmlEditingLegacyAdoptionError("CANDIDATE_UNAVAILABLE");
  const initial = prepareInitialHtmlEditingRevision({ authoritativeAnchor, encodedTrustedTemplate,
    sourceHtml: pilot.candidate.sourceHtml, grantedAssetIds: params.grantedAssetIds, imageSources: params.imageSources });
  const candidateDocument = compositionEditorDocumentSchema.parse({ ...current,
    clips: current.clips.map(item => item.id === clip.id ? { ...item, source: { ...clip.source, html: pilot.candidate.sourceHtml } } : item) });
  const proposed = bindHtmlEditingRevisionToComposition({ document: candidateDocument,
    revision: initial.revision, revisionSha256: initial.sha256, authoritativeBinding: initial.revision.manifest.binding,
    grantedAssetIds: params.grantedAssetIds, imageSources: params.imageSources });
  return { scope: "PREPARED_LEGACY_ADOPTION_NOT_COMMITTED" as const,
    expectedDocumentHash: params.expectedDocumentHash, originalSourceSha256: pilot.original.sha256, originalSource: clip.source.html,
    provenanceSha256: pilot.provenanceSha256, document: proposed.document, documentHash: proposed.documentHash,
    initialRevision: initial.revision, initialRevisionSha256: initial.sha256, usedAssetIds: initial.compiled.usedAssetIds,
    requiredReviews: pilot.requiredReviews };
}
