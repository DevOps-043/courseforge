import { z } from "zod";
import { htmlEditingReferenceSchema } from "./html-editing/html-editing-reference.contract";
import { HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";

/** One bounded job, not a browser loop or permission to retry unknown writes. */
export const GENERATED_DECK_INITIALIZATION_POLICY = Object.freeze({
  maximumClips: HTML_EDITING_LIMITS.elements, maximumRegistrationsBytes: 8 * 1024 * 1024,
  maximumReceiptBytes: 128 * 1024, maximumContextBytes: 16 * 1024 * 1024,
  timeoutMs: 60_000,
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const generatedDeckInitializationRequestSchema = z.object({
  operationId: z.string().uuid(), requestSha256: hash, expectedDocumentHash: hash,
}).strict();
export const generatedDeckInitializationOwnerSchema = z.object({
  actorId: z.string().uuid(), organizationId: z.string().uuid(), draftId: z.string().uuid(),
}).strict();
export const generatedDeckInitializationReceiptSchema = z.object({
  scope: z.literal("GENERATED_DECK_INITIALIZATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED"),
  owner: generatedDeckInitializationOwnerSchema,
  operationId: z.string().uuid(), requestSha256: hash, expectedDocumentHash: hash,
  documentHash: hash, documentVersion: z.number().int().positive(),
  items: z.array(htmlEditingReferenceSchema.extend({ created: z.boolean() }).strict())
    .min(1).max(GENERATED_DECK_INITIALIZATION_POLICY.maximumClips)
    .refine(items => new Set(items.map(item => item.clipId)).size === items.length)
    .refine(items => items.every((item, index) => item.revisionVersion === 1
      && (index === 0 || items[index - 1].clipId < item.clipId))),
}).strict().refine(receipt => receipt.expectedDocumentHash !== receipt.documentHash);
export const generatedDeckInitializationReadSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NOT_FOUND") }).strict(),
  z.object({ status: z.literal("RECORDED"), receipt: generatedDeckInitializationReceiptSchema }).strict(),
]);
export type GeneratedDeckInitializationRequest = z.infer<typeof generatedDeckInitializationRequestSchema>;
export type GeneratedDeckInitializationOwner = z.infer<typeof generatedDeckInitializationOwnerSchema>;
export type GeneratedDeckInitializationReceipt = z.infer<typeof generatedDeckInitializationReceiptSchema>;

/** Shared ASCII preimage; browser uses WebCrypto, server uses node:crypto. */
export function generatedDeckInitializationRequestPreimage(expectedDocumentHash: string): string {
  hash.parse(expectedDocumentHash);
  return JSON.stringify({ format: "courseforge-generated-deck-initialization-v1", expectedDocumentHash });
}
