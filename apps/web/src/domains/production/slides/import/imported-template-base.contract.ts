import { z } from "zod";

export const importedTemplateBaseSchema = z.object({
  runId: z.string().uuid(), specId: z.string().uuid(),
  outputHash: z.string().regex(/^[a-f0-9]{64}$/), title: z.string().min(1).max(120),
}).strict();
export type ImportedTemplateBase = z.infer<typeof importedTemplateBaseSchema>;
export const importedTemplateStudioOptionsSchema = z.object({
  baseRunId: z.string().uuid().optional(), reviseWithAi: z.boolean().optional(),
  layoutIds: z.array(z.string().regex(/^design-[0-9]+$/)).min(1).max(24).optional(),
}).strict();
export type ImportedTemplateStudioOptions = z.infer<typeof importedTemplateStudioOptionsSchema>;
export const IMPORTED_TEMPLATE_EDIT_LIMITS = Object.freeze({ contextBytes: 384_000, responseBytes: 128_000, cssCharacters: 20_000,
  fieldEdits: 1440, timeoutMs: 45_000, outputTokens: 16_384 });
export const importedTemplateEditSchema = z.object({
  summary: z.string().min(1).max(1000),
  cssAppend: z.string().max(IMPORTED_TEMPLATE_EDIT_LIMITS.cssCharacters).optional(),
  fields: z.array(z.object({ layoutId: z.string().regex(/^design-[0-9]+$/), fieldId: z.string().regex(/^field-[0-9]+$/),
    text: z.string().max(900).optional(), role: z.enum(["title", "subtitle", "body", "decoration"]).optional(),
    clear: z.boolean().optional(),
  }).strict()).max(IMPORTED_TEMPLATE_EDIT_LIMITS.fieldEdits).default([]),
  layouts: z.array(z.object({ id: z.string().regex(/^design-[0-9]+$/), label: z.string().min(1).max(120).optional(),
    purpose: z.enum(["cover", "content", "summary", "any"]).optional(),
  }).strict()).max(24).default([]),
}).strict();
