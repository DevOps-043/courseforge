/** Budgets stay below the hosting background-function deadline (15 minutes). */
export const PIPELINE_GENERATION_LIMITS = {
  requestTimeoutMs: 120_000,
  dispatchTimeoutMs: 15_000,
  curationRunMs: 10 * 60_000,
  staleRunMs: 15 * 60_000,
} as const;

export function isGenerationStale(updatedAt: string, now = Date.now()) {
  const timestamp = Date.parse(updatedAt);
  return Number.isFinite(timestamp) && now - timestamp > PIPELINE_GENERATION_LIMITS.staleRunMs;
}

/** Provider errors are reduced to actionable diagnostics, without response bodies. */
export function generationFailureMessage(error: unknown): string {
  const detail = error && typeof error === "object" ? error as {
    status?: number; statusCode?: number; code?: string; message?: string;
  } : {};
  const status = detail.status ?? detail.statusCode;
  const message = `${detail.code || ""} ${detail.message || ""}`.toLowerCase();
  if (status === 404 || message.includes("model_not_found")) {
    return "El modelo de IA configurado no está disponible para esta cuenta. Revisa el modelo principal y su respaldo en Configuración.";
  }
  if (/no object generated|schema|type validation|invalid_json|json.*parse/i.test(message)) {
    return "El proveedor respondió con un formato inválido. No se guardó contenido incompleto; puedes reintentar la generación.";
  }
  if (typeof detail.code === "string" && /^(?:[0-9]{5}|PGRST\d+)$/.test(detail.code)) {
    return "No se pudo guardar el resultado en la base de datos. Revisa las migraciones y los registros de esta ejecución antes de reintentar.";
  }
  if (message.includes("insufficient_quota") || message.includes("billing") || message.includes("credit")) {
    return "El proveedor de IA rechazó la solicitud por cuota o saldo. Revisa la facturación del proveedor antes de reintentar.";
  }
  if (status === 429 || message.includes("resource_exhausted")) {
    return "El proveedor de IA alcanzó su límite de solicitudes o cuota. Revisa sus límites y vuelve a intentar más tarde.";
  }
  if (status === 401 || status === 403 || message.includes("api_key") || message.includes("api key")) {
    return "No se pudo autenticar con el proveedor de IA. Revisa la configuración de credenciales del servidor.";
  }
  if (message.includes("timeout") || message.includes("timed out") || message.includes("abort")) {
    return "La generación excedió el tiempo permitido. Puedes reintentar conservando el progreso guardado.";
  }
  return "La generación falló. Revisa los registros del servidor y vuelve a intentar.";
}

export function isPermanentProviderFailure(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const detail = error as { status?: number; code?: string; message?: string };
  return [400, 401, 403, 404].includes(detail.status || 0) ||
    /insufficient_quota|billing|credit/i.test(`${detail.code || ""} ${detail.message || ""}`);
}
