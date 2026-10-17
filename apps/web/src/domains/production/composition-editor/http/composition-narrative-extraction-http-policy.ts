import { z } from "zod";
import { narrativeExtractionApplyRequestSchema, NARRATIVE_EXTRACTION_QUERY_MAX_BYTES } from "../composition-narrative-extraction-contract";

/** Configuration only: never infer trust from request Host/X-Forwarded-Host. */
export function resolveNarrativeExtractionTrustedOrigin(configuredUrl: string | null) {
  if (!configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && local))
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export function acceptsNarrativeExtractionOrigin(request: Request, trustedOrigin: string) {
  const fetchSite = request.headers.get("sec-fetch-site");
  return request.headers.get("origin") === trustedOrigin
    && (!fetchSite || fetchSite === "same-origin");
}

/** Stream cap prevents a missing/false Content-Length from allocating an arbitrarily large body. */
export async function parseNarrativeJsonHttpBody<T>(request: Request, signal: AbortSignal, schema: z.ZodType<T>) {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    return { ok: false, reason: "INVALID" } as const;
  }
  if (declared !== null && Number(declared) > NARRATIVE_EXTRACTION_QUERY_MAX_BYTES) return { ok: false, reason: "TOO_LARGE" } as const;
  if (!request.body) return { ok: false, reason: "INVALID" } as const;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let body = "";
  const abortRead = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abortRead, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > NARRATIVE_EXTRACTION_QUERY_MAX_BYTES) return { ok: false, reason: "TOO_LARGE" } as const;
      body += decoder.decode(chunk.value, { stream: true });
    }
    const parsed = schema.safeParse(JSON.parse(body + decoder.decode()));
    return parsed.success ? { ok: true, command: parsed.data } as const : { ok: false, reason: "INVALID" } as const;
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, reason: "INVALID" } as const;
  } finally {
    signal.removeEventListener("abort", abortRead);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function parseNarrativeExtractionHttpBody(request: Request, signal: AbortSignal) {
  return parseNarrativeJsonHttpBody(request, signal, narrativeExtractionApplyRequestSchema);
}

export const narrativeExtractionHttpScopeSchema = z.object({ organizationId: z.string().uuid(), userId: z.string().uuid() }).strict();
