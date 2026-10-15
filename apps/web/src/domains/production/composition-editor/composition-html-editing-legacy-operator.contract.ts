import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { htmlLegacyAdoptionCandidateSchema, HTML_LEGACY_ADOPTION_POLICY } from "./composition-html-editing-legacy-adoption.contract";

const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const HTML_LEGACY_OPERATOR_POLICY = Object.freeze({commandBytes: 16 * 1024, artifactBytes: HTML_LEGACY_ADOPTION_POLICY.candidateBytes + 4096,
  intentBytes: 8192, timeoutMs: 120_000});
export const htmlLegacyOperatorIdentitySchema = z.object({actorId: uuid, organizationId: uuid}).strict();
export const htmlLegacyPreparationSchema = htmlLegacyAdoptionCandidateSchema.omit({approval: true}).extend({preparedBy: uuid}).strict();
export const htmlLegacyPreparationLocatorSchema = htmlLegacyPreparationSchema.omit({encodedPilot: true}).extend({preparationSha256: hash}).strict();
export const htmlLegacyRegistrationIntentSchema = z.object({scope: z.literal("LEGACY_REGISTRATION_INTENT_NOT_APPROVAL_ACK_OR_ADOPTION"),
  locator: htmlLegacyPreparationLocatorSchema, approval: htmlLegacyAdoptionCandidateSchema.shape.approval}).strict();
export const htmlLegacyOperatorCommandSchema = z.discriminatedUnion("action", [
  z.object({action: z.literal("PREPARE"), candidateId: uuid, documentId: uuid, clipId: htmlEditingBindingSchema.shape.clipId,
    templateId: htmlEditingBindingSchema.shape.templateId, templateVersion: htmlEditingBindingSchema.shape.templateVersion,
    expectedDocumentHash: hash}).strict(),
  z.object({action: z.literal("READ_PREPARATION"), candidateId: uuid}).strict(),
  z.object({action: z.literal("STAGE_REVIEWED"), locator: htmlLegacyPreparationLocatorSchema,
    approval: htmlLegacyAdoptionCandidateSchema.shape.approval.omit({reviewerId: true}),
    confirmation: z.literal("REGISTER_REVIEWED_LEGACY_PILOT_WITHOUT_ADOPTING_OR_INSTALLING")}).strict(),
  z.object({action: z.literal("READ_REGISTRATION"), candidateId: uuid}).strict(),
]);
export type HtmlLegacyPreparation = z.infer<typeof htmlLegacyPreparationSchema>;
export type HtmlLegacyPreparationLocator = z.infer<typeof htmlLegacyPreparationLocatorSchema>;
export type HtmlLegacyRegistrationIntent = z.infer<typeof htmlLegacyRegistrationIntentSchema>;
export type HtmlLegacyOperatorIdentity = z.infer<typeof htmlLegacyOperatorIdentitySchema>;
