import { API_ERROR_CODE, type ApiErrorCode } from "./api-contract";
import { isExternalImportCapacityError } from "./external-import-concurrency";
import { OutboundCircuitOpenError } from "./outbound-http";

export interface ExternalImportApiError {
  code: ApiErrorCode;
  message: string;
  retryAfterSeconds?: number;
  retryable: boolean;
  status: number;
}

export function mapExternalImportError(
  error: unknown,
  providerLabel: string,
): ExternalImportApiError {
  const internalMessage = error instanceof Error ? error.message : "";

  if (isExternalImportCapacityError(error)) {
    return {
      code: API_ERROR_CODE.dependencyUnavailable,
      message: "La capacidad de importación está ocupada. Intenta nuevamente en unos segundos.",
      retryAfterSeconds: error.retryAfterSeconds,
      retryable: true,
      status: 503,
    };
  }

  if (error instanceof OutboundCircuitOpenError) {
    return {
      code: API_ERROR_CODE.dependencyUnavailable,
      message: `${providerLabel} está temporalmente no disponible. Intenta nuevamente en unos segundos.`,
      retryAfterSeconds: error.retryAfterSeconds,
      retryable: true,
      status: 503,
    };
  }

  if (/supera (?:el )?l[ií]mite|too large|EXTERNAL_MEDIA_TOO_LARGE/i.test(internalMessage)) {
    return {
      code: API_ERROR_CODE.payloadTooLarge,
      message: "El archivo excede el límite permitido para importación.",
      retryable: false,
      status: 413,
    };
  }
  if (/no hay cuenta|reconectar|no est[aá] vinculada|access token/i.test(internalMessage)) {
    return {
      code: API_ERROR_CODE.conflict,
      message: `La conexión con ${providerLabel} requiere autorización nuevamente.`,
      retryable: false,
      status: 409,
    };
  }
  if (/no se pudo resolver el recurso|no encontrado/i.test(internalMessage)) {
    return {
      code: API_ERROR_CODE.resourceNotFound,
      message: `No se encontró el archivo solicitado en ${providerLabel}.`,
      retryable: false,
      status: 404,
    };
  }
  if (
    (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name))
    || /timed?\s*out|timeout/i.test(internalMessage)
  ) {
    return {
      code: API_ERROR_CODE.dependencyUnavailable,
      message: `${providerLabel} tardó demasiado en responder.`,
      retryable: true,
      status: 504,
    };
  }

  return {
    code: API_ERROR_CODE.providerError,
    message: `No se pudo completar la importación desde ${providerLabel}.`,
    retryable: true,
    status: 502,
  };
}
