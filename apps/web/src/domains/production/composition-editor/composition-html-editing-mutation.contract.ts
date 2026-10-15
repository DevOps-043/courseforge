import { z } from "zod";
import { HTML_EDITING_LIMITS, htmlEditingCommandSchema } from "./html-editing/html-editing.contract";
import { htmlEditingRevisionLocatorSchema } from "./html-editing/html-editing-revision.contract";
export { htmlEditingRevisionLocatorSchema } from "./html-editing/html-editing-revision.contract";
export { htmlEditingMutationAcknowledgmentSchema } from "./html-editing/html-editing-operation.contract";

const common = { expected: htmlEditingRevisionLocatorSchema, expectedCompositionDocumentHash: z.string().regex(/^[a-f0-9]{64}$/) };
export const htmlEditingMutationRequestSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("COMMAND"), overrides: htmlEditingCommandSchema.shape.overrides }).strict(),
  z.object({ ...common, action: z.literal("RESTORE"), restore: htmlEditingRevisionLocatorSchema }).strict(),
]);
export const HTML_EDITING_MUTATION_HTTP_POLICY = Object.freeze({ maximumRequestBytes: HTML_EDITING_LIMITS.commandBytes,
  maximumUrlBytes: 2048, timeoutMs: 60_000, bodyTimeoutMs: 15_000, windowSeconds: 60,
  organizationRequestsPerWindow: 30, actorRequestsPerWindow: 12, maximumRateResponseBytes: 1024 });
export const htmlEditingMutationEnabled = (value: string | undefined): boolean => value === "true";
export type HtmlEditingMutationRequest = z.infer<typeof htmlEditingMutationRequestSchema>;
export type HtmlEditingMutationInput = HtmlEditingMutationRequest & { actorId: string; organizationId: string; documentId: string; clipId: string };
