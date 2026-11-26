import { readApiResponse } from "./api-response";
import type { MaterialAssets } from "../../domains/materials/types/materials.types";

export interface SlideGenerationState {
  assets: MaterialAssets;
  status: string;
  job: { id: string; provider_error?: { message?: string; error_message?: string } | null } | null;
}

export async function readSlideGenerationState(params: { componentId: string; jobId?: string; createdAfter?: string; signal?: AbortSignal }) {
  const query = new URLSearchParams({ componentId: params.componentId });
  if (params.jobId) query.set("jobId", params.jobId);
  if (params.createdAfter) query.set("createdAfter", params.createdAfter);
  const response = await fetch(`/api/production/slides/jobs?${query}`, {
    cache: "no-store",
    signal: params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  const payload = await readApiResponse<{ success: boolean; error?: string; data?: SlideGenerationState }>(response);
  if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error || "No se pudo consultar la generación de slides.");
  return payload.data;
}

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForSlideGeneration(params: {
  componentId: string;
  createdAfter?: string;
  jobId?: string;
  maxAttempts?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  const deadline = Date.now() + 5 * 60_000;
  for (let attempt = 0; attempt < (params.maxAttempts ?? 100) && Date.now() < deadline; attempt += 1) {
    params.signal?.throwIfAborted();
    const state = await readSlideGenerationState(params);
    params.onStatus?.(state.status);
    if (state.status === "SUCCEEDED") return state;
    if (state.status === "NOT_FOUND") throw new Error("SLIDES_JOB_NOT_FOUND: No se encontró el trabajo de slides. Actualiza el estado antes de generar otra vez.");
    if (state.status === "FAILED" || state.status === "CANCELLED") {
      const providerError = state.job?.provider_error;
      throw new Error(
        providerError?.message ||
          providerError?.error_message ||
          "La generacion de slides fallo en segundo plano.",
      );
    }
    await delay(params.intervalMs ?? 3_000, params.signal);
  }
  throw new Error("SLIDES_STILL_PENDING: La generación sigue pendiente. Consulta el mismo trabajo; si continúa en cola, reintentar slides conserva el identificador y puede reenviar su despacho.");
}
