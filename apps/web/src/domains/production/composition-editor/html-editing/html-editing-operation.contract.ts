import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing.contract";
import { htmlEditingRevisionLocatorSchema } from "./html-editing-revision.contract";

export const HTML_EDITING_OPERATION_POLICY = Object.freeze({ maximumReceiptBytes: 4096 });
export const htmlEditingMutationAcknowledgmentSchema = z.object({
  scope: z.literal("EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED"), changed: z.boolean(),
  previous: htmlEditingRevisionLocatorSchema, next: htmlEditingRevisionLocatorSchema,
}).strict().superRefine((ack, context) => {
  if (ack.next.version !== ack.previous.version + (ack.changed ? 1 : 0)
    || (ack.changed ? ack.next.sha256 === ack.previous.sha256 : ack.next.sha256 !== ack.previous.sha256)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid editorial acknowledgment" });
  }
});
export const htmlEditingOperationIdentitySchema = z.object({ operationId: z.string().uuid(),
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const htmlEditingOperationReceiptSchema = z.object({
  scope: z.literal("EDITORIAL_OPERATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED"),
  owner: z.object({ actorId: z.string().uuid(), organizationId: z.string().uuid(), draftId: z.string().uuid() }).strict(),
  ...htmlEditingOperationIdentitySchema.shape, clipId: htmlEditingBindingSchema.shape.clipId,
  acknowledgment: htmlEditingMutationAcknowledgmentSchema,
}).strict();
export const htmlEditingOperationReadSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NOT_FOUND") }).strict(),
  z.object({ status: z.literal("RECORDED"), receipt: htmlEditingOperationReceiptSchema }).strict(),
]);
export type HtmlEditingOperationIdentity = z.infer<typeof htmlEditingOperationIdentitySchema>;
export type HtmlEditingOperationReceipt = z.infer<typeof htmlEditingOperationReceiptSchema>;
