import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";

export const htmlEditingInitializationRequestSchema = htmlEditingBindingSchema.pick({ templateId: true, templateVersion: true })
  .extend({ expectedDocumentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const htmlEditingInitializationAcknowledgmentSchema = z.object({ status: z.literal("CONFIRMED"), created: z.boolean(), version: z.literal(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), compositionDocumentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type HtmlEditingInitializationRequest = z.infer<typeof htmlEditingInitializationRequestSchema>;
export type HtmlEditingInitializationAcknowledgment = z.infer<typeof htmlEditingInitializationAcknowledgmentSchema>;
export const HTML_EDITING_INITIALIZATION_HTTP_POLICY = Object.freeze({ maximumRequestBytes: 4096, maximumUrlBytes: 2048,
  maximumResponseBytes: 4096,
  timeoutMs: 60_000, bodyTimeoutMs: 15_000, windowSeconds: 60,
  organizationRequestsPerWindow: 10, actorRequestsPerWindow: 3, maximumRateResponseBytes: 1024 });
export const htmlEditingInitializationEnabled = (value: string | undefined): boolean => value === "true";
