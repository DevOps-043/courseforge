import { z } from "zod";

export const HTML_INITIAL_ANCHOR_POLICY = Object.freeze({ timeoutMs: 60_000, bodyTimeoutMs: 5_000,
  maximumRequestBytes: 1024, responseBytes: 2048, maximumUrlBytes: 2048,
  windowSeconds: 60, organizationRequests: 12, actorRequests: 4, maximumRateResponseBytes: 1024 });
export const htmlInitialAnchorRequestSchema = z.object({
  expectedDocumentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const htmlInitialAnchorScopeSchema = z.object({
  organizationId: z.string().uuid(), actorId: z.string().uuid(), documentId: z.string().uuid(),
}).extend(htmlInitialAnchorRequestSchema.shape).strict();
export type HtmlInitialAnchorCommand = z.infer<typeof htmlInitialAnchorScopeSchema>;
/** Availability is a current prerequisite, NOT an operation receipt or proof of
 * template registration, native binding, approval, rendering or visual parity. */
export const htmlInitialAnchorViewSchema = z.object({
  documentId: z.string().uuid(), compositionId: z.string().uuid(),
  documentHash: htmlInitialAnchorRequestSchema.shape.expectedDocumentHash,
  activeRevisionId: z.string().uuid().nullable(),
}).strict();
export type HtmlInitialAnchorView = z.infer<typeof htmlInitialAnchorViewSchema>;
