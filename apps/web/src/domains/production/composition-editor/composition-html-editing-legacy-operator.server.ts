import { isDeepStrictEqual } from "node:util";
import type { createHtmlLegacyOperatorHandoff } from "./composition-html-editing-legacy-operator-handoff.server";
import { legacyPreparationLocator } from "./composition-html-editing-legacy-operator-handoff.server";
import { readAuthorizedHtmlLegacyBootstrapContext } from "./composition-html-editing-legacy-context.server";
import { htmlLegacyAdoptionCandidateSchema, type HtmlLegacyAdoptionCandidate } from "./composition-html-editing-legacy-adoption.contract";
import { prepareLegacyHtmlEditingPilot } from "./html-editing/html-editing-legacy-instrumentation.server";
import { verifyLegacyHtmlEditingPilotPackage } from "./html-editing/html-editing-legacy-pilot-verification.server";
import { prepareHtmlEditingLegacyAdoption } from "./composition-html-editing-legacy-adoption.server";
import type { HtmlEditingTemplateCatalog } from "./html-editing/html-editing-template-catalog.server";
import type { SupabaseHtmlLegacyAdoptionRepository } from "./composition-html-editing-legacy-adoption-repository.server";
import { HTML_LEGACY_OPERATOR_POLICY as policy, htmlLegacyOperatorCommandSchema, htmlLegacyOperatorIdentitySchema,
  htmlLegacyPreparationSchema, htmlLegacyPreparationLocatorSchema, htmlLegacyRegistrationIntentSchema, type HtmlLegacyPreparation,
  type HtmlLegacyOperatorIdentity } from "./composition-html-editing-legacy-operator.contract";

type ContextRead = ReturnType<typeof readAuthorizedHtmlLegacyBootstrapContext>;
type ContextRequest = Parameters<typeof readAuthorizedHtmlLegacyBootstrapContext>[0]["request"];
type Repository = Pick<SupabaseHtmlLegacyAdoptionRepository, "stageReviewedCandidate" | "readCandidateRegistration">;
// Projection of an already strictly decoded preparation, not request sanitization.
const candidateMetadataSchema = htmlLegacyPreparationSchema.omit({preparedBy: true}).strip();
/** Product orchestration, private operator only. Preparation is not approval;
 * installed catalogue is independent input; staging never installs/adopts HTML.
 * Lost staging ACK is reconciled from immutable intent by READ_REGISTRATION. */
