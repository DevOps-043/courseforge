import { z } from "zod";
import { HTML_EDITING_LIMITS, htmlEditingBindingSchema } from "./html-editing/html-editing.contract";

export const HTML_TEMPLATE_CHOICES_POLICY = Object.freeze({ maximumTemplates: 32, responseBytes: 16 * 1024,
  timeoutMs: 20_000, maximumUrlBytes: 2048, windowSeconds: 60,
  organizationRequestsPerWindow: 120, actorRequestsPerWindow: 30, maximumRateResponseBytes: 1024 });
export const htmlTemplateChoicesQuerySchema = z.object({ expectedDocumentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const htmlTemplateChoiceSchema = htmlEditingBindingSchema.pick({ templateId: true, templateVersion: true })
  .extend({ fieldCount: z.number().int().min(1).max(HTML_EDITING_LIMITS.elements) }).strict();
export type HtmlTemplateChoice = z.infer<typeof htmlTemplateChoiceSchema>;
export const htmlTemplateChoicesViewSchema = z.object({
  documentId: z.string().uuid(), clipId: htmlEditingBindingSchema.shape.clipId,
  documentHash: htmlTemplateChoicesQuerySchema.shape.expectedDocumentHash,
  templates: z.array(htmlTemplateChoiceSchema).max(HTML_TEMPLATE_CHOICES_POLICY.maximumTemplates)
    .refine(items => new Set(items.map(item => `${item.templateId}:${item.templateVersion}`)).size === items.length),
}).strict();
export type HtmlTemplateChoicesView = z.infer<typeof htmlTemplateChoicesViewSchema>;
