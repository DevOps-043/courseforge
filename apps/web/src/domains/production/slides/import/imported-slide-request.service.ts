import { z } from "zod";
import { HTML_SLIDE_IMPORT_LIMITS, htmlSlideImportRequestSchema, importedDesignStructuralValue } from "./imported-slide-design.contract";

type ImportRequest = z.infer<typeof htmlSlideImportRequestSchema>;
type ParsedImportRequest = { success: true; data: ImportRequest } | { success: false; reason: "invalid" | "too_large" };

/** Content-Length no sustituye el recuento del stream real. */
export async function parseImportedSlideRequest(request: Request): Promise<ParsedImportRequest> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > HTML_SLIDE_IMPORT_LIMITS.requestBytes) return { success: false, reason: "too_large" };
  if (!request.body) return { success: false, reason: "invalid" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > HTML_SLIDE_IMPORT_LIMITS.requestBytes) {
        try { await reader.cancel(); } catch { /* El límite se conserva aunque falle la cancelación. */ }
        return { success: false, reason: "too_large" };
      }
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
    const value: unknown = JSON.parse(parts.join(""));
    if (value && typeof value === "object") {
      const input = value as Record<string, unknown>;
      if (input.action === "analyze" && typeof input.html === "string"
        && new TextEncoder().encode(input.html).byteLength > HTML_SLIDE_IMPORT_LIMITS.sourceBytes) return { success: false, reason: "too_large" };
      if (input.action === "save" && input.design && typeof input.design === "object"
        && new TextEncoder().encode(JSON.stringify(importedDesignStructuralValue(input.design))).byteLength > HTML_SLIDE_IMPORT_LIMITS.designBytes) return { success: false, reason: "too_large" };
    }
    const parsed = htmlSlideImportRequestSchema.safeParse(value);
    return parsed.success ? { success: true, data: parsed.data } : { success: false, reason: "invalid" };
  } catch {
    try { await reader.cancel(); } catch { /* El stream puede haberse cerrado antes del error. */ }
    return { success: false, reason: "invalid" };
  } finally { reader.releaseLock(); }
}
