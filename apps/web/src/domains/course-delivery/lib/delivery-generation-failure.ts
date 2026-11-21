import { materialGenerationError } from "../../../lib/material-generation-error";

export type DeliveryGenerationStage = "PREPARATION" | "GENERATION" | "VALIDATION" | "GROUNDING" | "PERSISTENCE";
const STAGES: Record<DeliveryGenerationStage, string> = {
  PREPARATION: "Preparación de entradas", GENERATION: "Generación de contenido",
  VALIDATION: "Validación del contenido", GROUNDING: "Comprobación de respaldo", PERSISTENCE: "Guardado de la unidad",
};

/** Mensajes públicos acotados: nunca persistir prompts, respuestas del proveedor o textos privados. */
export function deliveryGenerationFailure(failure: unknown, stage: DeliveryGenerationStage, timeoutMs: number) {
  if (stage === "GROUNDING") {
    const diagnostic = materialGenerationError(failure, stage);
    return { ...diagnostic, message: diagnostic.message.replace("Respaldo de fuentes", "Comprobación de respaldo") };
  }
  const error = failure && typeof failure === "object" ? failure as { name?: string; code?: string; status?: number; statusCode?: number; message?: string; groundingReason?: string } : {};
  const name = error.name || "Error";
  const text = String(error.message || "").toLowerCase();
  let code = "GENERATION_FAILED";
  let message = "No se pudo completar esta etapa. Consulta el identificador de ejecución para revisar el diagnóstico.";
  if (/TimeoutError|AbortError|Timeout/i.test(name) || /timed out|timeout|aborted|presupuesto de tiempo/.test(text)) {
    code = "TIMEOUT";
    message = stage === "GENERATION"
      ? `El proveedor no completó la respuesta dentro de ${timeoutMs / 1000} segundos. Reanuda para volver a intentar la unidad pendiente.`
      : "La etapa superó su presupuesto de tiempo. Se conserva el trabajo confirmado; reintenta los pendientes.";
  } else if (name === "ZodError" || /NoObjectGenerated|TypeValidation/.test(name) || stage === "VALIDATION") {
    code = "INVALID_OUTPUT"; message = "La respuesta no cumple el contrato o las referencias de la sesión. La versión anterior se conserva para revisión.";
  } else if (/cambiaron|sustituyó|SOURCE_CONFLICT|STALE/.test(String(error.message || ""))) {
    code = "INPUT_CHANGED"; message = "Las entradas o la versión del curso cambiaron. Actualiza el estado antes de reanudar.";
  } else if (error.status === 413 || error.statusCode === 413 || /SOURCE_CONTEXT_BUDGET/.test(String(error.message || ""))) {
    code = "CONTEXT_BUDGET"; message = "Las fuentes superan el presupuesto de contexto. Ajusta el alcance sin descartar evidencia silenciosamente.";
  } else if ([401,403,404].includes(error.status || error.statusCode || 0)) {
    code = "PROVIDER_CONFIGURATION"; message = "El proveedor rechazó la configuración o el acceso al modelo. Revisa la configuración antes de reanudar.";
  } else if (error.status === 429 || error.statusCode === 429) {
    code = "PROVIDER_LIMIT"; message = "El proveedor informó un límite de uso. Reintenta cuando se restablezca la disponibilidad.";
  }
  return { code, stage, message: `${STAGES[stage]} · ${code}: ${message}` };
}
