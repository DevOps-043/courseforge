import { groundingRejectionDiagnostic } from "./grounding-rejection-diagnostic";

export type MaterialGenerationStage = "PREPARATION" | "GENERATION" | "VALIDATION" | "GROUNDING" | "PERSISTENCE" | "DISPATCH";
const STAGES: Record<MaterialGenerationStage,string> = { PREPARATION: "Preparación", GENERATION: "Generación", VALIDATION: "Validación", GROUNDING: "Respaldo de fuentes", PERSISTENCE: "Guardado", DISPATCH: "Despacho" };

/** Política común de recuperación. Nunca propagar mensajes arbitrarios del proveedor. */
export function materialGenerationError(error: unknown, stage: MaterialGenerationStage) {
  const detail = error && typeof error === "object" ? error as { name?: string; status?: number; statusCode?: number; code?: string; message?: string; groundingReason?: string; verificationCode?: string } : {};
  const status = detail.status || detail.statusCode;
  const text = `${detail.code || ""} ${detail.message || ""}`;
  const rejection = groundingRejectionDiagnostic(detail.groundingReason);
  let code = "GENERATION_FAILED", retryable = true;
  let message = "No se pudo completar la unidad. Reintenta únicamente los pendientes.";
  let action = "Reintentar unidad";
  if (/DELIVERY_STALE|REVISION|SOURCE_CONFLICT|cambiaron|sustituyó|recorrido cambió/i.test(text)) {
    code="INPUT_CHANGED"; retryable=false; message="Las entradas o la reserva cambiaron. Actualiza el estado antes de continuar."; action="Actualizar estado";
  } else if (/MATERIAL_RETRY_CAPACITY/.test(text)) {
    code="CAPACITY"; message="Ya hay dos lecciones activas. Reintenta cuando se libere una de ellas."; action="Esperar capacidad";
  } else if (/insufficient_quota|billing|credit/i.test(text)) {
    code="BILLING"; retryable=false; message="El proveedor requiere revisar cuota o facturación."; action="Revisar proveedor";
  } else if (status===401 || status===403 || status===404 || detail.verificationCode === "GROUNDING_PROVIDER_CONFIGURATION" || /UNSUPPORTED.*MODEL|api[_ ]key/i.test(text)) {
    code="PROVIDER_CONFIGURATION"; retryable=false; message="Revisa el acceso y la configuración del modelo."; action="Revisar configuración";
  } else if (status===429 || detail.verificationCode === "GROUNDING_PROVIDER_LIMIT") {
    code="PROVIDER_LIMIT"; message="El proveedor alcanzó su límite de uso. Espera antes de reintentar."; action="Reintentar más tarde";
  } else if (detail.verificationCode === "GROUNDING_TIMEOUT" || /Timeout|Abort/i.test(detail.name || "") || /timeout|timed out|presupuesto de tiempo/i.test(text)) {
    code="TIMEOUT"; message="Se agotó el tiempo disponible. Se conserva el progreso confirmado.";
  } else if (status===413) {
    code="CONTEXT_LIMIT"; retryable=false; message="El contenido supera el límite admitido. Revisa el alcance y las fuentes."; action="Revisar alcance";
  } else if (rejection) {
    code=rejection.code; retryable=false; message=rejection.message; action="Revisar fuentes y contenido";
  } else if (status===409 && stage==="GROUNDING") {
    code="GROUNDING_CONFLICT"; retryable=false; message="La revisión detectó un conflicto de fuentes o referencias no permitidas."; action="Actualizar y revisar fuentes";
  } else if (stage==="VALIDATION" || detail.verificationCode === "GROUNDING_INVALID_RESPONSE" || /ZodError|NoObjectGenerated|TypeValidation/.test(detail.name || "")) {
    code="INVALID_OUTPUT"; message="La respuesta no cumple el contrato de la unidad.";
  } else if (stage==="PERSISTENCE") {
    code="PERSISTENCE_UNCERTAIN"; retryable=false; message="No se pudo confirmar el guardado. Consulta el estado antes de repetir generación."; action="Consultar estado";
  } else if (stage==="GROUNDING") {
    code="GROUNDING_UNAVAILABLE"; message="La comprobación técnica de fuentes no pudo completarse.";
  } else if (stage==="DISPATCH") {
    code="DISPATCH_FAILED"; message="No se pudo confirmar el despacho. Consulta el estado antes de reintentar.";
  }
  return { code, stage, retryable, action, message: `${STAGES[stage]} · ${code}: ${message}` };
}
