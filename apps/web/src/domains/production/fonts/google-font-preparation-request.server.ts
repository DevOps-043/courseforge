import { z } from "zod";
import type { ParsedJsonRequest } from "../../../lib/server/api-contract";
import { googleFontMaterializationRequestSchema } from "./google-font-bundle.contract";
import { googleFontAdmissionRequestSchema } from "./google-font-admission.contract";
import { GOOGLE_FONT_PREPARATION_POLICY } from "./google-font-preparation-policy";

const requestSchema = z.union([
  z.object({}).strict(),
  googleFontMaterializationRequestSchema.extend({ persist: z.literal(true) }).strict(),
  googleFontAdmissionRequestSchema,
]);

/** The same deadline bounds request ingestion and acquisition/persistence.
 * Do not trust Content-Length or buffer an unlimited request.text(). */
export async function readGoogleFontPreparationRequest(request: Request, signal: AbortSignal):
  Promise<ParsedJsonRequest<z.infer<typeof requestSchema>>> {
  signal.throwIfAborted();
  if (!request.body) return { success: false, reason: "invalid" };
  const reader = request.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null) {
      if (!/^\d+$/.test(declaredLength)) return { success: false, reason: "invalid" };
      if (Number(declaredLength) > GOOGLE_FONT_PREPARATION_POLICY.requestBytes) return { success: false, reason: "too_large" };
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let receivedBytes = 0;
    let body = "";
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > GOOGLE_FONT_PREPARATION_POLICY.requestBytes) return { success: false, reason: "too_large" };
      body += decoder.decode(chunk.value, { stream: true });
    }
    const parsed = requestSchema.safeParse(JSON.parse(body + decoder.decode()));
    return parsed.success ? { success: true, data: parsed.data } : { success: false, reason: "invalid" };
  } catch {
    signal.throwIfAborted();
    return { success: false, reason: "invalid" };
  } finally {
    signal.removeEventListener("abort", cancel);
    // Cancellation may itself stall; it must not extend the operation deadline.
    cancel();
    reader.releaseLock();
  }
}
