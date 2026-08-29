import { readApiResponse } from "./api-response";

export async function waitForSlideGeneration(params: {
  componentId: string;
  createdAfter?: string;
  jobId?: string;
  maxAttempts?: number;
  onStatus?: (status: string) => void;
}) {
  const maxAttempts = params.maxAttempts ?? 100;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const query = new URLSearchParams({ componentId: params.componentId });
    if (params.jobId) query.set("jobId", params.jobId);
    if (params.createdAfter) query.set("createdAfter", params.createdAfter);
    const response = await fetch(`/api/production/slides/jobs?${query}`, {
      cache: "no-store",
    });
    const payload = await readApiResponse(response);
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "No se pudo consultar la generacion de slides.");
    }
    params.onStatus?.(payload.data?.status || "QUEUED");
    if (payload.data?.status === "SUCCEEDED") return payload.data;
    if (payload.data?.status === "FAILED") {
      const providerError = payload.data?.job?.provider_error;
      throw new Error(
        providerError?.message ||
          providerError?.error_message ||
          "La generacion de slides fallo en segundo plano.",
      );
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 3_000));
  }
  throw new Error("La generacion de slides continua en segundo plano. Actualiza la pagina en unos minutos.");
}
