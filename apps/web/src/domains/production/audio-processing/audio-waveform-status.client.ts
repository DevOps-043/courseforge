export type WaveformReadStatus =
  | "CHECKING" | "WAITING_WORKER" | "ANALYZING" | "RETRYING"
  | "WAITING_TIMEOUT" | "ANALYSIS_TIMEOUT" | "ANALYSIS_FAILED"
  | "CANCELLED" | "REQUEST_TIMEOUT" | "REQUEST_FAILED" | "QUEUE_FAILED"
  | "READY" | "NO_AUDIO";

export function waveformJobStatus(status: string | undefined): WaveformReadStatus {
  switch (status) {
    case "PENDING": return "WAITING_WORKER";
    case "RUNNING": return "ANALYZING";
    case "RETRY_SCHEDULED": return "RETRYING";
    case "FAILED": return "ANALYSIS_FAILED";
    case "CANCELLED": return "CANCELLED";
    case "NO_AUDIO": return "NO_AUDIO";
    // SUCCEEDED may still be waiting for the waveform read to finish.
    case "SUCCEEDED": return "ANALYZING";
    default: return "REQUEST_FAILED";
  }
}

export function waveformReadFailure(error: unknown, lastStatus: WaveformReadStatus): WaveformReadStatus {
  if (error instanceof Error) {
    if (error.message === "WAVEFORM_WAIT_TIMEOUT")
      return lastStatus === "WAITING_WORKER" ? "WAITING_TIMEOUT" : "ANALYSIS_TIMEOUT";
    if (error.name === "TimeoutError") return "REQUEST_TIMEOUT";
    if (error.message === "WAVEFORM_QUEUE_FAILED") return "QUEUE_FAILED";
  }
  return "REQUEST_FAILED";
}

const STATUS_MESSAGES: Partial<Record<WaveformReadStatus, { message: string; action?: string }>> = {
  CHECKING: { message: "Consultando ondas" },
  WAITING_WORKER: { message: "Esperando worker de audio. El análisis aún no ha comenzado" },
  ANALYZING: { message: "Analizando ondas" },
  RETRYING: { message: "Análisis en espera de un nuevo intento automático" },
  WAITING_TIMEOUT: { message: "Tiempo de espera agotado: el worker no tomó el trabajo durante los 10 minutos de consulta. El trabajo sigue en cola", action: "Volver a consultar" },
  ANALYSIS_TIMEOUT: { message: "Tiempo de espera agotado tras 10 minutos de consulta. El trabajo puede continuar en segundo plano", action: "Volver a consultar" },
  ANALYSIS_FAILED: { message: "El procesamiento de audio falló", action: "Reintentar análisis" },
  CANCELLED: { message: "El análisis fue cancelado", action: "Reintentar análisis" },
  REQUEST_TIMEOUT: { message: "La solicitud agotó su tiempo de espera. No se pudo confirmar el estado del análisis", action: "Volver a consultar" },
  REQUEST_FAILED: { message: "No se pudo consultar la onda o el estado del análisis", action: "Volver a consultar" },
  QUEUE_FAILED: { message: "No se pudo solicitar el análisis de audio", action: "Reintentar solicitud" },
};

export function waveformStatusNotices(statuses: Record<string, WaveformReadStatus>) {
  return Object.entries(STATUS_MESSAGES).flatMap(([status, notice]) => {
    const count = Object.values(statuses).filter((value) => value === status).length;
    return count && notice ? [{ status, count, ...notice }] : [];
  });
}
