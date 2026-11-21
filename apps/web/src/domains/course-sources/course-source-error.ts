import { groundingRejectionDiagnostic } from "../../lib/grounding-rejection-diagnostic";

export type CourseSourceGroundingRejection =
  | "UNSUPPORTED_OUTPUT"
  | "SOURCE_NOT_IN_CONTEXT"
  | "QUOTE_NOT_IN_SOURCE"
  | "CLAIM_NOT_IN_OUTPUT";

export class CourseSourceError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly groundingReason?: CourseSourceGroundingRejection,
    readonly verificationCode?: string,
  ) {
    super(message);
    this.name = "CourseSourceError";
  }
}

export class DocumentaryBasePendingError extends CourseSourceError {
  constructor(message: string, readonly defer = false) {
    super(503, message);
  }
}

/** Diagnóstico público acotado; no copiar respuestas, citas ni mensajes arbitrarios. */
export function sourceGroundingFailure(error: unknown) {
  const failure = error && typeof error === "object" ? error as { status?: number; statusCode?: number; name?: string; groundingReason?: string; verificationCode?: string } : {};
  const status = failure.status || failure.statusCode;
  const technical: Record<string,string> = {
    GROUNDING_TIMEOUT: "Se agotó el tiempo disponible para comprobar el respaldo.",
    GROUNDING_PROVIDER_LIMIT: "El proveedor de la revisión informó un límite de uso.",
    GROUNDING_PROVIDER_CONFIGURATION: "El proveedor de la revisión rechazó el acceso o la configuración del modelo.",
    GROUNDING_INVALID_RESPONSE: "La revisión devolvió una respuesta que no cumple el contrato de citas.",
    GROUNDING_UNAVAILABLE: "No se pudo completar la comprobación técnica de respaldo. Esto no confirma que las fuentes sean insuficientes.",
  };
  if (failure.verificationCode && Object.hasOwn(technical,failure.verificationCode)) return { code: failure.verificationCode, message: technical[failure.verificationCode] };
  const rejection = groundingRejectionDiagnostic(failure.groundingReason);
  if (rejection) return rejection;
  if (failure.name === "TimeoutError" || failure.name === "AbortError") return { code: "GROUNDING_TIMEOUT", message: "Se agotó el tiempo disponible para comprobar el respaldo." };
  if (status === 409) return { code: "GROUNDING_CONFLICT", message: "El respaldo fue rechazado por vigencia de fuentes, referencias privadas o conflicto de versión. Consulta el diagnóstico de la ejecución." };
  if (status === 413) return { code: "GROUNDING_SIZE_LIMIT", message: "El contenido supera el límite de revisión de respaldo." };
  if (status === 429) return { code: "GROUNDING_PROVIDER_LIMIT", message: "El proveedor de la revisión informó un límite de uso." };
  if (status === 401 || status === 403 || status === 404) return { code: "GROUNDING_PROVIDER_CONFIGURATION", message: "El proveedor de la revisión rechazó el acceso o la configuración del modelo." };
  if (/NoObjectGenerated|TypeValidation|ZodError/.test(failure.name || "")) return { code: "GROUNDING_INVALID_RESPONSE", message: "La revisión devolvió una respuesta que no cumple el contrato de citas." };
  return { code: "GROUNDING_UNAVAILABLE", message: "No se pudo completar la comprobación técnica de respaldo. Esto no confirma que las fuentes sean insuficientes." };
}

export class DocumentaryBaseBatchError extends CourseSourceError {
  constructor(message: string, readonly batchReason: "EXECUTION_EXPIRED" | "ATTEMPTS_EXHAUSTED" | "UNITS_EXHAUSTED" | "BUDGET_EXHAUSTED" | "BATCH_BLOCKED") {
    super(422, message);
  }
}

export function sourcePersistenceError(error: { message: string; code?: string }): never {
  if (error.code === "PGRST202" && /(?:all_course_source_materials|course_source_all_material_context)/.test(error.message)) throw new CourseSourceError(503, "Falta aplicar la migración 20261120010000_all_validated_material_sources.sql en Architect antes de usar el conjunto completo de fuentes.");
  if (error.message.includes("SOURCE_SET_INCOMPLETE")) throw new CourseSourceError(409, "Faltan fuentes válidas con contenido para una o más lecciones. Completa la búsqueda o procesa documentos.");
  if (error.message.includes("SOURCE_GENERATION_RUNNING")) throw new CourseSourceError(409, "La búsqueda sigue en curso. Espera a que termine antes de continuar a Materiales.");
  if (error.message.includes("SOURCE_PLAN_REQUIRED")) throw new CourseSourceError(409, "Aprueba el plan vigente antes de continuar a Materiales.");
  if (error.message.includes("SOURCE_CONTEXT_BUDGET")) throw new CourseSourceError(413, "El conjunto completo de fuentes supera el límite de contexto. Reduce el alcance o divide el curso; no se descartarán fuentes automáticamente.");
  if (error.code === "23505") throw new CourseSourceError(409, "El archivo o su sustitución ya están registrados. Reutiliza la versión existente.");
  if (error.message.includes("SOURCE_QUOTA")) throw new CourseSourceError(429, "Se alcanzó la cuota de documentos o borradores.");
  if (error.message.includes("SOURCE_NOT_FOUND")) throw new CourseSourceError(404, "Fuente o curso no encontrado.");
  if (error.message.includes("SOURCE_CONFLICT")) throw new CourseSourceError(409, "La solicitud ya no coincide con la reserva o su versión.");
  if (error.message.includes("SOURCE_EXPIRED")) throw new CourseSourceError(409, "La reserva de carga venció. Consulta el estado antes de iniciar otra carga.");
  throw new CourseSourceError(503, "No se pudo consultar o guardar el estado documental. Consulta el estado antes de reintentar.");
}
