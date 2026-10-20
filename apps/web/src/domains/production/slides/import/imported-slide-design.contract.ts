import { z } from "zod";

export const HTML_SLIDE_IMPORT_LIMITS = Object.freeze({
  sourceBytes: 2_000_000, designBytes: 2_000_000, requestBytes: 5_000_000, responseBytes: 5_000_000,
  responseEnvelopeBytes: 1024,
  cssCharacters: 120_000, fragmentCharacters: 100_000,
  slides: 12, fields: 60, textCharacters: 900,
  sourceElements: 1500, sourceDepth: 40, cssNodes: 4096, cssDepth: 16,
});
export function formatHtmlSlideImportBytes(bytes: number): string {
  return bytes >= 1_000_000 ? `${bytes / 1_000_000} MB` : `${bytes / 1000} KB`;
}
export const HTML_SLIDE_SOURCE_SIZE_LABEL = formatHtmlSlideImportBytes(HTML_SLIDE_IMPORT_LIMITS.sourceBytes);
export const importedSlideFieldSchema = z.object({
  id: z.string().regex(/^field-[0-9]+$/),
  role: z.enum(["title", "subtitle", "body", "decoration"]),
  sample: z.string().max(2000),
  maxCharacters: z.number().int().min(1).max(HTML_SLIDE_IMPORT_LIMITS.textCharacters),
}).strict();
export const importedSlideLayoutSchema = z.object({
  id: z.string().regex(/^design-[0-9]+$/),
  label: z.string().min(1).max(120),
  purpose: z.enum(["cover", "content", "summary", "any"]),
  html: z.string().min(1).max(HTML_SLIDE_IMPORT_LIMITS.fragmentCharacters),
  fields: z.array(importedSlideFieldSchema).min(1).max(HTML_SLIDE_IMPORT_LIMITS.fields),
}).strict();
export const importedSlideDesignSchema = z.object({
  format: z.literal("courseforge-imported-slide-design-v1"),
  css: z.string().max(HTML_SLIDE_IMPORT_LIMITS.cssCharacters),
  layouts: z.array(importedSlideLayoutSchema).min(1).max(HTML_SLIDE_IMPORT_LIMITS.slides),
}).strict();
export type ImportedSlideDesign = z.infer<typeof importedSlideDesignSchema>;
export type ImportedSlideLayout = z.infer<typeof importedSlideLayoutSchema>;
export type ImportedSlideField = z.infer<typeof importedSlideFieldSchema>;

export class HtmlSlideImportError extends Error {
  constructor(message: string) { super(message); this.name = "HtmlSlideImportError"; }
}

export const htmlSlideImportRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("load"), conversationId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("analyze"), html: z.string().min(1).max(HTML_SLIDE_IMPORT_LIMITS.sourceBytes) }).strict(),
  z.object({ action: z.literal("save"), title: z.string().trim().min(1).max(120),
    design: importedSlideDesignSchema, reviewed: z.literal(true) }).strict(),
]);

export const IMPORT_PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'";
