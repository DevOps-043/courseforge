import { sessionPlanSchema, type AgendaSession, type DeliveryDocument } from "../types/delivery.schemas";
import { planIssues } from "./delivery-policy";
import { hybridPlanIssues } from "./hybrid-route";

/** Solo recibe motivos producidos por validadores del servidor, nunca texto del proveedor. */
export class DeliveryPlanValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join(" "));
    this.name = "DeliveryPlanValidationError";
  }
}

export function planGenerationRequirements(document: DeliveryDocument, session: AgendaSession) {
  const route = document.hybridRoute || [];
  const position = route.findIndex(item => item.kind === "SYNCHRONOUS" && item.sessionId === session.id);
  const allowedLinks = document.config.mode === "HYBRID"
    ? route.flatMap((item, index) => item.kind === "ASYNCHRONOUS" ? item.lessonIds.map(lessonId => ({ lessonId, timing: index < position ? "BEFORE" : "AFTER" })) : [])
    : session.coverage.flatMap(item => ["BEFORE", "AFTER"].map(timing => ({ lessonId: item.lessonId, timing })));
  return {
    totalMinutes: session.minutes,
    uniqueBlockIds: true,
    allowedLinks,
    requiredLessonIds: document.config.mode === "HYBRID"
      ? session.coverage.filter(item => allowedLinks.some(link => link.lessonId === item.lessonId)).map(item => item.lessonId) : [],
    rules: "La suma de minutos de todos los bloques debe ser exactamente totalMinutes. Conserva IDs únicos. Cada nexusLink debe coincidir con un lessonId y timing permitidos. Incluye un vínculo por cada requiredLessonId y desarrolla su propósito pedagógico. No inventes referencias ni alteres el recorrido.",
  };
}

export function validateGeneratedSessionPlan(output: unknown, document: DeliveryDocument, session: AgendaSession) {
  const parsed = sessionPlanSchema.safeParse(output);
  if (!parsed.success) throw new DeliveryPlanValidationError(["La estructura del plan no cumple el esquema de bloques y vínculos de estudio."]);
  const issues = [...planIssues(session, parsed.data, document.config), ...hybridPlanIssues(document, session, parsed.data)];
  if (issues.length) throw new DeliveryPlanValidationError(issues);
  return parsed.data;
}
