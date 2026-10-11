import { z } from "zod";
import { googleFontBundleReceiptSchema, googleFontPreparationDtoSchema, googleFontMaterializationRequestSchema } from "./google-font-bundle.contract";
import { GOOGLE_FONT_PREPARATION_POLICY } from "./google-font-preparation-policy";
import { googleFontAdmissionRequestSchema, googleFontAdmissionReceiptSchema } from "./google-font-admission.contract";

const RESPONSE_LIMIT_BYTES = GOOGLE_FONT_PREPARATION_POLICY.manifestBytes;
export class GoogleFontPreparationClientError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "GoogleFontPreparationClientError"; }
}

export async function requestGoogleFontPreparation(fontId: string, signal: AbortSignal, expectedCandidateSha256?: string, action: "persist" | "admit" = "persist") {
  z.string().uuid().parse(fontId);
  const persist = expectedCandidateSha256 !== undefined;
  if (persist) googleFontMaterializationRequestSchema.parse({ expectedCandidateSha256 });
  const admission = action === "admit";
  if (admission) googleFontAdmissionRequestSchema.parse({ admit: true, expectedCandidateSha256 });
  const response = await fetch(`/api/admin/fonts/${fontId}/google-preparation`, { method: "POST", signal,
    credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(admission ? { admit: true, expectedCandidateSha256 } : persist ? { persist: true, expectedCandidateSha256 } : {}),
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel().catch(() => undefined); };
  try {
    signal.throwIfAborted();
    if (!response.body || response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new GoogleFontPreparationClientError(response.status, "Respuesta de preparación no válida.");
    reader = response.body.getReader(); signal.addEventListener("abort", cancel, { once: true });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      signal.throwIfAborted(); const chunk = await reader.read(); signal.throwIfAborted(); if (chunk.done) break;
      size += chunk.value.byteLength; if (size > RESPONSE_LIMIT_BYTES) throw new GoogleFontPreparationClientError(response.status, "La respuesta de fuentes excede el límite.");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!response.ok) {
      const error = z.object({ message: z.string().min(1).max(512) }).safeParse(payload);
      throw new GoogleFontPreparationClientError(response.status, error.success ? error.data.message : "No se pudo completar la preparación de fuentes.");
    }
    if (admission) {
      const result = z.object({ success: z.literal(true), admission: googleFontAdmissionReceiptSchema }).parse(payload);
      if (result.admission.fontId !== fontId || result.admission.candidateSha256 !== expectedCandidateSha256)
        throw new GoogleFontPreparationClientError(503, "No se pudo confirmar la identidad de las variantes validadas.");
      return { kind: "ADMISSION" as const, admission: result.admission };
    }
    if (persist) {
      const result = z.object({ success: z.literal(true), bundle: googleFontBundleReceiptSchema }).parse(payload);
      if (result.bundle.candidateSha256 !== expectedCandidateSha256) throw new GoogleFontPreparationClientError(503, "No se pudo confirmar la identidad del guardado.");
      return { kind: "BUNDLE" as const, bundle: result.bundle };
    }
    const result = z.object({ success: z.literal(true), preparation: googleFontPreparationDtoSchema }).parse(payload);
    if (result.preparation.fontId !== fontId) throw new GoogleFontPreparationClientError(503, "La respuesta no corresponde a la fuente seleccionada.");
    return { kind: "PREPARATION" as const, preparation: result.preparation };
  } finally {
    signal.removeEventListener("abort", cancel);
    if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    else await response.body?.cancel().catch(() => undefined);
  }
}
