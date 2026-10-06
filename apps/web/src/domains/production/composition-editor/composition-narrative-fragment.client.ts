import { z } from "zod";
import { narrativeFragmentQuerySchema, narrativeFragmentSummarySchema, type NarrativeFragmentQuery,
  type NarrativeFragmentSummary } from "./composition-narrative-fragment-contract";
import { readNarrativeExtractionResponse } from "./composition-narrative-extraction-response";

export type NarrativeFragmentReviewResult = { ok: true; summary: NarrativeFragmentSummary }
  | { ok: false; message: string; retryAfterSeconds?: number };

/** Eligibility only. No command, retry, Storage fetch or write fallback. */
export async function requestNarrativeFragmentReview(params: { draftId: string; request: NarrativeFragmentQuery;
  signal: AbortSignal; fetcher?: typeof fetch }): Promise<NarrativeFragmentReviewResult> {
  const draftId = z.string().uuid().parse(params.draftId);
  const request = narrativeFragmentQuerySchema.parse(params.request);
  params.signal.throwIfAborted();
  const response = await (params.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${draftId}/narrative-fragment/plan`, {
    method: "POST", credentials: "same-origin", cache: "no-store", signal: params.signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
  });
  params.signal.throwIfAborted();
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) {
      const hint = Number(response.headers.get("retry-after"));
      const retryAfterSeconds = Number.isInteger(hint) && hint > 0 && hint <= 60 ? hint : 60;
      return { ok: false, message: `Límite de consultas alcanzado. Espera ${retryAfterSeconds} segundos.`, retryAfterSeconds };
    }
    return { ok: false, message: response.status === 409 ? "La composición cambió. Recarga y selecciona el intervalo nuevamente."
      : response.status === 401 || response.status === 403 ? "No tienes acceso a esta revisión audiovisual."
      : response.status === 422 ? "Las pistas elegidas o sus fuentes no admiten este fragmento. Incluye las dependencias vinculadas; efectos y fuentes no compatibles bloquean la extracción."
      : "No se pudo consultar el fragmento audiovisual. Vuelve a intentar cuando el servicio esté disponible." };
  }
  const parsed = z.object({ success: z.literal(true), data: narrativeFragmentSummarySchema })
    .safeParse(await readNarrativeExtractionResponse(response, params.signal));
  params.signal.throwIfAborted();
  if (!parsed.success || parsed.data.data.documentHash !== request.selection.documentHash
    || parsed.data.data.trackCount !== request.selectedTrackIds.length) {
    return { ok: false, message: "La respuesta no corresponde a una revisión válida del fragmento." };
  }
  return { ok: true, summary: parsed.data.data };
}