export function createHtmlLegacyOperatorWorkflow(ports: {handoff: ReturnType<typeof createHtmlLegacyOperatorHandoff>;
  readContext: (request: ContextRequest, signal: AbortSignal) => ContextRead;
  readCatalog: () => HtmlEditingTemplateCatalog; repository: (catalog?: HtmlEditingTemplateCatalog) => Repository}) {
  const checkOwner = (preparation: HtmlLegacyPreparation, identity: HtmlLegacyOperatorIdentity) => {
    if (preparation.organizationId !== identity.organizationId) throw new Error("HTML_LEGACY_OPERATOR_FORBIDDEN");
  };
  const inputs = (preparation: HtmlLegacyPreparation, context: Awaited<ContextRead>) => {
    const clip = context.document.clips.find(item => item.id === preparation.clipId);
    if (!clip || clip.kind !== "DECK_SLIDE" || clip.source.type !== "DECK_SLIDE"
      || context.document.htmlEditing?.items.some(item => item.clipId === clip.id)
      || context.revisionId !== preparation.revisionId) throw new Error("HTML_LEGACY_OPERATOR_BASE_CHANGED");
    return {sourceHtml: clip.source.html, templateId: preparation.templateId, templateVersion: preparation.templateVersion,
      authoritativeAnchor: {organizationId: preparation.organizationId, documentId: preparation.documentId, clipId: preparation.clipId,
        revisionId: context.revisionId, documentSha256: context.documentHash}, grantedAssetIds: context.grantedAssetIds,
      imageSources: new Map(context.grantedAssetIds.map(id => [id, `conformance-media/${id}`]))};
  };
  async function verifyPreparation(preparation: HtmlLegacyPreparation, identity: HtmlLegacyOperatorIdentity, signal: AbortSignal) {
    checkOwner(preparation, identity);
    const context = await ports.readContext({organizationId: identity.organizationId, actorId: identity.actorId,
      documentId: preparation.documentId, clipId: preparation.clipId, expectedDocumentHash: preparation.expectedDocumentHash}, signal);
    signal.throwIfAborted();
    const pilot = verifyLegacyHtmlEditingPilotPackage({encodedPilot: preparation.encodedPilot, expectedProvenanceSha256: preparation.provenanceSha256,
      authoritativeInputs: inputs(preparation, context)});
    if (pilot.original.sha256 !== preparation.originalSourceSha256 || pilot.candidate.sha256 !== preparation.candidateSourceSha256)
      throw new Error("HTML_LEGACY_OPERATOR_PREPARATION_MISMATCH");
    return {context, pilot};
  }
  return {
    async execute(input: unknown, authenticated: HtmlLegacyOperatorIdentity, signal: AbortSignal) {
      signal.throwIfAborted();
      if (Buffer.byteLength(JSON.stringify(input) ?? "") > policy.commandBytes) throw new Error("HTML_LEGACY_OPERATOR_REQUEST_TOO_LARGE");
      const command = htmlLegacyOperatorCommandSchema.parse(input), identity = htmlLegacyOperatorIdentitySchema.parse(authenticated);
      switch (command.action) {
        case "PREPARE": {
          const request = {organizationId: identity.organizationId, actorId: identity.actorId, documentId: command.documentId,
            clipId: command.clipId, expectedDocumentHash: command.expectedDocumentHash};
          const context = await ports.readContext(request, signal); signal.throwIfAborted();
          const clip = context.document.clips.find(item => item.id === command.clipId);
          if (!clip || clip.source.type !== "DECK_SLIDE" || clip.kind !== "DECK_SLIDE"
            || context.document.htmlEditing?.items.some(item => item.clipId === clip.id)) throw new Error("HTML_LEGACY_OPERATOR_BASE_CHANGED");
          const pilot = prepareLegacyHtmlEditingPilot({sourceHtml: clip.source.html, templateId: command.templateId, templateVersion: command.templateVersion,
            authoritativeAnchor: {organizationId: identity.organizationId, documentId: command.documentId, clipId: command.clipId,
              revisionId: context.revisionId, documentSha256: context.documentHash}, grantedAssetIds: context.grantedAssetIds,
            imageSources: new Map(context.grantedAssetIds.map(id => [id, `conformance-media/${id}`]))});
          const current = await ports.readContext(request, signal); signal.throwIfAborted();
          if (!isDeepStrictEqual(current, context)) throw new Error("HTML_LEGACY_OPERATOR_BASE_CHANGED");
          const preparation = htmlLegacyPreparationSchema.parse({candidateId: command.candidateId, preparedBy: identity.actorId,
            organizationId: identity.organizationId, documentId: command.documentId, clipId: command.clipId, revisionId: context.revisionId,
            expectedDocumentHash: context.documentHash, templateId: command.templateId, templateVersion: command.templateVersion,
            originalSourceSha256: pilot.original.sha256, candidateSourceSha256: pilot.candidate.sha256, provenanceSha256: pilot.provenanceSha256,
            encodedPilot: JSON.stringify(pilot)});
          return {status: "PREPARED_LEGACY_PILOT_REQUIRES_REVIEW" as const, locator: await ports.handoff.save(preparation, signal),
            compilationProfile: pilot.provenance.compilationProfile, requiredReviews: pilot.requiredReviews};
        }
        case "READ_PREPARATION": {
          const preparation = await ports.handoff.readCandidate(command.candidateId, signal);
          const {pilot} = await verifyPreparation(preparation, identity, signal);
          return {status: "PREPARED_LEGACY_PILOT_REQUIRES_REVIEW" as const, locator: legacyPreparationLocator(preparation),
            compilationProfile: pilot.provenance.compilationProfile, requiredReviews: pilot.requiredReviews};
        }
        case "STAGE_REVIEWED": {
          const locator = htmlLegacyPreparationLocatorSchema.parse(command.locator);
          if (locator.organizationId !== identity.organizationId) throw new Error("HTML_LEGACY_OPERATOR_FORBIDDEN");
          const preparation = await ports.handoff.read(locator, signal), {context} = await verifyPreparation(preparation, identity, signal);
          const approval = {...command.approval, reviewerId: identity.actorId};
          const metadata = candidateMetadataSchema.parse(preparation);
          const candidate = htmlLegacyAdoptionCandidateSchema.parse({...metadata, approval}), catalog = ports.readCatalog();
          // Preflight the installed catalogue before preserving a registration
          // intent. The repository independently repeats authority at dispatch.
          prepareHtmlEditingLegacyAdoption({document: context.document, expectedDocumentHash: context.documentHash,
            anchor: {organizationId: candidate.organizationId, documentId: candidate.documentId, clipId: candidate.clipId, revisionId: candidate.revisionId},
            templateId: candidate.templateId, templateVersion: candidate.templateVersion, encodedPilot: candidate.encodedPilot,
            expectedProvenanceSha256: candidate.provenanceSha256, catalog, grantedAssetIds: context.grantedAssetIds,
            imageSources: new Map(context.grantedAssetIds.map(id => [id, `conformance-media/${id}`]))});
          const intent = htmlLegacyRegistrationIntentSchema.parse({scope: "LEGACY_REGISTRATION_INTENT_NOT_APPROVAL_ACK_OR_ADOPTION", locator, approval});
          const preserved = await ports.handoff.preserveRegistration(intent, signal); signal.throwIfAborted();
          if (!isDeepStrictEqual(intent, preserved)) throw new Error("HTML_LEGACY_REGISTRATION_INTENT_UNCONFIRMED");
          return {status: "LEGACY_CANDIDATE_REGISTERED_NOT_ADOPTED" as const,
            result: await ports.repository(catalog).stageReviewedCandidate(candidate, signal)};
        }
        case "READ_REGISTRATION": {
          const intent = await ports.handoff.readRegistrationIntent(command.candidateId, signal);
          if (intent.locator.organizationId !== identity.organizationId || intent.approval.reviewerId !== identity.actorId)
            throw new Error("HTML_LEGACY_OPERATOR_FORBIDDEN");
          const preparation = await ports.handoff.read(intent.locator, signal);
          const metadata = candidateMetadataSchema.parse(preparation);
          const candidate: HtmlLegacyAdoptionCandidate = htmlLegacyAdoptionCandidateSchema.parse({...metadata, approval: intent.approval});
          const result = await ports.repository().readCandidateRegistration(candidate, identity.actorId, signal);
          return {...result, trackingPreserved: true, currentGrant: false};
        }
      }
    },
  };
}
