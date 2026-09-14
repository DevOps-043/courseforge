const JSON_CONTENT_TYPE = "application/json";

export async function readCompositionApiResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();
  if (!contentType.toLowerCase().includes(JSON_CONTENT_TYPE)) {
    throw new Error(response.status === 404
      ? `${fallbackMessage} El endpoint de snapshots no está disponible en este despliegue.`
      : `${fallbackMessage} El servidor devolvió una respuesta inesperada (${response.status}).`);
  }
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Error(`${fallbackMessage} El servidor devolvió JSON inválido.`);
  }
}
