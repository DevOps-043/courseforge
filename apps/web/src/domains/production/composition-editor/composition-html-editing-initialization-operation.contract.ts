import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { htmlEditingOperationIdentitySchema } from "./html-editing/html-editing-operation.contract";
import { htmlEditingInitializationRequestSchema, htmlEditingInitializationAcknowledgmentSchema } from "./composition-html-editing-initialization-http.contract";

export const HTML_EDITING_INITIALIZATION_OPERATION_POLICY = Object.freeze({ maximumReceiptBytes: 4096 });
export const htmlEditingInitializationOperationReceiptSchema = z.object({
  scope: z.literal("HTML_INITIALIZATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED"),
  owner: z.object({ actorId: z.string().uuid(), organizationId: z.string().uuid(), draftId: z.string().uuid() }).strict(),
  ...htmlEditingOperationIdentitySchema.shape, clipId: htmlEditingBindingSchema.shape.clipId,
  request: htmlEditingInitializationRequestSchema, acknowledgment: htmlEditingInitializationAcknowledgmentSchema,
}).strict().refine(receipt => receipt.acknowledgment.compositionDocumentHash === receipt.request.expectedDocumentHash);
export const htmlEditingInitializationOperationReadSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NOT_FOUND") }).strict(),
  z.object({ status: z.literal("RECORDED"), receipt: htmlEditingInitializationOperationReceiptSchema }).strict(),
]);
export type HtmlEditingInitializationOperationReceipt = z.infer<typeof htmlEditingInitializationOperationReceiptSchema>;
