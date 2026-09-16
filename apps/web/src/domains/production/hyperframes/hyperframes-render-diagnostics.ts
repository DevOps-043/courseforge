export interface RenderDiagnosticEvent {
  at: string;
  level: "info" | "warning" | "error";
  stage: string;
  message: string;
}

export interface HyperframesRenderDiagnostics {
  requestId: string;
  jobId: string;
  providerRenderId: string | null;
  providerStatus: string;
  importStatus: string;
  jobStatus: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  cancelledAt: string | null;
  archiveSizeBytes: number;
  uploadedBytes: number;
  sourceSizeBytes: number | null;
  attempts: number;
  failures: number;
  nextAttemptAt: string | null;
  lastActivityAt: string;
  events: RenderDiagnosticEvent[];
  error: string | null;
}

export function sanitizeRenderDiagnostic(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL omitida]")
    .replace(/\b(Bearer\s+)[\w.\-]+/gi, "$1[oculto]")
    .replace(/\b(api[_-]?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[oculto]")
    .slice(0, 700);
}

export function renderElapsedSeconds(createdAt: string, finishedAt: string | null, now = Date.now()): number {
  const start = Date.parse(createdAt);
  const end = finishedAt ? Date.parse(finishedAt) : now;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
}

export function formatRenderElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return [Math.floor(safe / 3600), Math.floor(safe / 60) % 60, safe % 60]
    .map((value) => String(value).padStart(2, "0")).join(":");
}

export function isRenderTerminal(value: Pick<HyperframesRenderDiagnostics, "jobStatus" | "importStatus" | "cancelledAt">): boolean {
  return Boolean(value.cancelledAt) || ["SUCCEEDED", "FAILED", "CANCELLED"].includes(value.jobStatus)
    || ["COMPLETED", "FAILED"].includes(value.importStatus);
}

export function renderStageLabel(providerStatus: string, importStatus: string, cancelledAt?: string | null): string {
  if (cancelledAt) return "Proceso cancelado";
  if (importStatus === "COMPLETED") return "Video importado";
  if (importStatus === "FAILED") return "Importación fallida";
  if (importStatus === "UPLOADING") return "Guardando video final";
  if (importStatus === "QUEUED") return "Esperando importación";
  if (importStatus === "RETRY_SCHEDULED") return "Importación pendiente de reintento";
  if (providerStatus === "UPLOADING") return "Subiendo ZIP a HeyGen";
  if (providerStatus === "SUBMITTING") return "Creando render en HeyGen";
  if (providerStatus === "FAILED") return "Render fallido";
  if (providerStatus === "COMPLETED") return "Render listo; esperando importación";
  if (["PENDING", "QUEUED"].includes(providerStatus.toUpperCase())) return "En cola de HeyGen";
  return "Renderizando en HeyGen";
}
