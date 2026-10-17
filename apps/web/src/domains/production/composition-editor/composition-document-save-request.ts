import { COMPOSITION_PREVIEW_SAVE_QUEUE_CONFIG } from "./composition-preview-sync.config";

/** Limita también la lectura del cuerpo; cancelar no implica que el servidor haya revertido el guardado. */
export async function requestCompositionDocumentSave(
  url: string,
  options: RequestInit,
  timeoutMs: number = COMPOSITION_PREVIEW_SAVE_QUEUE_CONFIG.requestTimeoutMs,
): Promise<{ response: Response; body: unknown }> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal });
    const body: unknown = await response.json();
    return { response, body };
  } catch (error) {
    if (signal.aborted) {
      throw new Error("El guardado excedió el tiempo de espera. El servidor podría haberlo completado; recarga el documento desde el editor antes de reintentar.");
    }
    throw error;
  }
}
