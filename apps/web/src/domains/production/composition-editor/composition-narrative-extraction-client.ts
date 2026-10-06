import { z } from "zod";
import { narrativeExtractionQuerySchema, narrativeExtractionSummarySchema, type NarrativeExtractionQuery,
  type NarrativeExtractionSummary } from "./composition-narrative-extraction-contract";
import { readNarrativeExtractionResponse } from "./composition-narrative-extraction-response";

export type NarrativeExtractionReviewResult = { ok: true; summary: NarrativeExtractionSummary }
  | { ok: false; message: string; retryAfterSeconds?: number };

/** A review never applies patches or retries automatically. */
export async function requestNarrativeExtractionReview(params: {
  draftId: string; selection: NarrativeExtractionQuery; signal: AbortSignal; fetcher?: typeof fetch;
}): Promise<NarrativeExtractionReviewResult> {
  const draftId = z.string().uuid().parse(params.draftId);
  const selection = narrativeExtractionQuerySchema.parse(params.selection);
  params.signal.throwIfAborted();
  const response = await (params.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${draftId}/narrative-extraction/plan`, {
    method: "POST", credentials: "same-origin", cache: "no-store", signal: params.signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(selection),
  });
  params.signal.throwIfAborted();
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) {
      const rawRetryAfter = Number(response.headers.get("retry-after"));
      const retryAfterSeconds = Number.isInteger(rawRetryAfter) && rawRetryAfter > 0 && rawRetryAfter <= 60 ? rawRetryAfter : 60;
      return { ok: false, message: `Límite de consultas alcanzado. Espera ${retryAfterSeconds} segundos.`, retryAfterSeconds };
    }
    const message = response.status === 409 ? "La composición cambió. Recarga y vuelve a seleccionar el rango."
      : response.status === 401 || response.status === 403 ? "No tienes acceso para consultar esta extracción."
      : response.status === 422 ? "Esta toma o sus dependencias no permiten extraer voz en la versión actual."
      : "No se pudo consultar la extracción. Vuelve a intentar cuando el servicio esté disponible.";
    return { ok: false, message };
  }
  const envelope = z.object({ success: z.literal(true), data: narrativeExtractionSummarySchema }).safeParse(await readNarrativeExtractionResponse(response, params.signal));
  if (!envelope.success || envelope.data.data.documentHash !== selection.documentHash) {
    return { ok: false, message: "La respuesta no corresponde a una revisión válida de esta composición." };
  }
  return { ok: true, summary: envelope.data.data };
}
