import { z } from "zod";
import { COMPOSITION_PREVIEW_MAX_GENERATION } from "./composition-preview-comparison";

export const htmlEditingPreviewSessionSchema = z.object({
  version: z.literal(1), nonce: z.string().regex(/^[a-f0-9]{64}$/),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  previewGeneration: z.number().int().min(0).max(COMPOSITION_PREVIEW_MAX_GENERATION),
}).strict();
export type HtmlEditingPreviewSession = z.infer<typeof htmlEditingPreviewSessionSchema>;
export function assertHtmlEditingPreviewParentOrigin(parentOrigin: string): void {
  const origin = new URL(parentOrigin);
  if (origin.origin !== parentOrigin || origin.username || origin.password
    || (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))) {
    throw new Error("HTML_PREVIEW_PARENT_ORIGIN_INVALID");
  }
}
export function sameHtmlEditingPreviewSession(first: HtmlEditingPreviewSession, second: HtmlEditingPreviewSession) {
  return first.version === second.version && first.nonce === second.nonce
    && first.documentHash === second.documentHash && first.previewGeneration === second.previewGeneration;
}
