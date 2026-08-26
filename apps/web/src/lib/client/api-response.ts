export async function readApiResponse<T = any>(
  response: Response,
  fallback = "El servidor devolvio una respuesta invalida.",
): Promise<T> {
  const rawBody = await response.text();
  if (!rawBody.trim()) {
    if (response.ok) return {} as T;
    throw new Error(buildNonJsonMessage(response, fallback));
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Error(buildNonJsonMessage(response, fallback));
  }
}

function buildNonJsonMessage(response: Response, fallback: string) {
  if (response.status === 504) {
    return "La operacion excedio el tiempo de la API. El proceso puede continuar en segundo plano; consulta nuevamente el estado en unos segundos.";
  }
  if (response.status === 502 || response.status === 503) {
    return "El servicio de produccion no estuvo disponible temporalmente. Intenta de nuevo en unos segundos.";
  }
  return `${fallback} (HTTP ${response.status || "desconocido"}).`;
}
